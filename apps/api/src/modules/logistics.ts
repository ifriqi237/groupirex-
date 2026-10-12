/**
 * LOGISTICS ENGINE côté base (§28, §29).
 *
 * Étapes 1 à 7 : sur l'expédition (campagne × pays), une mise à jour pour tout le lot.
 * Étape 8 : commande par commande (mise à disposition au bureau, code de retrait).
 * Étape 9 : confirmée par l'agent du bureau (voir modules/offices.ts).
 */

import { z } from 'zod';
import { DomainError, LOGISTICS_STEPS, assertOrderCanEnterPickup, planAdvance } from '@groupdeals/core';
import type { App } from '../app';
import { pageOf } from '../http/viewer';
import { audit } from '../services/audit';
import { notifyMany } from '../services/notify';
import { newPickupCode } from '../services/orders';

const SHIPMENT_SELECT = `
  SELECT s.*, d.slug AS deal_slug, d.title AS deal_title, p.name AS product_name, c.name AS country_name,
         (SELECT count(*)::int FROM orders o WHERE o.shipment_id = s.id AND o.payment_status = 'PAID') AS orders_count,
         (SELECT COALESCE(sum(o.total_quantity), 0)::int FROM orders o WHERE o.shipment_id = s.id AND o.payment_status = 'PAID') AS units,
         (SELECT count(*)::int FROM orders o WHERE o.shipment_id = s.id AND o.payment_status = 'PAID' AND o.pickup_step = 8) AS ready_count,
         (SELECT count(*)::int FROM orders o WHERE o.shipment_id = s.id AND o.payment_status = 'PAID' AND o.pickup_step = 9) AS picked_count
    FROM shipments s
    JOIN group_deals d ON d.id = s.deal_id
    JOIN products p ON p.id = d.product_id
    JOIN countries c ON c.code = s.country_code`;

function shipmentDto(s: Record<string, any>) {
  return {
    id: s.id,
    reference: s.reference,
    deal: { id: s.deal_id, slug: s.deal_slug, title: s.deal_title ?? s.product_name },
    productName: s.product_name,
    country: { code: s.country_code, name: s.country_name },
    currentStep: s.current_step,
    transportMode: s.transport_mode,
    vesselName: s.vessel_name,
    vesselImo: s.vessel_imo,
    containerNumber: s.container_number,
    billOfLading: s.bill_of_lading,
    departurePort: s.departure_port,
    arrivalPort: s.arrival_port,
    eta: s.eta,
    vesselPosition: s.vessel_position,
    ordersCount: s.orders_count,
    units: s.units,
    readyCount: s.ready_count,
    pickedCount: s.picked_count,
    updatedAt: s.updated_at,
  };
}

const advanceSchema = z.object({
  targetStep: z.number().int().min(1).max(7),
  note: z.string().trim().max(500).optional(),
  occurredAt: z.string().datetime().optional(),
  /** Intervention administrative : saut d'étape ou retour en arrière. Motif obligatoire. */
  override: z.object({ reason: z.string().trim().min(1).max(500) }).optional(),
});

const updateSchema = z
  .object({
    transportMode: z.enum(['SEA', 'AIR', 'ROAD']),
    vesselName: z.string().trim().max(120).nullable(),
    vesselImo: z.string().trim().max(20).nullable(),
    containerNumber: z.string().trim().max(40).nullable(),
    billOfLading: z.string().trim().max(60).nullable(),
    departurePort: z.string().trim().max(120).nullable(),
    arrivalPort: z.string().trim().max(120).nullable(),
    eta: z.string().datetime().nullable(),
    position: z
      .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), progressPercent: z.number().min(0).max(100) })
      .nullable(),
  })
  .partial();

export function registerLogisticsRoutes(app: App): void {
  const r = app.router;

  r.get(
    '/admin/shipments',
    { permission: 'logistics.read', query: z.object({ country: z.string().length(2).optional(), step: z.string().regex(/^[0-7]$/).optional(), open: z.enum(['1']).optional(), page: z.string().optional(), pageSize: z.string().optional() }) },
    async (ctx) => {
      const page = pageOf(ctx.query, 30, 100);
      const rows = await app.db.all(
        `${SHIPMENT_SELECT}
          WHERE ($1::text IS NULL OR s.country_code = $1) AND ($2::int IS NULL OR s.current_step = $2)
          ORDER BY s.current_step, s.created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
        [ctx.query.country ?? null, ctx.query.step ?? null],
      );
      return { items: rows.map(shipmentDto), steps: LOGISTICS_STEPS };
    },
  );

  r.get('/admin/shipments/:id', { permission: 'logistics.read' }, async (ctx) => {
    const s = await app.db.one(`${SHIPMENT_SELECT} WHERE s.id = $1`, [ctx.params.id]);
    if (!s) throw new DomainError('NOT_FOUND');
    const [history, orders] = await Promise.all([
      app.db.all(
        `SELECT t.step, t.status, t.note, t.is_override, t.override_reason, t.occurred_at, u.first_name || ' ' || u.last_name AS actor
           FROM logistics_tracking t LEFT JOIN users u ON u.id = t.actor_id WHERE t.shipment_id = $1 ORDER BY t.created_at`,
        [s.id],
      ),
      app.db.all(
        `SELECT o.id, o.number, o.total_quantity, o.pickup_step, o.pickup_office_id, f.name AS office_name,
                u.first_name || ' ' || u.last_name AS customer
           FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN local_offices f ON f.id = o.pickup_office_id
          WHERE o.shipment_id = $1 AND o.payment_status = 'PAID' ORDER BY o.number`,
        [s.id],
      ),
    ]);
    return {
      shipment: shipmentDto(s),
      history: history.map((h) => ({ step: h.step, status: h.status, note: h.note, isOverride: h.is_override, overrideReason: h.override_reason, occurredAt: h.occurred_at, actor: h.actor })),
      orders: orders.map((o) => ({ id: o.id, number: o.number, quantity: o.total_quantity, pickupStep: o.pickup_step, pickupOffice: o.pickup_office_id ? { id: o.pickup_office_id, name: o.office_name } : null, customer: o.customer })),
      canOverride: ctx.can('logistics.override'),
    };
  });

  /** Informations de transport et position du navire (étape 5). */
  r.patch('/admin/shipments/:id', { permission: 'logistics.advance', body: updateSchema }, async (ctx) => {
    const b = ctx.body as z.infer<typeof updateSchema>;
    const before = await app.db.one(`SELECT * FROM shipments WHERE id = $1`, [ctx.params.id]);
    if (!before) throw new DomainError('NOT_FOUND');
    const position =
      b.position === undefined
        ? before.vessel_position
        : b.position === null
          ? null
          : { ...b.position, updatedAt: ctx.now.toISOString(), source: 'MANUAL' };
    const pick = <K extends keyof typeof b>(key: K, column: string) => (b[key] === undefined ? before[column] : b[key]);
    await app.db.tx(async (tx) => {
      await tx.query(
        `UPDATE shipments SET transport_mode = $2, vessel_name = $3, vessel_imo = $4, container_number = $5, bill_of_lading = $6,
                departure_port = $7, arrival_port = $8, eta = $9, vessel_position = $10 WHERE id = $1`,
        [before.id, pick('transportMode', 'transport_mode'), pick('vesselName', 'vessel_name'), pick('vesselImo', 'vessel_imo'),
         pick('containerNumber', 'container_number'), pick('billOfLading', 'bill_of_lading'), pick('departurePort', 'departure_port'),
         pick('arrivalPort', 'arrival_port'), pick('eta', 'eta'), position === null ? null : JSON.stringify(position)],
      );
      await audit(tx, ctx, { action: 'shipment.update', entityType: 'shipment', entityId: before.id, after: b });
    });
    return { updated: true };
  });

  /**
   * Valide une étape pour tout le lot. Une étape ne peut être validée que si la
   * précédente l'est ; sinon il faut la permission de forçage et un motif, et
   * l'intervention est journalisée (§47).
   */
  r.post('/admin/shipments/:id/advance', { permission: 'logistics.advance', body: advanceSchema }, async (ctx) => {
    const b = ctx.body as z.infer<typeof advanceSchema>;
    const occurredAt = b.occurredAt ? new Date(b.occurredAt) : ctx.now;
    const out = await app.db.tx(async (tx) => {
      const s = await tx.one(`SELECT * FROM shipments WHERE id = $1 FOR UPDATE`, [ctx.params.id]);
      if (!s) throw new DomainError('NOT_FOUND');
      const plan = planAdvance({
        currentStep: s.current_step,
        targetStep: b.targetStep,
        scope: 'SHIPMENT',
        override: b.override ? { permitted: ctx.can('logistics.override'), reason: b.override.reason } : undefined,
      });
      const actor = ctx.me().id;
      const insert = (step: number, status: string) =>
        tx.query(
          `INSERT INTO logistics_tracking (shipment_id, step, status, note, is_override, override_reason, actor_id, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [s.id, step, status, status === 'VALIDATED' ? (b.note ?? null) : null, plan.overridden, plan.overrideReason, actor, occurredAt],
        );
      if (plan.newStep > s.current_step) {
        for (const step of plan.skippedSteps) await insert(step, 'SKIPPED');
        await insert(plan.newStep, 'VALIDATED');
      } else {
        // Retour en arrière : les étapes au-delà de la cible sont annulées.
        for (let step = s.current_step; step > plan.newStep; step--) await insert(step, 'REVERTED');
      }
      await tx.query(`UPDATE shipments SET current_step = $2 WHERE id = $1`, [s.id, plan.newStep]);
      if (plan.overridden) {
        await audit(tx, ctx, {
          action: 'logistics.override',
          entityType: 'shipment',
          entityId: s.id,
          before: { step: s.current_step },
          after: { step: plan.newStep, skipped: plan.skippedSteps },
          reason: plan.overrideReason,
        });
      } else {
        await audit(tx, ctx, { action: 'logistics.advance', entityType: 'shipment', entityId: s.id, before: { step: s.current_step }, after: { step: plan.newStep } });
      }
      if (plan.newStep > s.current_step) {
        const owners = await tx.all(`SELECT DISTINCT user_id FROM orders WHERE shipment_id = $1 AND payment_status = 'PAID'`, [s.id]);
        await notifyMany(tx, owners.map((o) => o.user_id), { type: 'LOGISTICS_STEP', params: { step: plan.newStep, reference: s.reference }, link: '/orders' });
      }
      return plan;
    });
    return { currentStep: out.newStep, overridden: out.overridden, skippedSteps: out.skippedSteps };
  });

  /**
   * Étape 8 : colis disponibles au retrait. Chaque commande reçoit un code de
   * retrait à 6 chiffres. Refusé tant que le lot n'est pas dédouané (étape 7).
   */
  r.post(
    '/admin/shipments/:id/ready-for-pickup',
    {
      permission: 'logistics.advance',
      body: z.object({ orderIds: z.array(z.string().uuid()).max(500).optional(), override: z.object({ reason: z.string().trim().min(1).max(500) }).optional() }),
    },
    async (ctx) => {
      const count = await app.db.tx(async (tx) => {
        const s = await tx.one(`SELECT * FROM shipments WHERE id = $1 FOR UPDATE`, [ctx.params.id]);
        if (!s) throw new DomainError('NOT_FOUND');
        const override = !!ctx.body.override && ctx.can('logistics.override');
        assertOrderCanEnterPickup(s.current_step, override);
        const orders = await tx.all(
          `SELECT id, user_id, number, pickup_office_id FROM orders
            WHERE shipment_id = $1 AND payment_status = 'PAID' AND pickup_step = 0
              AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) FOR UPDATE`,
          [s.id, ctx.body.orderIds ?? null],
        );
        const missing = orders.filter((o) => !o.pickup_office_id);
        if (missing.length) {
          throw new DomainError('VALIDATION_FAILED', { reason: 'pickup_office_missing', orders: missing.map((o) => o.number) });
        }
        const actor = ctx.me().id;
        for (const o of orders) {
          await tx.query(`UPDATE orders SET pickup_step = 8, pickup_code = $2 WHERE id = $1`, [o.id, newPickupCode()]);
          await tx.query(
            `INSERT INTO logistics_tracking (order_id, step, status, is_override, override_reason, actor_id, occurred_at)
             VALUES ($1, 8, 'VALIDATED', $2, $3, $4, $5)`,
            [o.id, override && s.current_step < 7, override && s.current_step < 7 ? ctx.body.override.reason : null, actor, ctx.now],
          );
        }
        await notifyMany(tx, orders.map((o) => o.user_id), { type: 'LOGISTICS_STEP', params: { step: 8, reference: s.reference }, link: '/orders' });
        await audit(tx, ctx, {
          action: override && s.current_step < 7 ? 'logistics.override' : 'logistics.ready_for_pickup',
          entityType: 'shipment',
          entityId: s.id,
          after: { orders: orders.length },
          reason: ctx.body.override?.reason ?? null,
        });
        return orders.length;
      });
      return { ordersReady: count };
    },
  );

  /** Affecter ou changer le bureau de retrait d'une commande. */
  r.post('/admin/orders/:id/pickup-office', { permission: 'logistics.advance', body: z.object({ officeId: z.string().uuid() }) }, async (ctx) => {
    await app.db.tx(async (tx) => {
      const o = await tx.one(`SELECT id, country_code, pickup_step, pickup_office_id FROM orders WHERE id = $1 FOR UPDATE`, [ctx.params.id]);
      if (!o) throw new DomainError('NOT_FOUND');
      if (o.pickup_step === 9) throw new DomainError('CONFLICT', { step: 9 });
      const office = await tx.one(`SELECT country_code, is_active, is_pickup_point FROM local_offices WHERE id = $1`, [ctx.body.officeId]);
      if (!office || office.country_code !== o.country_code || !office.is_active || !office.is_pickup_point) throw new DomainError('OFFICE_NOT_AVAILABLE');
      await tx.query(`UPDATE orders SET pickup_office_id = $2 WHERE id = $1`, [o.id, ctx.body.officeId]);
      await audit(tx, ctx, { action: 'order.pickup_office', entityType: 'order', entityId: o.id, before: { officeId: o.pickup_office_id }, after: { officeId: ctx.body.officeId } });
    });
    return { updated: true };
  });
}
