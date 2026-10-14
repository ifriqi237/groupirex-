/**
 * Application du Price Engine aux données de la base.
 *
 * UNE SEULE fonction calcule le prix d'une offre pour un pays (`priceOffer`).
 * La liste, la fiche, le devis, la commande et la facture passent toutes par elle :
 * un produit ne peut donc pas être calculé différemment selon l'écran (§19).
 */

import {
  DealState,
  DomainError,
  ErrorCode,
  PriceBreakdown,
  PriceContext,
  SaleUnit,
  computeUnitPrice,
  dealProgress,
  remainingQuantity,
} from '@groupdeals/core';
import type { App } from '../app';
import type { Db, Row } from '../db/pool';
import type { MoneyDto } from './reference';

/**
 * Condition SQL « la campagne `alias` est ouverte aux clients du pays `param` ».
 * Internationale : tous les pays (la livraison du produit est vérifiée à part, par product_countries).
 * Nationale ou multipays : uniquement les pays listés dans group_deal_countries.
 */
export function dealOpenIn(alias: string, param: string): string {
  return `(${alias}.geographic_scope = 'INTERNATIONAL' OR EXISTS (SELECT 1 FROM group_deal_countries gc WHERE gc.deal_id = ${alias}.id AND gc.country_code = ${param}))`;
}

/** Colonnes nécessaires au calcul et à l'affichage d'une offre pour le pays $1. */
export const OFFER_COLUMNS = `
  d.id AS deal_id, d.slug AS deal_slug, d.title AS deal_title, d.stored_status, d.base_price_amount, d.base_price_currency,
  d.compare_at_amount, d.target_quantity, d.min_quantity, d.max_per_order, d.max_quantity, d.paid_quantity, d.held_quantity,
  d.participants_count, d.starts_at, d.ends_at, d.is_featured, d.cancel_reason, d.geographic_scope, d.goal_scope,
  (SELECT array_agg(gc.country_code::text ORDER BY gc.country_code) FROM group_deal_countries gc WHERE gc.deal_id = d.id) AS country_codes,
  CASE WHEN d.goal_scope = 'PER_COUNTRY' THEN (
    SELECT json_build_object(
             'target', (SELECT gc.target_quantity FROM group_deal_countries gc WHERE gc.deal_id = d.id AND gc.country_code = $1),
             'paid', COALESCE(sum(o.total_quantity) FILTER (WHERE o.payment_status = 'PAID'), 0),
             'held', COALESCE(sum(o.total_quantity) FILTER (WHERE o.holds_quantity), 0),
             'participants', count(DISTINCT o.user_id) FILTER (WHERE o.payment_status = 'PAID'))
      FROM orders o WHERE o.deal_id = d.id AND o.country_code = $1) END AS country_goal,
  p.id AS product_id, p.slug AS product_slug, p.name AS product_name, p.description AS product_description,
  p.features, p.specifications, p.origin_country, p.lead_time_days_min, p.lead_time_days_max,
  p.sale_unit, p.pieces_per_sale_unit, p.supplier_cost_amount, p.supplier_cost_currency, p.i18n AS product_i18n,
  p.is_active AS product_active,
  c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.i18n AS category_i18n,
  sr.id AS shipping_rate_id, sr.amount AS shipping_amount, sr.currency_code AS shipping_currency,
  sr.freight_cost, sr.customs_cost,
  (pc.product_id IS NOT NULL) AS country_enabled,
  (SELECT json_build_object('kind', m.kind, 'url', m.url, 'thumbnailUrl', m.thumbnail_url, 'alt', m.alt)
     FROM product_media m WHERE m.product_id = p.id ORDER BY (m.kind = 'IMAGE') DESC, m.sort_order LIMIT 1) AS cover`;

export const OFFER_FROM = `
  FROM group_deals d
  JOIN products p ON p.id = d.product_id
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN shipping_rates sr ON sr.product_id = p.id AND sr.country_code = $1 AND sr.is_current
  LEFT JOIN product_countries pc ON pc.product_id = p.id AND pc.country_code = $1 AND ${dealOpenIn('d', '$1')}`;

export function dealStateOf(row: Row): DealState {
  return {
    storedStatus: row.stored_status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    targetQuantity: row.target_quantity,
    maxQuantity: row.max_quantity,
    paidQuantity: row.paid_quantity,
    heldQuantity: row.held_quantity,
  };
}

export interface PricedOffer {
  breakdown: PriceBreakdown | null;
  /** Ancien prix barré, livraison comprise, ou null. */
  compareAt: number | null;
  /** Raison pour laquelle le prix n'est pas disponible. */
  unavailable: ErrorCode | null;
}

/**
 * Prix final d'une offre pour un pays.
 * `variantDelta` : écart de prix de la variante, dans la devise du prix de base.
 */
export function priceOffer(ctx: PriceContext, row: Row, countryCode: string, targetCurrency: string, variantDelta = 0): PricedOffer {
  const shipping =
    row.shipping_rate_id === null || row.shipping_rate_id === undefined
      ? null
      : {
          countryCode,
          amount: { amount: row.shipping_amount as number, currency: row.shipping_currency as string },
          freightCost: row.freight_cost as number,
          customsCost: row.customs_cost as number,
        };
  try {
    const breakdown = computeUnitPrice(
      {
        basePrice: { amount: Math.max(0, row.base_price_amount + variantDelta), currency: row.base_price_currency },
        supplierCost:
          row.supplier_cost_amount === null || row.supplier_cost_amount === undefined
            ? undefined
            : { amount: row.supplier_cost_amount, currency: row.supplier_cost_currency },
        shipping,
        countryEnabled: !!row.country_enabled,
        targetCurrency,
      },
      ctx,
    );
    let compareAt: number | null = null;
    if (row.compare_at_amount) {
      const c = computeUnitPrice(
        {
          basePrice: { amount: row.compare_at_amount + variantDelta, currency: row.base_price_currency },
          shipping,
          countryEnabled: true,
          targetCurrency,
        },
        ctx,
      ).unitFinal;
      if (c > breakdown.unitFinal) compareAt = c;
    }
    return { breakdown, compareAt, unavailable: null };
  } catch (e) {
    if (e instanceof DomainError) return { breakdown: null, compareAt: null, unavailable: e.code };
    throw e;
  }
}

/** Texte localisé : la valeur de la langue demandée si elle existe, sinon la valeur par défaut (français). */
export function localized(base: string, i18n: Record<string, Record<string, string>> | null, lang: string, field: string): string {
  return i18n?.[lang]?.[field] || base;
}

export interface Viewer {
  countryCode: string;
  currencyCode: string;
  lang: string;
  userId: string | null;
}

/** Représentation publique d'une offre : UN prix, jamais ses composants (§16). */
export async function offerDto(app: App, row: Row, viewer: Viewer, now: Date) {
  const ref = await app.reference.get();
  const ctx = await app.reference.priceContext(viewer.countryCode);
  const priced = priceOffer(ctx, row, viewer.countryCode, viewer.currencyCode);
  const state = dealStateOf(row);
  const progress = dealProgress(state, now);
  // Objectif par pays : la jauge montre l'avancement du pays du visiteur. Le statut et
  // l'ouverture de la campagne restent ceux de la campagne entière.
  const goal = row.country_goal as { target: number | null; paid: number; held: number; participants: number } | null;
  const local = goal && goal.target
    ? { ordered: Number(goal.paid), target: goal.target, held: Number(goal.held), participants: Number(goal.participants) }
    : null;
  const shown = local ?? { ordered: progress.orderedQuantity, target: progress.targetQuantity, held: state.heldQuantity, participants: row.participants_count as number };
  const shownPercent = shown.target > 0 ? Math.floor((shown.ordered * 100) / shown.target) : 0;
  const money = (amount: number): MoneyDto => app.reference.moneySync(ref, amount, viewer.currencyCode, viewer.lang);
  const price = priced.breakdown ? money(priced.breakdown.unitFinal) : null;
  const compareAtPrice = priced.compareAt ? money(priced.compareAt) : null;

  return {
    id: row.deal_id as string,
    slug: row.deal_slug as string,
    title: (row.deal_title as string | null) ?? localized(row.product_name, row.product_i18n, viewer.lang, 'name'),
    status: progress.status,
    open: progress.open && price !== null,
    isFeatured: row.is_featured as boolean,
    product: {
      id: row.product_id as string,
      slug: row.product_slug as string,
      name: localized(row.product_name, row.product_i18n, viewer.lang, 'name'),
      description: localized(row.product_description, row.product_i18n, viewer.lang, 'description'),
      saleUnit: row.sale_unit as SaleUnit,
      piecesPerSaleUnit: row.pieces_per_sale_unit as number,
      cover: row.cover as { kind: string; url: string; thumbnailUrl: string | null; alt: string } | null,
      category: {
        id: row.category_id as string,
        slug: row.category_slug as string,
        name: localized(row.category_name, row.category_i18n, viewer.lang, 'name'),
      },
    },
    /** Prix GROUPDEALS final, livraison du pays comprise. */
    price,
    compareAtPrice,
    discountPercent: price && compareAtPrice ? Math.round((1 - price.amount / compareAtPrice.amount) * 100) : null,
    availability: priced.unavailable ?? 'AVAILABLE',
    minQuantity: row.min_quantity as number,
    maxPerOrder: row.max_per_order as number | null,
    remainingQuantity: remainingQuantity(state),
    progress: {
      ordered: shown.ordered,
      target: shown.target,
      percent: shownPercent,
      /** Quantités réservées, en attente de paiement (au bureau ou en ligne) : montrées à part, elles ne remplissent pas la jauge. */
      reserved: shown.held,
      reservedPercent: shown.target > 0 ? Math.min(100 - Math.min(100, shownPercent), Math.floor((shown.held * 100) / shown.target)) : 0,
      participants: shown.participants,
      /** « COUNTRY » : objectif propre au pays du visiteur ; « GLOBAL » : objectif commun à tous les pays. */
      scope: local ? 'COUNTRY' : 'GLOBAL',
    },
    startsAt: row.starts_at as Date,
    endsAt: row.ends_at as Date,
    secondsRemaining: progress.secondsRemaining,
    secondsUntilStart: progress.secondsUntilStart,
    serverTime: now,
    country: viewer.countryCode,
    /** Zone de la campagne. `countries` : null pour une campagne internationale. */
    geography: {
      scope: (row.geographic_scope as string) ?? 'INTERNATIONAL',
      countries: row.geographic_scope === 'INTERNATIONAL' ? null : ((row.country_codes as string[] | null) ?? []),
    },
  };
}

/**
 * Vrai si la campagne est réservée à d'autres pays que celui-ci.
 * Une campagne réservée (au Cameroun, par exemple) n'existe pas pour les autres pays.
 */
export function outsideCampaignCountries(row: Row, countryCode: string): boolean {
  if (row.geographic_scope === 'INTERNATIONAL' || row.geographic_scope === undefined) return false;
  const list = (row.country_codes as string[] | null) ?? [];
  return !list.includes(countryCode);
}

/** La campagne accepte-t-elle encore des clients de ce pays ? (pays retiré après une commande, par exemple) */
export async function dealStillOpenIn(db: Db, dealId: string, countryCode: string): Promise<boolean> {
  const row = await db.one(`SELECT 1 AS ok FROM group_deals d WHERE d.id = $1 AND ${dealOpenIn('d', '$2')}`, [dealId, countryCode]);
  return !!row;
}

/** Charge une offre par identifiant ou par slug, pour un pays. */
export async function loadOffer(db: Db, idOrSlug: string, countryCode: string, forUpdate = false): Promise<Row | null> {
  const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  return db.one(
    `SELECT ${OFFER_COLUMNS} ${OFFER_FROM} WHERE ${byId ? 'd.id = $2::uuid' : 'd.slug = $2'} ${forUpdate ? 'FOR UPDATE OF d' : ''}`,
    [countryCode, idOrSlug],
  );
}
