/**
 * Serveur de démonstration, dans le navigateur.
 *
 * Il rejoue des réponses enregistrées auprès de la vraie API (scripts/record-demo.mjs)
 * et simule le parcours d'un client : inscription, devis, commande, paiement, réservation
 * au bureau. Les écrans du personnel sont consultables ; leurs actions répondent
 * « non enregistré ». Rien ne quitte le navigateur : aucune donnée n'est envoyée, aucun
 * paiement n'a lieu. Ce fichier ne sert qu'à la démonstration (build-demo.mjs).
 */

import { ERRORS } from '@groupdeals/core';
import { store } from '../lib/env';

type Json = any;
type Gets = Record<string, Json>;
interface PublicFx { gets: Gets; lists: Record<string, Json>; deals: Record<string, Json> }
interface PersonaFx { session: Json; gets: Gets }
interface Templates { session: Json; me: Json; orders: Json; orderPending: Json; orderPaid: Json; orderOffice: Json; password: string; recordedAt: string }

export const DEMO_PASSWORD = 'Groupdeals2026!';
/** Comptes proposés par la barre de démonstration. */
export const DEMO_ACCOUNTS = { paul: 'paul@groupdeals.test', admin: 'superadmin@groupdeals.test', agent: 'agent.douala@groupdeals.test' } as const;
type Persona = 'visitor' | 'new' | keyof typeof DEMO_ACCOUNTS;

/** Marque un texte à traduire (relevé par scripts/i18n.mjs) ; défini ici pour éviter une dépendance circulaire. */
const N_ = (source: string): string => source;
const READONLY = N_('Démonstration : cette action n’est pas enregistrée.');

/* --------------------------------- État local --------------------------------- */

interface LocalOrder {
  id: string;
  number: string;
  owner: string;
  method: 'ONLINE' | 'OFFICE';
  state: 'PENDING' | 'PAID' | 'CANCELLED';
  dealSlug: string;
  lines: { variantId: string | null; variantLabel: string | null; quantity: number; unit: number }[];
  total: number;
  officeId: string | null;
  pickupOfficeId: string | null;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
}
interface State {
  persona: Persona;
  newUser: Json | null;
  orders: LocalOrder[];
  favorites: Record<string, Record<string, boolean>>;
  interests: Record<string, Record<string, boolean>>;
  notifications: { id: string; owner: string; type: string; params: Json; link: string | null; read: boolean; createdAt: string }[];
  readAll: Record<string, boolean>;
  requests: { id: string; owner: string; title: string; description: string; desiredQuantity: number | null; categoryId: string | null; createdAt: string }[];
  seq: number;
}
const fresh = (): State => ({ persona: 'visitor', newUser: null, orders: [], favorites: {}, interests: {}, notifications: [], readAll: {}, requests: [], seq: 9000 });
let st: State = fresh();
try {
  st = { ...fresh(), ...JSON.parse(store.get('gd_demo') ?? '{}') };
} catch {
  /* état illisible : on repart d'un état neuf */
}
const save = () => store.set('gd_demo', JSON.stringify(st));

/** Remet la démonstration à zéro (commandes et compte créés pendant l'essai). */
export function resetDemo(): void {
  st = fresh();
  save();
}
export const demoPersona = (): Persona => st.persona;

/* ------------------------------- Enregistrements ------------------------------- */

const files = new Map<string, Promise<Json>>();
let delta: number | null = null;

/** Décale toutes les dates enregistrées : la démonstration reste « d'aujourd'hui » quel que soit le jour d'ouverture. */
function shiftDates(text: string): string {
  if (delta === null) {
    const m = /"recordedAt":"([^"]+)"/.exec(text);
    delta = m ? Date.now() - Date.parse(m[1]) : 0;
  }
  const d = delta;
  return text.replace(/"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)"/g, (_m, iso) => `"${new Date(Date.parse(iso) + d).toISOString()}"`);
}

function file<T = Json>(name: string): Promise<T> {
  let p = files.get(name);
  if (!p) {
    p = (name === 'templates' ? Promise.resolve() : file('templates')) // fixe le décalage des dates avant toute autre lecture
      .then(() => fetch(`fixtures/${name}.json`))
      .then((r) => {
        if (!r.ok) throw new Error(`fixture ${name}`);
        return r.text();
      })
      // Les fichiers statiques sont servis à côté de la page : leurs adresses deviennent relatives.
      .then((text) => JSON.parse(shiftDates(text).replace(/"\/(demo|welcome|uploads|categories|photos)\//g, '"$1/')));
    files.set(name, p);
  }
  return p as Promise<T>;
}
const templates = () => file<Templates>('templates');
const common = (lang: string) => file<{ gets: Gets }>(`common-${lang}`);
const publicFx = (country: string, lang: string) => file<PublicFx>(`public-${country}-${lang}`).catch(() => file<PublicFx>(`public-CM-${lang}`));
const personaFx = (p: 'paul' | 'admin' | 'agent', lang: string) => file<PersonaFx>(`${p}-${lang}`).catch(() => file<PersonaFx>(`${p}-fr`));

/* ----------------------------------- Outils ----------------------------------- */

class Reply {
  constructor(readonly status: number, readonly body: Json = null) {}
}
const fail = (code: keyof typeof ERRORS, details: Json = null) => {
  const e = ERRORS[code];
  return new Reply(e.http, { error: { code: e.code, message: e.message, action: e.action, details, requestId: 'demo' } });
};
const readonly = () => new Reply(409, { error: { code: 'DEMO_READONLY', message: READONLY, action: 'NONE', details: null, requestId: 'demo' } });
const invalid = (fields: { path: string; message: string }[]) => fail('VALIDATION_FAILED', { fields });

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function normalize(path: string): { pathname: string; query: URLSearchParams; key: string } {
  const [pathname, search = ''] = path.split('?');
  const query = new URLSearchParams(search);
  query.delete('c'); // simple clé de rafraîchissement côté site
  const sorted = [...query.entries()].sort(([a], [b]) => a.localeCompare(b));
  return { pathname, query, key: pathname + (sorted.length ? '?' + sorted.map(([k, v]) => `${k}=${v}`).join('&') : '') };
}

/** Réponse enregistrée : d'abord l'adresse exacte, sinon la première enregistrée pour ce chemin. */
function lookup(gets: Gets, key: string, pathname: string): Json | undefined {
  if (key in gets) return gets[key];
  const alt = Object.keys(gets).find((k) => k === pathname || k.startsWith(pathname + '?'));
  return alt ? gets[alt] : undefined;
}

interface Money { amount: number; currency: string; decimals: number; formatted: string }
/** Reprend l'écriture d'un montant enregistré (séparateurs, symbole) pour un autre montant. */
function money(like: Money, amount: number): Money {
  const m = /^(\D*)(\d.*\d|\d)(\D*)$/.exec(like.formatted); // avant le nombre, le nombre, après (espace compris)
  const english = /\d,\d{3}/.test(like.formatted) || /\.\d{2}\b/.test(like.formatted);
  const digits = new Intl.NumberFormat(english ? 'en-US' : 'fr-FR', { minimumFractionDigits: like.decimals, maximumFractionDigits: like.decimals }).format(amount / 10 ** like.decimals);
  return { ...like, amount, formatted: m ? `${m[1]}${digits}${m[3]}` : digits };
}

/* ---------------------------------- Contexte ---------------------------------- */

interface Ctx {
  method: string;
  pathname: string;
  query: URLSearchParams;
  key: string;
  body: Json;
  lang: string;
  country: string;
  persona: Persona;
  user: Json | null;
  owner: string;
}

async function sessionOf(persona: Persona, lang: string): Promise<Json | null> {
  if (persona === 'visitor') return null;
  if (persona === 'new') return st.newUser ? { accessToken: 'demo.new', expiresIn: 900, user: st.newUser } : null;
  const fx = await personaFx(persona, lang);
  return { ...fx.session, accessToken: `demo.${persona}` };
}

/** Le client connecté dans la démonstration (pour ses documents), ou null s'il s'agit du personnel ou d'un visiteur. */
export async function demoCustomer(lang: string): Promise<Json | null> {
  if (st.persona !== 'paul' && st.persona !== 'new') return null;
  return (await sessionOf(st.persona, lang === 'en' ? 'en' : 'fr'))?.user ?? null;
}

const isCustomer = (c: Ctx) => c.persona === 'paul' || c.persona === 'new';
const favOf = (c: Ctx) => (st.favorites[c.owner] ??= {});

/** Applique à une réponse l'état local du visiteur (favoris, intérêts Matching). */
function personalize(c: Ctx, data: Json): Json {
  if (!c.user) return data;
  const fav = favOf(c);
  const interests = st.interests[c.owner] ?? {};
  const walk = (v: Json): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if ('isFavorite' in v && v.product?.id && v.product.id in fav) v.isFavorite = fav[v.product.id];
    if ('interested' in v && 'interestCount' in v && v.id in interests && v.interested !== interests[v.id]) {
      v.interestCount += interests[v.id] ? 1 : -1;
      v.interested = interests[v.id];
    }
    Object.values(v).forEach(walk);
  };
  const out = clone(data);
  walk(out);
  return out;
}

async function findDeal(c: Ctx, idOrSlug: string): Promise<Json | null> {
  const pub = await publicFx(c.country, c.lang);
  const hit = pub.gets[`/group-deals/${idOrSlug}`] ?? Object.values(pub.gets).find((g: Json) => g?.deal?.id === idOrSlug);
  return hit?.deal ? clone(hit.deal) : null;
}

/* ------------------------------ Devis et commandes ------------------------------ */

async function quote(c: Ctx, deal: Json, items: { variantId?: string | null; quantity: number }[]) {
  const variants: Json[] = deal.product.variants ?? [];
  const lines = items
    .filter((i) => Number.isInteger(i.quantity) && i.quantity > 0)
    .map((i) => {
      const v = variants.find((x) => x.id === i.variantId) ?? null;
      const unit = (v?.price ?? deal.price).amount as number;
      return { variantId: v?.id ?? null, variantLabel: v?.label ?? null, quantity: i.quantity, unitPrice: money(deal.price, unit), lineTotal: money(deal.price, unit * i.quantity) };
    });
  const totalQuantity = lines.reduce((n, l) => n + l.quantity, 0);
  const total = lines.reduce((n, l) => n + l.lineTotal.amount, 0);
  let problem: keyof typeof ERRORS | null = null;
  if (!deal.open) problem = deal.status === 'UPCOMING' ? 'DEAL_NOT_ACTIVE' : 'DEAL_EXPIRED';
  else if (totalQuantity < 1) problem = 'QUANTITY_INVALID';
  else if (variants.length && lines.some((l) => !l.variantId)) problem = 'QUANTITY_INVALID';
  else if (totalQuantity < deal.minQuantity) problem = 'QUANTITY_BELOW_MOQ';
  else if (deal.maxPerOrder && totalQuantity > deal.maxPerOrder) problem = 'QUANTITY_ABOVE_MAX';
  else if (deal.remainingQuantity !== null && totalQuantity > deal.remainingQuantity) problem = 'QUANTITY_NOT_AVAILABLE';
  const threshold: Money | null = deal.officePayment?.threshold ?? null;
  return {
    lines,
    totalQuantity,
    total: money(deal.price, total),
    canOrder: !problem,
    problem: problem ? { code: ERRORS[problem].code, message: ERRORS[problem].message, action: ERRORS[problem].action } : null,
    paymentMethods: { online: true, office: !!deal.officePayment?.enabled && (!threshold || total >= threshold.amount), officeThreshold: threshold },
    emailVerificationRequired: !!c.user && !c.user.emailVerified,
  };
}

/** Construit la fiche complète d'une commande créée pendant la démonstration, sur le modèle d'une vraie. */
async function orderDetail(c: Ctx, o: LocalOrder): Promise<Json> {
  const tpl = await templates();
  const deal = (await findDeal(c, o.dealSlug))!;
  const offices: Json[] = (await publicFx(c.country, c.lang)).gets['/local-offices']?.offices ?? [];
  const office = (id: string | null) => offices.find((x) => x.id === id) ?? null;
  const base = clone(o.state === 'PAID' ? tpl.orderPaid : o.method === 'OFFICE' ? tpl.orderOffice : tpl.orderPending).order;
  const total = money(deal.price, o.total);
  const now = new Date().toISOString();
  const expired = o.state === 'PENDING' && Date.parse(o.expiresAt) < Date.now();
  Object.assign(base, {
    id: o.id,
    number: o.number,
    status: o.state === 'PAID' ? 'PAID' : o.state === 'CANCELLED' ? 'CANCELLED' : expired ? 'EXPIRED' : 'PENDING_PAYMENT',
    paymentStatus: o.state === 'PAID' ? 'PAID' : o.state === 'CANCELLED' ? 'CANCELLED' : expired ? 'EXPIRED' : 'PENDING',
    paymentMethod: o.method,
    total,
    totalQuantity: o.lines.reduce((n, l) => n + l.quantity, 0),
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
    paidAt: o.paidAt,
    deal: { slug: deal.slug, title: deal.title },
    product: { name: deal.product.name, slug: deal.product.slug, cover: deal.product.cover },
    country: c.country,
    serverTime: now,
    canPayOnline: o.state === 'PENDING' && !expired && o.method === 'ONLINE',
    canCancel: o.state === 'PENDING' && !expired,
    items: o.lines.map((l) => ({
      productName: deal.product.name,
      variantLabel: l.variantLabel,
      saleUnit: deal.product.saleUnit,
      piecesPerSaleUnit: deal.product.piecesPerSaleUnit,
      quantity: l.quantity,
      unitPrice: money(deal.price, l.unit),
      lineTotal: money(deal.price, l.unit * l.quantity),
    })),
  });
  const suffix = o.number.split('-').slice(1).join('-');
  base.documents = (base.documents ?? []).map((d: Json) => ({ ...d, number: `${String(d.number).split('-')[0]}-${suffix}`, issuedAt: o.paidAt ?? o.createdAt, url: `/api/v1/orders/${o.id}/documents/${String(d.kind).toLowerCase()}` }));
  if (o.state === 'CANCELLED' || expired) base.documents = [];
  if (base.reservation) {
    if (o.method !== 'OFFICE') base.reservation = null;
    else Object.assign(base.reservation, { number: `RB-${suffix}`, status: o.state === 'PAID' ? 'PAID' : o.state === 'CANCELLED' ? 'CANCELLED' : 'PENDING_PAYMENT', expiresAt: o.expiresAt, paidAt: o.paidAt, amount: total, office: office(o.officeId) ?? base.reservation.office });
  }
  if (base.logistics?.pickup) base.logistics.pickup.office = office(o.pickupOfficeId ?? o.officeId) ?? null;
  return base;
}

const SUMMARY = ['id', 'number', 'status', 'paymentStatus', 'paymentMethod', 'total', 'totalQuantity', 'createdAt', 'expiresAt', 'paidAt', 'logisticsStep', 'deal', 'product'];

function notifyLocal(c: Ctx, type: string, params: Json, link: string | null) {
  st.notifications.unshift({ id: uuid(), owner: c.owner, type, params, link, read: false, createdAt: new Date().toISOString() });
}

/* ----------------------------------- Routes ----------------------------------- */

type Handler = (c: Ctx, ...params: string[]) => Promise<Reply | Json>;
const routes: [method: string, pattern: RegExp, handler: Handler][] = [];
const on = (method: string, pattern: string, handler: Handler) => routes.push([method, new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), handler]);

/* Compte */
on('POST', '/auth/register', async (c) => {
  const b = c.body ?? {};
  const countries: Json[] = (await common(c.lang)).gets['/countries'].countries;
  const country = countries.find((x) => x.code === String(b.countryCode ?? '').toUpperCase());
  const whatsapp = String(b.whatsapp ?? '').replace(/[\s().-]/g, '');
  const fields: { path: string; message: string }[] = [];
  if (!String(b.firstName ?? '').trim()) fields.push({ path: 'firstName', message: 'required' });
  if (!country) fields.push({ path: 'countryCode', message: 'required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email ?? '').trim())) fields.push({ path: 'email', message: 'invalid' });
  if (!/^\+[1-9]\d{7,14}$/.test(whatsapp)) fields.push({ path: 'whatsapp', message: 'invalid' });
  if (!/^(?=.*[A-Za-zÀ-ÿ])(?=.*\d).{8,128}$/.test(String(b.password ?? ''))) fields.push({ path: 'password', message: 'invalid' });
  if (fields.length) return invalid(fields);
  const email = String(b.email).trim().toLowerCase();
  if ((Object.values(DEMO_ACCOUNTS) as string[]).includes(email)) return fail('AUTH_EMAIL_TAKEN');
  const tpl = await templates();
  st.newUser = {
    ...clone(tpl.session.user),
    id: uuid(),
    email,
    firstName: String(b.firstName).trim(),
    lastName: String(b.lastName ?? '').trim(),
    whatsapp,
    country: { code: country!.code, name: country!.name, currency: country!.currency },
    languageCode: c.lang,
    // Aucun email ne part de la démonstration : l'adresse est considérée comme vérifiée, pour que rien ne bloque la commande.
    emailVerified: true,
    createdAt: new Date().toISOString(),
  };
  st.persona = 'new';
  st.notifications = st.notifications.filter((n) => n.owner !== st.newUser.id);
  notifyLocal({ ...c, owner: st.newUser.id }, 'WELCOME', { firstName: st.newUser.firstName }, '/deals');
  return new Reply(201, { accessToken: 'demo.new', expiresIn: 900, user: st.newUser, debug: { verifyToken: 'demo' } });
});

on('POST', '/auth/login', async (c) => {
  const email = String(c.body?.email ?? '').trim().toLowerCase();
  const persona = (Object.keys(DEMO_ACCOUNTS) as (keyof typeof DEMO_ACCOUNTS)[]).find((k) => DEMO_ACCOUNTS[k] === email) ?? (st.newUser?.email === email ? 'new' : null);
  if (!persona || (persona !== 'new' && c.body?.password !== DEMO_PASSWORD)) return fail('AUTH_INVALID_CREDENTIALS');
  st.persona = persona;
  return sessionOf(persona, c.lang);
});
on('POST', '/auth/refresh', async (c) => (await sessionOf(st.persona, c.lang)) ?? fail('AUTH_TOKEN_INVALID'));
on('POST', '/auth/logout', async () => {
  st.persona = 'visitor';
  return new Reply(204);
});
on('POST', '/auth/resend-verification', async () => ({ sent: true, debug: { verifyToken: 'demo' } }));
on('POST', '/auth/verify-email', async () => {
  if (st.newUser) st.newUser.emailVerified = true;
  return { verified: true };
});
on('POST', '/auth/forgot-password', async () => ({ sent: true }));
on('GET', '/me', async (c) => {
  if (!c.user) return fail('AUTH_REQUIRED');
  if (c.persona === 'new') return { ...clone((await templates()).me), user: c.user };
  return undefined; // enregistrement
});

/* Notifications */
on('GET', '/me/notifications', async (c) => {
  if (!c.user) return fail('AUTH_REQUIRED');
  // Plusieurs variantes sont enregistrées (dont une réduite au compteur) : on garde la plus complète.
  const variants: Json[] = c.persona === 'new' || c.persona === 'visitor' ? [] : Object.entries((await personaFx(c.persona, c.lang)).gets).filter(([k]) => k.startsWith('/me/notifications')).map(([, v]) => v);
  const recorded: Json = variants.sort((a, b) => b.items.length - a.items.length)[0] ?? { items: [] };
  const items = [...st.notifications.filter((n) => n.owner === c.owner).map(({ owner: _o, ...n }) => n), ...clone(recorded.items).map((n: Json) => ({ ...n, read: n.read || !!st.readAll[c.owner] }))];
  return { ...recorded, items, unread: items.filter((n) => !n.read).length };
});
on('POST', '/me/notifications/read', async (c) => {
  const ids: string[] | undefined = c.body?.ids;
  for (const n of st.notifications) if (n.owner === c.owner && (!ids || ids.includes(n.id))) n.read = true;
  if (!ids) st.readAll[c.owner] = true;
  return new Reply(204);
});

/* Favoris */
on('GET', '/me/favorites', async (c) => {
  if (!c.user) return fail('AUTH_REQUIRED');
  const pub = await publicFx(c.country, c.lang);
  const fav = favOf(c);
  return { items: personalize(c, Object.values(pub.deals)).filter((d: Json) => d.isFavorite || fav[d.product.id]) };
});
const setFavorite = (value: boolean): Handler => async (c, productId) => {
  if (!c.user) return fail('AUTH_REQUIRED');
  favOf(c)[productId] = value;
  return new Reply(204);
};
on('PUT', '/me/favorites/:id', setFavorite(true));
on('DELETE', '/me/favorites/:id', setFavorite(false));

/* Offres */
on('GET', '/group-deals', async (c) => {
  const pub = await publicFx(c.country, c.lang);
  const status = c.query.get('status') ?? 'active';
  const list = pub.lists[`${status}|${c.query.get('sort') ?? 'featured'}`] ?? pub.lists[`${status}|featured`] ?? { items: [] };
  const q = fold(c.query.get('q') ?? '');
  const category = c.query.get('category');
  const pageSize = Math.min(100, Number(c.query.get('pageSize')) || 12);
  const all = (list.items as string[]).map((slug) => pub.deals[slug]).filter((d) => d && (!category || d.product.category?.slug === category) && (!q || fold(`${d.title} ${d.product.name}`).includes(q)));
  return personalize(c, { ...list, items: all.slice(0, pageSize), page: 1, pageSize, total: all.length });
});
on('GET', '/group-deals/:id', async (c, id) => {
  const deal = await findDeal(c, id);
  return deal ? personalize(c, { deal }) : fail('NOT_FOUND');
});
on('POST', '/group-deals/:id/quote', async (c, id) => {
  const deal = await findDeal(c, id);
  return deal ? quote(c, deal, c.body?.items ?? []) : fail('NOT_FOUND');
});
on('POST', '/group-deals/:id/participate', async (c, id) => {
  if (!c.user) return fail('AUTH_REQUIRED');
  if (!isCustomer(c)) return readonly();
  if (!c.user.emailVerified) return fail('AUTH_EMAIL_NOT_VERIFIED');
  const deal = await findDeal(c, id);
  if (!deal) return fail('NOT_FOUND');
  const q = await quote(c, deal, c.body?.items ?? []);
  if (q.problem) return fail(q.problem.code as keyof typeof ERRORS);
  const method: 'ONLINE' | 'OFFICE' = c.body?.paymentMethod === 'OFFICE' ? 'OFFICE' : 'ONLINE';
  if (method === 'OFFICE' && !q.paymentMethods.office) return fail('OFFICE_PAYMENT_NOT_ELIGIBLE');
  if (method === 'OFFICE' && !c.body?.officeId) return invalid([{ path: 'officeId', message: 'Bureau requis' }]);
  const now = Date.now();
  const o: LocalOrder = {
    id: uuid(),
    number: `GD-${new Date().getFullYear()}-${String(++st.seq).padStart(8, '0')}`,
    owner: c.owner,
    method,
    state: 'PENDING',
    dealSlug: deal.slug,
    lines: q.lines.map((l) => ({ variantId: l.variantId, variantLabel: l.variantLabel, quantity: l.quantity, unit: l.unitPrice.amount })),
    total: q.total.amount,
    officeId: c.body?.officeId ?? null,
    pickupOfficeId: c.body?.pickupOfficeId ?? null,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (method === 'OFFICE' ? 72 : 24) * 3_600_000).toISOString(),
    paidAt: null,
  };
  st.orders.unshift(o);
  notifyLocal(c, 'ORDER_CREATED', { number: o.number }, `/orders/${o.id}`);
  return new Reply(201, { order: await orderDetail(c, o) });
});

/* Commandes */
const mine = (c: Ctx) => st.orders.filter((o) => o.owner === c.owner);
on('GET', '/orders', async (c) => {
  if (!c.user) return fail('AUTH_REQUIRED');
  const recorded: Json = c.persona === 'paul' ? clone(lookup((await personaFx('paul', c.lang)).gets, c.key, c.pathname) ?? { items: [], counts: {} }) : { items: [], page: 1, pageSize: 50, total: 0, counts: {} };
  const status = c.query.get('status');
  const local = (await Promise.all(mine(c).map((o) => orderDetail(c, o)))).map((d) => Object.fromEntries(SUMMARY.map((k) => [k, d[k]])));
  for (const o of local) recorded.counts[o.status as string] = (recorded.counts[o.status as string] ?? 0) + 1;
  const shown = local.filter((o) => !status || o.status === status);
  return { ...recorded, items: [...shown, ...recorded.items], total: (recorded.total ?? recorded.items.length) + shown.length };
});
on('GET', '/orders/:id', async (c, id) => {
  if (!c.user) return fail('AUTH_REQUIRED');
  const o = mine(c).find((x) => x.id === id);
  return o ? { order: await orderDetail(c, o) } : undefined;
});
on('POST', '/orders/:id/cancel', async (c, id) => {
  const o = mine(c).find((x) => x.id === id);
  if (!o) return readonly();
  if (o.state !== 'PENDING') return fail('CONFLICT');
  o.state = 'CANCELLED';
  return { cancelled: true };
});

/* Paiement en ligne simulé : même enchaînement que le prestataire de test de la vraie API. */
on('POST', '/payments', async (c) => {
  const o = mine(c).find((x) => x.id === c.body?.orderId);
  if (!o) return readonly();
  if (o.state !== 'PENDING') return fail('CONFLICT');
  return { checkoutUrl: `/sandbox/pay?tx_ref=${encodeURIComponent(o.number)}` };
});
on('GET', '/sandbox/checkout/:ref', async (c, ref) => {
  const o = st.orders.find((x) => x.number === decodeURIComponent(ref));
  if (!o) return fail('NOT_FOUND');
  const d = await orderDetail(c, o);
  return { txRef: o.number, description: `${o.number} — ${d.deal.title}`, amount: d.total, redirectUrl: `http://demo.local/payment/return?order=${o.id}` };
});
on('POST', '/sandbox/pay', async (c) => {
  const o = st.orders.find((x) => x.number === c.body?.txRef);
  if (!o) return fail('NOT_FOUND');
  const ok = c.body?.outcome === 'successful';
  return { transactionId: ok ? 'demo-ok' : 'demo-ko', redirectUrl: `http://demo.local/payment/return?order=${o.id}&status=${ok ? 'successful' : 'failed'}&tx_ref=${encodeURIComponent(o.number)}&transaction_id=${ok ? 'demo-ok' : 'demo-ko'}` };
});
on('POST', '/payments/verify', async (c) => {
  const o = mine(c).find((x) => x.id === c.body?.orderId);
  if (!o) return fail('NOT_FOUND');
  if (o.state === 'PENDING' && c.body?.transactionId === 'demo-ok') {
    o.state = 'PAID';
    o.paidAt = new Date().toISOString();
    notifyLocal(c, 'PAYMENT_CONFIRMED', { number: o.number }, `/orders/${o.id}`);
  }
  return o.state === 'PAID' ? { outcome: 'PAID', paymentStatus: 'PAID' } : { outcome: 'FAILED', paymentStatus: 'FAILED' };
});

/* Matching */
const setInterest = (value: boolean): Handler => async (c, id) => {
  if (!c.user) return fail('AUTH_REQUIRED');
  (st.interests[c.owner] ??= {})[id] = value;
  return new Reply(value ? 201 : 200, { interested: value });
};
on('POST', '/matching/:id/interest', setInterest(true));
on('DELETE', '/matching/:id/interest', setInterest(false));
on('GET', '/matching/mine', async (c) => {
  if (!c.user) return fail('AUTH_REQUIRED');
  const pub = await publicFx(c.country, c.lang);
  const recorded: Json = c.persona === 'paul' ? (lookup((await personaFx('paul', c.lang)).gets, c.key, c.pathname) ?? { items: [] }) : { items: [] };
  const model: Json = recorded.items[0] ?? Object.values(pub.gets).find((g: Json) => g?.items?.[0]?.interestCount !== undefined)?.items[0] ?? {};
  const categories: Json[] = pub.gets['/categories']?.categories ?? [];
  const local = st.requests
    .filter((r) => r.owner === c.owner)
    .map((r) => ({
      ...clone(model),
      id: r.id,
      title: r.title,
      description: r.description,
      imageUrl: null,
      status: 'PENDING_REVIEW',
      category: categories.find((x) => x.id === r.categoryId) ?? null,
      country: { code: c.country, name: c.user.country.name },
      desiredQuantity: r.desiredQuantity,
      interestCount: 0,
      totalQuantity: r.desiredQuantity ?? 0,
      author: c.user.firstName,
      isMine: true,
      interested: false,
      dealSlug: null,
      rejectionReason: null,
      createdAt: r.createdAt,
    }));
  return { ...recorded, items: [...local, ...recorded.items] };
});
on('POST', '/matching', async (c) => {
  if (!c.user) return fail('AUTH_REQUIRED');
  if (!isCustomer(c)) return readonly();
  const title = String(c.body?.title ?? '').trim();
  if (title.length < 5) return invalid([{ path: 'title', message: 'too_small' }]);
  const r = { id: uuid(), owner: c.owner, title, description: String(c.body?.description ?? '').trim(), desiredQuantity: c.body?.desiredQuantity ?? null, categoryId: c.body?.categoryId ?? null, createdAt: new Date().toISOString() };
  st.requests.unshift(r);
  return new Reply(201, { request: { id: r.id, status: 'PENDING_REVIEW' } });
});

/* Partenaires locaux : un enregistrement par pays desservi, les autres pays d'Afrique dans l'enregistrement commun. */
on('GET', '/local-partners/:country', async (c, country) => {
  if (country === 'countries') return undefined; // liste des pays : enregistrement commun
  const code = country.toUpperCase();
  const shared = (await common(c.lang)).gets;
  const key = `/local-partners/${code}`;
  if (key in shared) return shared[key];
  if (!(shared['/countries']?.countries ?? []).some((x: Json) => x.code === code)) return fail('NOT_FOUND');
  return (await file<PublicFx>(`public-${code}-${c.lang}`)).gets[key] ?? fail('NOT_FOUND');
});

/* Identité de l'éditeur (mentions légales) : à compléter dans les Réglages du vrai back-office. */
on('GET', '/config', async () => ({
  company: { legalName: 'GROUPIREX', legalForm: '', capital: '', address: '', rccm: '', taxId: '', phone: '', email: '', publicationDirector: '', host: '' },
}));

on('POST', '/analytics/events', async () => new Reply(204));

/* ---------------------------------- Aiguillage ---------------------------------- */

/** Pages publiques : toujours servies depuis l'enregistrement du pays, puis personnalisées. */
const PUBLIC = /^\/(home|categories|local-offices|group-deals|products)(\/|$)/;

async function handle(method: string, path: string, body: Json, headers: Record<string, string>): Promise<Reply> {
  const { pathname, query, key } = normalize(path);
  // Données enregistrées en français et en anglais ; toute autre langue affiche les données françaises.
  const lang = (headers['Accept-Language'] ?? 'fr').split('-')[0] === 'en' ? 'en' : 'fr';
  const session = await sessionOf(st.persona, lang);
  const user = session?.user ?? null;
  const c: Ctx = { method, pathname, query, key, body, lang, persona: st.persona, user, owner: user?.id ?? 'visitor', country: user?.country?.code ?? headers['X-Country'] ?? 'CM' };

  for (const [m, pattern, handler] of routes) {
    const hit = m === method ? pattern.exec(pathname) : null;
    if (!hit) continue;
    const out = await handler(c, ...hit.slice(1).map(decodeURIComponent));
    if (out instanceof Reply) return out;
    if (out !== undefined) return new Reply(200, out);
  }
  if (method !== 'GET') return user ? readonly() : fail('AUTH_REQUIRED');

  const shared = (await common(lang)).gets;
  if (key in shared) return new Reply(200, shared[key]);
  if (pathname.startsWith('/i18n/')) {
    // Seuls le français et l'anglais sont traduits. Les autres langues se choisissent quand même :
    // comme sur le serveur, leurs textes arrivent en français, sous le nom de la langue demandée.
    const code = pathname.slice(6);
    if (code === 'fr' || code === 'en') return new Reply(200, (await common(code)).gets[pathname]);
    const french = (await common('fr')).gets;
    const language = (french['/languages']?.languages as Json[] | undefined)?.find((l) => l.code === code);
    return language ? new Reply(200, { language, messages: french['/i18n/fr'].messages }) : fail('NOT_FOUND');
  }

  const fromPersona = async () => (st.persona === 'visitor' || st.persona === 'new' ? undefined : lookup((await personaFx(st.persona, lang)).gets, key, pathname));
  const fromPublic = async () => lookup((await publicFx(c.country, lang)).gets, key, pathname);
  const found = PUBLIC.test(pathname) ? ((await fromPublic()) ?? (await fromPersona())) : ((await fromPersona()) ?? (await fromPublic()));
  if (found !== undefined) return new Reply(200, personalize(c, found));
  // Compte créé pendant l'essai : listes vides plutôt qu'une erreur.
  if (st.persona === 'new' && /^\/(auth\/sessions|me\/)/.test(pathname)) return new Reply(200, { items: [], sessions: [] });
  return user || !/^\/(admin|agent|me|orders)/.test(pathname) ? fail('NOT_FOUND') : fail('AUTH_REQUIRED');
}

/** Remplace fetch() : même contrat qu'une réponse HTTP de l'API. */
export async function demoFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let body: Json = null;
  try {
    body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  } catch {
    /* corps non JSON */
  }
  let reply: Reply;
  try {
    reply = await handle((init.method ?? 'GET').toUpperCase(), path, body, (init.headers ?? {}) as Record<string, string>);
  } catch {
    reply = new Reply(503, { error: { code: 'DEMO_UNAVAILABLE', message: 'Une erreur est survenue. Réessayez plus tard.', action: 'RETRY', details: null } });
  }
  save();
  await new Promise((r) => setTimeout(r, 90)); // laisse voir les états de chargement
  return new Response(reply.status === 204 ? null : JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
}
