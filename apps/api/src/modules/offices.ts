/**
 * Bureaux locaux (§23, §24) et interface de l'agent (§25).
 *
 * L'agent encaisse et remet les colis. Il ne peut modifier ni le prix, ni la
 * commande, ni les règles de livraison : aucune route d'écriture sur ces objets
 * ne lui est ouverte, et le montant encaissé est toujours celui de la commande.
 * Chaque action est écrite au journal d'audit.
 */

import { z } from 'zod';
import { AFRICAN_COUNTRIES, DomainError, africanCountry, isOfficeScoped, paymentDeadline } from '@groupdeals/core';
import type { App } from '../app';
import type { Row } from '../db/pool';
import { Ctx, Reply } from '../http/server';
import { viewerOf } from '../http/viewer';
import { safeEqual } from '../lib/crypto';
import { qrSvg } from '../lib/qr';
import { audit } from '../services/audit';
import { notify } from '../services/notify';
import { applyPayment, createReservation, issueInvoice, officeDto, officeEligibility, reservationQrContent } from '../services/orders';
import { localized } from '../services/pricing';

/** Bureaux sur lesquels l'utilisateur peut agir : null = tous (direction, finance). */
function officeScope(ctx: Ctx): string[] | null {
  const me = ctx.me();
  return isOfficeScoped(me.roles) ? me.officeIds : null;
}

function assertOffice(ctx: Ctx, officeId: string): void {
  const scope = officeScope(ctx);
  if (scope && !scope.includes(officeId)) throw new DomainError('RESERVATION_WRONG_OFFICE');
}

const RESERVATION_SELECT = `
  SELECT r.*, o.number AS order_number, o.total_quantity, o.payment_status, o.user_id, o.created_at AS order_created_at,
         u.first_name, u.last_name, u.whatsapp, u.email,
         f.name AS office_name, f.city AS office_city,
         p.name AS product_name
    FROM office_payments r
    JOIN orders o ON o.id = r.order_id
    JOIN users u ON u.id = o.user_id
    JOIN local_offices f ON f.id = r.office_id
    JOIN group_deals d ON d.id = o.deal_id
    JOIN products p ON p.id = d.product_id`;

async function reservationDto(app: App, row: Row, now: Date, withItems = false) {
  const ref = await app.reference.get();
  const money = (a: number) => app.reference.moneySync(ref, a, row.currency_code, 'fr');
  const items = withItems
    ? await app.db.all(`SELECT product_name, variant_label, quantity, unit_final_amount, line_total_amount, sale_unit FROM order_items WHERE order_id = $1`, [row.order_id])
    : [];
  const effective = ['PENDING_PAYMENT', 'CONFIRMED'].includes(row.status) && row.expires_at <= now ? 'EXPIRED' : row.status;
  return {
    id: row.id,
    number: row.number,
    status: effective,
    payable: ['PENDING_PAYMENT', 'CONFIRMED'].includes(effective),
    /** Montant attendu : non modifiable par l'agent. */
    amount: money(row.amount),
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    channel: row.channel,
    order: { id: row.order_id, number: row.order_number, quantity: row.total_quantity, createdAt: row.order_created_at },
    customer: { name: `${row.first_name} ${row.last_name}`, whatsapp: row.whatsapp, email: row.email },
    office: { id: row.office_id, name: row.office_name, city: row.office_city },
    productName: row.product_name,
    items: items.map((i) => ({
      productName: i.product_name,
      variantLabel: i.variant_label,
      quantity: i.quantity,
      saleUnit: i.sale_unit,
      unitPrice: money(i.unit_final_amount),
      lineTotal: money(i.line_total_amount),
    })),
    documents: {
      proforma: `/api/v1/orders/${row.order_id}/documents/proforma`,
      receipt: row.status === 'PAID' ? `/api/v1/orders/${row.order_id}/documents/receipt` : null,
    },
  };
}

export function registerOfficeRoutes(app: App): void {
  const r = app.router;

  /** Pays utilisateur -> bureaux actifs -> villes disponibles (§23). */
  r.get('/local-offices', { auth: 'optional', query: z.object({ city: z.string().max(80).optional(), purpose: z.enum(['payment', 'pickup']).optional() }) }, async (ctx) => {
    const viewer = await viewerOf(ctx);
    const rows = await app.db.all(
      `SELECT * FROM local_offices
        WHERE country_code = $1 AND is_active
          AND ($2::text IS NULL OR city = $2)
          AND ($3::text IS NULL OR ($3 = 'payment' AND accepts_payments) OR ($3 = 'pickup' AND is_pickup_point))
        ORDER BY city, name`,
      [viewer.countryCode, ctx.query.city ?? null, ctx.query.purpose ?? null],
    );
    return {
      country: viewer.countryCode,
      cities: [...new Set(rows.map((o) => o.city as string))],
      offices: rows.map((o) => ({ ...officeDto(o), acceptsPayments: o.accepts_payments, isPickupPoint: o.is_pickup_point })),
    };
  });

  /**
   * Annuaire public des partenaires locaux : les bureaux actifs, pays par pays.
   * La liste couvre toute l'Afrique (54 pays), y compris les pays que GROUPDEALS ne dessert pas
   * encore : ceux-là apparaissent sans partenaire. Contrairement à /local-offices (limité au pays
   * du client), on peut consulter n'importe quel pays.
   */
  const partnerCountry = async (code: string, lang: string) => {
    const african = africanCountry(code);
    if (!african) return null;
    const known = (await app.reference.get()).countries[african.code];
    return {
      code: african.code,
      // Un pays desservi garde le nom saisi dans le back-office ; les autres prennent le nom de référence.
      name: known ? localized(known.name, known.i18n as Record<string, Record<string, string>>, lang, 'name') : lang === 'en' ? african.en : african.fr,
      served: !!known?.isActive,
    };
  };

  r.get('/local-partners/countries', { auth: 'none' }, async (ctx) => {
    const viewer = await viewerOf(ctx);
    const counts = await app.db.all(`SELECT country_code, count(*)::int AS n FROM local_offices WHERE is_active GROUP BY country_code`);
    const byCountry = new Map(counts.map((c) => [c.country_code as string, c.n as number]));
    const countries = [];
    for (const c of AFRICAN_COUNTRIES) countries.push({ ...(await partnerCountry(c.code, viewer.lang))!, partners: byCountry.get(c.code) ?? 0 });
    countries.sort((a, b) => a.name.localeCompare(b.name, viewer.lang));
    return new Reply(200, { countries, viewerCountry: viewer.countryCode }, { 'Cache-Control': 'public, max-age=60' });
  });

  r.get('/local-partners/:country', { auth: 'none' }, async (ctx) => {
    const viewer = await viewerOf(ctx);
    const country = await partnerCountry(ctx.params.country, viewer.lang);
    if (!country) throw new DomainError('NOT_FOUND');
    const rows = await app.db.all(`SELECT * FROM local_offices WHERE country_code = $1 AND is_active ORDER BY city, name`, [country.code]);
    return new Reply(
      200,
      {
        country,
        cities: [...new Set(rows.map((o) => o.city as string))],
        partners: rows.map((o) => ({ ...officeDto(o), acceptsPayments: o.accepts_payments, isPickupPoint: o.is_pickup_point })),
      },
      { 'Cache-Control': 'public, max-age=60' },
    );
  });

  /**
   * Choisir (ou changer) le bureau de paiement d'une commande en attente.
   * Le seuil des 500 000 FCFA est revérifié ici, sur le total réel de la commande.
   */
  r.post('/office-payments', { body: z.object({ orderId: z.string().uuid(), officeId: z.string().uuid() }), rateLimit: { max: 20, windowSec: 60 } }, async (ctx) => {
    const me = ctx.me();
    const policy = await app.reference.holdPolicy();
    const reservationId = await app.db.tx(async (tx) => {
      const order = await tx.one(
        `SELECT o.*, d.ends_at FROM orders o JOIN group_deals d ON d.id = o.deal_id WHERE o.id = $1 AND o.user_id = $2 FOR UPDATE OF o`,
        [ctx.body.orderId, me.id],
      );
      if (!order) throw new DomainError('NOT_FOUND');
      if (!['PENDING', 'FAILED'].includes(order.payment_status)) throw new DomainError('ORDER_NOT_PAYABLE');
      if (order.expires_at <= ctx.now) throw new DomainError('ORDER_EXPIRED');
      if (!(await officeEligibility(app, order.total_amount, order.currency_code))) throw new DomainError('OFFICE_PAYMENT_NOT_ELIGIBLE');
      const office = await tx.one(`SELECT * FROM local_offices WHERE id = $1`, [ctx.body.officeId]);
      if (!office || office.country_code !== order.country_code) throw new DomainError('OFFICE_NOT_AVAILABLE');
      if (!office.is_active || !office.accepts_payments) throw new DomainError('OFFICE_CLOSED');

      const expiresAt = paymentDeadline('OFFICE', ctx.now, order.ends_at, policy);
      await tx.query(
        `UPDATE orders SET payment_method = 'OFFICE', payment_status = 'PENDING', expires_at = $2,
                pickup_office_id = COALESCE(pickup_office_id, $3) WHERE id = $1`,
        [order.id, expiresAt, office.is_pickup_point ? office.id : null],
      );
      await tx.query(`DELETE FROM invoices WHERE order_id = $1 AND kind = 'PROFORMA'`, [order.id]);
      const existing = await tx.one(`SELECT id, status FROM office_payments WHERE order_id = $1`, [order.id]);
      if (existing) {
        await tx.query(`UPDATE office_payments SET office_id = $2, expires_at = $3, status = 'PENDING_PAYMENT' WHERE id = $1`, [existing.id, office.id, expiresAt]);
        await issueInvoice(app, tx, order.id, 'PROFORMA', ctx.now);
        return existing.id as string;
      }
      return createReservation(app, tx, order.id, office, ctx.now);
    });
    return Reply.created({ reservationId });
  });

  /* --------------------------------------------------------------------- */
  /* Interface de l'agent                                                   */
  /* --------------------------------------------------------------------- */

  const agent = { permission: 'office.payments.record' as const };

  r.get('/agent/overview', agent, async (ctx) => {
    const scope = officeScope(ctx);
    const offices = await app.db.all(
      `SELECT f.*,
              (SELECT count(*)::int FROM office_payments r WHERE r.office_id = f.id AND r.status IN ('PENDING_PAYMENT','CONFIRMED') AND r.expires_at > $2) AS pending,
              (SELECT count(*)::int FROM office_payments r WHERE r.office_id = f.id AND r.status = 'PAID' AND r.cash_closing_id IS NULL) AS unclosed,
              (SELECT count(*)::int FROM orders o WHERE o.pickup_office_id = f.id AND o.pickup_step = 8) AS pickups
         FROM local_offices f WHERE ($1::uuid[] IS NULL OR f.id = ANY($1::uuid[])) AND f.is_active ORDER BY f.city, f.name`,
      [scope, ctx.now],
    );
    return {
      offices: offices.map((o) => ({ ...officeDto(o), countryCode: o.country_code, pendingReservations: o.pending, unclosedPayments: o.unclosed, pickupsWaiting: o.pickups })),
      canCloseCash: ctx.can('office.cash.close'),
    };
  });

  r.get(
    '/agent/reservations',
    { ...agent, query: z.object({ q: z.string().trim().max(80).optional(), status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'PAID', 'EXPIRED', 'CANCELLED']).optional(), officeId: z.string().uuid().optional() }) },
    async (ctx) => {
      const scope = officeScope(ctx);
      if (ctx.query.officeId) assertOffice(ctx, ctx.query.officeId);
      const like = ctx.query.q ? `%${ctx.query.q.replace(/[\\%_]/g, '\\$&')}%` : null;
      const rows = await app.db.all(
        `${RESERVATION_SELECT}
          WHERE ($1::uuid[] IS NULL OR r.office_id = ANY($1::uuid[]))
            AND ($2::uuid IS NULL OR r.office_id = $2)
            AND ($3::text IS NULL OR r.status = $3)
            AND ($4::text IS NULL OR r.number ILIKE $4 OR o.number ILIKE $4 OR u.whatsapp ILIKE $4
                 OR (u.first_name || ' ' || u.last_name) ILIKE $4)
          ORDER BY (r.status IN ('PENDING_PAYMENT','CONFIRMED')) DESC, r.created_at DESC LIMIT 100`,
        [scope, ctx.query.officeId ?? null, ctx.query.status ?? null, like],
      );
      const out = [];
      for (const row of rows) out.push(await reservationDto(app, row, ctx.now));
      return { reservations: out };
    },
  );

  /** Lecture du QR Code présenté par le client. */
  r.get('/agent/reservations/scan/:token', { ...agent, rateLimit: { max: 60, windowSec: 60 } }, async (ctx) => {
    const row = await app.db.one(`${RESERVATION_SELECT} WHERE r.qr_token = $1`, [ctx.params.token]);
    if (!row) throw new DomainError('NOT_FOUND');
    assertOffice(ctx, row.office_id);
    return { reservation: await reservationDto(app, row, ctx.now, true) };
  });

  r.get('/agent/reservations/:id', agent, async (ctx) => {
    const row = await app.db.one(`${RESERVATION_SELECT} WHERE r.id = $1`, [ctx.params.id]);
    if (!row) throw new DomainError('NOT_FOUND');
    assertOffice(ctx, row.office_id);
    return { reservation: await reservationDto(app, row, ctx.now, true), qrSvg: qrSvg(reservationQrContent(app, row.qr_token)) };
  });

  /** Le client s'est présenté : la réservation est confirmée, en attente d'encaissement. */
  r.post('/agent/reservations/:id/confirm', agent, async (ctx) => {
    await app.db.tx(async (tx) => {
      const row = await tx.one(`SELECT * FROM office_payments WHERE id = $1 FOR UPDATE`, [ctx.params.id]);
      if (!row) throw new DomainError('NOT_FOUND');
      assertOffice(ctx, row.office_id);
      if (row.status === 'CONFIRMED') return;
      if (row.status !== 'PENDING_PAYMENT') throw new DomainError('RESERVATION_NOT_PAYABLE');
      if (row.expires_at <= ctx.now) throw new DomainError('RESERVATION_EXPIRED');
      await tx.query(`UPDATE office_payments SET status = 'CONFIRMED' WHERE id = $1`, [row.id]);
      await audit(tx, ctx, { action: 'office_payment.confirm', entityType: 'office_payment', entityId: row.id, before: { status: row.status }, after: { status: 'CONFIRMED' } });
    });
    return { status: 'CONFIRMED' };
  });

  /** Encaissement. Le montant n'est pas un paramètre : c'est celui de la commande. */
  r.post(
    '/agent/reservations/:id/pay',
    { ...agent, body: z.object({ channel: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MOBILE_MONEY']).default('CASH') }).strict(), rateLimit: { max: 60, windowSec: 60 } },
    async (ctx) => {
      const me = ctx.me();
      const row = await app.db.one(`SELECT * FROM office_payments WHERE id = $1`, [ctx.params.id]);
      if (!row) throw new DomainError('NOT_FOUND');
      assertOffice(ctx, row.office_id);
      const res = await applyPayment(app, row.order_id, { provider: 'OFFICE', channel: ctx.body.channel, agentId: me.id });
      if (res.outcome === 'PAID') {
        await audit(app.db, ctx, {
          action: 'office_payment.record',
          entityType: 'office_payment',
          entityId: row.id,
          before: { status: row.status },
          after: { status: 'PAID', amount: row.amount, currency: row.currency_code, channel: ctx.body.channel, orderId: row.order_id },
        });
      }
      const fresh = await app.db.one(`${RESERVATION_SELECT} WHERE r.id = $1`, [row.id]);
      return { outcome: res.outcome, reservation: await reservationDto(app, fresh!, ctx.now, true) };
    },
  );

  /* ------------------------------ Retraits ------------------------------ */

  const pickup = { permission: 'office.pickup.confirm' as const };

  r.get('/agent/pickups', { ...pickup, query: z.object({ q: z.string().trim().max(80).optional() }) }, async (ctx) => {
    const scope = officeScope(ctx);
    const like = ctx.query.q ? `%${ctx.query.q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const rows = await app.db.all(
      `SELECT o.id, o.number, o.total_quantity, o.pickup_step, o.pickup_office_id, o.picked_up_at,
              u.first_name, u.last_name, u.whatsapp, p.name AS product_name, f.name AS office_name
         FROM orders o JOIN users u ON u.id = o.user_id JOIN group_deals d ON d.id = o.deal_id
         JOIN products p ON p.id = d.product_id JOIN local_offices f ON f.id = o.pickup_office_id
        WHERE o.pickup_step >= 8 AND ($1::uuid[] IS NULL OR o.pickup_office_id = ANY($1::uuid[]))
          AND ($2::text IS NULL OR o.number ILIKE $2 OR u.whatsapp ILIKE $2 OR (u.first_name || ' ' || u.last_name) ILIKE $2)
        ORDER BY o.pickup_step, o.updated_at DESC LIMIT 100`,
      [scope, like],
    );
    return {
      pickups: rows.map((o) => ({
        orderId: o.id,
        orderNumber: o.number,
        quantity: o.total_quantity,
        productName: o.product_name,
        customer: { name: `${o.first_name} ${o.last_name}`, whatsapp: o.whatsapp },
        office: { id: o.pickup_office_id, name: o.office_name },
        status: o.pickup_step === 9 ? 'PICKED_UP' : 'READY',
        pickedUpAt: o.picked_up_at,
      })),
    };
  });

  /** Étape 9 : retrait confirmé, sur présentation du code remis au client. */
  r.post(
    '/agent/pickups/:orderId/confirm',
    { ...pickup, body: z.object({ code: z.string().regex(/^\d{6}$/) }), rateLimit: { max: 20, windowSec: 60 } },
    async (ctx) => {
      await app.db.tx(async (tx) => {
        const o = await tx.one(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [ctx.params.orderId]);
        if (!o || !o.pickup_office_id) throw new DomainError('NOT_FOUND');
        assertOffice(ctx, o.pickup_office_id);
        if (o.pickup_step === 9) throw new DomainError('CONFLICT', { step: 9 });
        if (o.pickup_step !== 8) throw new DomainError('LOGISTICS_STEP_OUT_OF_ORDER', { currentStep: o.pickup_step, targetStep: 9 });
        if (!safeEqual(String(o.pickup_code ?? ''), ctx.body.code)) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'code', message: 'Code de retrait incorrect' }] });
        await tx.query(`UPDATE orders SET pickup_step = 9, picked_up_at = $2 WHERE id = $1`, [o.id, ctx.now]);
        await tx.query(
          `INSERT INTO logistics_tracking (order_id, step, status, actor_id, occurred_at) VALUES ($1, 9, 'VALIDATED', $2, $3)`,
          [o.id, ctx.me().id, ctx.now],
        );
        await audit(tx, ctx, { action: 'pickup.confirm', entityType: 'order', entityId: o.id, after: { officeId: o.pickup_office_id } });
        await notify(tx, { userId: o.user_id, type: 'LOGISTICS_STEP', params: { number: o.number, step: 9 }, link: `/orders/${o.id}` });
      });
      return { status: 'PICKED_UP' };
    },
  );

  /* --------------------------- Clôture de caisse --------------------------- */

  /** Encaissements du bureau non encore clôturés. */
  r.get('/agent/cash', { ...agent, query: z.object({ officeId: z.string().uuid() }) }, async (ctx) => {
    assertOffice(ctx, ctx.query.officeId);
    const ref = await app.reference.get();
    const open = await app.db.all(
      `SELECT r.number, r.amount, r.currency_code, r.channel, r.paid_at, o.number AS order_number,
              a.first_name || ' ' || a.last_name AS agent_name
         FROM office_payments r JOIN orders o ON o.id = r.order_id LEFT JOIN users a ON a.id = r.recorded_by
        WHERE r.office_id = $1 AND r.status = 'PAID' AND r.cash_closing_id IS NULL ORDER BY r.paid_at`,
      [ctx.query.officeId],
    );
    const totals = new Map<string, number>();
    for (const p of open) totals.set(p.currency_code, (totals.get(p.currency_code) ?? 0) + p.amount);
    const closings = await app.db.all(
      `SELECT c.*, u.first_name || ' ' || u.last_name AS closed_by_name FROM cash_closings c JOIN users u ON u.id = c.closed_by
        WHERE c.office_id = $1 ORDER BY c.closed_at DESC LIMIT 30`,
      [ctx.query.officeId],
    );
    return {
      open: open.map((p) => ({
        reservationNumber: p.number,
        orderNumber: p.order_number,
        amount: app.reference.moneySync(ref, p.amount, p.currency_code),
        channel: p.channel,
        paidAt: p.paid_at,
        agentName: p.agent_name,
      })),
      expected: [...totals].map(([currency, amount]) => app.reference.moneySync(ref, amount, currency)),
      closings: closings.map((c) => ({
        id: c.id,
        businessDate: c.business_date,
        expected: app.reference.moneySync(ref, c.expected_amount, c.currency_code),
        declared: app.reference.moneySync(ref, c.declared_amount, c.currency_code),
        difference: app.reference.moneySync(ref, Math.abs(c.difference), c.currency_code),
        differenceSign: Math.sign(c.difference),
        paymentsCount: c.payments_count,
        note: c.note,
        closedBy: c.closed_by_name,
        closedAt: c.closed_at,
      })),
      canClose: ctx.can('office.cash.close'),
    };
  });

  /** Clôture : compare la somme comptée en caisse à la somme des encaissements enregistrés. */
  r.post(
    '/agent/cash/close',
    {
      permission: 'office.cash.close',
      body: z.object({ officeId: z.string().uuid(), currency: z.string().length(3), declaredAmount: z.number().int().min(0), note: z.string().trim().max(500).optional() }),
    },
    async (ctx) => {
      assertOffice(ctx, ctx.body.officeId);
      const closing = await app.db.tx(async (tx) => {
        const office = await tx.one(`SELECT id, timezone FROM local_offices WHERE id = $1 FOR UPDATE`, [ctx.body.officeId]);
        if (!office) throw new DomainError('NOT_FOUND');
        const payments = await tx.all(
          `SELECT id, amount FROM office_payments
            WHERE office_id = $1 AND status = 'PAID' AND cash_closing_id IS NULL AND currency_code = $2 FOR UPDATE`,
          [office.id, ctx.body.currency],
        );
        if (!payments.length) throw new DomainError('VALIDATION_FAILED', { reason: 'nothing_to_close' });
        const expected = payments.reduce((s, p) => s + (p.amount as number), 0);
        const businessDate = new Intl.DateTimeFormat('en-CA', { timeZone: office.timezone }).format(ctx.now);
        const row = await tx.one(
          `INSERT INTO cash_closings (office_id, business_date, currency_code, expected_amount, declared_amount, payments_count, note, closed_by, closed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (office_id, business_date, currency_code) DO UPDATE
             SET expected_amount = cash_closings.expected_amount + EXCLUDED.expected_amount,
                 declared_amount = cash_closings.declared_amount + EXCLUDED.declared_amount,
                 payments_count = cash_closings.payments_count + EXCLUDED.payments_count,
                 note = COALESCE(EXCLUDED.note, cash_closings.note), closed_by = EXCLUDED.closed_by, closed_at = EXCLUDED.closed_at
           RETURNING id, expected_amount, declared_amount, difference`,
          [office.id, businessDate, ctx.body.currency, expected, ctx.body.declaredAmount, payments.length, ctx.body.note ?? null, ctx.me().id, ctx.now],
        );
        await tx.query(`UPDATE office_payments SET cash_closing_id = $2 WHERE id = ANY($1::uuid[])`, [payments.map((p) => p.id), row!.id]);
        await audit(tx, ctx, {
          action: 'cash.close',
          entityType: 'cash_closing',
          entityId: row!.id,
          after: { officeId: office.id, businessDate, expected, declared: ctx.body.declaredAmount, payments: payments.length },
          reason: ctx.body.note ?? null,
        });
        return row!;
      });
      return Reply.created({ id: closing.id, expected: closing.expected_amount, declared: closing.declared_amount, difference: closing.difference });
    },
  );
}
