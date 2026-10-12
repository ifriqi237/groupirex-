/**
 * Matching (§30, §31) : les membres publient ce qu'ils cherchent, les autres
 * disent « je veux aussi ». Le seuil d'intérêts ne crée rien tout seul : il
 * alerte l'administration, qui garde la décision commerciale.
 */

import { z } from 'zod';
import { DomainError, canTransitionMatching, shouldAlertAdmin } from '@groupdeals/core';
import type { App } from '../app';
import { Row, uniqueViolation } from '../db/pool';
import { Reply } from '../http/server';
import { pageOf, viewerOf } from '../http/viewer';
import { audit } from '../services/audit';
import { notify, notifyMany } from '../services/notify';
import { localized } from '../services/pricing';

const createSchema = z.object({
  title: z.string().trim().min(5).max(140),
  description: z.string().trim().max(2000).default(''),
  categoryId: z.string().uuid().nullish(),
  desiredQuantity: z.number().int().min(1).max(10_000_000).nullish(),
  imageUrl: z.string().url().max(500).nullish(),
});

const MATCHING_SELECT = `
  SELECT m.*, u.first_name, u.last_name, c.name AS country_name, cat.name AS category_name, cat.i18n AS category_i18n,
         cat.slug AS category_slug, d.slug AS deal_slug`;
const MATCHING_FROM = `
    FROM matching_requests m
    JOIN users u ON u.id = m.user_id
    JOIN countries c ON c.code = m.country_code
    LEFT JOIN categories cat ON cat.id = m.category_id
    LEFT JOIN group_deals d ON d.id = m.converted_deal_id`;

function dto(m: Row, lang: string, viewerId: string | null, threshold: number) {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    imageUrl: m.image_url,
    status: m.status,
    category: m.category_id ? { id: m.category_id, slug: m.category_slug, name: localized(m.category_name, m.category_i18n, lang, 'name') } : null,
    country: { code: m.country_code, name: m.country_name },
    desiredQuantity: m.desired_quantity,
    interestCount: m.interest_count,
    totalQuantity: m.total_quantity,
    threshold,
    // Seule l'initiale du nom est publique.
    author: m.last_name ? `${m.first_name} ${String(m.last_name).charAt(0)}.` : m.first_name,
    isMine: viewerId !== null && m.user_id === viewerId,
    interested: !!m.interested,
    dealSlug: m.status === 'CONVERTED' ? m.deal_slug : null,
    rejectionReason: viewerId !== null && m.user_id === viewerId ? m.rejection_reason : null,
    createdAt: m.created_at,
  };
}

export function registerMatchingRoutes(app: App): void {
  const r = app.router;
  const threshold = () => app.reference.setting('matching.alert_threshold', 50);

  r.get(
    '/matching',
    { auth: 'optional', query: z.object({ sort: z.enum(['popular', 'recent']).default('popular'), category: z.string().max(80).optional(), q: z.string().trim().max(80).optional(), page: z.string().optional(), pageSize: z.string().optional() }) },
    async (ctx) => {
      const viewer = await viewerOf(ctx);
      const page = pageOf(ctx.query);
      const like = ctx.query.q ? `%${ctx.query.q.replace(/[\\%_]/g, '\\$&')}%` : null;
      const rows = await app.db.all(
        `${MATCHING_SELECT}, (mi.user_id IS NOT NULL) AS interested, count(*) OVER()::int AS total
         ${MATCHING_FROM}
         LEFT JOIN matching_interests mi ON mi.request_id = m.id AND mi.user_id = $1
         WHERE m.status IN ('PUBLISHED', 'CONVERTED')
           AND ($2::text IS NULL OR cat.slug = $2)
           AND ($3::text IS NULL OR m.title ILIKE $3 OR m.description ILIKE $3)
         ORDER BY ${ctx.query.sort === 'recent' ? 'm.created_at DESC' : 'm.interest_count DESC, m.created_at DESC'}
         LIMIT ${page.pageSize} OFFSET ${page.offset}`,
        [viewer.userId, ctx.query.category ?? null, like],
      );
      const t = await threshold();
      return { items: rows.map((m) => dto(m, viewer.lang, viewer.userId, t)), page: page.page, pageSize: page.pageSize, total: rows[0]?.total ?? 0 };
    },
  );

  r.get('/matching/mine', {}, async (ctx) => {
    const viewer = await viewerOf(ctx);
    const rows = await app.db.all(
      `${MATCHING_SELECT}, false AS interested ${MATCHING_FROM} WHERE m.user_id = $1 ORDER BY m.created_at DESC LIMIT 100`,
      [ctx.me().id],
    );
    const t = await threshold();
    return { items: rows.map((m) => dto(m, viewer.lang, viewer.userId, t)) };
  });

  /** Publier une demande. Elle passe par la modération avant d'être visible. */
  r.post('/matching', { body: createSchema, rateLimit: { max: 10, windowSec: 3600 } }, async (ctx) => {
    const me = ctx.me();
    const b = ctx.body as z.infer<typeof createSchema>;
    const row = await app.db.tx(async (tx) => {
      const created = await tx.one(
        `INSERT INTO matching_requests (user_id, title, description, category_id, country_code, desired_quantity, image_url, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, status`,
        [me.id, b.title, b.description, b.categoryId ?? null, me.countryCode, b.desiredQuantity ?? null, b.imageUrl ?? null, ctx.now],
      );
      await tx.query(`INSERT INTO analytics_events (type, user_id, country_code, entity_type, entity_id) VALUES ('matching_request', $1, $2, 'matching', $3)`, [me.id, me.countryCode, created!.id]);
      return created!;
    });
    return Reply.created({ id: row.id, status: row.status });
  });

  /** « Je veux aussi ce produit » : une seule fois par utilisateur et par demande (§47). */
  r.post('/matching/:id/interest', { body: z.object({ quantity: z.number().int().min(1).max(10_000_000).nullish() }), rateLimit: { max: 60, windowSec: 60 } }, async (ctx) => {
    const me = ctx.me();
    const t = await threshold();
    try {
      const out = await app.db.tx(async (tx) => {
        const m = await tx.one(`SELECT * FROM matching_requests WHERE id = $1 FOR UPDATE`, [ctx.params.id]);
        if (!m) throw new DomainError('NOT_FOUND');
        if (m.status !== 'PUBLISHED') throw new DomainError('MATCHING_NOT_PUBLISHED');
        // La clé primaire (request_id, user_id) garantit l'unicité même en cas de double clic.
        await tx.query(`INSERT INTO matching_interests (request_id, user_id, quantity, created_at) VALUES ($1, $2, $3, $4)`, [m.id, me.id, ctx.body.quantity ?? null, ctx.now]);
        const updated = await tx.one(
          `UPDATE matching_requests SET interest_count = interest_count + 1, total_quantity = total_quantity + $2 WHERE id = $1
           RETURNING interest_count, total_quantity`,
          [m.id, ctx.body.quantity ?? 0],
        );
        if (shouldAlertAdmin(updated!.interest_count, t, m.threshold_alerted_at !== null)) {
          await tx.query(`UPDATE matching_requests SET threshold_alerted_at = $2 WHERE id = $1`, [m.id, ctx.now]);
          const staff = await tx.all(
            `SELECT DISTINCT ur.user_id FROM user_roles ur JOIN role_permissions rp ON rp.role_code = ur.role_code
              WHERE rp.permission_code = 'matching.convert'`,
          );
          await notifyMany(tx, staff.map((s) => s.user_id), {
            type: 'MATCHING_THRESHOLD',
            params: { title: m.title, interests: updated!.interest_count },
            link: `/admin/matching`,
          });
        }
        await tx.query(`INSERT INTO analytics_events (type, user_id, country_code, entity_type, entity_id) VALUES ('matching_interest', $1, $2, 'matching', $3)`, [me.id, me.countryCode, m.id]);
        return updated!;
      });
      return Reply.created({ interested: true, interestCount: out.interest_count, totalQuantity: out.total_quantity });
    } catch (e) {
      if (uniqueViolation(e)) throw new DomainError('MATCHING_ALREADY_INTERESTED');
      throw e;
    }
  });

  r.delete('/matching/:id/interest', {}, async (ctx) => {
    const me = ctx.me();
    await app.db.tx(async (tx) => {
      const m = await tx.one(`SELECT id FROM matching_requests WHERE id = $1 FOR UPDATE`, [ctx.params.id]);
      if (!m) throw new DomainError('NOT_FOUND');
      const removed = await tx.one(`DELETE FROM matching_interests WHERE request_id = $1 AND user_id = $2 RETURNING quantity`, [m.id, me.id]);
      if (removed) {
        await tx.query(`UPDATE matching_requests SET interest_count = interest_count - 1, total_quantity = total_quantity - $2 WHERE id = $1`, [m.id, removed.quantity ?? 0]);
      }
    });
    return Reply.noContent();
  });

  /* ------------------------------ Administration ------------------------------ */

  r.get(
    '/admin/matching',
    { permission: ['matching.moderate', 'matching.convert'], query: z.object({ status: z.enum(['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'CONVERTED', 'CLOSED']).optional(), page: z.string().optional(), pageSize: z.string().optional() }) },
    async (ctx) => {
      const page = pageOf(ctx.query, 30, 100);
      const t = await threshold();
      const rows = await app.db.all(
        `${MATCHING_SELECT}, false AS interested, u.email AS author_email, count(*) OVER()::int AS total ${MATCHING_FROM}
          WHERE ($1::text IS NULL OR m.status = $1)
          ORDER BY (m.status = 'PENDING_REVIEW') DESC, (m.threshold_alerted_at IS NOT NULL AND m.status = 'PUBLISHED') DESC, m.interest_count DESC, m.created_at DESC
          LIMIT ${page.pageSize} OFFSET ${page.offset}`,
        [ctx.query.status ?? null],
      );
      const counts = await app.db.all(`SELECT status, count(*)::int AS n FROM matching_requests GROUP BY status`);
      return {
        items: rows.map((m) => ({
          ...dto(m, 'fr', null, t),
          author: `${m.first_name} ${m.last_name}`,
          authorEmail: m.author_email,
          thresholdReached: m.threshold_alerted_at !== null,
          rejectionReason: m.rejection_reason,
        })),
        total: rows[0]?.total ?? 0,
        counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
        threshold: t,
      };
    },
  );

  r.post(
    '/admin/matching/:id/moderate',
    { permission: 'matching.moderate', body: z.object({ decision: z.enum(['PUBLISH', 'REJECT', 'CLOSE']), reason: z.string().trim().max(500).optional() }) },
    async (ctx) => {
      const target = ({ PUBLISH: 'PUBLISHED', REJECT: 'REJECTED', CLOSE: 'CLOSED' } as const)[ctx.body.decision as 'PUBLISH' | 'REJECT' | 'CLOSE'];
      if (target === 'REJECTED' && !ctx.body.reason) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'reason', message: 'Motif requis' }] });
      await app.db.tx(async (tx) => {
        const m = await tx.one(`SELECT * FROM matching_requests WHERE id = $1 FOR UPDATE`, [ctx.params.id]);
        if (!m) throw new DomainError('NOT_FOUND');
        if (!canTransitionMatching(m.status, target)) throw new DomainError('CONFLICT', { from: m.status, to: target });
        await tx.query(
          `UPDATE matching_requests SET status = $2, moderated_by = $3, moderated_at = $4, rejection_reason = $5 WHERE id = $1`,
          [m.id, target, ctx.me().id, ctx.now, target === 'REJECTED' ? ctx.body.reason : null],
        );
        await audit(tx, ctx, { action: 'matching.moderate', entityType: 'matching_request', entityId: m.id, before: { status: m.status }, after: { status: target }, reason: ctx.body.reason ?? null });
        if (target === 'PUBLISHED') await notify(tx, { userId: m.user_id, type: 'MATCHING_PUBLISHED', params: { title: m.title }, link: '/matching' });
        if (target === 'REJECTED') await notify(tx, { userId: m.user_id, type: 'MATCHING_REJECTED', params: { title: m.title, reason: ctx.body.reason }, link: '/matching' });
      });
      return { status: target };
    },
  );

  /**
   * Transformer une demande en campagne : l'administration crée la campagne
   * normalement, puis la rattache ici. Tous les membres intéressés sont prévenus.
   */
  r.post('/admin/matching/:id/convert', { permission: 'matching.convert', body: z.object({ dealId: z.string().uuid() }) }, async (ctx) => {
    await app.db.tx(async (tx) => {
      const m = await tx.one(`SELECT * FROM matching_requests WHERE id = $1 FOR UPDATE`, [ctx.params.id]);
      if (!m) throw new DomainError('NOT_FOUND');
      if (!canTransitionMatching(m.status, 'CONVERTED')) throw new DomainError('CONFLICT', { from: m.status, to: 'CONVERTED' });
      const deal = await tx.one(`SELECT id, slug, title FROM group_deals WHERE id = $1`, [ctx.body.dealId]);
      if (!deal) throw new DomainError('NOT_FOUND');
      await tx.query(`UPDATE matching_requests SET status = 'CONVERTED', converted_deal_id = $2, moderated_by = $3, moderated_at = $4 WHERE id = $1`, [m.id, deal.id, ctx.me().id, ctx.now]);
      const interested = await tx.all(`SELECT user_id FROM matching_interests WHERE request_id = $1`, [m.id]);
      await notifyMany(tx, [m.user_id, ...interested.map((i) => i.user_id)], { type: 'MATCHING_CONVERTED', params: { title: m.title }, link: `/deals/${deal.slug}` });
      await audit(tx, ctx, { action: 'matching.convert', entityType: 'matching_request', entityId: m.id, after: { dealId: deal.id } });
    });
    return { status: 'CONVERTED' };
  });
}
