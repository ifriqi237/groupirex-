/**
 * Back-office du catalogue : catégories, produits, variantes, médias, pays,
 * tarifs de livraison (Produit -> Pays -> Tarif) et campagnes (§10, §11, §36, §37).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DomainError, PRODUCT_MEDIA_LIMITS, applyDealDecision, dealProgress, deriveDealStatus, mediaProblem } from '@groupdeals/core';
import type { App } from '../app';
import { Db, Row, uniqueViolation } from '../db/pool';
import { Ctx, Reply } from '../http/server';
import { pageOf } from '../http/viewer';
import { audit } from '../services/audit';
import { broadcast, notify, notifyMany } from '../services/notify';
import { attachToShipment } from '../services/orders';
import { dealStateOf, priceOffer } from '../services/pricing';

export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'article'
  );
}

async function uniqueSlug(db: Db, table: 'products' | 'categories' | 'group_deals', base: string, exceptId?: string): Promise<string> {
  let slug = base;
  for (let i = 2; ; i++) {
    const clash = await db.one(`SELECT id FROM ${table} WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2)`, [slug, exceptId ?? null]);
    if (!clash) return slug;
    slug = `${base}-${i}`;
  }
}

const i18nSchema = z.record(z.string().min(2).max(5), z.record(z.string(), z.any())).default({});
const moneySchema = z.object({ amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), currency: z.string().length(3).toUpperCase() });

const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).default(''),
  icon: z.string().max(40).nullish(),
  imageUrl: z.string().max(500).nullish(),
  videoUrl: z.string().max(500).nullish(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  i18n: i18nSchema,
});

const productSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().max(80).optional(),
  description: z.string().trim().max(5000).default(''),
  features: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  specifications: z.array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(300) })).max(40).default([]),
  originCountry: z.string().trim().max(80).nullish(),
  leadTimeDaysMin: z.number().int().min(0).max(730).nullish(),
  leadTimeDaysMax: z.number().int().min(0).max(730).nullish(),
  saleUnit: z.enum(['UNIT', 'LOT', 'CARTON', 'PALLET']).default('UNIT'),
  piecesPerSaleUnit: z.number().int().min(1).max(1_000_000).default(1),
  moq: z.number().int().min(1).max(1_000_000).default(1),
  maxPerOrder: z.number().int().min(1).nullish(),
  basePrice: moneySchema,
  compareAtAmount: z.number().int().min(0).nullish(),
  supplierCost: moneySchema.nullish(),
  isActive: z.boolean().default(true),
  i18n: i18nSchema,
});

const variantSchema = z.object({
  sku: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  attributes: z.record(z.string(), z.string().max(80)).default({}),
  priceDeltaAmount: z.number().int().default(0),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

const shippingSchema = z.object({
  rates: z
    .array(
      z.object({
        countryCode: z.string().length(2).toUpperCase(),
        enabled: z.boolean(),
        /** Livraison facturée, par unité de vente, dans la devise indiquée. null = pas de tarif. */
        amount: z.number().int().min(0).nullable(),
        currency: z.string().length(3).toUpperCase().optional(),
        freightCost: z.number().int().min(0).default(0),
        customsCost: z.number().int().min(0).default(0),
      }),
    )
    .max(80),
});

const dealSchema = z.object({
  productId: z.string().uuid(),
  title: z.string().trim().max(160).nullish(),
  basePrice: moneySchema.optional(),
  compareAtAmount: z.number().int().min(0).nullish(),
  targetQuantity: z.number().int().min(1).max(100_000_000),
  minQuantity: z.number().int().min(1).optional(),
  maxPerOrder: z.number().int().min(1).nullish(),
  maxQuantity: z.number().int().min(1).nullish(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  isFeatured: z.boolean().default(false),
});

const decisionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('EXTEND'), newEndsAt: z.string().datetime() }),
  z.object({ type: z.literal('CONFIRM') }),
  z.object({ type: z.literal('CANCEL'), reason: z.string().trim().min(3).max(500) }),
]);

function productAdminDto(p: Row) {
  return {
    id: p.id,
    categoryId: p.category_id,
    categoryName: p.category_name,
    slug: p.slug,
    name: p.name,
    description: p.description,
    features: p.features,
    specifications: p.specifications,
    originCountry: p.origin_country,
    leadTimeDaysMin: p.lead_time_days_min,
    leadTimeDaysMax: p.lead_time_days_max,
    saleUnit: p.sale_unit,
    piecesPerSaleUnit: p.pieces_per_sale_unit,
    moq: p.moq,
    maxPerOrder: p.max_per_order,
    basePrice: { amount: p.base_price_amount, currency: p.base_price_currency },
    compareAtAmount: p.compare_at_amount,
    supplierCost: p.supplier_cost_amount === null ? null : { amount: p.supplier_cost_amount, currency: p.supplier_cost_currency },
    isActive: p.is_active,
    i18n: p.i18n,
    cover: p.cover ?? null,
    countriesCount: p.countries_count,
    dealsCount: p.deals_count,
    createdAt: p.created_at,
  };
}

async function assertCurrency(app: App, code: string): Promise<void> {
  const ref = await app.reference.get();
  if (!ref.currencies[code]) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'currency', message: `Devise inconnue : ${code}` }] });
}

export function registerAdminCatalogRoutes(app: App): void {
  const r = app.router;
  const read = { permission: ['catalog.read', 'catalog.manage'] as ('catalog.read' | 'catalog.manage')[] };
  const manage = { permission: 'catalog.manage' as const };

  /* ------------------------------- Catégories ------------------------------- */

  r.get('/admin/categories', read, async () => {
    const rows = await app.db.all(
      `SELECT c.*, (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS products_count
         FROM categories c WHERE c.deleted_at IS NULL ORDER BY c.sort_order, c.name`,
    );
    return {
      categories: rows.map((c) => ({
        id: c.id, slug: c.slug, name: c.name, description: c.description, icon: c.icon, imageUrl: c.image_url, videoUrl: c.video_url,
        sortOrder: c.sort_order, isActive: c.is_active, i18n: c.i18n, productsCount: c.products_count,
      })),
    };
  });

  r.post('/admin/categories', { ...manage, body: categorySchema }, async (ctx) => {
    const b = ctx.body as z.infer<typeof categorySchema>;
    const row = await app.db.tx(async (tx) => {
      const slug = await uniqueSlug(tx, 'categories', slugify(b.slug || b.name));
      const created = await tx.one(
        `INSERT INTO categories (slug, name, description, icon, image_url, video_url, sort_order, is_active, i18n)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [slug, b.name, b.description, b.icon ?? null, b.imageUrl ?? null, b.videoUrl ?? null, b.sortOrder, b.isActive, JSON.stringify(b.i18n)],
      );
      await audit(tx, ctx, { action: 'category.create', entityType: 'category', entityId: created!.id, after: b });
      return created!;
    });
    return Reply.created({ id: row.id });
  });

  r.put('/admin/categories/:id', { ...manage, body: categorySchema }, async (ctx) => {
    const b = ctx.body as z.infer<typeof categorySchema>;
    await app.db.tx(async (tx) => {
      const before = await tx.one(`SELECT * FROM categories WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [ctx.params.id]);
      if (!before) throw new DomainError('NOT_FOUND');
      const slug = await uniqueSlug(tx, 'categories', slugify(b.slug || before.slug), before.id);
      await tx.query(
        `UPDATE categories SET slug = $2, name = $3, description = $4, icon = $5, image_url = $6, video_url = $7, sort_order = $8, is_active = $9, i18n = $10 WHERE id = $1`,
        [before.id, slug, b.name, b.description, b.icon ?? null, b.imageUrl ?? null, b.videoUrl ?? null, b.sortOrder, b.isActive, JSON.stringify(b.i18n)],
      );
      await audit(tx, ctx, { action: 'category.update', entityType: 'category', entityId: before.id, before: { name: before.name, isActive: before.is_active, sortOrder: before.sort_order }, after: b });
    });
    return { updated: true };
  });

  /** Réordonner : la liste des identifiants dans le nouvel ordre. */
  r.post('/admin/categories/reorder', { ...manage, body: z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }) }, async (ctx) => {
    await app.db.tx(async (tx) => {
      for (const [i, id] of (ctx.body.ids as string[]).entries()) await tx.query(`UPDATE categories SET sort_order = $2 WHERE id = $1`, [id, i + 1]);
      await audit(tx, ctx, { action: 'category.reorder', entityType: 'category', after: { ids: ctx.body.ids } });
    });
    return { updated: true };
  });

  /** Suppression : réservée au super-admin (§10). Refusée si la catégorie contient des produits. */
  r.delete('/admin/categories/:id', { permission: 'categories.delete' }, async (ctx) => {
    await app.db.tx(async (tx) => {
      const used = await tx.one(`SELECT count(*)::int AS n FROM products WHERE category_id = $1 AND deleted_at IS NULL`, [ctx.params.id]);
      if (used!.n > 0) throw new DomainError('CONFLICT', { reason: 'category_not_empty', products: used!.n });
      const res = await tx.query(`UPDATE categories SET deleted_at = $2, is_active = false, slug = slug || '-supprime-' || left(id::text, 8) WHERE id = $1 AND deleted_at IS NULL`, [ctx.params.id, ctx.now]);
      if (!res.rowCount) throw new DomainError('NOT_FOUND');
      await audit(tx, ctx, { action: 'category.delete', entityType: 'category', entityId: ctx.params.id });
    });
    return Reply.noContent();
  });

  /* -------------------------------- Produits -------------------------------- */

  const PRODUCT_SELECT = `
    SELECT p.*, c.name AS category_name,
           (SELECT json_build_object('kind', m.kind, 'url', m.url, 'thumbnailUrl', m.thumbnail_url) FROM product_media m
             WHERE m.product_id = p.id ORDER BY (m.kind = 'IMAGE') DESC, m.sort_order LIMIT 1) AS cover,
           (SELECT count(*)::int FROM product_countries pc WHERE pc.product_id = p.id) AS countries_count,
           (SELECT count(*)::int FROM group_deals d WHERE d.product_id = p.id) AS deals_count
      FROM products p JOIN categories c ON c.id = p.category_id`;

  r.get('/admin/products', { ...read, query: z.object({ q: z.string().trim().max(80).optional(), categoryId: z.string().uuid().optional(), page: z.string().optional(), pageSize: z.string().optional() }) }, async (ctx) => {
    const page = pageOf(ctx.query, 30, 100);
    const like = ctx.query.q ? `%${ctx.query.q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const rows = await app.db.all(
      `${PRODUCT_SELECT} WHERE p.deleted_at IS NULL AND ($1::text IS NULL OR p.name ILIKE $1) AND ($2::uuid IS NULL OR p.category_id = $2)
        ORDER BY p.created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
      [like, ctx.query.categoryId ?? null],
    );
    const total = await app.db.one(
      `SELECT count(*)::int AS n FROM products p WHERE p.deleted_at IS NULL AND ($1::text IS NULL OR p.name ILIKE $1) AND ($2::uuid IS NULL OR p.category_id = $2)`,
      [like, ctx.query.categoryId ?? null],
    );
    return { items: rows.map(productAdminDto), total: total!.n, page: page.page, pageSize: page.pageSize };
  });

  r.get('/admin/products/:id', read, async (ctx) => {
    const p = await app.db.one(`${PRODUCT_SELECT} WHERE p.id = $1 AND p.deleted_at IS NULL`, [ctx.params.id]);
    if (!p) throw new DomainError('NOT_FOUND');
    const [variants, media] = await Promise.all([
      app.db.all(`SELECT * FROM product_variants WHERE product_id = $1 ORDER BY sort_order, label`, [p.id]),
      app.db.all(`SELECT * FROM product_media WHERE product_id = $1 ORDER BY sort_order, created_at`, [p.id]),
    ]);
    return {
      product: productAdminDto(p),
      variants: variants.map((v) => ({ id: v.id, sku: v.sku, label: v.label, attributes: v.attributes, priceDeltaAmount: v.price_delta_amount, sortOrder: v.sort_order, isActive: v.is_active })),
      media: media.map((m) => ({ id: m.id, kind: m.kind, url: m.url, thumbnailUrl: m.thumbnail_url, alt: m.alt, sortOrder: m.sort_order })),
    };
  });

  const writeProduct = async (ctx: Ctx, id: string | null) => {
    const b = ctx.body as z.infer<typeof productSchema>;
    await assertCurrency(app, b.basePrice.currency);
    if (b.supplierCost) await assertCurrency(app, b.supplierCost.currency);
    if (b.maxPerOrder && b.maxPerOrder < b.moq) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'maxPerOrder', message: 'Doit être supérieur ou égal au MOQ' }] });
    return app.db.tx(async (tx) => {
      const category = await tx.one(`SELECT id FROM categories WHERE id = $1 AND deleted_at IS NULL`, [b.categoryId]);
      if (!category) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'categoryId', message: 'Catégorie inconnue' }] });
      const before = id ? await tx.one(`SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]) : null;
      if (id && !before) throw new DomainError('NOT_FOUND');
      const slug = await uniqueSlug(tx, 'products', slugify(b.slug || before?.slug || b.name), id ?? undefined);
      const values = [
        b.categoryId, slug, b.name, b.description, JSON.stringify(b.features), JSON.stringify(b.specifications), b.originCountry ?? null,
        b.leadTimeDaysMin ?? null, b.leadTimeDaysMax ?? null, b.saleUnit, b.piecesPerSaleUnit, b.moq, b.maxPerOrder ?? null,
        b.basePrice.amount, b.basePrice.currency, b.compareAtAmount ?? null, b.supplierCost?.amount ?? null, b.supplierCost?.currency ?? null,
        b.isActive, JSON.stringify(b.i18n),
      ];
      let productId = id;
      if (id) {
        await tx.query(
          `UPDATE products SET category_id=$2, slug=$3, name=$4, description=$5, features=$6, specifications=$7, origin_country=$8,
                  lead_time_days_min=$9, lead_time_days_max=$10, sale_unit=$11, pieces_per_sale_unit=$12, moq=$13, max_per_order=$14,
                  base_price_amount=$15, base_price_currency=$16, compare_at_amount=$17, supplier_cost_amount=$18, supplier_cost_currency=$19,
                  is_active=$20, i18n=$21 WHERE id=$1`,
          [id, ...values],
        );
      } else {
        const created = await tx.one(
          `INSERT INTO products (category_id, slug, name, description, features, specifications, origin_country, lead_time_days_min, lead_time_days_max,
                                 sale_unit, pieces_per_sale_unit, moq, max_per_order, base_price_amount, base_price_currency, compare_at_amount,
                                 supplier_cost_amount, supplier_cost_currency, is_active, i18n, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
          [...values, ctx.me().id],
        );
        productId = created!.id;
      }
      await audit(tx, ctx, {
        action: id ? 'product.update' : 'product.create',
        entityType: 'product',
        entityId: productId,
        before: before ? { name: before.name, basePrice: before.base_price_amount, currency: before.base_price_currency, moq: before.moq, supplierCost: before.supplier_cost_amount, isActive: before.is_active } : undefined,
        after: { name: b.name, basePrice: b.basePrice.amount, currency: b.basePrice.currency, moq: b.moq, supplierCost: b.supplierCost?.amount ?? null, isActive: b.isActive },
      });
      return productId as string;
    });
  };

  r.post('/admin/products', { ...manage, body: productSchema }, async (ctx) => Reply.created({ id: await writeProduct(ctx, null) }));
  r.put('/admin/products/:id', { ...manage, body: productSchema }, async (ctx) => ({ id: await writeProduct(ctx, ctx.params.id) }));

  /** Suppression logique. Refusée si une campagne publiée utilise le produit. */
  r.delete('/admin/products/:id', manage, async (ctx) => {
    await app.db.tx(async (tx) => {
      const live = await tx.one(`SELECT count(*)::int AS n FROM group_deals WHERE product_id = $1 AND stored_status = 'PUBLISHED'`, [ctx.params.id]);
      if (live!.n > 0) throw new DomainError('CONFLICT', { reason: 'product_has_live_deal' });
      const res = await tx.query(
        `UPDATE products SET deleted_at = $2, is_active = false, slug = slug || '-supprime-' || left(id::text, 8) WHERE id = $1 AND deleted_at IS NULL`,
        [ctx.params.id, ctx.now],
      );
      if (!res.rowCount) throw new DomainError('NOT_FOUND');
      await audit(tx, ctx, { action: 'product.delete', entityType: 'product', entityId: ctx.params.id });
    });
    return Reply.noContent();
  });

  /* -------------------------------- Variantes -------------------------------- */

  r.put('/admin/products/:id/variants', { ...manage, body: z.object({ variants: z.array(variantSchema.extend({ id: z.string().uuid().optional() })).max(200) }) }, async (ctx) => {
    const list = ctx.body.variants as (z.infer<typeof variantSchema> & { id?: string })[];
    try {
      await app.db.tx(async (tx) => {
        const product = await tx.one(`SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [ctx.params.id]);
        if (!product) throw new DomainError('NOT_FOUND');
        const keep: string[] = [];
        for (const v of list) {
          const args = [v.sku, v.label, JSON.stringify(v.attributes), v.priceDeltaAmount, v.sortOrder, v.isActive];
          if (v.id) {
            const res = await tx.query(
              `UPDATE product_variants SET sku=$3, label=$4, attributes=$5, price_delta_amount=$6, sort_order=$7, is_active=$8 WHERE id=$1 AND product_id=$2`,
              [v.id, product.id, ...args],
            );
            if (!res.rowCount) throw new DomainError('VARIANT_INVALID');
            keep.push(v.id);
          } else {
            const row = await tx.one(
              `INSERT INTO product_variants (product_id, sku, label, attributes, price_delta_amount, sort_order, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
              [product.id, ...args],
            );
            keep.push(row!.id);
          }
        }
        // Une variante déjà commandée n'est jamais effacée : elle est désactivée.
        await tx.query(
          `UPDATE product_variants SET is_active = false WHERE product_id = $1 AND NOT (id = ANY($2::uuid[]))
              AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.variant_id = product_variants.id)`,
          [product.id, keep],
        );
        await tx.query(
          `DELETE FROM product_variants WHERE product_id = $1 AND NOT (id = ANY($2::uuid[]))
              AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.variant_id = product_variants.id)`,
          [product.id, keep],
        );
        await audit(tx, ctx, { action: 'product.variants', entityType: 'product', entityId: product.id, after: { count: list.length } });
      });
    } catch (e) {
      if (uniqueViolation(e)) throw new DomainError('CONFLICT', { reason: 'sku_taken' });
      throw e;
    }
    return { updated: true };
  });

  /* --------------------------------- Médias --------------------------------- */

  /**
   * Envoi d'un fichier (corps brut). Les images sont recompressées en WebP en deux
   * tailles ; les vidéos sont gardées telles quelles et ne sont jamais chargées
   * automatiquement dans les listes (§45).
   */
  r.post('/admin/media', { ...manage, raw: true, maxBodyBytes: 60 * 1024 * 1024 }, async (ctx) => {
    const type = String(ctx.header('content-type') ?? '').split(';')[0].trim();
    if (!ctx.rawBody.length) throw new DomainError('VALIDATION_FAILED', { reason: 'empty_file' });
    const id = crypto.randomBytes(12).toString('hex');
    const dir = path.join(app.config.uploadsDir, id.slice(0, 2));
    fs.mkdirSync(dir, { recursive: true });
    const rel = (name: string) => `/media/${id.slice(0, 2)}/${name}`;

    if (/^image\/(jpeg|png|webp|avif)$/.test(type)) {
      if (ctx.rawBody.length > 12 * 1024 * 1024) throw new DomainError('VALIDATION_FAILED', { reason: 'image_too_large', limitMb: 12 });
      const sharp = (await import('sharp')).default;
      let image;
      try {
        image = sharp(ctx.rawBody, { failOn: 'error' }).rotate();
        await image.metadata();
      } catch {
        throw new DomainError('VALIDATION_FAILED', { reason: 'invalid_image' });
      }
      await image.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(dir, `${id}.webp`));
      await image.clone().resize({ width: 480, height: 480, fit: 'cover' }).webp({ quality: 74 }).toFile(path.join(dir, `${id}-thumb.webp`));
      return Reply.created({ kind: 'IMAGE', url: rel(`${id}.webp`), thumbnailUrl: rel(`${id}-thumb.webp`) });
    }
    if (/^video\/(mp4|webm)$/.test(type)) {
      const ext = type.endsWith('webm') ? 'webm' : 'mp4';
      // Signature du fichier : un MP4 contient « ftyp » en tête, un WebM commence par l'en-tête EBML.
      const ok = ext === 'mp4' ? ctx.rawBody.subarray(4, 8).toString('latin1') === 'ftyp' : ctx.rawBody.readUInt32BE(0) === 0x1a45dfa3;
      if (!ok) throw new DomainError('VALIDATION_FAILED', { reason: 'invalid_video' });
      fs.writeFileSync(path.join(dir, `${id}.${ext}`), ctx.rawBody);
      return Reply.created({ kind: 'VIDEO', url: rel(`${id}.${ext}`), thumbnailUrl: null });
    }
    throw new DomainError('VALIDATION_FAILED', { reason: 'unsupported_type', accepted: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'] });
  });

  r.put(
    '/admin/products/:id/media',
    {
      ...manage,
      body: z.object({
        media: z
          .array(z.object({ kind: z.enum(['IMAGE', 'VIDEO']), url: z.string().min(1).max(500), thumbnailUrl: z.string().max(500).nullish(), alt: z.string().max(200).default('') }))
          .max(PRODUCT_MEDIA_LIMITS.photos + PRODUCT_MEDIA_LIMITS.videos),
      }),
    },
    async (ctx) => {
      const list = ctx.body.media as { kind: string; url: string; thumbnailUrl?: string | null; alt: string }[];
      // Le carrousel de la page d'une offre présente au plus dix photos et une vidéo.
      const problem = mediaProblem(list);
      if (problem === 'TOO_MANY_PHOTOS') throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'media', message: 'Dix photos au maximum par produit.' }] });
      if (problem === 'TOO_MANY_VIDEOS') throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'media', message: 'Une seule vidéo par produit.' }] });
      await app.db.tx(async (tx) => {
        const product = await tx.one(`SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [ctx.params.id]);
        if (!product) throw new DomainError('NOT_FOUND');
        await tx.query(`DELETE FROM product_media WHERE product_id = $1`, [product.id]);
        for (const [i, m] of list.entries()) {
          await tx.query(`INSERT INTO product_media (product_id, kind, url, thumbnail_url, alt, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`, [
            product.id, m.kind, m.url, m.thumbnailUrl ?? null, m.alt, i,
          ]);
        }
        await audit(tx, ctx, { action: 'product.media', entityType: 'product', entityId: product.id, after: { count: list.length } });
      });
      return { updated: true };
    },
  );

  /* ---------------------- Livraison : Produit -> Pays -> Tarif ---------------------- */

  /**
   * Tableau des prix par pays : tarif de livraison, prix final calculé, et — pour
   * les rôles autorisés — composants et marge. C'est la vue interne du §17.
   */
  r.get('/admin/products/:id/pricing', { permission: ['pricing.manage', 'catalog.read', 'margins.view'] }, async (ctx) => {
    const p = await app.db.one(`SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL`, [ctx.params.id]);
    if (!p) throw new DomainError('NOT_FOUND');
    const ref = await app.reference.get();
    const rates = await app.db.all(`SELECT * FROM shipping_rates WHERE product_id = $1 AND is_current`, [p.id]);
    const enabled = new Set((await app.db.all(`SELECT country_code FROM product_countries WHERE product_id = $1`, [p.id])).map((x) => x.country_code));
    const showMargin = ctx.can('margins.view');
    const rows = [];
    for (const country of Object.values(ref.countries).filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name, 'fr'))) {
      const rate = rates.find((x) => x.country_code === country.code);
      const priceCtx = await app.reference.priceContext(country.code);
      const priced = priceOffer(
        priceCtx,
        {
          base_price_amount: p.base_price_amount, base_price_currency: p.base_price_currency,
          supplier_cost_amount: p.supplier_cost_amount, supplier_cost_currency: p.supplier_cost_currency,
          shipping_rate_id: rate?.id ?? null, shipping_amount: rate?.amount, shipping_currency: rate?.currency_code,
          freight_cost: rate?.freight_cost, customs_cost: rate?.customs_cost, country_enabled: enabled.has(country.code), compare_at_amount: null,
        },
        country.code,
        country.currencyCode,
      );
      const money = (a: number) => app.reference.moneySync(ref, a, country.currencyCode);
      const b = priced.breakdown;
      rows.push({
        country: { code: country.code, name: country.name, currency: country.currencyCode },
        enabled: enabled.has(country.code),
        shipping: rate
          ? { amount: rate.amount, currency: rate.currency_code, freightCost: showMargin ? rate.freight_cost : null, customsCost: showMargin ? rate.customs_cost : null, since: rate.created_at }
          : null,
        finalPrice: b ? money(b.unitFinal) : null,
        unavailable: priced.unavailable,
        components: b
          ? {
              base: money(b.baseConverted),
              shipping: money(b.shippingConverted),
              rounding: money(b.roundingAdjustment),
              fxBufferBps: b.fxBufferBps,
              rates: b.ratesUsed,
            }
          : null,
        margin: showMargin && b && b.estimatedUnitMargin !== null
          ? { amount: money(Math.abs(b.estimatedUnitMargin)), negative: b.estimatedUnitMargin < 0, percent: b.unitFinal ? Math.round((b.estimatedUnitMargin / b.unitFinal) * 1000) / 10 : 0 }
          : null,
      });
    }
    return {
      product: { id: p.id, name: p.name, basePrice: { amount: p.base_price_amount, currency: p.base_price_currency } },
      countries: rows,
      canEdit: ctx.can('pricing.manage'),
      canSeeMargins: showMargin,
    };
  });

  /** Enregistre les pays desservis et les tarifs. Un tarif modifié est historisé, jamais écrasé. */
  r.put('/admin/products/:id/shipping-rates', { permission: 'pricing.manage', body: shippingSchema }, async (ctx) => {
    const { rates } = ctx.body as z.infer<typeof shippingSchema>;
    const ref = await app.reference.get();
    const changes: unknown[] = [];
    await app.db.tx(async (tx) => {
      const product = await tx.one(`SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [ctx.params.id]);
      if (!product) throw new DomainError('NOT_FOUND');
      for (const rate of rates) {
        const country = ref.countries[rate.countryCode];
        if (!country) throw new DomainError('COUNTRY_NOT_COVERED', { country: rate.countryCode });
        const currency = rate.currency ?? country.currencyCode;
        if (!ref.currencies[currency]) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'currency', message: `Devise inconnue : ${currency}` }] });

        if (rate.enabled) await tx.query(`INSERT INTO product_countries (product_id, country_code) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [product.id, rate.countryCode]);
        else await tx.query(`DELETE FROM product_countries WHERE product_id = $1 AND country_code = $2`, [product.id, rate.countryCode]);

        const current = await tx.one(`SELECT * FROM shipping_rates WHERE product_id = $1 AND country_code = $2 AND is_current FOR UPDATE`, [product.id, rate.countryCode]);
        const same =
          current && rate.amount !== null && current.amount === rate.amount && current.currency_code === currency &&
          current.freight_cost === rate.freightCost && current.customs_cost === rate.customsCost;
        if (same || (!current && rate.amount === null)) continue;
        if (current) await tx.query(`UPDATE shipping_rates SET is_current = false, closed_at = $2 WHERE id = $1`, [current.id, ctx.now]);
        if (rate.amount !== null) {
          await tx.query(
            `INSERT INTO shipping_rates (product_id, country_code, amount, currency_code, freight_cost, customs_cost, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [product.id, rate.countryCode, rate.amount, currency, rate.freightCost, rate.customsCost, ctx.me().id, ctx.now],
          );
        }
        changes.push({
          country: rate.countryCode,
          before: current ? { amount: current.amount, currency: current.currency_code } : null,
          after: rate.amount === null ? null : { amount: rate.amount, currency },
        });
      }
      await audit(tx, ctx, { action: 'shipping_rate.update', entityType: 'product', entityId: product.id, after: { changes, countries: rates.filter((x) => x.enabled).map((x) => x.countryCode) } });
    });
    return { updated: true, changes: changes.length };
  });

  /* -------------------------------- Campagnes -------------------------------- */

  const DEAL_SELECT = `
    SELECT d.*, p.name AS product_name, p.moq AS product_moq, p.base_price_amount AS product_base_amount, p.base_price_currency AS product_base_currency,
           (SELECT count(*)::int FROM orders o WHERE o.deal_id = d.id AND o.payment_status = 'PAID') AS paid_orders,
           (SELECT count(*)::int FROM orders o WHERE o.deal_id = d.id AND o.payment_status IN ('PENDING','FAILED')) AS pending_orders
      FROM group_deals d JOIN products p ON p.id = d.product_id`;

  const dealAdminDto = (d: Row, now: Date) => {
    const state = dealStateOf(d);
    const progress = dealProgress(state, now);
    return {
      id: d.id,
      slug: d.slug,
      title: d.title ?? d.product_name,
      rawTitle: d.title,
      productId: d.product_id,
      productName: d.product_name,
      storedStatus: d.stored_status,
      status: progress.status,
      /** Fin dépassée sans décision : l'administration doit trancher (§51, point 4). */
      needsDecision: d.stored_status === 'PUBLISHED' && now >= d.ends_at,
      basePrice: { amount: d.base_price_amount, currency: d.base_price_currency },
      compareAtAmount: d.compare_at_amount,
      targetQuantity: d.target_quantity,
      minQuantity: d.min_quantity,
      maxPerOrder: d.max_per_order,
      maxQuantity: d.max_quantity,
      paidQuantity: d.paid_quantity,
      heldQuantity: d.held_quantity,
      percent: progress.percent,
      participants: d.participants_count,
      paidOrders: d.paid_orders,
      pendingOrders: d.pending_orders,
      startsAt: d.starts_at,
      endsAt: d.ends_at,
      isFeatured: d.is_featured,
      cancelReason: d.cancel_reason,
      decidedAt: d.decided_at,
      createdAt: d.created_at,
    };
  };

  r.get('/admin/deals', { permission: ['deals.manage', 'catalog.read'], query: z.object({ status: z.enum(['DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELLED', 'NEEDS_DECISION']).optional(), q: z.string().trim().max(80).optional(), page: z.string().optional(), pageSize: z.string().optional() }) }, async (ctx) => {
    const page = pageOf(ctx.query, 30, 100);
    const like = ctx.query.q ? `%${ctx.query.q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const status = ctx.query.status ?? null;
    const rows = await app.db.all(
      `${DEAL_SELECT}
        WHERE ($1::text IS NULL OR ($1 = 'NEEDS_DECISION' AND d.stored_status = 'PUBLISHED' AND d.ends_at <= $3) OR d.stored_status = $1)
          AND ($2::text IS NULL OR p.name ILIKE $2 OR d.title ILIKE $2)
        ORDER BY (d.stored_status = 'PUBLISHED' AND d.ends_at <= $3) DESC, d.created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
      [status, like, ctx.now],
    );
    return { items: rows.map((d) => dealAdminDto(d, ctx.now)) };
  });

  r.get('/admin/deals/:id', { permission: ['deals.manage', 'catalog.read'] }, async (ctx) => {
    const d = await app.db.one(`${DEAL_SELECT} WHERE d.id = $1`, [ctx.params.id]);
    if (!d) throw new DomainError('NOT_FOUND');
    const byCountry = await app.db.all(
      `SELECT o.country_code, c.name, o.currency_code, count(*)::int AS orders, sum(o.total_quantity)::int AS units, sum(o.total_amount)::bigint AS revenue
         FROM orders o JOIN countries c ON c.code = o.country_code WHERE o.deal_id = $1 AND o.payment_status = 'PAID'
        GROUP BY o.country_code, c.name, o.currency_code ORDER BY units DESC`,
      [d.id],
    );
    const ref = await app.reference.get();
    return {
      deal: dealAdminDto(d, ctx.now),
      byCountry: byCountry.map((x) => ({ country: { code: x.country_code, name: x.name }, orders: x.orders, units: x.units, revenue: app.reference.moneySync(ref, x.revenue, x.currency_code) })),
    };
  });

  const writeDeal = async (ctx: Ctx, id: string | null) => {
    const b = ctx.body as z.infer<typeof dealSchema>;
    const startsAt = new Date(b.startsAt);
    const endsAt = new Date(b.endsAt);
    if (endsAt <= startsAt) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'endsAt', message: 'La fin doit suivre le début' }] });
    if (b.basePrice) await assertCurrency(app, b.basePrice.currency);
    return app.db.tx(async (tx) => {
      const product = await tx.one(`SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL`, [b.productId]);
      if (!product) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'productId', message: 'Produit inconnu' }] });
      const base = b.basePrice ?? { amount: product.base_price_amount, currency: product.base_price_currency };
      const minQuantity = b.minQuantity ?? product.moq;
      if (b.maxPerOrder && b.maxPerOrder < minQuantity) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'maxPerOrder', message: 'Doit être supérieur ou égal au minimum' }] });
      if (b.maxQuantity && b.maxQuantity < b.targetQuantity) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'maxQuantity', message: "Doit être supérieur ou égal à l'objectif" }] });

      if (id) {
        const before = await tx.one(`SELECT * FROM group_deals WHERE id = $1 FOR UPDATE`, [id]);
        if (!before) throw new DomainError('NOT_FOUND');
        if (before.stored_status === 'COMPLETED' || before.stored_status === 'CANCELLED') throw new DomainError('CONFLICT', { reason: 'deal_closed' });
        const hasOrders = (await tx.one(`SELECT count(*)::int AS n FROM orders WHERE deal_id = $1`, [id]))!.n > 0;
        // Dès qu'une commande existe, le prix et le produit sont figés : on ne change pas les règles en cours de route.
        if (hasOrders && (before.base_price_amount !== base.amount || before.base_price_currency !== base.currency || before.product_id !== b.productId || before.min_quantity !== minQuantity)) {
          throw new DomainError('CONFLICT', { reason: 'deal_has_orders_price_locked' });
        }
        if (b.maxQuantity && b.maxQuantity < before.paid_quantity + before.held_quantity) throw new DomainError('CONFLICT', { reason: 'max_below_reserved' });
        await tx.query(
          `UPDATE group_deals SET product_id=$2, title=$3, base_price_amount=$4, base_price_currency=$5, compare_at_amount=$6, target_quantity=$7,
                  min_quantity=$8, max_per_order=$9, max_quantity=$10, starts_at=$11, ends_at=$12, is_featured=$13 WHERE id=$1`,
          [id, b.productId, b.title ?? null, base.amount, base.currency, b.compareAtAmount ?? null, b.targetQuantity, minQuantity,
           b.maxPerOrder ?? null, b.maxQuantity ?? null, startsAt, endsAt, b.isFeatured],
        );
        await audit(tx, ctx, { action: 'deal.update', entityType: 'deal', entityId: id, before: { target: before.target_quantity, endsAt: before.ends_at, basePrice: before.base_price_amount }, after: b });
        return id;
      }
      const slug = await uniqueSlug(tx, 'group_deals', slugify(`${b.title || product.name}-${startsAt.toISOString().slice(0, 7)}`));
      const created = await tx.one(
        `INSERT INTO group_deals (product_id, slug, title, base_price_amount, base_price_currency, compare_at_amount, target_quantity,
                                  min_quantity, max_per_order, max_quantity, starts_at, ends_at, is_featured, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [b.productId, slug, b.title ?? null, base.amount, base.currency, b.compareAtAmount ?? null, b.targetQuantity, minQuantity,
         b.maxPerOrder ?? null, b.maxQuantity ?? null, startsAt, endsAt, b.isFeatured, ctx.me().id],
      );
      await audit(tx, ctx, { action: 'deal.create', entityType: 'deal', entityId: created!.id, after: b });
      return created!.id as string;
    });
  };

  r.post('/admin/deals', { permission: 'deals.manage', body: dealSchema }, async (ctx) => Reply.created({ id: await writeDeal(ctx, null) }));
  r.put('/admin/deals/:id', { permission: 'deals.manage', body: dealSchema }, async (ctx) => ({ id: await writeDeal(ctx, ctx.params.id) }));

  /** Publication : la campagne devient visible. Refusée si aucun pays n'a de tarif de livraison. */
  r.post('/admin/deals/:id/publish', { permission: 'deals.manage' }, async (ctx) => {
    await app.db.tx(async (tx) => {
      const d = await tx.one(`SELECT d.*, p.name AS product_name FROM group_deals d JOIN products p ON p.id = d.product_id WHERE d.id = $1 FOR UPDATE OF d`, [ctx.params.id]);
      if (!d) throw new DomainError('NOT_FOUND');
      if (d.stored_status !== 'DRAFT') throw new DomainError('CONFLICT', { reason: 'not_draft' });
      if (d.ends_at <= ctx.now) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'endsAt', message: 'La date de fin est déjà passée' }] });
      const sellable = await tx.one(
        `SELECT count(*)::int AS n FROM product_countries pc JOIN shipping_rates sr
           ON sr.product_id = pc.product_id AND sr.country_code = pc.country_code AND sr.is_current WHERE pc.product_id = $1`,
        [d.product_id],
      );
      if (sellable!.n === 0) throw new DomainError('SHIPPING_RATE_MISSING', { reason: 'no_country_with_rate' });
      await tx.query(`UPDATE group_deals SET stored_status = 'PUBLISHED' WHERE id = $1`, [d.id]);
      await audit(tx, ctx, { action: 'deal.publish', entityType: 'deal', entityId: d.id });
      await broadcast(
        tx, 'DEAL_NEW', { title: d.title ?? d.product_name }, `/deals/${d.slug}`,
        `SELECT u.id AS user_id FROM users u WHERE u.country_code IN (SELECT country_code FROM product_countries WHERE product_id = $4)`,
        [d.product_id],
      );
    });
    return { status: 'PUBLISHED' };
  });

  r.delete('/admin/deals/:id', { permission: 'deals.manage' }, async (ctx) => {
    await app.db.tx(async (tx) => {
      const d = await tx.one(`SELECT stored_status FROM group_deals WHERE id = $1 FOR UPDATE`, [ctx.params.id]);
      if (!d) throw new DomainError('NOT_FOUND');
      if (d.stored_status !== 'DRAFT') throw new DomainError('CONFLICT', { reason: 'only_drafts_can_be_deleted' });
      await tx.query(`DELETE FROM group_deals WHERE id = $1`, [ctx.params.id]);
      await audit(tx, ctx, { action: 'deal.delete', entityType: 'deal', entityId: ctx.params.id });
    });
    return Reply.noContent();
  });

  /**
   * Décision de fin de campagne : prolonger, confirmer malgré tout, ou annuler et
   * rembourser. Aucun automatisme : GROUPIREX décide (§51, point 4).
   */
  r.post('/admin/deals/:id/decide', { permission: 'deals.decide', body: decisionSchema }, async (ctx) => {
    const b = ctx.body as z.infer<typeof decisionSchema>;
    const result = await app.db.tx(async (tx) => {
      const d = await tx.one(`SELECT d.*, p.name AS product_name FROM group_deals d JOIN products p ON p.id = d.product_id WHERE d.id = $1 FOR UPDATE OF d`, [ctx.params.id]);
      if (!d) throw new DomainError('NOT_FOUND');
      const state = dealStateOf(d);
      const outcome = applyDealDecision(
        state,
        b.type === 'EXTEND' ? { type: 'EXTEND', newEndsAt: new Date(b.newEndsAt) } : b.type === 'CANCEL' ? { type: 'CANCEL', reason: b.reason } : { type: 'CONFIRM' },
        ctx.now,
      );
      await tx.query(
        `UPDATE group_deals SET stored_status = $2, ends_at = $3, decided_at = $4, decided_by = $5, cancel_reason = $6,
                ending_notified_at = CASE WHEN $7 THEN NULL ELSE ending_notified_at END WHERE id = $1`,
        [d.id, outcome.storedStatus, outcome.endsAt, ctx.now, ctx.me().id, b.type === 'CANCEL' ? b.reason : null, b.type === 'EXTEND'],
      );
      const title = d.title ?? d.product_name;
      const paid = await tx.all(`SELECT id, user_id, country_code, total_amount, currency_code FROM orders WHERE deal_id = $1 AND payment_status = 'PAID' FOR UPDATE`, [d.id]);

      if (outcome.openShipments) {
        for (const o of paid) await attachToShipment(tx, o.id, d.id, o.country_code, ctx.now);
        await notifyMany(tx, paid.map((o) => o.user_id), { type: 'DEAL_CONFIRMED', params: { title }, link: '/orders' });
      }
      if (b.type === 'CANCEL') {
        // Commandes payées : remboursement à traiter par la finance.
        for (const o of paid) {
          await tx.query(`UPDATE orders SET payment_status = 'REFUND_PENDING', cancel_reason = $2 WHERE id = $1`, [o.id, b.reason]);
          const payment = await tx.one(`SELECT id FROM payments WHERE order_id = $1 AND status = 'SUCCESSFUL'`, [o.id]);
          await tx.query(`INSERT INTO refunds (order_id, payment_id, amount, currency_code, reason, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
            o.id, payment?.id ?? null, o.total_amount, o.currency_code, 'DEAL_CANCELLED', ctx.now,
          ]);
          await notify(tx, { userId: o.user_id, type: 'DEAL_CANCELLED', params: { title, reason: b.reason, refund: true }, link: `/orders/${o.id}` });
        }
        // Commandes impayées : annulées, quantités libérées.
        const pending = await tx.all(`SELECT id, user_id FROM orders WHERE deal_id = $1 AND payment_status IN ('PENDING', 'FAILED') FOR UPDATE`, [d.id]);
        for (const o of pending) {
          await tx.query(`UPDATE orders SET payment_status = 'CANCELLED', holds_quantity = false, cancelled_at = $2, cancel_reason = $3 WHERE id = $1`, [o.id, ctx.now, b.reason]);
          await tx.query(`UPDATE office_payments SET status = 'CANCELLED' WHERE order_id = $1 AND status IN ('PENDING_PAYMENT', 'CONFIRMED')`, [o.id]);
          await notify(tx, { userId: o.user_id, type: 'DEAL_CANCELLED', params: { title, reason: b.reason, refund: false }, link: `/orders/${o.id}` });
        }
        await tx.query(`UPDATE group_deals SET held_quantity = 0 WHERE id = $1`, [d.id]);
      }
      await audit(tx, ctx, {
        action: `deal.decide.${b.type.toLowerCase()}`,
        entityType: 'deal',
        entityId: d.id,
        before: { status: deriveDealStatus(state, ctx.now), endsAt: d.ends_at, paidQuantity: d.paid_quantity, targetQuantity: d.target_quantity },
        after: { storedStatus: outcome.storedStatus, endsAt: outcome.endsAt, refunds: outcome.refundPaidOrders ? paid.length : 0 },
        reason: b.type === 'CANCEL' ? b.reason : null,
      });
      return { storedStatus: outcome.storedStatus, endsAt: outcome.endsAt, paidOrders: paid.length };
    });
    return result;
  });
}
