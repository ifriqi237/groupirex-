/**
 * ORDER ENGINE côté base de données (§20 à §27, §43).
 *
 * Règles de concurrence :
 *   - toute opération qui touche aux quantités verrouille d'abord la campagne
 *     (SELECT … FOR UPDATE), puis la commande : toujours dans cet ordre, pour
 *     exclure les interblocages ;
 *   - une commande impayée RETIENT des quantités (held_quantity) jusqu'à son
 *     paiement, son annulation ou son expiration ; seules les quantités payées
 *     font avancer la jauge.
 */

import {
  CurrencyDef,
  DomainError,
  ErrorCode,
  PaymentMethod,
  PriceBreakdown,
  ProviderVerification,
  assertCanParticipate,
  decidePayment,
  deriveDealStatus,
  effectiveOrderStep,
  formatAmount,
  formatInvoiceNumber,
  formatOrderNumber,
  formatReservationNumber,
  isOfficePaymentEligible,
  lineTotal,
  paymentDeadline,
  remainingQuantity,
  LOGISTICS_STEPS,
} from '@groupdeals/core';
import type { App } from '../app';
import { Db, Row, uniqueViolation } from '../db/pool';
import { randomDigits, randomToken } from '../lib/crypto';
import { qrSvg } from '../lib/qr';
import { audit } from './audit';
import { productThumb } from './doc-image';
import { notify } from './notify';
import { InvoiceData, UNIT_LABELS, sellerLines, winAnsiSafe } from './pdf';
import { dealStateOf, loadOffer, localized, outsideCampaignCountries, priceOffer } from './pricing';
import type { CountryRow } from './reference';

export interface ItemInput {
  variantId?: string | null;
  quantity: number;
}

export interface PricedLine {
  variantId: string | null;
  variantLabel: string | null;
  quantity: number;
  breakdown: PriceBreakdown;
  lineTotal: number;
}

/* ------------------------------------------------------------------ */
/* Lignes et devis                                                     */
/* ------------------------------------------------------------------ */

/** Valide les variantes demandées et calcule le prix final de chaque ligne. */
export async function buildLines(app: App, db: Db, offer: Row, items: ItemInput[], country: CountryRow): Promise<PricedLine[]> {
  const variants = await db.all(
    `SELECT id, label, price_delta_amount FROM product_variants WHERE product_id = $1 AND is_active`,
    [offer.product_id],
  );
  const byId = new Map(variants.map((v) => [v.id as string, v]));
  const merged = new Map<string, number>();
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new DomainError('QUANTITY_INVALID');
    const key = item.variantId ?? '';
    if (variants.length > 0 && !key) throw new DomainError('VARIANT_REQUIRED');
    if (key && !byId.has(key)) throw new DomainError('VARIANT_INVALID');
    merged.set(key, (merged.get(key) ?? 0) + item.quantity);
  }
  if (merged.size === 0) throw new DomainError('QUANTITY_INVALID');

  const ctx = await app.reference.priceContext(country.code);
  const lines: PricedLine[] = [];
  for (const [key, quantity] of merged) {
    const variant = key ? byId.get(key)! : null;
    const priced = priceOffer(ctx, offer, country.code, country.currencyCode, variant?.price_delta_amount ?? 0);
    if (!priced.breakdown) throw new DomainError(priced.unavailable as ErrorCode);
    lines.push({
      variantId: variant?.id ?? null,
      variantLabel: variant?.label ?? null,
      quantity,
      breakdown: priced.breakdown,
      lineTotal: lineTotal(priced.breakdown.unitFinal, quantity),
    });
  }
  return lines;
}

/** Le paiement en bureau est-il possible pour ce total ? Décidé ici, côté serveur (§22). */
export async function officeEligibility(app: App, total: number, currency: string): Promise<boolean> {
  const ref = await app.reference.get();
  if (!ref.officeMethodActive) return false;
  if (!ref.officeThreshold) return true;
  const ctx = await app.reference.priceContext();
  try {
    return isOfficePaymentEligible({ amount: total, currency }, { ...ctx, maxRateAgeHours: 0 }, ref.officeThreshold);
  } catch {
    return false; // taux de change manquant : on ne propose pas le bureau
  }
}

/* ------------------------------------------------------------------ */
/* Création d'une commande                                             */
/* ------------------------------------------------------------------ */

export interface CreateOrderInput {
  userId: string;
  dealId: string;
  items: ItemInput[];
  paymentMethod: PaymentMethod;
  officeId?: string | null;
  pickupOfficeId?: string | null;
  expectedTotal?: number;
  idempotencyKey: string;
}

export async function createOrder(app: App, input: CreateOrderInput): Promise<{ orderId: string; created: boolean }> {
  const existing = await app.db.one(`SELECT id FROM orders WHERE user_id = $1 AND idempotency_key = $2`, [input.userId, input.idempotencyKey]);
  if (existing) return { orderId: existing.id, created: false };

  const now = app.clock.now();
  const requireVerified = await app.reference.setting('orders.require_verified_email', true);
  const policy = await app.reference.holdPolicy();

  try {
    const orderId = await app.db.tx(async (tx) => {
      const user = await tx.one(`SELECT id, country_code, email_verified_at, status FROM users WHERE id = $1`, [input.userId]);
      if (!user || user.status !== 'ACTIVE') throw new DomainError('AUTH_REQUIRED');
      const country = await app.reference.country(user.country_code);

      // Verrou sur la campagne : les participations à une même campagne passent une par une.
      const offer = await loadOffer(tx, input.dealId, country.code, true);
      if (!offer || offer.stored_status === 'DRAFT') throw new DomainError('NOT_FOUND');
      // Le pays est celui du compte, jamais celui envoyé par le navigateur.
      if (outsideCampaignCountries(offer, country.code)) throw new DomainError('DEAL_NOT_IN_COUNTRY');
      if (!offer.product_active) throw new DomainError('DEAL_NOT_ACTIVE');

      const lines = await buildLines(app, tx, offer, input.items, country);
      const totalQuantity = lines.reduce((s, l) => s + l.quantity, 0);
      const totalAmount = lines.reduce((s, l) => s + l.lineTotal, 0);

      assertCanParticipate({
        authenticated: true,
        emailVerified: user.email_verified_at !== null,
        requireVerifiedEmail: requireVerified,
        quantity: totalQuantity,
        moq: offer.min_quantity,
        maxPerOrder: offer.max_per_order,
        deal: dealStateOf(offer),
        now,
      });

      if (input.expectedTotal !== undefined && input.expectedTotal !== totalAmount) {
        throw new DomainError('PRICE_CHANGED', { total: totalAmount, currency: country.currencyCode });
      }

      // Mode de paiement : la règle des 500 000 FCFA est appliquée ici, quel que soit ce que le client a envoyé.
      let office: Row | null = null;
      if (input.paymentMethod === 'OFFICE') {
        if (!(await officeEligibility(app, totalAmount, country.currencyCode))) throw new DomainError('OFFICE_PAYMENT_NOT_ELIGIBLE');
        if (!input.officeId) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'officeId', message: 'Bureau requis' }] });
        office = await tx.one(`SELECT * FROM local_offices WHERE id = $1`, [input.officeId]);
        if (!office || office.country_code !== country.code) throw new DomainError('OFFICE_NOT_AVAILABLE');
        if (!office.is_active || !office.accepts_payments) throw new DomainError('OFFICE_CLOSED');
      }

      // Bureau de retrait : celui du paiement par défaut, sinon celui choisi.
      const pickupId = input.pickupOfficeId ?? (office?.is_pickup_point ? office.id : null);
      if (pickupId) {
        const pickup = await tx.one(`SELECT country_code, is_active, is_pickup_point FROM local_offices WHERE id = $1`, [pickupId]);
        if (!pickup || pickup.country_code !== country.code || !pickup.is_active || !pickup.is_pickup_point) {
          throw new DomainError('OFFICE_NOT_AVAILABLE');
        }
      }

      const seq = (await tx.one(`SELECT nextval('order_number_seq')::int AS n`))!.n as number;
      const number = formatOrderNumber(now.getUTCFullYear(), seq);
      const expiresAt = paymentDeadline(input.paymentMethod, now, offer.ends_at, policy);

      const order = await tx.one(
        `INSERT INTO orders (number, user_id, deal_id, country_code, currency_code, total_quantity, total_amount,
                             payment_method, tx_ref, expires_at, pickup_office_id, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [number, user.id, offer.deal_id, country.code, country.currencyCode, totalQuantity, totalAmount,
         input.paymentMethod, `${number}-${randomToken(6)}`, expiresAt, pickupId, input.idempotencyKey, now],
      );

      for (const l of lines) {
        const b = l.breakdown;
        await tx.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, product_name, variant_label, sale_unit, pieces_per_sale_unit,
                                    quantity, unit_final_amount, line_total_amount,
                                    base_source_amount, base_source_currency, base_converted_amount,
                                    shipping_source_amount, shipping_source_currency, shipping_converted_amount,
                                    rounding_adjustment, fx_buffer_bps, reference_currency, rates_used,
                                    shipping_rate_id, estimated_unit_margin, computed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
          [order!.id, offer.product_id, l.variantId, offer.product_name, l.variantLabel, offer.sale_unit, offer.pieces_per_sale_unit,
           l.quantity, b.unitFinal, l.lineTotal,
           b.baseSource.amount, b.baseSource.currency, b.baseConverted,
           b.shippingSource.amount, b.shippingSource.currency, b.shippingConverted,
           b.roundingAdjustment, b.fxBufferBps, b.referenceCurrency, JSON.stringify(b.ratesUsed),
           offer.shipping_rate_id, b.estimatedUnitMargin, b.computedAt],
        );
      }

      // Retenue des quantités. La contrainte group_deals_no_oversell est le dernier rempart.
      await tx.query(`UPDATE group_deals SET held_quantity = held_quantity + $2 WHERE id = $1`, [offer.deal_id, totalQuantity]);

      if (office) await createReservation(app, tx, order!.id, office, now);

      await notify(tx, {
        userId: user.id,
        type: 'ORDER_CREATED',
        params: { number, paymentMethod: input.paymentMethod, expiresAt: expiresAt.toISOString() },
        link: `/orders/${order!.id}`,
      });
      await tx.query(
        `INSERT INTO analytics_events (type, user_id, country_code, entity_type, entity_id, data, created_at)
         VALUES ('order_created', $1, $2, 'deal', $3, $4, $5)`,
        [user.id, country.code, offer.deal_id, JSON.stringify({ quantity: totalQuantity, method: input.paymentMethod }), now],
      );
      return order!.id as string;
    });
    return { orderId, created: true };
  } catch (e) {
    if (uniqueViolation(e) === 'orders_user_id_idempotency_key_key') {
      const row = await app.db.one(`SELECT id FROM orders WHERE user_id = $1 AND idempotency_key = $2`, [input.userId, input.idempotencyKey]);
      if (row) return { orderId: row.id, created: false };
    }
    if ((e as { constraint?: string }).constraint === 'group_deals_no_oversell') throw new DomainError('QUANTITY_NOT_AVAILABLE');
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Réservation en bureau et documents                                  */
/* ------------------------------------------------------------------ */

async function nextDocNumber(db: Db, kind: 'INVOICE' | 'PROFORMA' | 'RECEIPT', now: Date): Promise<string> {
  const seq = (await db.one(`SELECT nextval('invoice_number_seq')::int AS n`))!.n as number;
  return formatInvoiceNumber(kind, now.getUTCFullYear(), seq);
}

/** Montant lisible dans un PDF : symbole s'il est imprimable, sinon code ISO. */
export function pdfMoney(amount: number, c: CurrencyDef, lang: string): string {
  const symbol = winAnsiSafe(c.symbol) === c.symbol ? c.symbol : c.code;
  return `${formatAmount(amount, c, lang)} ${symbol}`;
}

/** Fige le contenu d'un document au moment de son émission. */
export async function issueInvoice(app: App, db: Db, orderId: string, kind: 'INVOICE' | 'PROFORMA' | 'RECEIPT', now: Date): Promise<string> {
  const already = await db.one(`SELECT id FROM invoices WHERE order_id = $1 AND kind = $2`, [orderId, kind]);
  if (already) return already.id;
  const o = await db.one(
    `SELECT o.*, u.first_name, u.last_name, u.email, u.whatsapp, u.language_code, c.name AS country_name,
            (SELECT channel FROM payments p WHERE p.order_id = o.id AND p.status = 'SUCCESSFUL' LIMIT 1) AS pay_channel
       FROM orders o JOIN users u ON u.id = o.user_id JOIN countries c ON c.code = o.country_code WHERE o.id = $1`,
    [orderId],
  );
  const items = await db.all(
    `SELECT i.*, p.i18n AS product_i18n,
            (SELECT COALESCE(m.thumbnail_url, m.url) FROM product_media m
              WHERE m.product_id = i.product_id AND m.kind = 'IMAGE' ORDER BY m.sort_order LIMIT 1) AS image_url
       FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = $1 ORDER BY i.variant_label NULLS FIRST`,
    [orderId],
  );
  // Une image par produit, convertie une fois, puis figée dans le document.
  const images = new Map<string, string | null>();
  for (const i of items) if (!images.has(i.product_id)) images.set(i.product_id, await productThumb(app, i.image_url));
  const reservation = await db.one(
    `SELECT r.*, f.name AS office_name, f.city, f.address, f.phone FROM office_payments r
       JOIN local_offices f ON f.id = r.office_id WHERE r.order_id = $1`,
    [orderId],
  );
  const currency = await app.reference.currency(o!.currency_code);
  const lang = o!.language_code === 'en' ? 'en' : 'fr';
  const number = await nextDocNumber(db, kind, now);
  const data: InvoiceData = {
    kind,
    number,
    issuedAt: now.toISOString(),
    orderNumber: o!.number,
    lang,
    customer: { name: `${o!.first_name} ${o!.last_name}`.trim(), email: o!.email, whatsapp: o!.whatsapp, country: o!.country_name },
    currency: o!.currency_code,
    // Une ligne par produit, au prix unitaire FINAL. Pas de ligne de livraison (§16).
    lines: items.map((i) => ({
      name: localized(i.product_name, i.product_i18n, lang, 'name'),
      variant: i.variant_label,
      unit: UNIT_LABELS[lang][i.sale_unit] ?? '',
      quantity: i.quantity,
      unitPrice: pdfMoney(i.unit_final_amount, currency, lang),
      total: pdfMoney(i.line_total_amount, currency, lang),
      image: images.get(i.product_id) ?? null,
    })),
    total: pdfMoney(o!.total_amount, currency, lang),
    payment: { method: o!.payment_method, status: o!.payment_status, paidAt: o!.paid_at ? (o!.paid_at as Date).toISOString() : null, channel: o!.pay_channel },
    office: reservation ? { name: reservation.office_name, city: reservation.city, address: reservation.address, phone: reservation.phone } : null,
    reservation: reservation
      ? { number: reservation.number, expiresAt: (reservation.expires_at as Date).toISOString(), qrContent: reservationQrContent(app, reservation.qr_token) }
      : null,
    // Le QR Code ramène le client à sa commande (connexion demandée).
    qr: { content: `${app.config.publicUrl}/orders/${orderId}`, target: 'ORDER' },
    seller: sellerLines(await app.reference.company(), lang),
  };
  const row = await db.one(
    `INSERT INTO invoices (number, kind, order_id, amount, currency_code, data, issued_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [number, kind, orderId, o!.total_amount, o!.currency_code, JSON.stringify(data), now],
  );
  return row!.id;
}

export function reservationQrContent(app: App, qrToken: string): string {
  return `${app.config.publicUrl}/agent/scan/${qrToken}`;
}

/** Crée la réservation de paiement en bureau : numéro, QR Code, date limite, proforma (§24). */
export async function createReservation(app: App, db: Db, orderId: string, office: Row, now: Date): Promise<string> {
  const o = await db.one(`SELECT total_amount, currency_code, expires_at FROM orders WHERE id = $1`, [orderId]);
  const seq = (await db.one(`SELECT nextval('reservation_number_seq')::int AS n`))!.n as number;
  const row = await db.one(
    `INSERT INTO office_payments (number, order_id, office_id, amount, currency_code, qr_token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [formatReservationNumber(now.getUTCFullYear(), seq), orderId, office.id, o!.total_amount, o!.currency_code, randomToken(24), o!.expires_at],
  );
  await issueInvoice(app, db, orderId, 'PROFORMA', now);
  return row!.id;
}

/* ------------------------------------------------------------------ */
/* Confirmation d'un paiement                                          */
/* ------------------------------------------------------------------ */

export type PaymentSource =
  | { provider: 'FLUTTERWAVE' | 'SANDBOX'; verification: ProviderVerification; raw?: unknown }
  | { provider: 'OFFICE'; channel: 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'MOBILE_MONEY'; agentId: string };

export type PaymentOutcome = 'PAID' | 'ALREADY_PROCESSED' | 'PENDING' | 'FAILED' | 'REFUND_REQUIRED' | 'REJECTED';

/** S'assure qu'une expédition existe pour la campagne et le pays, et y rattache la commande. */
export async function attachToShipment(db: Db, orderId: string, dealId: string, countryCode: string, now: Date): Promise<string> {
  let shipment = await db.one(`SELECT id FROM shipments WHERE deal_id = $1 AND country_code = $2`, [dealId, countryCode]);
  if (!shipment) {
    const seq = (await db.one(`SELECT nextval('shipment_number_seq')::int AS n`))!.n as number;
    shipment = await db.one(
      `INSERT INTO shipments (reference, deal_id, country_code, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (deal_id, country_code) DO UPDATE SET updated_at = now() RETURNING id`,
      [`EX-${now.getUTCFullYear()}-${String(seq).padStart(6, '0')}`, dealId, countryCode, now],
    );
  }
  await db.query(`UPDATE orders SET shipment_id = $2 WHERE id = $1`, [orderId, shipment!.id]);
  return shipment!.id;
}

/** Passe une commande à « payée » et met à jour la campagne. La commande et la campagne sont déjà verrouillées. */
async function markPaid(app: App, tx: Db, order: Row, deal: Row, now: Date, kind: 'INVOICE' | 'RECEIPT'): Promise<void> {
  await tx.query(`UPDATE orders SET payment_status = 'PAID', paid_at = $2, holds_quantity = false WHERE id = $1`, [order.id, now]);
  await tx.query(
    `UPDATE group_deals SET paid_quantity = paid_quantity + $2, held_quantity = held_quantity - $3 WHERE id = $1`,
    [deal.id, order.total_quantity, order.holds_quantity ? order.total_quantity : 0],
  );
  const participant = await tx.one(
    `INSERT INTO group_deal_participants (deal_id, user_id, paid_quantity, orders_count, joined_at)
     VALUES ($1, $2, $3, 1, $4)
     ON CONFLICT (deal_id, user_id) DO UPDATE
       SET paid_quantity = group_deal_participants.paid_quantity + EXCLUDED.paid_quantity,
           orders_count = group_deal_participants.orders_count + 1
     RETURNING (xmax = 0) AS inserted`,
    [deal.id, order.user_id, order.total_quantity, now],
  );
  if (participant!.inserted) await tx.query(`UPDATE group_deals SET participants_count = participants_count + 1 WHERE id = $1`, [deal.id]);

  await issueInvoice(app, tx, order.id, kind, now);
  // Campagne déjà confirmée : la commande rejoint tout de suite l'expédition de son pays.
  if (deal.stored_status === 'COMPLETED') await attachToShipment(tx, order.id, deal.id, order.country_code, now);

  await notify(tx, { userId: order.user_id, type: 'PAYMENT_CONFIRMED', params: { number: order.number }, link: `/orders/${order.id}` });
  await tx.query(
    `INSERT INTO analytics_events (type, user_id, country_code, entity_type, entity_id, data, created_at)
     VALUES ('order_paid', $1, $2, 'deal', $3, $4, $5)`,
    [order.user_id, order.country_code, deal.id, JSON.stringify({ amount: order.total_amount, currency: order.currency_code, quantity: order.total_quantity }), now],
  );
}

/**
 * Applique un paiement à une commande. Idempotent : rejouer le même événement
 * (webhook reçu deux fois, clic double au bureau) ne change rien.
 */
export async function applyPayment(app: App, orderId: string, source: PaymentSource): Promise<{ outcome: PaymentOutcome; error?: ErrorCode }> {
  const now = app.clock.now();
  return app.db.tx(async (tx) => {
    const ref = await tx.one(`SELECT deal_id FROM orders WHERE id = $1`, [orderId]);
    if (!ref) throw new DomainError('NOT_FOUND');
    const deal = (await tx.one(`SELECT * FROM group_deals WHERE id = $1 FOR UPDATE`, [ref.deal_id]))!;
    const order = (await tx.one(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]))!;
    const currency = await app.reference.currency(order.currency_code);

    /* ---------- Paiement au bureau : l'agent encaisse le montant exact ---------- */
    if (source.provider === 'OFFICE') {
      if (order.payment_status === 'PAID') return { outcome: 'ALREADY_PROCESSED' as const };
      if (order.payment_status !== 'PENDING' && order.payment_status !== 'FAILED') throw new DomainError('RESERVATION_NOT_PAYABLE');
      if (order.expires_at <= now) throw new DomainError('RESERVATION_EXPIRED');
      const reservation = await tx.one(
        `UPDATE office_payments SET status = 'PAID', paid_at = $2, recorded_by = $3, channel = $4
          WHERE order_id = $1 AND status IN ('PENDING_PAYMENT', 'CONFIRMED') RETURNING id`,
        [order.id, now, source.agentId, source.channel],
      );
      if (!reservation) throw new DomainError('RESERVATION_NOT_PAYABLE');
      await tx.query(
        `INSERT INTO payments (order_id, provider, tx_ref, status, amount, currency_code, channel, verified_at, created_at)
         VALUES ($1, 'OFFICE', $2, 'SUCCESSFUL', $3, $4, $5, $6, $6)`,
        [order.id, order.tx_ref, order.total_amount, order.currency_code, source.channel, now],
      );
      await markPaid(app, tx, order, deal, now, 'RECEIPT');
      return { outcome: 'PAID' as const };
    }

    /* ---------- Paiement en ligne : décision à partir de la réponse vérifiée ---------- */
    const v = source.verification;
    const recorded = await tx.one(`SELECT provider_tx_id FROM payments WHERE order_id = $1 AND status = 'SUCCESSFUL'`, [order.id]);
    const decision = decidePayment(
      {
        reference: order.tx_ref,
        amount: order.total_amount,
        currency: order.currency_code,
        paymentStatus: order.payment_status,
        recordedProviderId: recorded?.provider_tx_id ?? null,
      },
      v,
      currency,
    );

    const record = async (status: string, amount: number, rejectReason: string | null = null): Promise<boolean> => {
      const res = await tx.query(
        `INSERT INTO payments (order_id, provider, provider_tx_id, tx_ref, status, amount, currency_code, reject_reason, raw, verified_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         ON CONFLICT (provider, provider_tx_id) WHERE provider_tx_id IS NOT NULL
         DO UPDATE SET status = EXCLUDED.status, amount = EXCLUDED.amount, raw = EXCLUDED.raw, verified_at = EXCLUDED.verified_at
           WHERE payments.status IN ('INITIATED', 'FAILED') AND EXCLUDED.status = 'SUCCESSFUL'
         RETURNING id`,
        [order.id, source.provider, v.providerId, order.tx_ref, status, amount, order.currency_code, rejectReason, JSON.stringify(source.raw ?? v), now],
      );
      return res.rowCount > 0;
    };
    const minor = Math.round(v.amountMajor * 10 ** currency.decimals);
    const refundRequired = async (paidAmount: number, reason: string) => {
      if (await record('REFUND_REQUIRED', paidAmount, reason)) {
        const payment = await tx.one(`SELECT id FROM payments WHERE provider = $1 AND provider_tx_id = $2`, [source.provider, v.providerId]);
        await tx.query(`INSERT INTO refunds (order_id, payment_id, amount, currency_code, reason, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
          order.id, payment!.id, paidAmount, order.currency_code, reason, now,
        ]);
        await notify(tx, { userId: order.user_id, type: 'REFUND_PENDING', params: { number: order.number }, link: `/orders/${order.id}` });
      }
      return { outcome: 'REFUND_REQUIRED' as const };
    };

    switch (decision.outcome) {
      case 'ALREADY_PROCESSED':
        return { outcome: 'ALREADY_PROCESSED' as const };
      case 'PENDING':
        return { outcome: 'PENDING' as const };
      case 'FAILED':
        if (await record('FAILED', Number.isSafeInteger(minor) ? Math.max(0, minor) : 0)) {
          if (order.payment_status === 'PENDING') await tx.query(`UPDATE orders SET payment_status = 'FAILED' WHERE id = $1`, [order.id]);
          await notify(tx, { userId: order.user_id, type: 'PAYMENT_FAILED', params: { number: order.number }, link: `/orders/${order.id}` });
        }
        return { outcome: 'FAILED' as const };
      case 'REJECT':
        if (await record('REJECTED', Number.isSafeInteger(minor) ? Math.max(0, minor) : 0, decision.error)) {
          await audit(tx, null, { action: 'payment.rejected', entityType: 'order', entityId: order.id, after: { ...v, reason: decision.error } });
        }
        return { outcome: 'REJECTED' as const, error: decision.error };
      case 'REFUND_REQUIRED': {
        if (decision.reason === 'ORDER_CLOSED' && order.payment_status === 'EXPIRED') {
          // L'argent est arrivé après l'expiration. Si la campagne est encore ouverte et qu'il
          // reste de la place, on honore la commande ; sinon on rembourse.
          const state = dealStateOf(deal);
          const status = deriveDealStatus(state, now);
          const remaining = remainingQuantity(state);
          const open = (status === 'ACTIVE' || status === 'TARGET_REACHED') && now < deal.ends_at;
          if (open && (remaining === null || remaining >= order.total_quantity)) {
            await record('SUCCESSFUL', decision.paidAmount);
            await markPaid(app, tx, { ...order, holds_quantity: false }, deal, now, 'INVOICE');
            await audit(tx, null, { action: 'order.revived_by_late_payment', entityType: 'order', entityId: order.id });
            return { outcome: 'PAID' as const };
          }
        }
        return refundRequired(decision.paidAmount, decision.reason);
      }
      case 'CONFIRM': {
        if (deal.stored_status === 'CANCELLED') return refundRequired(decision.paidAmount, 'DEAL_CANCELLED');
        await record('SUCCESSFUL', decision.paidAmount);
        await markPaid(app, tx, order, deal, now, 'INVOICE');
        if (decision.overpaid > 0) {
          await audit(tx, null, { action: 'payment.overpaid', entityType: 'order', entityId: order.id, after: { overpaid: decision.overpaid } });
        }
        return { outcome: 'PAID' as const };
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Annulation et expiration                                            */
/* ------------------------------------------------------------------ */

/** Libère les quantités retenues par une commande impayée. Campagne puis commande verrouillées par l'appelant. */
async function release(tx: Db, order: Row, status: 'EXPIRED' | 'CANCELLED', now: Date, reason: string | null): Promise<void> {
  await tx.query(
    `UPDATE orders SET payment_status = $2, holds_quantity = false, cancelled_at = $3, cancel_reason = $4 WHERE id = $1`,
    [order.id, status, status === 'CANCELLED' ? now : null, reason],
  );
  if (order.holds_quantity) {
    await tx.query(`UPDATE group_deals SET held_quantity = held_quantity - $2 WHERE id = $1`, [order.deal_id, order.total_quantity]);
  }
  await tx.query(
    `UPDATE office_payments SET status = $2 WHERE order_id = $1 AND status IN ('PENDING_PAYMENT', 'CONFIRMED')`,
    [order.id, status],
  );
}

export async function cancelOrder(app: App, orderId: string, reason: string, actor: { userId: string; asStaff: boolean }): Promise<void> {
  const now = app.clock.now();
  await app.db.tx(async (tx) => {
    const ref = await tx.one(`SELECT deal_id, user_id FROM orders WHERE id = $1`, [orderId]);
    if (!ref || (!actor.asStaff && ref.user_id !== actor.userId)) throw new DomainError('NOT_FOUND');
    await tx.one(`SELECT id FROM group_deals WHERE id = $1 FOR UPDATE`, [ref.deal_id]);
    const order = (await tx.one(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]))!;
    if (order.payment_status !== 'PENDING' && order.payment_status !== 'FAILED') throw new DomainError('ORDER_NOT_PAYABLE');
    await release(tx, order, 'CANCELLED', now, reason);
  });
}

/**
 * Tâche de fond : expire les commandes impayées dont le délai est dépassé.
 * Avant d'expirer une commande en ligne, on interroge le prestataire : si le
 * client a payé mais que le webhook n'est pas arrivé, la commande est confirmée.
 */
export async function expireUnpaidOrders(app: App, limit = 100): Promise<{ expired: number; recovered: number }> {
  const now = app.clock.now();
  const due = await app.db.all(
    `SELECT id, tx_ref, payment_method FROM orders
      WHERE holds_quantity AND expires_at <= $1 AND payment_status IN ('PENDING', 'FAILED')
      ORDER BY expires_at LIMIT $2`,
    [now, limit],
  );
  let expired = 0;
  let recovered = 0;
  for (const o of due) {
    if (o.payment_method === 'ONLINE') {
      try {
        const v = await app.gateway.verifyByReference(o.tx_ref);
        if (v?.status === 'successful') {
          const res = await applyPayment(app, o.id, { provider: app.gateway.name, verification: v });
          if (res.outcome === 'PAID') {
            recovered++;
            continue;
          }
        }
      } catch (e) {
        // Prestataire injoignable : on n'expire pas à l'aveugle, on réessaiera au prochain passage.
        app.log.error('expire_verify_failed', { orderId: o.id, error: String(e) });
        continue;
      }
    }
    const done = await app.db.tx(async (tx) => {
      const ref = await tx.one(`SELECT deal_id FROM orders WHERE id = $1`, [o.id]);
      await tx.one(`SELECT id FROM group_deals WHERE id = $1 FOR UPDATE`, [ref!.deal_id]);
      const order = (await tx.one(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [o.id]))!;
      if (!order.holds_quantity || order.expires_at > now || !['PENDING', 'FAILED'].includes(order.payment_status)) return false;
      await release(tx, order, 'EXPIRED', now, null);
      await notify(tx, { userId: order.user_id, type: 'ORDER_EXPIRED', params: { number: order.number }, link: `/orders/${order.id}` });
      return true;
    });
    if (done) expired++;
  }
  return { expired, recovered };
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

/** Regroupement utilisé par « Mes commandes » (§27). */
export const ORDER_BUCKET_SQL = `
  CASE
    WHEN o.payment_status IN ('PENDING', 'FAILED') THEN 'PENDING_PAYMENT'
    WHEN o.payment_status <> 'PAID' THEN o.payment_status
    WHEN o.pickup_step = 9 THEN 'COMPLETED'
    WHEN o.pickup_step = 8 THEN 'READY_FOR_PICKUP'
    WHEN COALESCE(s.current_step, 0) >= 3 THEN 'SHIPPED'
    WHEN COALESCE(s.current_step, 0) >= 1 THEN 'IN_PRODUCTION'
    ELSE 'PAID'
  END`;

export const ORDER_SELECT = `
  SELECT o.*, ${ORDER_BUCKET_SQL} AS bucket,
         s.current_step AS shipment_step, s.reference AS shipment_reference, s.transport_mode, s.vessel_name,
         s.departure_port, s.arrival_port, s.eta, s.vessel_position,
         d.slug AS deal_slug, d.title AS deal_title, d.stored_status AS deal_stored_status, d.ends_at AS deal_ends_at,
         p.name AS product_name, p.i18n AS product_i18n, p.slug AS product_slug,
         (SELECT json_build_object('kind', m.kind, 'url', m.url, 'thumbnailUrl', m.thumbnail_url, 'alt', m.alt)
            FROM product_media m WHERE m.product_id = p.id ORDER BY (m.kind = 'IMAGE') DESC, m.sort_order LIMIT 1) AS cover
    FROM orders o
    JOIN group_deals d ON d.id = o.deal_id
    JOIN products p ON p.id = d.product_id
    LEFT JOIN shipments s ON s.id = o.shipment_id`;

/** Résumé d'une commande pour les listes. */
export async function orderSummaryDto(app: App, row: Row, lang: string) {
  const ref = await app.reference.get();
  return {
    id: row.id,
    number: row.number,
    status: row.bucket as string,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    total: app.reference.moneySync(ref, row.total_amount, row.currency_code, lang),
    totalQuantity: row.total_quantity,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    logisticsStep: row.payment_status === 'PAID' ? effectiveOrderStep(row.shipment_step ?? 0, row.pickup_step) : 0,
    deal: { slug: row.deal_slug, title: row.deal_title ?? localized(row.product_name, row.product_i18n, lang, 'name') },
    product: { name: localized(row.product_name, row.product_i18n, lang, 'name'), slug: row.product_slug, cover: row.cover },
  };
}

/** Détail complet d'une commande pour son propriétaire. Aucun composant de prix interne n'y figure. */
export async function orderDetailDto(app: App, db: Db, row: Row, lang: string, now: Date) {
  const ref = await app.reference.get();
  const money = (amount: number) => app.reference.moneySync(ref, amount, row.currency_code, lang);
  const [items, invoices, reservation, tracking, pickupOffice] = await Promise.all([
    db.all(
      `SELECT i.product_name, p.i18n AS product_i18n, i.variant_label, i.sale_unit, i.pieces_per_sale_unit, i.quantity, i.unit_final_amount, i.line_total_amount
         FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = $1 ORDER BY i.variant_label NULLS FIRST`,
      [row.id],
    ),
    db.all(`SELECT kind, number, issued_at FROM invoices WHERE order_id = $1 ORDER BY issued_at`, [row.id]),
    db.one(
      `SELECT r.id, r.number, r.status, r.qr_token, r.expires_at, r.paid_at, r.amount,
              f.id AS office_id, f.name, f.city, f.address, f.phone, f.whatsapp, f.email, f.opening_hours, f.latitude, f.longitude
         FROM office_payments r JOIN local_offices f ON f.id = r.office_id WHERE r.order_id = $1`,
      [row.id],
    ),
    db.all(
      `SELECT step, status, note, occurred_at FROM logistics_tracking
        WHERE (shipment_id = $1 OR order_id = $2) ORDER BY occurred_at, created_at`,
      [row.shipment_id, row.id],
    ),
    row.pickup_office_id
      ? db.one(`SELECT id, name, city, address, phone, whatsapp, opening_hours, latitude, longitude FROM local_offices WHERE id = $1`, [row.pickup_office_id])
      : Promise.resolve(null),
  ]);

  const paid = row.payment_status === 'PAID';
  const currentStep = paid ? effectiveOrderStep(row.shipment_step ?? 0, row.pickup_step) : 0;
  // Dernier état connu de chaque étape (une étape annulée par un retour en arrière n'est plus « faite »).
  const last = new Map<number, Row>();
  for (const t of tracking) last.set(t.step, t);
  const steps = LOGISTICS_STEPS.map((s) => {
    const t = last.get(s.step);
    const reached = s.step <= currentStep && t && t.status !== 'REVERTED';
    return {
      step: s.step,
      code: s.code,
      state: reached ? (t!.status === 'SKIPPED' ? 'skipped' : 'done') : s.step === currentStep + 1 && paid ? 'next' : 'pending',
      at: reached ? t!.occurred_at : null,
      note: reached ? t!.note : null,
    };
  });
  const payable = ['PENDING', 'FAILED'].includes(row.payment_status) && row.expires_at > now;

  return {
    ...(await orderSummaryDto(app, row, lang)),
    country: row.country_code,
    serverTime: now,
    canPayOnline: payable && row.payment_method === 'ONLINE',
    canCancel: payable,
    items: items.map((i) => ({
      productName: localized(i.product_name, i.product_i18n, lang, 'name'),
      variantLabel: i.variant_label,
      saleUnit: i.sale_unit,
      piecesPerSaleUnit: i.pieces_per_sale_unit,
      quantity: i.quantity,
      unitPrice: money(i.unit_final_amount),
      lineTotal: money(i.line_total_amount),
    })),
    documents: invoices.map((i) => ({ kind: i.kind, number: i.number, issuedAt: i.issued_at, url: `/api/v1/orders/${row.id}/documents/${String(i.kind).toLowerCase()}` })),
    reservation: reservation
      ? {
          id: reservation.id,
          number: reservation.number,
          status: reservation.status,
          expiresAt: reservation.expires_at,
          paidAt: reservation.paid_at,
          amount: money(reservation.amount),
          qrContent: reservationQrContent(app, reservation.qr_token),
          qrSvg: qrSvg(reservationQrContent(app, reservation.qr_token)),
          office: officeDto(reservation, 'office_id'),
        }
      : null,
    logistics: {
      currentStep,
      steps,
      shipmentReference: row.shipment_reference,
      transportMode: row.transport_mode,
      vessel:
        row.shipment_id && (row.vessel_name || row.vessel_position || row.eta)
          ? { name: row.vessel_name, departurePort: row.departure_port, arrivalPort: row.arrival_port, eta: row.eta, position: row.vessel_position }
          : null,
      pickup: {
        office: pickupOffice ? officeDto(pickupOffice, 'id') : null,
        // Le code de retrait n'est révélé qu'à partir de l'étape 8.
        code: row.pickup_step >= 8 ? row.pickup_code : null,
        pickedUpAt: row.picked_up_at,
      },
    },
    cancelReason: row.cancel_reason,
  };
}

export function officeDto(o: Row, idField = 'id') {
  return {
    id: o[idField],
    name: o.name,
    city: o.city,
    address: o.address,
    phone: o.phone,
    whatsapp: o.whatsapp,
    email: o.email ?? null,
    openingHours: o.opening_hours,
    latitude: o.latitude === null || o.latitude === undefined ? null : Number(o.latitude),
    longitude: o.longitude === null || o.longitude === undefined ? null : Number(o.longitude),
  };
}

export const newPickupCode = () => randomDigits(6);
