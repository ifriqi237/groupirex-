/**
 * Enregistre les réponses de la vraie API pour la démonstration autonome (demo/fixtures).
 *
 *   1. lancer l'API avec le jeu de démonstration (npm run seed:demo && npm start) ;
 *   2. node scripts/record-demo.mjs        (BASE_URL=http://localhost:4000 par défaut) ;
 *   3. node build-demo.mjs.
 *
 * Trois sources :
 *   - les pages publiques, appelées directement pour chaque pays et chaque langue ;
 *   - les écrans d'un client, d'un administrateur et d'un agent, parcourus dans un vrai
 *     navigateur : chaque lecture faite par le site est consignée ;
 *   - des modèles de commande (en attente, payée, réservée au bureau) créés avec un compte jetable.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
const API = `${BASE}/api/v1`;
const PASSWORD = 'Groupdeals2026!';
const LANGS = ['fr', 'en'];
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../demo/fixtures');
// ONLY=admin,agent ne réenregistre que ces parties (public, paul, admin, agent, modeles).
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const wanted = (part) => !only || only.includes(part);
if (!only) fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(data));

/** Même normalisation que le serveur de démonstration : chemin + paramètres triés, sans « c ». */
function keyOf(pathAndQuery) {
  const [pathname, search = ''] = pathAndQuery.split('?');
  const q = new URLSearchParams(search);
  q.delete('c');
  const sorted = [...q.entries()].sort(([a], [b]) => a.localeCompare(b));
  return pathname + (sorted.length ? '?' + sorted.map(([k, v]) => `${k}=${v}`).join('&') : '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, opts = {}) {
  const { token, country, lang = 'fr', body, headers = {} } = opts;
  await sleep(110); // l'API limite à 600 requêtes par minute et par adresse
  const res = await fetch(API + p, {
    method,
    headers: {
      'X-Requested-With': 'groupdeals',
      'Accept-Language': lang,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : country ? { 'X-Country': country } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* réponse non JSON */
  }
  if (res.status === 429) {
    await sleep(((json?.error?.details?.retryAfterSec ?? 30) + 1) * 1000);
    return call(method, p, opts);
  }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text.slice(0, 200)}`);
  return json;
}

const recordedAt = new Date().toISOString();

/* ------------------------------ Pages publiques ------------------------------ */
const countries = (await call('GET', '/countries')).countries.map((c) => c.code);
for (const lang of wanted('public') ? LANGS : []) {
  const gets = {};
  for (const p of ['/countries', '/languages', '/currencies', '/local-partners/countries', `/i18n/${lang}`]) gets[p] = await call('GET', p, { lang });
  // Pays d'Afrique non desservis : leur page « partenaires » (vide) va dans l'enregistrement commun.
  for (const c of gets['/local-partners/countries'].countries) {
    if (!countries.includes(c.code)) gets[`/local-partners/${c.code}`] = await call('GET', `/local-partners/${c.code}`, { lang });
  }
  write(`common-${lang}`, { gets });

  for (const country of countries) {
    const opt = { country, lang };
    const gets = {};
    for (const p of ['/home', '/categories', '/local-offices', `/local-partners/${country}`, '/matching?sort=popular&pageSize=50', '/matching?sort=recent&pageSize=50']) {
      try {
        gets[keyOf(p)] = await call('GET', p, opt);
      } catch {
        /* route réservée aux membres : enregistrée plus bas avec un compte */
      }
    }
    const lists = {};
    const deals = {};
    for (const status of ['active', 'upcoming', 'ended']) {
      for (const sort of ['featured', 'ending', 'popular', 'recent']) {
        // Une liste vide ou à un seul élément ne change pas avec le tri.
        const first = lists[`${status}|featured`];
        if (first && first.items.length < 2) {
          lists[`${status}|${sort}`] = first;
          continue;
        }
        const res = await call('GET', `/group-deals?status=${status}&sort=${sort}&pageSize=100`, opt);
        for (const d of res.items) deals[d.slug] = d;
        lists[`${status}|${sort}`] = { ...res, items: res.items.map((d) => d.slug) };
      }
    }
    for (const slug of Object.keys(deals)) gets[`/group-deals/${slug}`] = await call('GET', `/group-deals/${slug}`, opt);
    write(`public-${country}-${lang}`, { gets, lists, deals });
  }
  console.log(`pages publiques : ${countries.length} pays en ${lang}`);
}

/* --------------------------- Écrans parcourus au navigateur --------------------------- */
const browser = await chromium.launch();

async function crawl(name, email, lang, starts, { maxPages = 220, follow = () => true, extra = null } = {}) {
  if (!wanted(name)) return;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: lang === 'en' ? 'en-GB' : 'fr-FR' });
  await ctx.addInitScript((l) => localStorage.setItem('gd_lang', l), lang);
  const page = await ctx.newPage();
  const gets = {};
  let session = null;
  let limited = false;
  page.on('response', async (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith('/api/v1/')) return;
    if (res.status() === 429) limited = true;
    const req = res.request();
    const p = url.pathname.slice(7);
    try {
      if (req.method() === 'POST' && p === '/auth/login' && res.ok()) session = await res.json();
      if (req.method() !== 'GET' || !res.ok() || !req.headers().authorization) return;
      const body = await res.json();
      const key = keyOf(p + url.search);
      if (!(key in gets)) gets[key] = body;
    } catch {
      /* PDF, réponse vide ou navigation en cours */
    }
  });
  const settle = () => page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);

  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('.welcome__cta');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await settle();

  const queue = [...starts];
  const seen = new Set(queue);
  let visited = 0;
  while (queue.length && visited < maxPages) {
    const target = queue.shift();
    visited++;
    // Chaque page fait une dizaine de lectures : on reste sous la limite de 600 par minute.
    await sleep(1100);
    limited = false;
    await page.goto(BASE + target);
    await settle();
    if (limited) {
      await sleep(61_000);
      queue.unshift(target);
      visited--;
      continue;
    }
    // Les onglets sont des boutons : on les ouvre tous pour enregistrer leurs lectures.
    const tabs = await page.locator('[role=tab]').count();
    for (let i = 0; i < tabs; i++) {
      await sleep(250);
      await page.locator('[role=tab]').nth(i).click().catch(() => undefined);
      await settle();
      await collect();
    }
    await collect();
    if (extra) await extra(page, settle);
  }
  async function collect() {
    const links = await page.$$eval('a[href^="/"]', (as) => as.map((a) => a.getAttribute('href')));
    for (const href of links) {
      if (!href || href.startsWith('/api/') || href.startsWith('//') || seen.has(href) || !follow(href)) continue;
      seen.add(href);
      queue.push(href);
    }
  }
  await ctx.close();
  // Fiches ouvertes dans une fenêtre (espace bureau) : lues directement avec la session du parcours.
  for (const r of gets['/agent/reservations']?.reservations ?? []) {
    gets[`/agent/reservations/${r.id}`] ??= await call('GET', `/agent/reservations/${r.id}`, { token: session.accessToken, lang });
  }
  delete session.debug;
  write(`${name}-${lang}`, { session, gets });
  console.log(`${name} (${lang}) : ${visited} pages, ${Object.keys(gets).length} lectures`);
}

const customerPages = (h) => !/^\/(admin|agent|login|register|forgot|reset|sandbox|payment)/.test(h);
for (const lang of LANGS) {
  await crawl('paul', 'paul@groupdeals.test', lang, ['/', '/orders', '/profile', '/notifications', '/matching', '/deals'], { follow: (h) => customerPages(h) && /^\/(orders|profile|notifications|matching)/.test(h), maxPages: 60 });
}
await crawl('admin', 'superadmin@groupdeals.test', 'fr', ['/admin', '/admin/languages?lang=en', '/admin/languages?lang=fr', '/admin/payments?tab=refunds', '/admin/currencies?tab=countries', '/admin/audit?tab=outbox'], { follow: (h) => h.startsWith('/admin') });
// Espace bureau : les fiches s'ouvrent dans une fenêtre, on les ouvre une à une.
await crawl('agent', 'agent.douala@groupdeals.test', 'fr', ['/agent'], {
  follow: (h) => h.startsWith('/agent'),
  maxPages: 40,
  extra: async (page, settle) => {
    await page.locator('[role=tab]').first().click().catch(() => undefined);
    await settle();
    const rows = await page.locator('table button.link').count();
    for (let i = 0; i < rows; i++) {
      await sleep(300);
      await page.locator('table button.link').nth(i).click().catch(() => undefined);
      await settle();
      await page.keyboard.press('Escape');
      await page.locator('.modal .iconbtn').first().click({ timeout: 1000 }).catch(() => undefined);
    }
  },
});
await browser.close();

if (!wanted('modeles')) process.exit(0);

/* ------------------------------ Modèles de commande ------------------------------ */
// Un compte jetable passe une commande en ligne (avant et après paiement) et une réservation au bureau.
const email = `modele-${Date.now()}@groupdeals.test`;
const reg = await call('POST', '/auth/register', { body: { firstName: 'Modèle', lastName: 'Démo', countryCode: 'CM', email, whatsapp: '+237600000000', password: PASSWORD, languageCode: 'fr' } });
const token = reg.accessToken;
await call('POST', '/auth/verify-email', { token, body: { token: reg.debug.verifyToken } });
const me = await call('GET', '/me', { token });
const session = { accessToken: 'demo', expiresIn: reg.expiresIn, user: me.user };
const offices = (await call('GET', '/local-offices', { token })).offices;
const deal = (await call('GET', '/group-deals/sandales-en-cuir-tresse-2026-09', { token })).deal;
const variantId = deal.product.variants?.[0]?.id ?? null;
const participate = (quantity, paymentMethod) =>
  call('POST', `/group-deals/${deal.id}/participate`, {
    token,
    headers: { 'Idempotency-Key': `modele-${paymentMethod}-${Date.now()}` },
    body: {
      items: [{ variantId, quantity }],
      paymentMethod,
      officeId: paymentMethod === 'OFFICE' ? offices.find((o) => o.acceptsPayments).id : null,
      pickupOfficeId: paymentMethod === 'OFFICE' ? null : offices.find((o) => o.isPickupPoint).id,
      expectedTotal: deal.price.amount * quantity,
    },
  });

const online = (await participate(deal.minQuantity, 'ONLINE')).order;
const orderPending = await call('GET', `/orders/${online.id}`, { token });
const pay = await call('POST', '/payments', { token, body: { orderId: online.id } });
const txRef = new URL(pay.checkoutUrl, BASE).searchParams.get('tx_ref');
const paid = await call('POST', '/sandbox/pay', { body: { txRef, outcome: 'successful' } });
await call('POST', '/payments/verify', { token, body: { orderId: online.id, transactionId: paid.transactionId } });
const orderPaid = await call('GET', `/orders/${online.id}`, { token });
const reserved = (await participate(Math.ceil(deal.officePayment.threshold.amount / deal.price.amount), 'OFFICE')).order;
const orderOffice = await call('GET', `/orders/${reserved.id}`, { token });
const orders = await call('GET', '/orders?pageSize=50', { token });
write('templates', { recordedAt, session, me, orders, orderPending, orderPaid, orderOffice });

const total = fs.readdirSync(out).reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
console.log(`modèles de commande enregistrés. ${fs.readdirSync(out).length} fichiers, ${(total / 1024).toFixed(0)} ko dans ${out}`);
