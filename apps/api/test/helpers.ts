/**
 * Outils des tests de bout en bout : chaque fichier de test démarre une vraie API
 * sur une base PostgreSQL neuve, créée pour lui puis supprimée.
 */

import crypto from 'node:crypto';
import { App, createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPool } from '../src/db/pool';
import { hashPassword } from '../src/lib/crypto';
import { SandboxGateway } from '../src/services/gateway';

const PG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? '',
};

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
  raw: Buffer;
}

export interface TestEnv {
  app: App;
  base: string;
  sandbox: SandboxGateway;
  api(method: string, path: string, opts?: { token?: string; body?: unknown; headers?: Record<string, string>; rawBody?: string | Buffer }): Promise<Res>;
  close(): Promise<void>;
}

export const PASSWORD = 'Motdepasse2026';

export async function startEnv(overrides: Record<string, string> = {}): Promise<TestEnv> {
  const database = `gd_test_${crypto.randomBytes(5).toString('hex')}`;
  const admin = await createPool({ ...PG, database: 'postgres', max: 1 });
  await admin.script(`CREATE DATABASE ${database}`);
  await admin.close();

  const auth = PG.password ? `${PG.user}:${encodeURIComponent(PG.password)}` : PG.user;
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '0',
    DATABASE_URL: `postgres://${auth}@${PG.host}:${PG.port}/${database}`,
    PAYMENT_PROVIDER: 'sandbox',
    REQUIRE_STAFF_2FA: 'false',
    // Les tests avancent l'horloge de plusieurs heures : le jeton d'accès doit y survivre.
    ACCESS_TOKEN_TTL_SEC: '864000',
    WEB_DIR: '',
    RUN_JOBS: 'false',
    LOG_LEVEL: 'silent',
    UPLOADS_DIR: `/tmp/${database}-uploads`,
    ...overrides,
  });
  const app = await createApp(config);
  const port = await app.start();
  const base = `http://127.0.0.1:${port}`;
  (config as { publicUrl: string }).publicUrl = base;

  return {
    app,
    base,
    sandbox: app.gateway as SandboxGateway,
    async api(method, path, opts = {}) {
      const headers: Record<string, string> = { 'X-Requested-With': 'groupdeals', ...(opts.headers ?? {}) };
      if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
      let body: string | Buffer | undefined;
      if (opts.rawBody !== undefined) body = opts.rawBody;
      else if (opts.body !== undefined) {
        body = JSON.stringify(opts.body);
        headers['Content-Type'] = 'application/json';
      }
      const res = await fetch(`${base}/api/v1${path}`, { method, headers, body });
      const raw = Buffer.from(await res.arrayBuffer());
      let parsed: any = null;
      if ((res.headers.get('content-type') ?? '').includes('json')) {
        try {
          parsed = JSON.parse(raw.toString('utf8'));
        } catch {
          parsed = null;
        }
      }
      return { status: res.status, body: parsed, headers: res.headers, raw };
    },
    async close() {
      await app.stop();
      const a = await createPool({ ...PG, database: 'postgres', max: 1 });
      await a.script(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await a.close();
    },
  };
}

let counter = 0;

/** Crée un compte directement en base (email déjà vérifié) et ouvre une session. */
export async function createUser(
  env: TestEnv,
  opts: { roles?: string[]; country?: string; officeId?: string; position?: 'MANAGER' | 'AGENT'; verified?: boolean; email?: string } = {},
): Promise<{ id: string; email: string; token: string }> {
  const email = opts.email ?? `user${++counter}-${crypto.randomBytes(3).toString('hex')}@test.local`;
  const hash = await cachedHash();
  const row = await env.app.db.one(
    `INSERT INTO users (email, password_hash, first_name, last_name, country_code, whatsapp, email_verified_at)
     VALUES ($1, $2, 'Test', $3, $4, '+237600000000', $5) RETURNING id`,
    [email, hash, `User${counter}`, opts.country ?? 'CM', opts.verified === false ? null : new Date()],
  );
  for (const role of new Set(['CUSTOMER', ...(opts.roles ?? [])])) {
    await env.app.db.query(`INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)`, [row!.id, role]);
  }
  if (opts.officeId) {
    await env.app.db.query(`INSERT INTO local_office_agents (office_id, user_id, position) VALUES ($1, $2, $3)`, [opts.officeId, row!.id, opts.position ?? 'AGENT']);
  }
  const login = await env.api('POST', '/auth/login', { body: { email, password: PASSWORD } });
  if (login.status !== 200) throw new Error(`Connexion impossible : ${JSON.stringify(login.body)}`);
  return { id: row!.id, email, token: login.body.accessToken };
}

let hashPromise: Promise<string> | null = null;
function cachedHash(): Promise<string> {
  hashPromise ??= hashPassword(PASSWORD);
  return hashPromise;
}

export interface Catalog {
  productId: string;
  dealId: string;
  dealSlug: string;
}

/** Taux de change de test : unités de devise pour 1 USD. */
export async function setRates(env: TestEnv, adminToken: string, rates: Record<string, string> = { XAF: '600', XOF: '600', KES: '130', NGN: '1500' }): Promise<void> {
  const res = await env.api('POST', '/admin/exchange-rates', {
    token: adminToken,
    body: { rates: Object.entries(rates).map(([currency, rate]) => ({ currency, rate, source: 'TEST' })) },
  });
  if (res.status !== 201) throw new Error(`Taux : ${JSON.stringify(res.body)}`);
}

/** Crée, par les routes d'administration, un produit, ses tarifs de livraison et une campagne publiée. */
export async function createCatalog(
  env: TestEnv,
  adminToken: string,
  opts: {
    name?: string;
    base?: { amount: number; currency: string };
    moq?: number;
    shipping?: { countryCode: string; amount: number | null; currency?: string; enabled?: boolean }[];
    target?: number;
    maxQuantity?: number | null;
    maxPerOrder?: number | null;
    startsInMs?: number;
    endsInMs?: number;
    publish?: boolean;
    supplierCost?: { amount: number; currency: string } | null;
  } = {},
): Promise<Catalog> {
  const cats = await env.api('GET', '/admin/categories', { token: adminToken });
  const product = await env.api('POST', '/admin/products', {
    token: adminToken,
    body: {
      categoryId: cats.body.categories[0].id,
      name: opts.name ?? `Sandales ${++counter}`,
      description: 'Produit de test',
      moq: opts.moq ?? 10,
      basePrice: opts.base ?? { amount: 10_000, currency: 'XAF' },
      supplierCost: opts.supplierCost ?? null,
    },
  });
  if (product.status !== 201) throw new Error(`Produit : ${JSON.stringify(product.body)}`);
  const shipping = opts.shipping ?? [
    { countryCode: 'CM', amount: 1_500, currency: 'XAF' },
    { countryCode: 'SN', amount: 2_500, currency: 'XOF' },
  ];
  const rates = await env.api('PUT', `/admin/products/${product.body.id}/shipping-rates`, {
    token: adminToken,
    body: { rates: shipping.map((s) => ({ enabled: true, ...s })) },
  });
  if (rates.status !== 200) throw new Error(`Tarifs : ${JSON.stringify(rates.body)}`);
  const now = env.app.clock.now().getTime();
  const deal = await env.api('POST', '/admin/deals', {
    token: adminToken,
    body: {
      productId: product.body.id,
      targetQuantity: opts.target ?? 100,
      maxQuantity: opts.maxQuantity ?? null,
      maxPerOrder: opts.maxPerOrder ?? null,
      startsAt: new Date(now + (opts.startsInMs ?? -3_600_000)).toISOString(),
      endsAt: new Date(now + (opts.endsInMs ?? 10 * 86_400_000)).toISOString(),
    },
  });
  if (deal.status !== 201) throw new Error(`Campagne : ${JSON.stringify(deal.body)}`);
  if (opts.publish ?? true) {
    const pub = await env.api('POST', `/admin/deals/${deal.body.id}/publish`, { token: adminToken });
    if (pub.status !== 200) throw new Error(`Publication : ${JSON.stringify(pub.body)}`);
  }
  const detail = await env.api('GET', `/admin/deals/${deal.body.id}`, { token: adminToken });
  return { productId: product.body.id, dealId: deal.body.id, dealSlug: detail.body.deal.slug };
}

export async function createOffice(env: TestEnv, adminToken: string, country = 'CM', city = 'Douala'): Promise<string> {
  const res = await env.api('POST', '/admin/offices', {
    token: adminToken,
    body: { countryCode: country, name: `Bureau ${city} ${++counter}`, city, address: 'Rue de test', latitude: 4.05, longitude: 9.7 },
  });
  if (res.status !== 201) throw new Error(`Bureau : ${JSON.stringify(res.body)}`);
  return res.body.id;
}

/** Passe une commande ; renvoie la réponse brute pour que les tests puissent vérifier les refus. */
export function participate(
  env: TestEnv,
  token: string,
  dealId: string,
  quantity: number,
  extra: Record<string, unknown> = {},
  key: string = crypto.randomUUID(),
): Promise<Res> {
  return env.api('POST', `/group-deals/${dealId}/participate`, {
    token,
    headers: { 'Idempotency-Key': key },
    body: { items: [{ quantity }], paymentMethod: 'ONLINE', ...extra },
  });
}

/** Paie une commande par le prestataire simulé (page de paiement factice -> webhook signé). */
export async function payOnline(env: TestEnv, token: string, orderId: string, outcome: 'successful' | 'failed' = 'successful'): Promise<Res> {
  const order = await env.app.db.one(`SELECT tx_ref FROM orders WHERE id = $1`, [orderId]);
  const checkout = await env.api('POST', '/payments', { token, body: { orderId } });
  if (checkout.status !== 200) throw new Error(`Paiement : ${JSON.stringify(checkout.body)}`);
  return env.api('POST', '/sandbox/pay', { body: { txRef: order!.tx_ref, outcome } });
}

/** Cherche récursivement des clés interdites dans une réponse. */
export function findKeys(value: unknown, pattern: RegExp, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findKeys(v, pattern, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [...(pattern.test(k) ? [`${path}.${k}`] : []), ...findKeys(v, pattern, `${path}.${k}`)]);
  }
  return [];
}

/** Cherche récursivement des valeurs interdites dans une réponse ; renvoie leurs chemins. */
export function findValues(value: unknown, predicate: (v: unknown) => boolean, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findValues(v, predicate, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => findValues(v, predicate, `${path}.${k}`));
  return predicate(value) ? [path] : [];
}
