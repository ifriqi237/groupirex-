/**
 * Accès à la base : pool de connexions, transactions, petits utilitaires.
 *
 * Deux pilotes au choix (variable DATABASE_DRIVER) :
 *   - "builtin" (défaut) : le client intégré de ./wire.ts, sans dépendance ;
 *   - "pg"               : le paquet npm `pg`, s'il est installé.
 * Les deux renvoient les mêmes types JavaScript.
 */

import { Connection, PgError, QueryResult, WireOptions } from './wire';

export { PgError };
export type Row = Record<string, any>;

/** Ce que le code métier voit : une connexion, ou une transaction en cours. */
export interface Db {
  query<T = Row>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Première ligne, ou null. */
  one<T = Row>(text: string, params?: unknown[]): Promise<T | null>;
  /** Toutes les lignes. */
  all<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Exécute `fn` dans une transaction (imbriquée = point de sauvegarde). */
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

interface RawClient {
  query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

function wrap(client: RawClient, tx: Db['tx']): Db {
  return {
    query: (text, params) => client.query(text, params),
    one: async (text, params) => (await client.query<any>(text, params)).rows[0] ?? null,
    all: async (text, params) => (await client.query<any>(text, params)).rows,
    tx,
  };
}

let savepointSeq = 0;

function transactional(client: RawClient): Db {
  const nested: Db['tx'] = async (fn) => {
    const name = `sp_${++savepointSeq}`;
    await client.query(`SAVEPOINT ${name}`);
    try {
      const out = await fn(db);
      await client.query(`RELEASE SAVEPOINT ${name}`);
      return out;
    } catch (e) {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw e;
    }
  };
  const db = wrap(client, nested);
  return db;
}

export interface PoolOptions extends WireOptions {
  max?: number;
  driver?: 'builtin' | 'pg';
}

export interface Pool extends Db {
  /** Script SQL brut sans paramètre (migrations uniquement). */
  script(sql: string): Promise<void>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Pilote intégré                                                      */
/* ------------------------------------------------------------------ */

class BuiltinPool implements Pool {
  private idle: Connection[] = [];
  private size = 0;
  private waiters: { resolve: (c: Connection) => void; reject: (e: Error) => void }[] = [];
  private closed = false;
  private readonly max: number;

  constructor(private readonly opts: PoolOptions) {
    this.max = opts.max ?? 10;
  }

  private async acquire(): Promise<Connection> {
    if (this.closed) throw new Error('Pool fermé');
    for (;;) {
      const c = this.idle.pop();
      if (!c) break;
      if (!c.broken) return c;
      this.size--;
    }
    if (this.size < this.max) {
      this.size++;
      try {
        return await Connection.connect(this.opts);
      } catch (e) {
        this.size--;
        throw e;
      }
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private release(c: Connection): void {
    if (c.broken) {
      this.size--;
      // Une place s'est libérée : on réveille un demandeur en lui ouvrant une connexion neuve.
      const w = this.waiters.shift();
      if (w) {
        this.size++;
        Connection.connect(this.opts).then(w.resolve, (e) => {
          this.size--;
          w.reject(e);
        });
      }
      return;
    }
    const w = this.waiters.shift();
    if (w) w.resolve(c);
    else if (this.closed) void c.close();
    else this.idle.push(c);
  }

  async query<T = Row>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const c = await this.acquire();
    try {
      return await c.query<T>(text, params);
    } finally {
      this.release(c);
    }
  }

  async one<T = Row>(text: string, params?: unknown[]): Promise<T | null> {
    return (await this.query<T>(text, params)).rows[0] ?? null;
  }

  async all<T = Row>(text: string, params?: unknown[]): Promise<T[]> {
    return (await this.query<T>(text, params)).rows;
  }

  async tx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const c = await this.acquire();
    try {
      await c.exec('BEGIN');
      try {
        const out = await fn(transactional(c));
        await c.exec('COMMIT');
        return out;
      } catch (e) {
        if (!c.broken) await c.exec('ROLLBACK').catch(() => undefined);
        throw e;
      }
    } finally {
      this.release(c);
    }
  }

  async script(sql: string): Promise<void> {
    const c = await this.acquire();
    try {
      await c.exec(sql);
    } finally {
      this.release(c);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.idle.splice(0).map((c) => c.close()));
  }
}

/* ------------------------------------------------------------------ */
/* Pilote `pg` (optionnel)                                             */
/* ------------------------------------------------------------------ */

async function createPgPool(opts: PoolOptions): Promise<Pool> {
  let pg: any;
  try {
    const name = 'pg';
    pg = await import(name);
    pg = pg.default ?? pg;
  } catch {
    throw new Error('DATABASE_DRIVER=pg mais le paquet "pg" n\'est pas installé (npm install pg)');
  }
  // Mêmes conversions que le pilote intégré.
  pg.types.setTypeParser(20, (v: string) => {
    const n = Number(v);
    if (!Number.isSafeInteger(n)) throw new RangeError(`Entier hors limites sûres : ${v}`);
    return n;
  });
  pg.types.setTypeParser(1082, (v: string) => v);
  const pool = new pg.Pool({
    host: opts.host,
    port: opts.port,
    user: opts.user,
    password: opts.password,
    database: opts.database,
    ssl: opts.ssl || undefined,
    max: opts.max ?? 10,
    statement_timeout: opts.statementTimeoutMs,
    options: '-c TimeZone=UTC',
  });
  const norm = <T>(r: any): QueryResult<T> => ({ rows: r.rows, rowCount: r.rowCount ?? 0, command: r.command });
  const tx: Db['tx'] = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const raw: RawClient = { query: async (t, p) => norm(await client.query(t, p)) };
      const out = await fn(transactional(raw));
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  };
  const raw: RawClient = { query: async (t, p) => norm(await pool.query(t, p)) };
  return {
    ...wrap(raw, tx),
    script: async (sql) => {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

export async function createPool(opts: PoolOptions): Promise<Pool> {
  if (opts.driver === 'pg') return createPgPool(opts);
  const pool = new BuiltinPool(opts);
  await pool.query('SELECT 1'); // échoue tout de suite si la base est injoignable
  return pool;
}

/** postgres://user:pass@host:5432/base?sslmode=require */
export function parseDatabaseUrl(url: string): WireOptions {
  const u = new URL(url);
  const sslmode = u.searchParams.get('sslmode');
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    ssl:
      sslmode === 'require' || sslmode === 'no-verify'
        ? { rejectUnauthorized: false }
        : sslmode === 'verify-full' || sslmode === 'verify-ca'
          ? { rejectUnauthorized: true }
          : false,
  };
}

/** Violation d'unicité : renvoie le nom de la contrainte, sinon null. */
export function uniqueViolation(e: unknown): string | null {
  const err = e as { code?: string; constraint?: string };
  return err?.code === '23505' ? (err.constraint ?? 'unique') : null;
}
