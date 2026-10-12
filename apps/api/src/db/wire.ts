/**
 * Client PostgreSQL intégré (protocole v3), sans dépendance.
 *
 * Couvre ce dont l'API a besoin : authentification (trust, mot de passe, MD5,
 * SCRAM-SHA-256), TLS, requêtes paramétrées (protocole étendu, donc jamais de
 * concaténation SQL), transactions et conversion des types courants.
 *
 * Les valeurs passent TOUJOURS en paramètres liés : l'injection SQL est exclue
 * par construction.
 */

import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

export interface WireOptions {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string };
  connectTimeoutMs?: number;
  statementTimeoutMs?: number;
}

export interface QueryResult<T = Record<string, any>> {
  rows: T[];
  rowCount: number;
  command: string;
}

export class PgError extends Error {
  code = '';
  severity = '';
  detail?: string;
  constraint?: string;
  table?: string;
  column?: string;
  constructor(fields: Record<string, string>) {
    super(fields.M ?? 'Erreur PostgreSQL');
    this.name = 'PgError';
    this.code = fields.C ?? '';
    this.severity = fields.S ?? '';
    this.detail = fields.D;
    this.constraint = fields.n;
    this.table = fields.t;
    this.column = fields.c;
  }
}

interface Msg {
  type: string;
  body: Buffer;
}

/* ------------------------------------------------------------------ */
/* Conversion des types                                                */
/* ------------------------------------------------------------------ */

function parseTimestamp(text: string, hasZone: boolean): Date {
  // "2026-10-04 12:00:00.123+00" -> ISO 8601
  let iso = text.replace(' ', 'T');
  if (hasZone) {
    iso = iso.replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  } else {
    iso += 'Z';
  }
  return new Date(iso);
}

export function parseArray(text: string, map: (v: string) => unknown): unknown[] {
  const out: unknown[] = [];
  if (text === '{}') return out;
  let i = 1;
  while (i < text.length - 1) {
    if (text[i] === '"') {
      let v = '';
      i++;
      while (text[i] !== '"') {
        if (text[i] === '\\') i++;
        v += text[i++];
      }
      i++;
      out.push(map(v));
    } else {
      let j = i;
      while (j < text.length - 1 && text[j] !== ',') j++;
      const raw = text.slice(i, j);
      out.push(raw === 'NULL' ? null : map(raw));
      i = j;
    }
    if (text[i] === ',') i++;
  }
  return out;
}

function parseValue(oid: number, text: string): unknown {
  switch (oid) {
    case 16:
      return text === 't';
    case 20: {
      const n = Number(text);
      if (!Number.isSafeInteger(n)) throw new RangeError(`Entier hors limites sûres : ${text}`);
      return n;
    }
    case 21:
    case 23:
    case 26:
      return parseInt(text, 10);
    case 700:
    case 701:
      return parseFloat(text);
    case 114:
    case 3802:
      return JSON.parse(text);
    case 1114:
      return parseTimestamp(text, false);
    case 1184:
      return parseTimestamp(text, true);
    case 1005:
    case 1007:
    case 1016:
      return parseArray(text, (v) => Number(v));
    case 1009:
    case 1015:
    case 2951:
    case 1014:
      return parseArray(text, (v) => v);
    default:
      // text, varchar, bpchar, uuid, numeric, date, inet… : restitués en chaîne
      return text;
  }
}

function serializeArray(arr: unknown[]): string {
  return (
    '{' +
    arr
      .map((v) => {
        if (v === null || v === undefined) return 'NULL';
        if (Array.isArray(v)) return serializeArray(v);
        return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
      })
      .join(',') +
    '}'
  );
}

export function serializeParam(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new RangeError('Paramètre numérique invalide');
    return String(v);
  }
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return '\\x' + v.toString('hex');
  if (Array.isArray(v)) return serializeArray(v);
  return JSON.stringify(v);
}

/* ------------------------------------------------------------------ */
/* Écriture des messages                                               */
/* ------------------------------------------------------------------ */

function message(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(5);
  head.write(type, 0, 'latin1');
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}
const cstr = (s: string) => Buffer.from(s + '\0', 'utf8');
const int16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const int32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};

/* ------------------------------------------------------------------ */
/* Connexion                                                           */
/* ------------------------------------------------------------------ */

export class Connection {
  private sock!: net.Socket;
  private buf: Buffer = Buffer.alloc(0);
  private inbox: Msg[] = [];
  private waiter: { resolve: (m: Msg) => void; reject: (e: Error) => void } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  failure: Error | null = null;

  static async connect(opts: WireOptions): Promise<Connection> {
    const c = new Connection();
    await c.open(opts);
    return c;
  }

  get broken(): boolean {
    return this.failure !== null;
  }

  private async open(opts: WireOptions): Promise<void> {
    const timeout = opts.connectTimeoutMs ?? 10_000;
    let sock: net.Socket = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect({ host: opts.host, port: opts.port });
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error(`Connexion PostgreSQL : délai dépassé (${opts.host}:${opts.port})`));
      }, timeout);
      s.once('connect', () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    sock.setNoDelay(true);

    if (opts.ssl) {
      const sslOpts = opts.ssl === true ? {} : opts.ssl;
      sock.write(Buffer.concat([int32(8), int32(80877103)]));
      const answer: Buffer = await new Promise((resolve, reject) => {
        sock.once('data', resolve);
        sock.once('error', reject);
      });
      if (answer.toString('latin1', 0, 1) !== 'S') {
        sock.destroy();
        throw new Error('Le serveur PostgreSQL refuse TLS alors que DATABASE_SSL est activé');
      }
      sock = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const t = tls.connect({
          socket: sock,
          servername: net.isIP(opts.host) ? undefined : opts.host,
          rejectUnauthorized: sslOpts.rejectUnauthorized ?? true,
          ca: sslOpts.ca,
        });
        t.once('secureConnect', () => resolve(t));
        t.once('error', reject);
      });
    }

    this.sock = sock;
    sock.on('data', (chunk: Buffer) => this.onData(chunk));
    sock.on('error', (e) => this.fail(e));
    sock.on('close', () => this.fail(new Error('Connexion PostgreSQL fermée')));

    const params =
      `user\0${opts.user}\0database\0${opts.database}\0client_encoding\0UTF8\0` +
      `TimeZone\0UTC\0DateStyle\0ISO\0application_name\0groupdeals-api\0\0`;
    const body = Buffer.concat([int32(196608), Buffer.from(params, 'utf8')]);
    sock.write(Buffer.concat([int32(body.length + 4), body]));

    await this.authenticate(opts);
    if (opts.statementTimeoutMs) {
      await this.exec(`SET statement_timeout = ${Math.floor(opts.statementTimeoutMs)}`);
    }
  }

  private async authenticate(opts: WireOptions): Promise<void> {
    const password = opts.password ?? '';
    let scram: { clientFirstBare: string; nonce: string; serverSignature?: Buffer } | null = null;

    for (;;) {
      const msg = await this.next();
      if (msg.type === 'E') throw new PgError(parseErrorFields(msg.body));
      if (msg.type === 'Z') return;
      if (msg.type !== 'R') continue; // ParameterStatus, BackendKeyData, NoticeResponse

      const code = msg.body.readInt32BE(0);
      if (code === 0) continue;
      if (code === 3) {
        this.sock.write(message('p', cstr(password)));
      } else if (code === 5) {
        const salt = msg.body.subarray(4, 8);
        const inner = crypto.createHash('md5').update(password + opts.user).digest('hex');
        const outer = crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
        this.sock.write(message('p', cstr('md5' + outer)));
      } else if (code === 10) {
        const mechanisms = msg.body.subarray(4).toString('utf8').split('\0').filter(Boolean);
        if (!mechanisms.includes('SCRAM-SHA-256')) {
          throw new Error(`Mécanisme SASL non pris en charge : ${mechanisms.join(', ')}`);
        }
        const nonce = crypto.randomBytes(18).toString('base64');
        const clientFirstBare = `n=*,r=${nonce}`;
        scram = { clientFirstBare, nonce };
        const first = Buffer.from('n,,' + clientFirstBare, 'utf8');
        this.sock.write(message('p', cstr('SCRAM-SHA-256'), int32(first.length), first));
      } else if (code === 11) {
        if (!scram) throw new Error('Séquence SCRAM inattendue');
        const serverFirst = msg.body.subarray(4).toString('utf8');
        const attrs = Object.fromEntries(serverFirst.split(',').map((kv) => [kv[0], kv.slice(2)]));
        if (!attrs.r?.startsWith(scram.nonce)) throw new Error('SCRAM : nonce serveur invalide');
        const salted = crypto.pbkdf2Sync(
          password.normalize('NFKC'),
          Buffer.from(attrs.s, 'base64'),
          parseInt(attrs.i, 10),
          32,
          'sha256',
        );
        const hmac = (key: Buffer, data: string) => crypto.createHmac('sha256', key).update(data).digest();
        const clientKey = hmac(salted, 'Client Key');
        const storedKey = crypto.createHash('sha256').update(clientKey).digest();
        const finalNoProof = `c=biws,r=${attrs.r}`;
        const authMessage = `${scram.clientFirstBare},${serverFirst},${finalNoProof}`;
        const signature = hmac(storedKey, authMessage);
        const proof = Buffer.alloc(clientKey.length);
        for (let i = 0; i < proof.length; i++) proof[i] = clientKey[i] ^ signature[i];
        scram.serverSignature = hmac(hmac(salted, 'Server Key'), authMessage);
        this.sock.write(message('p', Buffer.from(`${finalNoProof},p=${proof.toString('base64')}`, 'utf8')));
      } else if (code === 12) {
        const serverFinal = msg.body.subarray(4).toString('utf8');
        const v = serverFinal.split(',').find((kv) => kv.startsWith('v='))?.slice(2) ?? '';
        const expected = scram?.serverSignature;
        if (!expected || !crypto.timingSafeEqual(Buffer.from(v, 'base64'), expected)) {
          throw new Error('SCRAM : signature du serveur invalide');
        }
      } else {
        throw new Error(`Méthode d'authentification PostgreSQL non prise en charge (${code})`);
      }
    }
  }

  private onData(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) break;
      const msg: Msg = { type: String.fromCharCode(this.buf[0]), body: this.buf.subarray(5, len + 1) };
      this.buf = this.buf.subarray(len + 1);
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w.resolve(msg);
      } else {
        this.inbox.push(msg);
      }
    }
  }

  private fail(e: Error): void {
    if (this.failure) return;
    this.failure = e;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w.reject(e);
    }
  }

  private next(): Promise<Msg> {
    const queued = this.inbox.shift();
    if (queued) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  /** Les requêtes d'une connexion s'exécutent strictement l'une après l'autre. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Requête paramétrée (protocole étendu). */
  query<T = Record<string, any>>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.serial(async () => {
      if (this.failure) throw this.failure;
      const values = params.map(serializeParam);
      const bind: Buffer[] = [cstr(''), cstr(''), int16(0), int16(values.length)];
      for (const v of values) {
        if (v === null) {
          bind.push(int32(-1));
        } else {
          const b = Buffer.from(v, 'utf8');
          bind.push(int32(b.length), b);
        }
      }
      bind.push(int16(0));
      this.sock.write(
        Buffer.concat([
          message('P', cstr(''), cstr(text), int16(0)),
          message('B', ...bind),
          message('D', Buffer.from('P'), cstr('')),
          message('E', cstr(''), int32(0)),
          message('S'),
        ]),
      );
      const results = await this.collect<T>();
      return results[results.length - 1] ?? { rows: [], rowCount: 0, command: '' };
    });
  }

  /** Script SQL sans paramètre (migrations, BEGIN/COMMIT). */
  exec(sql: string): Promise<QueryResult[]> {
    return this.serial(async () => {
      if (this.failure) throw this.failure;
      this.sock.write(message('Q', cstr(sql)));
      return this.collect();
    });
  }

  private async collect<T>(): Promise<QueryResult<T>[]> {
    const results: QueryResult<T>[] = [];
    let fields: { name: string; oid: number }[] = [];
    let rows: T[] = [];
    let error: PgError | null = null;

    for (;;) {
      const { type, body } = await this.next();
      switch (type) {
        case 'T': {
          fields = [];
          rows = [];
          const n = body.readInt16BE(0);
          let off = 2;
          for (let i = 0; i < n; i++) {
            const end = body.indexOf(0, off);
            const name = body.toString('utf8', off, end);
            off = end + 1;
            const oid = body.readInt32BE(off + 6);
            off += 18;
            fields.push({ name, oid });
          }
          break;
        }
        case 'D': {
          const n = body.readInt16BE(0);
          let off = 2;
          const row: Record<string, unknown> = {};
          for (let i = 0; i < n; i++) {
            const len = body.readInt32BE(off);
            off += 4;
            if (len === -1) {
              row[fields[i].name] = null;
            } else {
              row[fields[i].name] = parseValue(fields[i].oid, body.toString('utf8', off, off + len));
              off += len;
            }
          }
          rows.push(row as T);
          break;
        }
        case 'C': {
          const tag = body.toString('utf8', 0, body.length - 1);
          const last = tag.split(' ').pop() ?? '';
          const count = /^\d+$/.test(last) ? parseInt(last, 10) : rows.length;
          results.push({ rows, rowCount: count, command: tag.split(' ')[0] });
          fields = [];
          rows = [];
          break;
        }
        case 'E':
          error = error ?? new PgError(parseErrorFields(body));
          break;
        case 'Z':
          if (error) throw error;
          return results;
        default:
          // ParseComplete, BindComplete, NoData, EmptyQuery, Notice, ParameterStatus…
          break;
      }
    }
  }

  async close(): Promise<void> {
    if (this.failure) return;
    try {
      this.sock.write(message('X'));
    } catch {
      /* déjà fermée */
    }
    this.sock.end();
    this.failure = new Error('Connexion fermée');
  }
}

function parseErrorFields(body: Buffer): Record<string, string> {
  const fields: Record<string, string> = {};
  let off = 0;
  while (off < body.length && body[off] !== 0) {
    const key = String.fromCharCode(body[off]);
    const end = body.indexOf(0, off + 1);
    fields[key] = body.toString('utf8', off + 1, end);
    off = end + 1;
  }
  return fields;
}
