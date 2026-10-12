/**
 * PRICE ENGINE (§15 à §19, §52).
 *
 *   PRIX GROUPDEALS = PRIX DU PRODUIT + LIVRAISON DU PAYS
 *
 * Règle unique, appliquée partout (liste, fiche, commande, facture) :
 *   1. le prix de base est converti dans la devise du pays ;
 *   2. la livraison du pays est convertie dans la devise du pays ;
 *   3. les deux sont additionnés ;
 *   4. la somme est arrondie VERS LE HAUT au pas d'arrondi de la devise.
 *
 * Une marge de sécurité de change s'applique uniquement aux composants qui
 * changent réellement de devise. Le backend est la seule autorité de calcul.
 */

import { DomainError } from './errors';
import { CurrencyDef, Money, assertMinorAmount, convert, roundUpToStep } from './money';

export interface RateInfo {
  /** Unités de la devise pour 1 unité de la devise de référence, ex. "655.957". */
  rate: string;
  /** Date de validité du taux (ISO 8601). */
  asOf: string;
  source: string;
}

export interface PriceContext {
  /** Devise de référence des taux (USD par défaut). */
  referenceCurrency: string;
  currencies: Record<string, CurrencyDef>;
  rates: Record<string, RateInfo>;
  /** Marge de sécurité de change en points de base. */
  fxBufferBps: number;
  /**
   * Groupes de devises à parité fixe entre elles (ex. XAF et XOF, arrimés à l'euro
   * au même cours). Entre deux devises d'un même groupe, aucune marge de change.
   */
  peggedGroups?: string[][];
  /** Âge maximal accepté pour un taux, en heures. 0 = pas de contrôle. */
  maxRateAgeHours?: number;
  now?: Date;
}

export interface ShippingRateInput {
  countryCode: string;
  /** Livraison facturée par unité de vente, dans sa propre devise. */
  amount: Money;
  /** Coûts internes estimés par unité, dans la devise du tarif (jamais montrés au client). */
  freightCost?: number;
  customsCost?: number;
}

export interface PriceInput {
  /** Prix de base par unité de vente. */
  basePrice: Money;
  /** Coût d'achat fournisseur par unité de vente (interne). */
  supplierCost?: Money;
  /** Tarif de livraison du pays, ou null s'il n'est pas paramétré. */
  shipping: ShippingRateInput | null;
  /** Le produit est-il ouvert à ce pays ? */
  countryEnabled: boolean;
  /** Devise d'affichage : celle du pays de l'utilisateur. */
  targetCurrency: string;
}

/** Détail interne du calcul : enregistré sur la commande, jamais envoyé au client. */
export interface PriceBreakdown {
  countryCode: string;
  currency: string;
  /** Prix final par unité, livraison comprise. C'est le SEUL montant montré au client. */
  unitFinal: number;
  baseSource: Money;
  baseConverted: number;
  shippingSource: Money;
  shippingConverted: number;
  roundingAdjustment: number;
  fxBufferBps: number;
  referenceCurrency: string;
  ratesUsed: Record<string, RateInfo>;
  /** Marge estimée par unité dans la devise du pays, si les coûts internes sont connus. */
  estimatedUnitMargin: number | null;
  computedAt: string;
}

function currencyOf(ctx: PriceContext, code: string): CurrencyDef {
  const c = ctx.currencies[code];
  if (!c) throw new DomainError('FX_RATE_MISSING', { currency: code });
  return c;
}

function rateOf(ctx: PriceContext, code: string, used: Record<string, RateInfo>): string {
  if (code === ctx.referenceCurrency) return '1';
  const info = ctx.rates[code];
  if (!info) throw new DomainError('FX_RATE_MISSING', { currency: code });
  if (ctx.maxRateAgeHours && ctx.maxRateAgeHours > 0) {
    const now = (ctx.now ?? new Date()).getTime();
    const ageHours = (now - new Date(info.asOf).getTime()) / 3_600_000;
    if (ageHours > ctx.maxRateAgeHours) {
      throw new DomainError('FX_RATE_STALE', { currency: code, asOf: info.asOf });
    }
  }
  used[code] = info;
  return info.rate;
}

function toTarget(
  ctx: PriceContext,
  money: Money,
  target: CurrencyDef,
  used: Record<string, RateInfo>,
  withBuffer: boolean,
): number {
  assertMinorAmount(money.amount);
  const from = currencyOf(ctx, money.currency);
  if (from.code === target.code) return money.amount;
  const pegged = (ctx.peggedGroups ?? []).some((g) => g.includes(from.code) && g.includes(target.code));
  return convert({
    amount: money.amount,
    from,
    to: target,
    fromRate: rateOf(ctx, from.code, used),
    toRate: rateOf(ctx, target.code, used),
    bufferBps: withBuffer && !pegged ? ctx.fxBufferBps : 0,
  });
}

/** Calcule le prix final unitaire d'un produit pour un pays. */
export function computeUnitPrice(input: PriceInput, ctx: PriceContext): PriceBreakdown {
  if (!input.countryEnabled) throw new DomainError('COUNTRY_NOT_COVERED');
  if (!input.shipping) throw new DomainError('SHIPPING_RATE_MISSING');

  const target = currencyOf(ctx, input.targetCurrency);
  const used: Record<string, RateInfo> = {};

  const baseConverted = toTarget(ctx, input.basePrice, target, used, true);
  const shippingConverted = toTarget(ctx, input.shipping.amount, target, used, true);
  const subtotal = baseConverted + shippingConverted;
  const unitFinal = roundUpToStep(subtotal, target.roundingStep);

  let estimatedUnitMargin: number | null = null;
  if (input.supplierCost) {
    // Les coûts réels sont convertis au taux nu : la marge de change est un gain, pas un coût.
    const supplier = toTarget(ctx, input.supplierCost, target, used, false);
    const internal = (input.shipping.freightCost ?? 0) + (input.shipping.customsCost ?? 0);
    const logistics = toTarget(
      ctx,
      { amount: internal, currency: input.shipping.amount.currency },
      target,
      used,
      false,
    );
    estimatedUnitMargin = unitFinal - supplier - logistics;
  }

  return {
    countryCode: input.shipping.countryCode,
    currency: target.code,
    unitFinal,
    baseSource: input.basePrice,
    baseConverted,
    shippingSource: input.shipping.amount,
    shippingConverted,
    roundingAdjustment: unitFinal - subtotal,
    fxBufferBps: ctx.fxBufferBps,
    referenceCurrency: ctx.referenceCurrency,
    ratesUsed: used,
    estimatedUnitMargin,
    computedAt: (ctx.now ?? new Date()).toISOString(),
  };
}

/** Ce que le client a le droit de voir : un seul prix, aucune ligne de livraison (§16). */
export interface PublicPrice {
  unitPrice: number;
  currency: string;
}

export function toPublicPrice(b: PriceBreakdown): PublicPrice {
  return { unitPrice: b.unitFinal, currency: b.currency };
}

/** Total d'une ligne : prix final unitaire × quantité, sans aucun autre frais. */
export function lineTotal(unitFinal: number, quantity: number): number {
  assertMinorAmount(unitFinal, 'Prix unitaire');
  if (!Number.isInteger(quantity) || quantity < 1) throw new DomainError('QUANTITY_INVALID');
  const total = unitFinal * quantity;
  if (!Number.isSafeInteger(total)) throw new DomainError('VALIDATION_FAILED', { reason: 'total' });
  return total;
}

/** Convertit un montant sans marge de change (seuils, statistiques, rapprochement). */
export function convertPlain(money: Money, targetCurrency: string, ctx: PriceContext): number {
  const used: Record<string, RateInfo> = {};
  return toTarget(ctx, money, currencyOf(ctx, targetCurrency), used, false);
}
