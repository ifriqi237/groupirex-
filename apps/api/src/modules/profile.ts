/**
 * Profil, favoris et notifications (§32, §33).
 */

import { z } from 'zod';
import { DomainError } from '@groupdeals/core';
import type { App } from '../app';
import { Reply } from '../http/server';
import { pageOf, viewerOf } from '../http/viewer';
import { OFFER_COLUMNS, OFFER_FROM, dealOpenIn, offerDto } from '../services/pricing';
import { loadProfile } from './auth';
import { audit } from '../services/audit';

const updateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80),
    whatsapp: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s().-]/g, ''))
      .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/)),
    countryCode: z.string().length(2).toUpperCase(),
    languageCode: z.string().min(2).max(5),
    avatarUrl: z.string().max(500).nullable(),
    notificationPrefs: z.object({ push: z.boolean(), email: z.boolean(), whatsapp: z.boolean() }).partial(),
  })
  .partial();

/** Délai minimal entre deux changements de pays du compte. */
const COUNTRY_CHANGE_DAYS = 30;

/**
 * Le pays du compte décide des campagnes visibles, du prix et de la devise.
 * Pour qu'un changement de pays ne serve pas à contourner une campagne réservée :
 *   - pas de changement tant qu'une commande attend son paiement (elle garde son pays d'origine) ;
 *   - un seul changement par période de 30 jours (le premier est libre) ; au-delà, le support tranche ;
 *   - chaque changement est inscrit au journal d'audit.
 * Les commandes passées gardent leur pays, leur devise et leur prix : le changement ne vaut que pour la suite.
 */
async function guardCountryChange(app: App, userId: string, next: string | undefined, ctx: Parameters<typeof audit>[1]): Promise<void> {
  if (!next) return;
  const u = await app.db.one(`SELECT country_code::text AS country_code, country_changed_at FROM users WHERE id = $1`, [userId]);
  if (!u || u.country_code === next) return;
  const pending = await app.db.one(`SELECT count(*)::int AS n FROM orders WHERE user_id = $1 AND payment_status IN ('PENDING', 'FAILED')`, [userId]);
  if (pending!.n > 0) throw new DomainError('COUNTRY_CHANGE_PENDING_ORDERS');
  const now = app.clock.now();
  if (u.country_changed_at && now.getTime() - (u.country_changed_at as Date).getTime() < COUNTRY_CHANGE_DAYS * 86_400_000) {
    throw new DomainError('COUNTRY_CHANGE_TOO_SOON');
  }
  await app.db.query(`UPDATE users SET country_changed_at = $2 WHERE id = $1`, [userId, now]);
  await audit(app.db, ctx, { action: 'user.country_change', entityType: 'user', entityId: userId, before: { country: u.country_code }, after: { country: next } });
}

export function registerProfileRoutes(app: App): void {
  const r = app.router;

  r.get('/me', { allowWithoutMfa: true }, async (ctx) => ({ user: await loadProfile(app, app.db, ctx.me().id), mfa: ctx.me().mfa }));

  /**
   * Changer de pays change la devise et le prix final des offres (§47).
   * Les commandes déjà passées gardent le pays, la devise et le prix d'origine.
   */
  r.patch('/me', { body: updateSchema }, async (ctx) => {
    const me = ctx.me();
    const b = ctx.body as z.infer<typeof updateSchema>;
    const ref = await app.reference.get();
    if (b.countryCode) await app.reference.country(b.countryCode);
    await guardCountryChange(app, me.id, b.countryCode, ctx);
    if (b.languageCode && !ref.languages.some((l) => l.code === b.languageCode && l.isActive)) {
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'languageCode', message: 'Langue indisponible' }] });
    }
    await app.db.query(
      `UPDATE users SET first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name), whatsapp = COALESCE($4, whatsapp),
              country_code = COALESCE($5, country_code), language_code = COALESCE($6, language_code),
              avatar_url = CASE WHEN $7::boolean THEN $8 ELSE avatar_url END,
              notification_prefs = notification_prefs || $9::jsonb
        WHERE id = $1`,
      [me.id, b.firstName ?? null, b.lastName ?? null, b.whatsapp ?? null, b.countryCode ?? null, b.languageCode ?? null,
       b.avatarUrl !== undefined, b.avatarUrl ?? null, JSON.stringify(b.notificationPrefs ?? {})],
    );
    return { user: await loadProfile(app, app.db, me.id) };
  });

  /* -------------------------------- Favoris -------------------------------- */

  r.get('/me/favorites', {}, async (ctx) => {
    const viewer = await viewerOf(ctx);
    // Pour chaque produit favori : sa campagne la plus pertinente (en cours, sinon la plus récente).
    const rows = await app.db.all(
      `SELECT ${OFFER_COLUMNS}, fav.created_at AS favorited_at
         ${OFFER_FROM}
         JOIN favorites fav ON fav.product_id = p.id AND fav.user_id = $2
        WHERE d.id = (SELECT d2.id FROM group_deals d2 WHERE d2.product_id = p.id AND d2.stored_status IN ('PUBLISHED', 'COMPLETED')
                         AND ${dealOpenIn('d2', '$1')}
                       ORDER BY (d2.stored_status = 'PUBLISHED' AND d2.ends_at > $3) DESC, d2.ends_at DESC LIMIT 1)
        ORDER BY fav.created_at DESC`,
      [viewer.countryCode, ctx.me().id, ctx.now],
    );
    const items = [];
    for (const row of rows) items.push({ ...(await offerDto(app, row, viewer, ctx.now)), isFavorite: true });
    return { items };
  });

  r.put('/me/favorites/:productId', {}, async (ctx) => {
    const me = ctx.me();
    const product = await app.db.one(`SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL`, [ctx.params.productId]);
    if (!product) throw new DomainError('NOT_FOUND');
    const res = await app.db.query(`INSERT INTO favorites (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me.id, product.id]);
    if (res.rowCount) {
      await app.db.query(`INSERT INTO analytics_events (type, user_id, country_code, entity_type, entity_id) VALUES ('favorite_add', $1, $2, 'product', $3)`, [me.id, me.countryCode, product.id]);
    }
    return { isFavorite: true };
  });

  r.delete('/me/favorites/:productId', {}, async (ctx) => {
    await app.db.query(`DELETE FROM favorites WHERE user_id = $1 AND product_id = $2`, [ctx.me().id, ctx.params.productId]);
    return { isFavorite: false };
  });

  /* ------------------------------ Notifications ------------------------------ */

  r.get('/me/notifications', { allowWithoutMfa: true, query: z.object({ page: z.string().optional(), pageSize: z.string().optional() }) }, async (ctx) => {
    const me = ctx.me();
    const page = pageOf(ctx.query, 30, 100);
    const rows = await app.db.all(
      `SELECT id, type, params, link, read_at, created_at FROM notifications
        WHERE user_id = $1 AND type NOT IN ('EMAIL_VERIFY', 'PASSWORD_RESET')
        ORDER BY created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
      [me.id],
    );
    const unread = await app.db.one(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [me.id]);
    return {
      items: rows.map((n) => ({ id: n.id, type: n.type, params: n.params, link: n.link, read: n.read_at !== null, createdAt: n.created_at })),
      unread: unread!.n,
    };
  });

  r.post('/me/notifications/read', { body: z.object({ ids: z.array(z.string().uuid()).max(200).optional() }) }, async (ctx) => {
    await app.db.query(
      `UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))`,
      [ctx.me().id, ctx.now, ctx.body.ids ?? null],
    );
    return Reply.noContent();
  });

  /** Enregistre l'appareil pour les notifications push (Firebase Cloud Messaging). */
  r.post('/me/devices', { body: z.object({ token: z.string().min(20).max(500), platform: z.enum(['WEB', 'ANDROID', 'IOS']) }) }, async (ctx) => {
    await app.db.query(
      `INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform`,
      [ctx.me().id, ctx.body.token, ctx.body.platform],
    );
    return Reply.noContent();
  });

  r.delete('/me/devices/:token', {}, async (ctx) => {
    await app.db.query(`DELETE FROM device_tokens WHERE user_id = $1 AND token = $2`, [ctx.me().id, ctx.params.token]);
    return Reply.noContent();
  });
}
