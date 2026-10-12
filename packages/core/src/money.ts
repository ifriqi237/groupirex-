/**
 * Montants et devises.
 *
 * Règles :
 *  - un montant est TOUJOURS un entier exprimé dans la plus petite unité de sa devise
 *    (1 500 XAF -> 1500 ; 10,00 USD -> 1000). Jamais de nombre à virgule flottante ;
 *  - un taux de change est une chaîne décimale, convertie en entier à l'échelle 1e8 ;
 *  - toute l'arithmétique passe par BigInt pour rester exacte.
 */

export interface CurrencyDef {
  code: string;
  /** Nombre de décimales de la plus petite unité (XAF = 0, USD = 2). */
  decimals: number;
  /**
   * Pas d'arrondi du prix affiché, en plus petite unité.
   * Ex. XAF = 5 : un prix final est toujours un multiple de 5 FCFA.
   */
  roundingStep: number;
  symbol: string;
}

/** Devises livrées par défaut. La table en base fait foi : ceci sert de jeu initial. */
export const DEFAULT_CURRENCIES: Record<string, CurrencyDef> = {
  XAF: { code: 'XAF', decimals: 0, roundingStep: 5, symbol: 'FCFA' },
  XOF: { code: 'XOF', decimals: 0, roundingStep: 5, symbol: 'FCFA' },
  NGN: { code: 'NGN', decimals: 2, roundingStep: 1000, symbol: '₦' },
  GHS: { code: 'GHS', decimals: 2, roundingStep: 10, symbol: 'GH₵' },
  KES: { code: 'KES', decimals: 2, roundingStep: 100, symbol: 'KSh' },
  TZS: { code: 'TZS', decimals: 2, roundingStep: 10000, symbol: 'TSh' },
  ZAR: { code: 'ZAR', decimals: 2, roundingStep: 10, symbol: 'R' },
  MAD: { code: 'MAD', decimals: 2, roundingStep: 10, symbol: 'DH' },
  DZD: { code: 'DZD', decimals: 2, roundingStep: 1000, symbol: 'DA' },
  EGP: { code: 'EGP', decimals: 2, roundingStep: 10, symbol: 'E£' },
  USD: { code: 'USD', decimals: 2, roundingStep: 1, symbol: '$' },
  CNY: { code: 'CNY', decimals: 2, roundingStep: 1, symbol: '¥' },
  EUR: { code: 'EUR', decimals: 2, roundingStep: 1, symbol: '€' },
  UGX: { code: 'UGX', decimals: 0, roundingStep: 100, symbol: 'USh' },
  RWF: { code: 'RWF', decimals: 0, roundingStep: 10, symbol: 'FRw' },
  ETB: { code: 'ETB', decimals: 2, roundingStep: 100, symbol: 'Br' },
  AOA: { code: 'AOA', decimals: 2, roundingStep: 1000, symbol: 'Kz' },
  MZN: { code: 'MZN', decimals: 2, roundingStep: 100, symbol: 'MT' },
  CDF: { code: 'CDF', decimals: 2, roundingStep: 10000, symbol: 'FC' },
  GNF: { code: 'GNF', decimals: 0, roundingStep: 500, symbol: 'FG' },
  TND: { code: 'TND', decimals: 3, roundingStep: 100, symbol: 'DT' },
};

export interface Money {
  /** Entier, en plus petite unité de la devise. */
  amount: number;
  currency: string;
}

export const RATE_SCALE = 100_000_000n; // 1e8

/** "655.957" -> 65595700000n. Refuse tout ce qui n'est pas un décimal positif. */
export function parseRate(rate: string): bigint {
  if (!/^\d+(\.\d{1,8})?$/.test(rate)) {
    throw new RangeError(`Taux de change invalide : "${rate}"`);
  }
  const [int, frac = ''] = rate.split('.');
  const scaled = BigInt(int) * RATE_SCALE + BigInt(frac.padEnd(8, '0'));
  if (scaled <= 0n) throw new RangeError('Un taux de change doit être strictement positif');
  return scaled;
}

/** Division entière arrondie au plus proche (demi vers le haut), pour des valeurs positives. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Arrondit vers le haut au multiple de `step` supérieur ou égal. */
export function roundUpToStep(amount: number, step: number): number {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError('Montant invalide');
  if (!Number.isInteger(step) || step < 1) throw new RangeError("Pas d'arrondi invalide");
  return Math.ceil(amount / step) * step;
}

export function assertMinorAmount(amount: number, label = 'Montant'): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`${label} invalide : entier positif en plus petite unité attendu`);
  }
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

export interface ConvertArgs {
  amount: number;
  from: CurrencyDef;
  to: CurrencyDef;
  /** Unités de `from` pour 1 unité de la devise de référence. */
  fromRate: string;
  /** Unités de `to` pour 1 unité de la devise de référence. */
  toRate: string;
  /** Marge de sécurité de change, en points de base (200 = 2 %). Ignorée si from = to. */
  bufferBps?: number;
}

/**
 * Convertit un montant d'une devise à une autre en passant par la devise de référence.
 * Même devise : le montant est rendu tel quel, sans marge de change.
 */
export function convert(args: ConvertArgs): number {
  const { amount, from, to, fromRate, toRate, bufferBps = 0 } = args;
  assertMinorAmount(amount);
  if (from.code === to.code) return amount;
  if (!Number.isInteger(bufferBps) || bufferBps < 0 || bufferBps > 5000) {
    throw new RangeError('Marge de change invalide (0 à 5000 points de base)');
  }
  const numerator =
    BigInt(amount) * parseRate(toRate) * pow10(to.decimals) * BigInt(10_000 + bufferBps);
  const denominator = parseRate(fromRate) * pow10(from.decimals) * 10_000n;
  const result = divRoundHalfUp(numerator, denominator);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Montant converti trop grand');
  return Number(result);
}

/** 1150000, XAF -> "1 150 000" ; 1250, USD -> "12,50" (séparateurs selon la langue). */
export function formatAmount(amount: number, currency: CurrencyDef, locale = 'fr'): string {
  const value = amount / 10 ** currency.decimals;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  }).format(value);
}

export function formatMoney(amount: number, currency: CurrencyDef, locale = 'fr'): string {
  return `${formatAmount(amount, currency, locale)} ${currency.symbol}`;
}
