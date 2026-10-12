/**
 * Référentiel en mémoire : devises, taux courants, pays, langues, réglages.
 * Rechargé au plus toutes les 15 secondes, et immédiatement après une
 * modification faite dans le back-office.
 */

import {
  CurrencyDef,
  DEFAULT_HOLD_POLICY,
  DomainError,
  HoldPolicy,
  Money,
  PriceContext,
  RateInfo,
  formatMoney,
} from '@groupdeals/core';
import type { App } from '../app';
import type { Db } from '../db/pool';

export interface CountryRow {
  code: string;
  name: string;
  i18n: Record<string, { name?: string }>;
  currencyCode: string;
  phonePrefix: string;
  defaultLanguage: string;
  fxBufferBps: number | null;
  isActive: boolean;
}

export interface LanguageRow {
  code: string;
  name: string;
  nativeName: string;
  isRtl: boolean;
  isActive: boolean;
  /** Nombre de textes traduits ; à zéro, l'interface reste en français. */
  translated: number;
}

interface Snapshot {
  loadedAt: number;
  currencies: Record<string, CurrencyDef & { name: string; isActive: boolean }>;
  rates: Record<string, RateInfo>;
  countries: Record<string, CountryRow>;
  languages: LanguageRow[];
  settings: Record<string, unknown>;
  officeThreshold: Money | null;
  officeMethodActive: boolean;
}

const TTL_MS = 15_000;

export class Reference {
  private snapshot: Snapshot | null = null;
  private loading: Promise<Snapshot> | null = null;

  constructor(private readonly app: App) {}

  invalidate(): void {
    this.snapshot = null;
  }

  async get(db: Db = this.app.db): Promise<Snapshot> {
    const s = this.snapshot;
    if (s && Date.now() - s.loadedAt < TTL_MS) return s;
    if (!this.loading) {
      this.loading = this.load(db).finally(() => {
        this.loading = null;
      });
    }
    this.snapshot = await this.loading;
    return this.snapshot;
  }

  private async load(db: Db): Promise<Snapshot> {
    const now = this.app.clock.now();
    const [currencies, rates, countries, languages, settings, methods] = await Promise.all([
      db.all('SELECT code, name, symbol, decimals, rounding_step, is_active FROM currencies'),
      db.all(
        `SELECT DISTINCT ON (currency_code) currency_code, rate, as_of, source
           FROM exchange_rates WHERE as_of <= $1 ORDER BY currency_code, as_of DESC, created_at DESC`,
        [now],
      ),
      db.all('SELECT * FROM countries'),
      db.all('SELECT l.*, (SELECT count(*)::int FROM translations t WHERE t.language_code = l.code) AS translated FROM languages l ORDER BY l.sort_order'),
      db.all('SELECT key, value FROM settings'),
      db.all('SELECT * FROM payment_methods'),
    ]);
    const office = methods.find((m) => m.code === 'OFFICE');
    return {
      loadedAt: Date.now(),
      currencies: Object.fromEntries(
        currencies.map((c) => [
          c.code,
          { code: c.code, name: c.name, symbol: c.symbol, decimals: c.decimals, roundingStep: c.rounding_step, isActive: c.is_active },
        ]),
      ),
      rates: Object.fromEntries(
        rates.map((r) => [
          r.currency_code,
          // NUMERIC(20,8) -> "600.00000000" ; on retire les zéros inutiles pour la lisibilité des instantanés
          { rate: String(r.rate).replace(/\.?0+$/, '') || '0', asOf: (r.as_of as Date).toISOString(), source: r.source },
        ]),
      ),
      countries: Object.fromEntries(
        countries.map((c) => [
          c.code,
          {
            code: c.code,
            name: c.name,
            i18n: c.i18n ?? {},
            currencyCode: c.currency_code,
            phonePrefix: c.phone_prefix,
            defaultLanguage: c.default_language,
            fxBufferBps: c.fx_buffer_bps,
            isActive: c.is_active,
          },
        ]),
      ),
      languages: languages.map((l) => ({ code: l.code, name: l.name, nativeName: l.native_name, isRtl: l.is_rtl, isActive: l.is_active, translated: l.translated })),
      settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
      officeThreshold:
        office && office.min_total_amount !== null ? { amount: office.min_total_amount, currency: office.min_total_currency } : null,
      officeMethodActive: !!office?.is_active,
    };
  }

  /** Identité légale de l'entreprise (réglages company.*). */
  async company(): Promise<import('./pdf').CompanyIdentity & { publicationDirector: string; host: string }> {
    const s = (await this.get()).settings;
    const v = (k: string) => String(s[`company.${k}`] ?? '').trim();
    return {
      legalName: v('legal_name') || 'GROUPIREX', legalForm: v('legal_form'), capital: v('capital'), address: v('address'), rccm: v('rccm'),
      taxId: v('tax_id'), phone: v('phone'), email: v('email'), publicationDirector: v('publication_director'), host: v('host'),
    };
  }

  async setting<T>(key: string, fallback: T): Promise<T> {
    const s = await this.get();
    return (s.settings[key] as T) ?? fallback;
  }

  /** Pays actif, ou erreur COUNTRY_NOT_COVERED. */
  async country(code: string): Promise<CountryRow> {
    const c = (await this.get()).countries[code];
    if (!c || !c.isActive) throw new DomainError('COUNTRY_NOT_COVERED', { country: code });
    return c;
  }

  async currency(code: string): Promise<CurrencyDef> {
    const c = (await this.get()).currencies[code];
    if (!c) throw new DomainError('FX_RATE_MISSING', { currency: code });
    return c;
  }

  /** Contexte de calcul des prix pour un pays (marge de change propre au pays si définie). */
  async priceContext(countryCode: string | null = null): Promise<PriceContext> {
    const s = await this.get();
    const country = countryCode ? s.countries[countryCode] : null;
    return {
      referenceCurrency: (s.settings['pricing.reference_currency'] as string) ?? 'USD',
      currencies: s.currencies,
      rates: s.rates,
      fxBufferBps: country?.fxBufferBps ?? (s.settings['pricing.fx_buffer_bps'] as number) ?? 0,
      maxRateAgeHours: (s.settings['pricing.max_rate_age_hours'] as number) ?? 0,
      peggedGroups: (s.settings['pricing.pegged_currencies'] as string[][]) ?? [],
      now: this.app.clock.now(),
    };
  }

  async holdPolicy(): Promise<HoldPolicy> {
    const s = await this.get();
    return {
      onlineMinutes: (s.settings['orders.online_hold_minutes'] as number) ?? DEFAULT_HOLD_POLICY.onlineMinutes,
      officeHours: (s.settings['orders.office_hold_hours'] as number) ?? DEFAULT_HOLD_POLICY.officeHours,
    };
  }

  /** Montant prêt à afficher : entier, devise et texte formaté dans la langue demandée. */
  async money(amount: number, currencyCode: string, lang = 'fr'): Promise<MoneyDto> {
    const c = await this.currency(currencyCode);
    return { amount, currency: currencyCode, decimals: c.decimals, formatted: formatMoney(amount, c, numberLocale(await this.get(), lang)) };
  }

  moneySync(s: Snapshot, amount: number, currencyCode: string, lang = 'fr'): MoneyDto {
    const c = s.currencies[currencyCode];
    return { amount, currency: currencyCode, decimals: c?.decimals ?? 0, formatted: c ? formatMoney(amount, c, numberLocale(s, lang)) : `${amount} ${currencyCode}` };
  }
}

/**
 * Langue des nombres. Celle de l'interface quand elle a des traductions et que le moteur la connaît ;
 * sinon le français, puisque les textes s'affichent alors en français eux aussi.
 */
function numberLocale(s: Snapshot, lang: string): string {
  if (lang === 'fr') return 'fr';
  const language = s.languages.find((l) => l.code === lang);
  if (!language?.translated) return 'fr';
  return Intl.NumberFormat.supportedLocalesOf([lang]).length ? lang : 'fr';
}

export interface MoneyDto {
  amount: number;
  currency: string;
  decimals: number;
  formatted: string;
}
