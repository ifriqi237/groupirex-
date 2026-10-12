/**
 * ORDER ENGINE (§14, §20 à §24, §43, §52).
 *
 *   Produit -> Quantité -> MOQ -> Prix final -> Commande -> Paiement -> Confirmation
 */

import { DealState, deriveDealStatus, remainingQuantity } from './deal';
import { DomainError, ErrorCode } from './errors';
import { CurrencyDef, Money } from './money';
import { PriceContext, convertPlain } from './price-engine';

/* ------------------------------------------------------------------ */
/* Unités de vente                                                     */
/* ------------------------------------------------------------------ */

export type SaleUnit = 'UNIT' | 'LOT' | 'CARTON' | 'PALLET';

export interface SalePackaging {
  saleUnit: SaleUnit;
  /** Nombre de pièces dans une unité de vente (1 pour UNIT). */
  piecesPerSaleUnit: number;
}

/** Les quantités commandées, le MOQ et les prix s'expriment tous en unités de vente. */
export function totalPieces(quantity: number, packaging: SalePackaging): number {
  return quantity * packaging.piecesPerSaleUnit;
}

/* ------------------------------------------------------------------ */
/* Participation                                                       */
/* ------------------------------------------------------------------ */

export interface ParticipationInput {
  authenticated: boolean;
  emailVerified: boolean;
  /** Faut-il un email vérifié pour commander ? (paramètre de la plateforme) */
  requireVerifiedEmail: boolean;
  quantity: number;
  /** Quantité minimale par commande, en unités de vente. */
  moq: number;
  /** Quantité maximale par commande, ou null. */
  maxPerOrder: number | null;
  deal: DealState;
  now: Date;
}

/**
 * Contrôles de participation, dans l'ordre du §20. Lève une DomainError au premier échec.
 * La couverture du pays et le tarif de livraison sont contrôlés par le Price Engine,
 * appelé juste après : une commande ne peut pas exister sans prix calculé.
 */
export function assertCanParticipate(input: ParticipationInput): void {
  if (!input.authenticated) throw new DomainError('AUTH_REQUIRED');
  if (input.requireVerifiedEmail && !input.emailVerified) {
    throw new DomainError('AUTH_EMAIL_NOT_VERIFIED');
  }

  const status = deriveDealStatus(input.deal, input.now);
  if (status === 'EXPIRED' || status === 'COMPLETED') throw new DomainError('DEAL_EXPIRED');
  if (status !== 'ACTIVE' && status !== 'TARGET_REACHED') {
    throw new DomainError('DEAL_NOT_ACTIVE', { status });
  }
  // Objectif atteint mais date de fin dépassée : la campagne n'accepte plus personne.
  if (input.now >= input.deal.endsAt) throw new DomainError('DEAL_EXPIRED');

  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new DomainError('QUANTITY_INVALID');
  }
  if (input.quantity < input.moq) {
    throw new DomainError('QUANTITY_BELOW_MOQ', { moq: input.moq });
  }
  if (input.maxPerOrder !== null && input.quantity > input.maxPerOrder) {
    throw new DomainError('QUANTITY_ABOVE_MAX', { max: input.maxPerOrder });
  }

  const remaining = remainingQuantity(input.deal);
  if (remaining !== null) {
    if (remaining === 0) throw new DomainError('DEAL_SOLD_OUT');
    if (input.quantity > remaining) {
      throw new DomainError('QUANTITY_NOT_AVAILABLE', { remaining });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Numérotation                                                        */
/* ------------------------------------------------------------------ */

/** GD-2026-00000125 */
export function formatOrderNumber(year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99_999_999) {
    throw new RangeError('Séquence de commande invalide');
  }
  return `GD-${year}-${String(sequence).padStart(8, '0')}`;
}

/** RB-2026-00000042 (réservation bureau) */
export function formatReservationNumber(year: number, sequence: number): string {
  return `RB-${year}-${String(sequence).padStart(8, '0')}`;
}

/** FA-… facture, PF-… proforma, RC-… reçu. */
export function formatInvoiceNumber(
  kind: 'INVOICE' | 'PROFORMA' | 'RECEIPT',
  year: number,
  sequence: number,
): string {
  const prefix = { INVOICE: 'FA', PROFORMA: 'PF', RECEIPT: 'RC' }[kind];
  return `${prefix}-${year}-${String(sequence).padStart(8, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Paiement en bureau : seuil de 500 000 FCFA (§22, §47)                */
/* ------------------------------------------------------------------ */

export const DEFAULT_OFFICE_THRESHOLD: Money = { amount: 500_000, currency: 'XAF' };

/**
 * Le total de la commande est converti dans la devise du seuil (XAF), sans marge
 * de change, puis comparé. 499 999 -> refusé ; 500 000 -> accepté.
 * Cette fonction est la SEULE source de vérité : l'API l'appelle pour décider,
 * et renvoie le résultat au client, qui ne fait que masquer ou afficher l'option.
 */
export function isOfficePaymentEligible(
  total: Money,
  ctx: PriceContext,
  threshold: Money = DEFAULT_OFFICE_THRESHOLD,
): boolean {
  return convertPlain(total, threshold.currency, ctx) >= threshold.amount;
}

export type PaymentMethod = 'ONLINE' | 'OFFICE';

export function assertPaymentMethodAllowed(
  method: PaymentMethod,
  total: Money,
  ctx: PriceContext,
  threshold: Money = DEFAULT_OFFICE_THRESHOLD,
): void {
  if (method === 'OFFICE' && !isOfficePaymentEligible(total, ctx, threshold)) {
    throw new DomainError('OFFICE_PAYMENT_NOT_ELIGIBLE', { threshold });
  }
}

/* ------------------------------------------------------------------ */
/* Délais de paiement                                                  */
/* ------------------------------------------------------------------ */

export interface HoldPolicy {
  onlineMinutes: number;
  officeHours: number;
}

export const DEFAULT_HOLD_POLICY: HoldPolicy = { onlineMinutes: 30, officeHours: 72 };

/**
 * Date limite de paiement. Une commande impayée ne retient jamais de quantité
 * au-delà de la fin de la campagne.
 */
export function paymentDeadline(
  method: PaymentMethod,
  now: Date,
  dealEndsAt: Date,
  policy: HoldPolicy = DEFAULT_HOLD_POLICY,
): Date {
  const ms =
    method === 'ONLINE' ? policy.onlineMinutes * 60_000 : policy.officeHours * 3_600_000;
  const deadline = new Date(now.getTime() + ms);
  // Le bureau garde un délai de grâce de 24 h après la fin de campagne pour encaisser.
  const cap =
    method === 'OFFICE' ? new Date(dealEndsAt.getTime() + 24 * 3_600_000) : dealEndsAt;
  return deadline < cap ? deadline : cap;
}

/* ------------------------------------------------------------------ */
/* Statuts                                                             */
/* ------------------------------------------------------------------ */

export type PaymentStatus =
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['PAID', 'FAILED', 'EXPIRED', 'CANCELLED'],
  FAILED: ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'],
  PAID: ['REFUND_PENDING'],
  EXPIRED: [],
  CANCELLED: [],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** Statuts d'une réservation en bureau (§24). */
export type ReservationStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'PAID' | 'EXPIRED' | 'CANCELLED';

const RESERVATION_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'PAID', 'EXPIRED', 'CANCELLED'],
  CONFIRMED: ['PAID', 'EXPIRED', 'CANCELLED'],
  PAID: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function canTransitionReservation(from: ReservationStatus, to: ReservationStatus): boolean {
  return RESERVATION_TRANSITIONS[from].includes(to);
}

/* ------------------------------------------------------------------ */
/* Vérification d'un paiement en ligne (§43)                           */
/* ------------------------------------------------------------------ */

export interface ExpectedPayment {
  /** Référence de transaction générée par GROUPDEALS (tx_ref). */
  reference: string;
  amount: number;
  currency: string;
  paymentStatus: PaymentStatus;
  /** Identifiant fournisseur déjà enregistré pour cette commande, s'il y en a un. */
  recordedProviderId: string | null;
}

/** Réponse de l'API de vérification du prestataire (jamais celle du navigateur). */
export interface ProviderVerification {
  providerId: string;
  status: 'successful' | 'failed' | 'pending' | string;
  reference: string;
  /** Montant en unités principales, tel que renvoyé par le prestataire (ex. 230000 ou 12.5). */
  amountMajor: number;
  currency: string;
}

export type PaymentDecision =
  | { outcome: 'CONFIRM'; paidAmount: number; overpaid: number }
  | { outcome: 'ALREADY_PROCESSED' }
  | { outcome: 'PENDING' }
  | { outcome: 'FAILED' }
  | { outcome: 'REFUND_REQUIRED'; paidAmount: number; reason: 'ORDER_CLOSED' | 'DUPLICATE_PAYMENT' }
  | { outcome: 'REJECT'; error: ErrorCode };

/**
 * Décide du sort d'un paiement à partir de la réponse VÉRIFIÉE du prestataire.
 * Fonction pure : la même entrée donne toujours la même décision, ce qui rend
 * le traitement des webhooks rejouable sans risque de double encaissement.
 */
export function decidePayment(
  expected: ExpectedPayment,
  provider: ProviderVerification,
  currency: CurrencyDef,
): PaymentDecision {
  if (provider.reference !== expected.reference) {
    return { outcome: 'REJECT', error: 'PAYMENT_REFERENCE_MISMATCH' };
  }
  if (provider.status === 'pending') return { outcome: 'PENDING' };
  if (provider.status !== 'successful') return { outcome: 'FAILED' };

  if (provider.currency !== expected.currency) {
    return { outcome: 'REJECT', error: 'PAYMENT_CURRENCY_MISMATCH' };
  }
  const paidAmount = Math.round(provider.amountMajor * 10 ** currency.decimals);
  if (!Number.isSafeInteger(paidAmount) || paidAmount < expected.amount) {
    return { outcome: 'REJECT', error: 'PAYMENT_AMOUNT_MISMATCH' };
  }

  if (expected.paymentStatus === 'PAID' || expected.paymentStatus === 'REFUND_PENDING' || expected.paymentStatus === 'REFUNDED') {
    // Même transaction rejouée : rien à faire. Autre transaction : double paiement à rembourser.
    return expected.recordedProviderId === provider.providerId
      ? { outcome: 'ALREADY_PROCESSED' }
      : { outcome: 'REFUND_REQUIRED', paidAmount, reason: 'DUPLICATE_PAYMENT' };
  }
  if (expected.paymentStatus === 'EXPIRED' || expected.paymentStatus === 'CANCELLED') {
    // L'argent est arrivé après la libération des quantités : on ne confirme pas à l'aveugle.
    return { outcome: 'REFUND_REQUIRED', paidAmount, reason: 'ORDER_CLOSED' };
  }
  return { outcome: 'CONFIRM', paidAmount, overpaid: paidAmount - expected.amount };
}
