/**
 * Catalogue public : catégories, produits, campagnes GROUPDEALS (§9 à §13).
 * Toutes les réponses portent UN prix final par offre, jamais ses composants.
 */

import { z } from 'zod';
import { DomainError } from '@groupdeals/core';
import type { App } from '../app';
import type { Row } from '../db/pool';
import { Ctx } from '../http/server';
import { pageOf, viewerOf } from '../http/viewer';
import { OFFER_COLUMNS, OFFER_FROM, Viewer, dealOpenIn, loadOffer, localized, offerDto, outsideCampaignCountries, priceOffer } from '../services/pricing';

const listQuery = z.object({
  status: z.enum(['active', 'upcoming', 'ended', 'all']).default('active'),
  category: z.string().max(80).optional(),
  q: z.string().trim().max(80).optional(),
  sort: z.enum(['ending', 'popular', 'recent', 'featured']).default('featured'),
  featured: z.enum(['1', 'true']).optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

function categoryDto(row: Row, lang: string) {
  return {
    id: row.id,
    slug: row.slug,
    name: localized(row.name, row.i18n, lang, 'name'),
    description: localized(row.description, row.i18n, lang, 'description'),
    icon: row.icon,
    imageUrl: row.image_url,
    videoUrl: row.video_url,
    activeDeals: row.active_deals ?? 0,
  };
}

export async function listCategories(app: App, viewer: Viewer, now: Date) {
  const rows = await app.db.all(
    `SELECT c.*, (SELECT count(*)::int FROM group_deals d JOIN products p ON p.id = d.product_id
                   JOIN product_countries pc ON pc.product_id = p.id AND pc.country_code = $1
                  WHERE p.category_id = c.id AND d.stored_status = 'PUBLISHED'
                    AND ${dealOpenIn('d', '$1')}
                    AND d.starts_at <= $2 AND d.ends_at > $2 AND p.deleted_at IS NULL) AS active_deals
       FROM categories c WHERE c.is_active AND c.deleted_at IS NULL ORDER BY c.sort_order, c.name`,
    [viewer.countryCode, now],
  );
  return rows.map((row) => categoryDto(row, viewer.lang));
}

export async function listDeals(app: App, viewer: Viewer, q: z.infer<typeof listQuery>, now: Date) {
  const page = pageOf(q);
  const where: string[] = ['p.deleted_at IS NULL', 'p.is_active', 'pc.product_id IS NOT NULL', 'sr.id IS NOT NULL'];
  const params: unknown[] = [viewer.countryCode, now];
  if (q.status === 'active') where.push(`d.stored_status = 'PUBLISHED' AND d.starts_at <= $2 AND d.ends_at > $2`);
  else if (q.status === 'upcoming') where.push(`d.stored_status = 'PUBLISHED' AND d.starts_at > $2`);
  else if (q.status === 'ended') where.push(`(d.stored_status = 'COMPLETED' OR (d.stored_status = 'PUBLISHED' AND d.ends_at <= $2))`);
  else where.push(`d.stored_status IN ('PUBLISHED', 'COMPLETED')`);
  if (q.category) {
    params.push(q.category);
    where.push(`c.slug = $${params.length}`);
  }
  if (q.q) {
    params.push(`%${q.q.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(p.name ILIKE $${params.length} OR d.title ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
  }
  if (q.featured) where.push('d.is_featured');
  const order = {
    ending: 'd.ends_at ASC',
    popular: '(d.paid_quantity::float / d.target_quantity) DESC, d.participants_count DESC',
    recent: 'd.created_at DESC',
    // La campagne choisie pour la bannière passe en premier : c'est elle que montre la grande carte de l'accueil.
    featured: 'd.is_banner DESC, d.is_featured DESC, d.ends_at ASC',
  }[q.sort];

  const sqlWhere = where.join(' AND ');
  const total = (await app.db.one(`SELECT count(*)::int AS n ${OFFER_FROM} WHERE ${sqlWhere}`, params))!.n as number;
  const rows = await app.db.all(
    `SELECT ${OFFER_COLUMNS} ${OFFER_FROM} WHERE ${sqlWhere} ORDER BY ${order}, d.id LIMIT ${page.pageSize} OFFSET ${page.offset}`,
    params,
  );
  const items = [];
  for (const row of rows) items.push(await offerDto(app, row, viewer, now));
  return { items, page: page.page, pageSize: page.pageSize, total };
}

async function favoriteSet(app: App, userId: string | null, productIds: string[]): Promise<Set<string>> {
  if (!userId || !productIds.length) return new Set();
  const rows = await app.db.all(`SELECT product_id FROM favorites WHERE user_id = $1 AND product_id = ANY($2::uuid[])`, [userId, productIds]);
  return new Set(rows.map((x) => x.product_id));
}

export function registerCatalogRoutes(app: App): void {
  const r = app.router;

  r.get('/categories', { auth: 'optional' }, async (ctx) => {
    const viewer = await viewerOf(ctx);
    return { categories: await listCategories(app, viewer, ctx.now) };
  });

  /** Écran d'accueil : bannière, catégories, offres à la une, offres qui se terminent. */
  r.get('/home', { auth: 'optional' }, async (ctx) => {
    const viewer = await viewerOf(ctx);
    const base = { page: '1', pageSize: '8' } as const;
    const [categories, featured, ending, upcoming, stats] = await Promise.all([
      listCategories(app, viewer, ctx.now),
      listDeals(app, viewer, { status: 'active', sort: 'featured', ...base }, ctx.now),
      listDeals(app, viewer, { status: 'active', sort: 'ending', ...base, pageSize: '4' }, ctx.now),
      listDeals(app, viewer, { status: 'upcoming', sort: 'recent', ...base, pageSize: '4' }, ctx.now),
      app.db.one(
        `SELECT (SELECT count(*)::int FROM users) AS members,
                (SELECT count(*)::int FROM countries WHERE is_active) AS countries,
                (SELECT count(*)::int FROM group_deals WHERE stored_status = 'PUBLISHED' AND starts_at <= $1 AND ends_at > $1) AS active_deals,
                (SELECT COALESCE(sum(total_quantity), 0)::int FROM orders WHERE payment_status = 'PAID') AS units_ordered`,
        [ctx.now],
      ),
    ]);
    const fav = await favoriteSet(app, viewer.userId, [...featured.items, ...ending.items].map((d) => d.product.id));
    const mark = <T extends { product: { id: string } }>(items: T[]) => items.map((d) => ({ ...d, isFavorite: fav.has(d.product.id) }));
    return {
      stats: { members: stats!.members, countries: stats!.countries, activeDeals: stats!.active_deals, unitsOrdered: stats!.units_ordered },
      categories,
      featured: mark(featured.items),
      endingSoon: mark(ending.items),
      upcoming: upcoming.items,
      viewer: { country: viewer.countryCode, currency: viewer.currencyCode, language: viewer.lang },
    };
  });

  r.get('/group-deals', { auth: 'optional', query: listQuery }, async (ctx) => {
    const viewer = await viewerOf(ctx);
    const out = await listDeals(app, viewer, ctx.query, ctx.now);
    const fav = await favoriteSet(app, viewer.userId, out.items.map((d) => d.product.id));
    return { ...out, items: out.items.map((d) => ({ ...d, isFavorite: fav.has(d.product.id) })) };
  });

  r.get('/group-deals/:id', { auth: 'optional' }, async (ctx) => {
    const viewer = await viewerOf(ctx);
    return dealDetail(app, ctx, viewer, ctx.params.id);
  });

  /** Produits (hors campagne) : la fiche indique la campagne en cours s'il y en a une. */
  r.get('/products', { auth: 'optional', query: z.object({ category: z.string().optional(), q: z.string().trim().max(80).optional(), page: z.string().optional(), pageSize: z.string().optional() }) }, async (ctx) => {
    const viewer = await viewerOf(ctx);
    const page = pageOf(ctx.query);
    const params: unknown[] = [viewer.countryCode, ctx.now];
    const where = ['p.deleted_at IS NULL', 'p.is_active', 'pc.product_id IS NOT NULL'];
    if (ctx.query.category) {
      params.push(ctx.query.category);
      where.push(`c.slug = $${params.length}`);
    }
    if (ctx.query.q) {
      params.push(`%${String(ctx.query.q).replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`p.name ILIKE $${params.length}`);
    }
    const rows = await app.db.all(
      `SELECT p.id, p.slug, p.name, p.description, p.i18n, p.sale_unit, p.pieces_per_sale_unit, p.moq,
              c.slug AS category_slug, c.name AS category_name, c.i18n AS category_i18n,
              (SELECT json_build_object('kind', m.kind, 'url', m.url, 'thumbnailUrl', m.thumbnail_url, 'alt', m.alt)
                 FROM product_media m WHERE m.product_id = p.id ORDER BY (m.kind = 'IMAGE') DESC, m.sort_order LIMIT 1) AS cover,
              (SELECT d.slug FROM group_deals d WHERE d.product_id = p.id AND d.stored_status = 'PUBLISHED'
                  AND ${dealOpenIn('d', '$1')} AND d.starts_at <= $2 AND d.ends_at > $2 ORDER BY d.ends_at LIMIT 1) AS active_deal_slug,
              count(*) OVER()::int AS total
         FROM products p JOIN categories c ON c.id = p.category_id
         LEFT JOIN product_countries pc ON pc.product_id = p.id AND pc.country_code = $1
        WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
      params,
    );
    return {
      items: rows.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: localized(p.name, p.i18n, viewer.lang, 'name'),
        description: localized(p.description, p.i18n, viewer.lang, 'description'),
        saleUnit: p.sale_unit,
        piecesPerSaleUnit: p.pieces_per_sale_unit,
        moq: p.moq,
        cover: p.cover,
        category: { slug: p.category_slug, name: localized(p.category_name, p.category_i18n, viewer.lang, 'name') },
        activeDealSlug: p.active_deal_slug,
      })),
      page: page.page,
      pageSize: page.pageSize,
      total: rows[0]?.total ?? 0,
    };
  });

  r.get('/products/:id', { auth: 'optional' }, async (ctx) => {
    const viewer = await viewerOf(ctx);
    const byId = /^[0-9a-f-]{36}$/i.test(ctx.params.id);
    const deal = await app.db.one(
      `SELECT d.slug FROM group_deals d JOIN products p ON p.id = d.product_id
        WHERE ${byId ? 'p.id = $1::uuid' : 'p.slug = $1'} AND d.stored_status IN ('PUBLISHED', 'COMPLETED')
          AND ${dealOpenIn('d', '$3')}
        ORDER BY (d.stored_status = 'PUBLISHED' AND d.ends_at > $2) DESC, d.ends_at DESC LIMIT 1`,
      [ctx.params.id, ctx.now, viewer.countryCode],
    );
    if (!deal) throw new DomainError('NOT_FOUND');
    return dealDetail(app, ctx, viewer, deal.slug);
  });
}

/** Fiche produit complète (§13) : galerie, caractéristiques, variantes, MOQ, prix final. */
async function dealDetail(app: App, ctx: Ctx, viewer: Viewer, idOrSlug: string) {
  const row = await loadOffer(app.db, idOrSlug, viewer.countryCode);
  if (!row || row.stored_status === 'DRAFT') throw new DomainError('NOT_FOUND');
  // Lien direct vers une campagne réservée à d'autres pays : refusée, avec un message clair.
  if (outsideCampaignCountries(row, viewer.countryCode)) throw new DomainError('DEAL_NOT_IN_COUNTRY');
  const ref = await app.reference.get();
  const priceCtx = await app.reference.priceContext(viewer.countryCode);
  const [media, variants, fav] = await Promise.all([
    app.db.all(`SELECT kind, url, thumbnail_url, alt FROM product_media WHERE product_id = $1 ORDER BY sort_order, created_at`, [row.product_id]),
    app.db.all(`SELECT id, label, attributes, price_delta_amount FROM product_variants WHERE product_id = $1 AND is_active ORDER BY sort_order, label`, [row.product_id]),
    favoriteSet(app, viewer.userId, [row.product_id]),
  ]);
  const base = await offerDto(app, row, viewer, ctx.now);
  const threshold = ref.officeThreshold;

  return {
    deal: {
      ...base,
      isFavorite: fav.has(row.product_id),
      cancelReason: base.status === 'CANCELLED' ? row.cancel_reason : null,
      product: {
        ...base.product,
        features: localizedList(row.features, row.product_i18n, viewer.lang, 'features'),
        specifications: localizedList(row.specifications, row.product_i18n, viewer.lang, 'specifications'),
        origin: row.origin_country,
        leadTimeDays: row.lead_time_days_min === null ? null : { min: row.lead_time_days_min, max: row.lead_time_days_max ?? row.lead_time_days_min },
        media: media.map((m) => ({ kind: m.kind, url: m.url, thumbnailUrl: m.thumbnail_url, alt: m.alt })),
        variants: variants.map((v) => {
          const priced = priceOffer(priceCtx, row, viewer.countryCode, viewer.currencyCode, v.price_delta_amount);
          return {
            id: v.id,
            label: v.label,
            attributes: v.attributes,
            price: priced.breakdown ? app.reference.moneySync(ref, priced.breakdown.unitFinal, viewer.currencyCode, viewer.lang) : null,
          };
        }),
      },
      officePayment: {
        enabled: ref.officeMethodActive,
        threshold: threshold ? app.reference.moneySync(ref, threshold.amount, threshold.currency, viewer.lang) : null,
      },
    },
  };
}

function localizedList(base: unknown, i18n: Record<string, Record<string, unknown>> | null, lang: string, field: string): unknown {
  const t = i18n?.[lang]?.[field];
  return Array.isArray(t) && t.length ? t : base;
}
