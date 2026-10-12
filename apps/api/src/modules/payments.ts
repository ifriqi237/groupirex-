/**
 * Paiement en ligne (§22-A, §43).
 *
 * Le navigateur ne décide jamais qu'un paiement est réussi. Les deux chemins
 * (webhook du prestataire, retour du client sur le site) aboutissent au même
 * endroit : le serveur interroge le prestataire, puis applique la décision.
 */

import { z } from 'zod';
import { DomainError } from '@groupdeals/core';
import type { App } from '../app';
import { Reply } from '../http/server';
import { SandboxGateway } from '../services/gateway';
import { PaymentOutcome, applyPayment } from '../services/orders';

/** Vérifie une transaction auprès du prestataire et l'applique à la commande correspondante. */
async function verifyAndApply(app: App, lookup: { providerTxId?: string | null; txRef?: string | null }): Promise<{ outcome: PaymentOutcome | 'UNKNOWN'; orderId: string | null }> {
  const verification = lookup.providerTxId
    ? await app.gateway.verify(lookup.providerTxId)
    : lookup.txRef
      ? await app.gateway.verifyByReference(lookup.txRef)
      : null;
  if (!verification) return { outcome: 'UNKNOWN', orderId: null };
  // La commande est retrouvée par la référence que renvoie le prestataire, pas par celle du message reçu.
  const order = await app.db.one(`SELECT id FROM orders WHERE tx_ref = $1`, [verification.reference]);
  if (!order) return { outcome: 'UNKNOWN', orderId: null };
  const res = await applyPayment(app, order.id, { provider: app.gateway.name, verification, raw: verification });
  return { outcome: res.outcome, orderId: order.id };
}

/** Traite un webhook déjà authentifié. Idempotent grâce à la table webhook_events. */
export async function handleWebhook(app: App, headers: Record<string, string | string[] | undefined>, rawBody: Buffer): Promise<{ status: number; body: unknown }> {
  const event = app.gateway.parseWebhook(headers, rawBody);
  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    payload = { unparsable: true };
  }
  if (!event) {
    await app.db.query(
      `INSERT INTO webhook_events (provider, dedupe_key, signature_valid, payload, result, processed_at)
       VALUES ($1, $2, false, $3, 'SIGNATURE_INVALID', now())`,
      [app.gateway.name, `invalid:${Date.now()}:${Math.random().toString(36).slice(2)}`, JSON.stringify(payload)],
    );
    return { status: 401, body: { error: { code: 'WEBHOOK_SIGNATURE_INVALID' } } };
  }

  const inserted = await app.db.one(
    `INSERT INTO webhook_events (provider, dedupe_key, signature_valid, payload) VALUES ($1, $2, true, $3)
     ON CONFLICT (provider, dedupe_key) DO NOTHING RETURNING id`,
    [app.gateway.name, event.dedupeKey, JSON.stringify(payload)],
  );
  if (!inserted) {
    const prev = await app.db.one(`SELECT processed_at FROM webhook_events WHERE provider = $1 AND dedupe_key = $2`, [app.gateway.name, event.dedupeKey]);
    if (prev?.processed_at) return { status: 200, body: { received: true, duplicate: true } };
  }

  // Si la vérification échoue (prestataire injoignable), on répond 5xx : le prestataire renverra l'événement.
  const res = await verifyAndApply(app, { providerTxId: event.providerTxId, txRef: event.txRef });
  await app.db.query(`UPDATE webhook_events SET processed_at = now(), result = $3 WHERE provider = $1 AND dedupe_key = $2`, [
    app.gateway.name,
    event.dedupeKey,
    res.outcome,
  ]);
  return { status: 200, body: { received: true, outcome: res.outcome } };
}

export function registerPaymentRoutes(app: App): void {
  const r = app.router;

  /** Ouvre (ou rouvre) une page de paiement pour une commande en attente. */
  r.post('/payments', { body: z.object({ orderId: z.string().uuid() }), rateLimit: { max: 20, windowSec: 60 } }, async (ctx) => {
    const me = ctx.me();
    const o = await app.db.one(
      `SELECT o.*, u.email, u.first_name, u.last_name, u.whatsapp, p.name AS product_name
         FROM orders o JOIN users u ON u.id = o.user_id JOIN group_deals d ON d.id = o.deal_id JOIN products p ON p.id = d.product_id
        WHERE o.id = $1 AND o.user_id = $2`,
      [ctx.body.orderId, me.id],
    );
    if (!o) throw new DomainError('NOT_FOUND');
    if (o.payment_method !== 'ONLINE' || !['PENDING', 'FAILED'].includes(o.payment_status)) throw new DomainError('ORDER_NOT_PAYABLE');
    if (o.expires_at <= ctx.now) throw new DomainError('ORDER_EXPIRED');
    const currency = await app.reference.currency(o.currency_code);
    const { checkoutUrl } = await app.gateway.createCheckout({
      txRef: o.tx_ref,
      amountMajor: o.total_amount / 10 ** currency.decimals,
      currency: o.currency_code,
      customer: { email: o.email, name: `${o.first_name} ${o.last_name}`.trim(), phone: o.whatsapp },
      description: `${o.number} — ${o.product_name}`,
      redirectUrl: `${app.config.publicUrl}/payment/return?order=${o.id}`,
    });
    await app.db.query(
      `INSERT INTO analytics_events (type, user_id, country_code, entity_type, entity_id) VALUES ('checkout_start', $1, $2, 'deal', $3)`,
      [me.id, o.country_code, o.deal_id],
    );
    return { checkoutUrl, expiresAt: o.expires_at };
  });

  /** Notification serveur à serveur du prestataire. Corps brut, signature obligatoire. */
  r.post('/payments/webhook', { auth: 'none', raw: true, rateLimit: { max: 300, windowSec: 60 } }, async (ctx) => {
    const res = await handleWebhook(app, ctx.req.headers, ctx.rawBody);
    return new Reply(res.status, res.body);
  });

  /**
   * Appelé par le site quand le client revient de la page de paiement.
   * Les paramètres de l'URL de retour ne sont qu'un indice : le statut vient du prestataire.
   */
  r.post(
    '/payments/verify',
    { body: z.object({ orderId: z.string().uuid(), transactionId: z.string().max(64).optional() }), rateLimit: { max: 30, windowSec: 60 } },
    async (ctx) => {
      const me = ctx.me();
      const o = await app.db.one(`SELECT id, tx_ref, payment_status FROM orders WHERE id = $1 AND user_id = $2`, [ctx.body.orderId, me.id]);
      if (!o) throw new DomainError('NOT_FOUND');
      let outcome: string = o.payment_status === 'PAID' ? 'PAID' : 'PENDING';
      if (o.payment_status !== 'PAID') {
        const res = await verifyAndApply(app, { providerTxId: ctx.body.transactionId ?? null, txRef: o.tx_ref });
        // Une transaction qui appartient à une autre commande ne dit rien de celle-ci.
        if (res.orderId === o.id) outcome = res.outcome;
      }
      const fresh = await app.db.one(`SELECT payment_status FROM orders WHERE id = $1`, [o.id]);
      return { outcome, paymentStatus: fresh!.payment_status };
    },
  );

  /* ------------------------- Bac à sable (hors production) ------------------------- */

  if (app.gateway instanceof SandboxGateway) {
    const sandbox = app.gateway;

    r.get('/sandbox/checkout/:txRef', { auth: 'none' }, async (ctx) => {
      const checkout = sandbox.checkouts.get(ctx.params.txRef);
      if (!checkout) throw new DomainError('NOT_FOUND');
      const currency = await app.reference.currency(checkout.currency);
      const minor = Math.round(checkout.amountMajor * 10 ** currency.decimals);
      return {
        txRef: checkout.txRef,
        description: checkout.description,
        amount: await app.reference.money(minor, checkout.currency),
        redirectUrl: checkout.redirectUrl,
      };
    });

    /** Simule le paiement puis envoie à l'API le même webhook signé qu'un vrai prestataire. */
    r.post(
      '/sandbox/pay',
      { auth: 'none', body: z.object({ txRef: z.string().max(80), outcome: z.enum(['successful', 'failed']) }) },
      async (ctx) => {
        const checkout = sandbox.checkouts.get(ctx.body.txRef);
        if (!checkout) throw new DomainError('NOT_FOUND');
        const tx = sandbox.simulate(ctx.body.txRef, ctx.body.outcome);
        const body = JSON.stringify({ event: 'charge.completed', data: { id: Number(tx.providerId), tx_ref: tx.reference, status: tx.status } });
        await handleWebhook(app, { 'x-sandbox-signature': sandbox.signWebhook(body) }, Buffer.from(body));
        const sep = checkout.redirectUrl.includes('?') ? '&' : '?';
        return {
          transactionId: tx.providerId,
          redirectUrl: `${checkout.redirectUrl}${sep}status=${tx.status}&tx_ref=${encodeURIComponent(tx.reference)}&transaction_id=${tx.providerId}`,
        };
      },
    );
  }
}
