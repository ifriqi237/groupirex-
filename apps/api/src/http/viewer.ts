/**
 * Qui regarde ? Le pays détermine la devise, le prix final et les bureaux (§8).
 *   - utilisateur connecté : le pays de son profil ;
 *   - visiteur : le pays qu'il a choisi (en-tête X-Country), sinon le pays par défaut.
 */

import type { Ctx } from './server';
import type { Viewer } from '../services/pricing';

export async function viewerOf(ctx: Ctx): Promise<Viewer> {
  const ref = await ctx.app.reference.get();
  const wanted = ctx.user?.countryCode ?? (ctx.header('x-country') ?? '').toUpperCase();
  const country =
    (ref.countries[wanted]?.isActive ? ref.countries[wanted] : null) ??
    ref.countries[ctx.app.config.defaultCountry] ??
    Object.values(ref.countries)[0];

  // Les codes de langue font deux ou trois lettres (« fr », « nso ») ; « pt-BR » vaut « pt ».
  const fromHeader = (ctx.header('accept-language') ?? '').split(',')[0].split(';')[0].trim().toLowerCase();
  const candidates = [fromHeader, fromHeader.split('-')[0], ctx.user?.languageCode, country.defaultLanguage, 'fr'];
  const lang = candidates.find((l) => l && ref.languages.some((x) => x.code === l && x.isActive)) ?? 'fr';

  return { countryCode: country.code, currencyCode: country.currencyCode, lang, userId: ctx.user?.id ?? null };
}

export interface Page {
  page: number;
  pageSize: number;
  offset: number;
}

export function pageOf(query: Record<string, unknown>, defaultSize = 20, maxSize = 50): Page {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(String(query.pageSize ?? defaultSize), 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
