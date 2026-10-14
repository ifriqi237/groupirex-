/**
 * Participation, commandes et documents (§20, §21, §26, §27).
 */

import { z } from 'zod';
import { DomainError, assertCanParticipate } from '@groupdeals/core';
import type { App } from '../app';
import { Reply } from '../http/server';
import { pageOf, viewerOf } from '../http/viewer';
import {
  ORDER_BUCKET_SQL,
  ORDER_SELECT,
  buildLines,
  cancelOrder,
  createOrder,
  officeEligibility,
  orderDetailDto,
  orderSummaryDto,
  pdfMoney,
} from '../services/orders';
import { UNIT_LABELS, quoteProformaData, renderInvoicePdf, sellerLines } from '../services/pdf';
import { randomDigits } from '../lib/crypto';
import { productThumb } from '../services/doc-image';
import { dealStateOf, loadOffer, localized, outsideCampaignCountries } from '../services/pricing';

const itemsSchema = z
  .array(z.object({ variantId: z.string().uuid().nullish(), quantity: z.number().int().min(1).max(1_000_000) }))
  .min(1)
  .max(50);

const participateSchema = z.object({
  items: itemsSchema,
  paymentMethod: z.enum(['ONLINE', 'OFFICE']),
  officeId: z.string().uuid().nullish(),
  pickupOfficeId: z.string().uuid().nullish(),
  /** Total affiché au client au moment du clic : si le prix a changé entre-temps, la commande est refusée. */
  expectedTotal: z.number().int().min(0).optional(),
});

const BUCKETS = ['PENDING_PAYMENT', 'PAID', 'IN_PRODUCTION', 'SHIPPED', 'READY_FOR_PICKUP', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'] as const;

export function registerOrderRoutes(app: App): void {
  const r = app.router;

  /**
   * Devis : prix final de chaque ligne, total, et modes de paiement possibles.
   * C'est le serveur qui dit si le bureau local est proposé ; le client se contente d'afficher.
   */
  r.post('/group-deals/:id/quote', { auth: 'optional', body: z.object({ items: itemsSchema }), rateLimit: { max: 120, windowSec: 60 } }, async (ctx) => {
    const viewer = await viewerOf(ctx);
    const country = await app.reference.country(viewer.countryCode);
    const offer = await loadOffer(app.db, ctx.params.id, country.code);
    if (!offer || offer.stored_status === 'DRAFT') throw new DomainError('NOT_FOUND');
    if (outsideCampaignCountries(offer, country.code)) throw new DomainError('DEAL_NOT_IN_COUNTRY');
    const lines = await buildLines(app, app.db, offer, ctx.body.items, country);
    const totalQuantity = lines.reduce((s, l) => s + l.quantity, 0);
    const total = lines.reduce((s, l) => s + l.lineTotal, 0);
    const ref = await app.reference.get();
    const money = (a: number) => app.reference.moneySync(ref, a, country.currencyCode, viewer.lang);

    let problem: { code: string; message: string; details: unknown } | null = null;
    try {
      assertCanParticipate({
        authenticated: true,
        emailVerified: true,
        requireVerifiedEmail: false,
        quantity: totalQuantity,
        moq: offer.min_quantity,
        maxPerOrder: offer.max_per_order,
        deal: dealStateOf(offer),
        now: ctx.now,
      });
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      problem = { code: e.code, message: e.message, details: e.details ?? null };
    }
    const officeEligible = await officeEligibility(app, total, country.currencyCode);
    return {
      lines: lines.map((l) => ({
        variantId: l.variantId,
        variantLabel: l.variantLabel,
        quantity: l.quantity,
        unitPrice: money(l.breakdown.unitFinal),
        lineTotal: money(l.lineTotal),
      })),
      totalQuantity,
      total: money(total),
      canOrder: problem === null,
      problem,
      paymentMethods: {
        online: true,
        office: officeEligible,
        officeThreshold: ref.officeThreshold ? app.reference.moneySync(ref, ref.officeThreshold.amount, ref.officeThreshold.currency, viewer.lang) : null,
      },
      emailVerificationRequired: (await app.reference.setting('orders.require_verified_email', true)) && !!ctx.user && !ctx.user.emailVerified,
    };
  });

  /**
   * Proforma de la page « Votre commande » : le devis du moment, en PDF, avant toute commande.
   * Rien n'est enregistré ni réservé ; les prix sont ceux que le serveur appliquerait à l'instant.
   */
  r.post(
    '/group-deals/:id/proforma',
    { body: z.object({ items: itemsSchema, paymentMethod: z.enum(['ONLINE', 'OFFICE']).optional(), officeId: z.string().uuid().nullish() }), rateLimit: { max: 30, windowSec: 60 } },
    async (ctx) => {
      const me = ctx.me();
      const viewer = await viewerOf(ctx);
      const country = await app.reference.country(viewer.countryCode);
      const offer = await loadOffer(app.db, ctx.params.id, country.code);
      if (!offer || offer.stored_status === 'DRAFT') throw new DomainError('NOT_FOUND');
    if (outsideCampaignCountries(offer, country.code)) throw new DomainError('DEAL_NOT_IN_COUNTRY');
      const lines = await buildLines(app, app.db, offer, ctx.body.items, country);
      const totalQuantity = lines.reduce((s, l) => s + l.quantity, 0);
      const total = lines.reduce((s, l) => s + l.lineTotal, 0);
      // Mêmes conditions que pour commander (offre ouverte, minimum, maximum) : sinon l'erreur dit pourquoi.
      assertCanParticipate({
        authenticated: true,
        emailVerified: true,
        requireVerifiedEmail: false,
        quantity: totalQuantity,
        moq: offer.min_quantity,
        maxPerOrder: offer.max_per_order,
        deal: dealStateOf(offer),
        now: ctx.now,
      });
      const ref = await app.reference.get();
      const currency = await app.reference.currency(country.currencyCode);
      const lang = viewer.lang === 'en' ? 'en' : 'fr';
      const eligible = await officeEligibility(app, total, country.currencyCode);
      const office =
        eligible && ctx.body.paymentMethod === 'OFFICE' && ctx.body.officeId
          ? await app.db.one(
              `SELECT name, city, address, phone FROM local_offices WHERE id = $1 AND country_code = $2 AND is_active AND accepts_payments`,
              [ctx.body.officeId, country.code],
            )
          : null;
      const user = await app.db.one(`SELECT first_name, last_name, email, whatsapp FROM users WHERE id = $1`, [me.id]);
      const productName = localized(offer.product_name, offer.product_i18n, lang, 'name');
      const cover = offer.cover as { url: string; thumbnailUrl: string | null; kind: string } | null;
      const image = cover?.kind === 'IMAGE' ? await productThumb(app, cover.thumbnailUrl ?? cover.url) : null;
      // Le QR Code rouvre « Votre commande » avec les mêmes quantités ; s'il devient trop long, la page de l'offre.
      const checkout = `${app.config.publicUrl}/checkout/${offer.deal_slug}?items=${lines.map((l) => `${l.variantId ?? ''}:${l.quantity}`).join(',')}`;
      const qrContent = Buffer.byteLength(checkout) <= 200 ? checkout : `${app.config.publicUrl}/deals/${offer.deal_slug}`;
      const data = quoteProformaData({
        lang,
        now: ctx.now,
        reference: randomDigits(6),
        customer: { name: `${user!.first_name} ${user!.last_name}`.trim(), email: user!.email, whatsapp: user!.whatsapp, country: country.name },
        offer: { title: (offer.deal_title as string | null) ?? productName, validUntil: offer.ends_at ? (offer.ends_at as Date).toISOString() : null },
        currency: country.currencyCode,
        lines: lines.map((l) => ({
          name: productName,
          variant: l.variantLabel,
          unit: UNIT_LABELS[lang][offer.sale_unit] ?? '',
          quantity: l.quantity,
          unitPrice: pdfMoney(l.breakdown.unitFinal, currency, lang),
          total: pdfMoney(l.lineTotal, currency, lang),
          image,
        })),
        total: pdfMoney(total, currency, lang),
        method: ctx.body.paymentMethod ?? 'ONLINE',
        office: office ? { name: office.name, city: office.city, address: office.address, phone: office.phone } : null,
        officeEligible: eligible,
        officeThreshold: ref.officeThreshold ? pdfMoney(ref.officeThreshold.amount, await app.reference.currency(ref.officeThreshold.currency), lang) : null,
        qrContent,
        seller: sellerLines(await app.reference.company(), lang),
      });
      return Reply.file(await renderInvoicePdf(data), 'application/pdf', `${data.number}.pdf`);
    },
  );

  /** « Participer au GroupDeals » : crée la commande et retient les quantités. */
  r.post('/group-deals/:id/participate', { body: participateSchema, rateLimit: { max: 20, windowSec: 60 } }, async (ctx) => {
    const me = ctx.me();
    const key = ctx.header('idempotency-key');
    if (!key || key.length < 8 || key.length > 100) {
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'Idempotency-Key', message: 'En-tête Idempotency-Key requis (8 à 100 caractères)' }] });
    }
    const out = await createOrder(app, { userId: me.id, dealId: ctx.params.id, idempotencyKey: key, ...ctx.body });
    const row = await app.db.one(`${ORDER_SELECT} WHERE o.id = $1`, [out.orderId]);
    const viewer = await viewerOf(ctx);
    const order = await orderDetailDto(app, app.db, row!, viewer.lang, ctx.now);
    return new Reply(out.created ? 201 : 200, { order, created: out.created });
  });

  r.get(
    '/orders',
    { query: z.object({ status: z.enum(BUCKETS).optional(), page: z.string().optional(), pageSize: z.string().optional() }) },
    async (ctx) => {
      const me = ctx.me();
      const viewer = await viewerOf(ctx);
      const page = pageOf(ctx.query);
      const params: unknown[] = [me.id];
      let filter = '';
      if (ctx.query.status) {
        params.push(ctx.query.status);
        filter = `AND ${ORDER_BUCKET_SQL} = $2`;
      }
      const rows = await app.db.all(
        `${ORDER_SELECT} WHERE o.user_id = $1 ${filter} ORDER BY o.created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
        params,
      );
      const counts = await app.db.all(
        `SELECT ${ORDER_BUCKET_SQL} AS bucket, count(*)::int AS n
           FROM orders o LEFT JOIN shipments s ON s.id = o.shipment_id WHERE o.user_id = $1 GROUP BY 1`,
        [me.id],
      );
      const items = [];
      for (const row of rows) items.push(await orderSummaryDto(app, row, viewer.lang));
      const byStatus = Object.fromEntries(counts.map((c) => [c.bucket, c.n]));
      return {
        items,
        page: page.page,
        pageSize: page.pageSize,
        total: ctx.query.status ? (byStatus[ctx.query.status] ?? 0) : counts.reduce((s, c) => s + c.n, 0),
        counts: byStatus,
      };
    },
  );

  r.get('/orders/:id', {}, async (ctx) => {
    const me = ctx.me();
    const row = await app.db.one(`${ORDER_SELECT} WHERE o.id = $1 AND o.user_id = $2`, [ctx.params.id, me.id]);
    if (!row) throw new DomainError('NOT_FOUND');
    const viewer = await viewerOf(ctx);
    return { order: await orderDetailDto(app, app.db, row, viewer.lang, ctx.now) };
  });

  r.post('/orders/:id/cancel', { body: z.object({ reason: z.string().trim().max(300).optional() }) }, async (ctx) => {
    const me = ctx.me();
    await cancelOrder(app, ctx.params.id, ctx.body.reason || 'Annulée par le client', { userId: me.id, asStaff: false });
    return { cancelled: true };
  });

  /** Facture proforma, facture ou reçu, en PDF (§26). */
  r.get('/orders/:id/documents/:kind', {}, async (ctx) => {
    const me = ctx.me();
    const kind = ctx.params.kind.replace(/\.pdf$/, '').toUpperCase();
    if (!['PROFORMA', 'INVOICE', 'RECEIPT'].includes(kind)) throw new DomainError('NOT_FOUND');
    const staff = ctx.can('orders.read') || ctx.can('office.payments.record');
    const row = await app.db.one(
      `SELECT i.number, i.data, o.user_id,
              (SELECT office_id FROM office_payments r WHERE r.order_id = o.id) AS office_id
         FROM invoices i JOIN orders o ON o.id = i.order_id WHERE i.order_id = $1 AND i.kind = $2`,
      [ctx.params.id, kind],
    );
    if (!row) throw new DomainError('NOT_FOUND');
    const own = row.user_id === me.id;
    // Un agent ne voit que les documents des réservations de son bureau.
    const officeOk = ctx.can('orders.read') || (row.office_id && me.officeIds.includes(row.office_id));
    if (!own && !(staff && officeOk)) throw new DomainError('NOT_FOUND');
    return Reply.file(await renderInvoicePdf(row.data), 'application/pdf', `${row.number}.pdf`);
  });
}
