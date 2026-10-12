/**
 * Référentiels publics : pays, devises, langues, textes d'interface, réglages visibles.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DomainError, LOGISTICS_STEPS } from '@groupdeals/core';
import type { App } from '../app';
import { migrationsDir } from '../db/migrate';
import { Reply } from '../http/server';
import { viewerOf } from '../http/viewer';
import { localized } from '../services/pricing';

/**
 * Charge en base les textes livrés avec l'application (db/i18n/<langue>.json).
 * N'ajoute que les clés manquantes : une traduction corrigée dans le back-office
 * n'est jamais écrasée par une mise à jour.
 */
export async function syncTranslations(app: App): Promise<number> {
  const dir = path.resolve(migrationsDir(), '../i18n');
  if (!fs.existsSync(dir)) return 0;
  let added = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const lang = path.basename(file, '.json');
    const messages = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Record<string, string>;
    const keys = Object.keys(messages);
    if (!keys.length) continue;
    const exists = await app.db.one('SELECT 1 FROM languages WHERE code = $1', [lang]);
    if (!exists) continue;
    const res = await app.db.query(
      `INSERT INTO translations (language_code, key, value)
       SELECT $1, k, v FROM unnest($2::text[], $3::text[]) AS t(k, v)
       ON CONFLICT DO NOTHING`,
      [lang, keys, keys.map((k) => messages[k])],
    );
    added += res.rowCount;
  }
  return added;
}

export function registerReferenceRoutes(app: App): void {
  const r = app.router;
  const cache = { 'Cache-Control': 'public, max-age=60' };

  r.get('/countries', { auth: 'none' }, async (ctx) => {
    const ref = await app.reference.get();
    const lang = (await viewerOf(ctx)).lang;
    return new Reply(
      200,
      {
        countries: Object.values(ref.countries)
          .filter((c) => c.isActive)
          .map((c) => ({
            code: c.code,
            name: localized(c.name, c.i18n as Record<string, Record<string, string>>, lang, 'name'),
            currency: c.currencyCode,
            currencySymbol: ref.currencies[c.currencyCode]?.symbol,
            phonePrefix: c.phonePrefix,
            defaultLanguage: c.defaultLanguage,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, lang)),
        defaultCountry: app.config.defaultCountry,
      },
      cache,
    );
  });

  r.get('/currencies', { auth: 'none' }, async () => {
    const ref = await app.reference.get();
    return new Reply(
      200,
      {
        currencies: Object.values(ref.currencies)
          .filter((c) => c.isActive)
          .map((c) => ({ code: c.code, name: c.name, symbol: c.symbol, decimals: c.decimals })),
      },
      cache,
    );
  });

  r.get('/languages', { auth: 'none' }, async () => {
    const ref = await app.reference.get();
    return new Reply(200, { languages: ref.languages.filter((l) => l.isActive) }, cache);
  });

  /** Textes d'interface d'une langue, complétés par le français pour les clés non traduites. */
  r.get('/i18n/:lang', { auth: 'none' }, async (ctx) => {
    const ref = await app.reference.get();
    const language = ref.languages.find((l) => l.code === ctx.params.lang && l.isActive);
    if (!language) throw new DomainError('NOT_FOUND');
    const rows = await app.db.all(
      `SELECT key, value, language_code FROM translations WHERE language_code IN ('fr', $1) ORDER BY (language_code = $1)`,
      [language.code],
    );
    const messages: Record<string, string> = {};
    for (const row of rows) messages[row.key] = row.value;
    return new Reply(200, { language, messages }, cache);
  });

  /** Réglages utiles au client. Le serveur reste seul juge : ces valeurs servent à l'affichage. */
  r.get('/config', { auth: 'optional' }, async (ctx) => {
    const ref = await app.reference.get();
    const viewer = await viewerOf(ctx);
    const threshold = ref.officeThreshold;
    return {
      country: viewer.countryCode,
      currency: viewer.currencyCode,
      language: viewer.lang,
      officePayment: {
        enabled: ref.officeMethodActive,
        threshold: threshold ? app.reference.moneySync(ref, threshold.amount, threshold.currency, viewer.lang) : null,
      },
      logisticsSteps: LOGISTICS_STEPS.map((s) => ({ step: s.step, code: s.code })),
      // Identité légale de l'éditeur du site (mentions légales, conditions générales).
      company: await app.reference.company(),
      paymentProvider: app.config.payments.provider,
      environment: app.config.env,
    };
  });

  /** Mesure d'audience (§46) : vues de produits, clics, etc. */
  r.post(
    '/analytics/events',
    {
      auth: 'optional',
      rateLimit: { max: 120, windowSec: 60 },
      body: z.object({
        type: z.enum(['product_view', 'deal_view', 'category_view', 'search', 'participate_click', 'checkout_start']),
        entityType: z.enum(['product', 'deal', 'category']).optional(),
        entityId: z.string().uuid().optional(),
        sessionId: z.string().max(64).optional(),
        data: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
      }),
    },
    async (ctx) => {
      const viewer = await viewerOf(ctx);
      await app.db.query(
        `INSERT INTO analytics_events (type, user_id, session_id, country_code, entity_type, entity_id, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ctx.body.type, ctx.user?.id ?? null, ctx.body.sessionId ?? null, viewer.countryCode, ctx.body.entityType ?? null, ctx.body.entityId ?? null, JSON.stringify(ctx.body.data ?? {})],
      );
      return Reply.noContent();
    },
  );
}
