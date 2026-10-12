/**
 * Prestataire de paiement en ligne (§22, §43).
 *
 * L'API ne parle qu'à cette interface. Deux implémentations :
 *   - FlutterwaveGateway : production (Mobile Money, carte…) ;
 *   - SandboxGateway     : développement et tests, simule le prestataire sans réseau.
 *
 * Dans les deux cas, un paiement n'est jamais cru sur parole : le serveur
 * interroge le prestataire (`verify`) avant toute confirmation.
 */

import crypto from 'node:crypto';
import type { ProviderVerification } from '@groupdeals/core';
import { DomainError } from '@groupdeals/core';
import type { App } from '../app';
import { safeEqual } from '../lib/crypto';

export interface CheckoutRequest {
  txRef: string;
  /** Montant en unités principales (ex. 230000 pour 230 000 XAF, 12.5 pour 12,50 USD). */
  amountMajor: number;
  currency: string;
  customer: { email: string; name: string; phone: string };
  description: string;
  redirectUrl: string;
}

export interface WebhookEvent {
  /** Clé de déduplication de l'événement. */
  dedupeKey: string;
  txRef: string | null;
  providerTxId: string | null;
}

export interface PaymentGateway {
  readonly name: 'FLUTTERWAVE' | 'SANDBOX';
  /** Crée la page de paiement et renvoie son adresse. */
  createCheckout(req: CheckoutRequest): Promise<{ checkoutUrl: string }>;
  /** Interroge le prestataire sur une transaction précise. */
  verify(providerTxId: string): Promise<ProviderVerification | null>;
  /** Cherche une transaction par notre référence (rattrapage quand le webhook n'est pas arrivé). */
  verifyByReference(txRef: string): Promise<ProviderVerification | null>;
  /** Vérifie la signature d'un webhook et en extrait l'essentiel ; null si la signature est invalide. */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookEvent | null;
}

/* ------------------------------------------------------------------ */
/* Flutterwave (API v3)                                                */
/* ------------------------------------------------------------------ */

export class FlutterwaveGateway implements PaymentGateway {
  readonly name = 'FLUTTERWAVE' as const;
  constructor(private readonly app: App) {}

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    const { flutterwaveBaseUrl, flutterwaveSecretKey } = this.app.config.payments;
    let res: Response;
    try {
      res = await fetch(flutterwaveBaseUrl + path, {
        method,
        headers: { Authorization: `Bearer ${flutterwaveSecretKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      this.app.log.error('flutterwave_unreachable', { path, error: String(e) });
      throw new DomainError('PAYMENT_PROVIDER_UNAVAILABLE');
    }
    const json: any = await res.json().catch(() => null);
    if (res.status >= 500 || !json) throw new DomainError('PAYMENT_PROVIDER_UNAVAILABLE');
    return { status: res.status, json };
  }

  private static normalize(data: any): ProviderVerification | null {
    if (!data || data.id === undefined) return null;
    return {
      providerId: String(data.id),
      status: String(data.status ?? '').toLowerCase(),
      reference: String(data.tx_ref ?? ''),
      amountMajor: Number(data.amount),
      currency: String(data.currency ?? ''),
    };
  }

  async createCheckout(req: CheckoutRequest): Promise<{ checkoutUrl: string }> {
    const { json } = await this.call('POST', '/payments', {
      tx_ref: req.txRef,
      amount: req.amountMajor,
      currency: req.currency,
      redirect_url: req.redirectUrl,
      customer: { email: req.customer.email, name: req.customer.name, phonenumber: req.customer.phone },
      customizations: { title: 'GROUPDEALS', description: req.description },
    });
    const link = json?.data?.link;
    if (json?.status !== 'success' || typeof link !== 'string') {
      this.app.log.error('flutterwave_checkout_failed', { txRef: req.txRef, message: json?.message });
      throw new DomainError('PAYMENT_PROVIDER_UNAVAILABLE');
    }
    return { checkoutUrl: link };
  }

  async verify(providerTxId: string): Promise<ProviderVerification | null> {
    if (!/^\d+$/.test(providerTxId)) return null;
    const { json } = await this.call('GET', `/transactions/${providerTxId}/verify`);
    return json?.status === 'success' ? FlutterwaveGateway.normalize(json.data) : null;
  }

  async verifyByReference(txRef: string): Promise<ProviderVerification | null> {
    const { json } = await this.call('GET', `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`);
    return json?.status === 'success' ? FlutterwaveGateway.normalize(json.data) : null;
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookEvent | null {
    // Flutterwave renvoie dans l'en-tête « verif-hash » le secret défini dans son tableau de bord.
    const signature = String(headers['verif-hash'] ?? '');
    const expected = this.app.config.payments.flutterwaveWebhookHash;
    if (!expected || !safeEqual(signature, expected)) return null;
    try {
      const payload = JSON.parse(rawBody.toString('utf8'));
      const data = payload?.data ?? {};
      const id = data.id !== undefined ? String(data.id) : null;
      return {
        dedupeKey: `${payload?.event ?? 'event'}:${id ?? crypto.createHash('sha256').update(rawBody).digest('hex')}:${data.status ?? ''}`,
        txRef: data.tx_ref ? String(data.tx_ref) : null,
        providerTxId: id,
      };
    } catch {
      return null;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Bac à sable                                                         */
/* ------------------------------------------------------------------ */

interface SandboxTx extends ProviderVerification {
  createdAt: number;
}

/**
 * Simule le prestataire : la page de paiement est une page locale où l'on choisit
 * « payer » ou « échouer ». Les transactions vivent en mémoire. Les webhooks sont
 * signés (HMAC) pour exercer le même chemin de code qu'en production.
 */
export class SandboxGateway implements PaymentGateway {
  readonly name = 'SANDBOX' as const;
  readonly checkouts = new Map<string, CheckoutRequest>();
  readonly transactions = new Map<string, SandboxTx>();
  private seq = 1000;
  constructor(private readonly app: App) {}

  get webhookSecret(): string {
    return crypto.createHmac('sha256', this.app.config.jwtSecret).update('sandbox-webhook').digest('hex');
  }

  async createCheckout(req: CheckoutRequest): Promise<{ checkoutUrl: string }> {
    this.checkouts.set(req.txRef, req);
    return { checkoutUrl: `${this.app.config.publicUrl}/sandbox/pay?tx_ref=${encodeURIComponent(req.txRef)}` };
  }

  /** Simule l'issue d'un paiement (appelé par la page de paiement factice et par les tests). */
  simulate(txRef: string, outcome: 'successful' | 'failed' | 'pending', override: Partial<ProviderVerification> = {}): SandboxTx {
    const checkout = this.checkouts.get(txRef);
    const tx: SandboxTx = {
      providerId: String(++this.seq),
      status: outcome,
      reference: txRef,
      amountMajor: checkout?.amountMajor ?? 0,
      currency: checkout?.currency ?? 'XAF',
      createdAt: Date.now(),
      ...override,
    };
    this.transactions.set(tx.providerId, tx);
    return tx;
  }

  async verify(providerTxId: string): Promise<ProviderVerification | null> {
    return this.transactions.get(providerTxId) ?? null;
  }

  async verifyByReference(txRef: string): Promise<ProviderVerification | null> {
    const all = [...this.transactions.values()].filter((t) => t.reference === txRef);
    return all.find((t) => t.status === 'successful') ?? all.at(-1) ?? null;
  }

  signWebhook(body: string): string {
    return crypto.createHmac('sha256', this.webhookSecret).update(body).digest('hex');
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookEvent | null {
    const signature = String(headers['x-sandbox-signature'] ?? '');
    if (!safeEqual(signature, this.signWebhook(rawBody.toString('utf8')))) return null;
    try {
      const payload = JSON.parse(rawBody.toString('utf8'));
      return {
        dedupeKey: `${payload.event}:${payload.data.id}:${payload.data.status}`,
        txRef: payload.data.tx_ref ?? null,
        providerTxId: payload.data.id !== undefined ? String(payload.data.id) : null,
      };
    } catch {
      return null;
    }
  }
}

export function createGateway(app: App): PaymentGateway {
  return app.config.payments.provider === 'flutterwave' ? new FlutterwaveGateway(app) : new SandboxGateway(app);
}
