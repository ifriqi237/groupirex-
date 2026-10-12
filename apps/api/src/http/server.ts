/**
 * Serveur HTTP : routeur, validation des entrées, authentification, droits,
 * limitation de débit, en-têtes de sécurité, journalisation, fichiers statiques.
 * Bâti sur node:http, sans framework.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { z } from 'zod';
import { DomainError, ERRORS, ErrorCode, Permission, Role } from '@groupdeals/core';
import type { App } from '../app';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  permissions: Set<Permission>;
  /** Bureaux auxquels l'utilisateur est rattaché (agents et responsables). */
  officeIds: string[];
  countryCode: string;
  languageCode: string;
  emailVerified: boolean;
  /** Double authentification validée pour cette session. */
  mfa: boolean;
  twoFactorEnabled: boolean;
  sessionId: string;
}

export interface Ctx<B = any, Q = any> {
  app: App;
  req: http.IncomingMessage;
  method: string;
  path: string;
  params: Record<string, string>;
  query: Q;
  body: B;
  rawBody: Buffer;
  user: AuthUser | null;
  ip: string;
  userAgent: string;
  requestId: string;
  now: Date;
  cookies: Record<string, string>;
  /** Cookies et en-têtes à ajouter à la réponse. */
  responseHeaders: Record<string, string | string[]>;
  setCookie(name: string, value: string, opts: CookieOptions): void;
  header(name: string): string | undefined;
  /** Utilisateur authentifié ; lève AUTH_REQUIRED sinon. */
  me(): AuthUser;
  can(permission: Permission): boolean;
}

export interface CookieOptions {
  maxAgeSec: number;
  path?: string;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax';
}

/** Réponse non-JSON ou avec un statut particulier. */
export class Reply {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly headers: Record<string, string> = {},
  ) {}
  static created(body: unknown) {
    return new Reply(201, body);
  }
  static noContent() {
    return new Reply(204, null);
  }
  static file(buf: Buffer, contentType: string, filename?: string) {
    return new Reply(200, buf, {
      'Content-Type': contentType,
      ...(filename ? { 'Content-Disposition': `inline; filename="${filename}"` } : {}),
    });
  }
  static html(html: string, status = 200) {
    return new Reply(status, Buffer.from(html, 'utf8'), { 'Content-Type': 'text/html; charset=utf-8' });
  }
  static redirect(location: string) {
    return new Reply(302, null, { Location: location });
  }
}

export interface RouteOptions {
  /** required (défaut) : connecté ; optional : connecté ou non ; none : public. */
  auth?: 'required' | 'optional' | 'none';
  /** Permission exigée (une seule suffit si tableau). Implique auth: required. */
  permission?: Permission | Permission[];
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  rateLimit?: { max: number; windowSec: number };
  /** Corps reçu tel quel (webhooks, envoi de fichiers). */
  raw?: boolean;
  maxBodyBytes?: number;
  /** Route accessible au personnel avant l'activation de la 2FA (mise en place de la 2FA). */
  allowWithoutMfa?: boolean;
  /** Exige l'en-tête X-Requested-With (routes authentifiées par cookie). */
  csrf?: boolean;
}

type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: string;
  regex: RegExp;
  keys: string[];
  opts: RouteOptions;
  handler: Handler;
}

/* ------------------------------------------------------------------ */
/* Limitation de débit (mémoire locale)                                */
/* ------------------------------------------------------------------ */

/**
 * Fenêtre fixe par clé. Suffisant pour une instance ; avec plusieurs instances
 * derrière un répartiteur, placer la même limite au niveau du répartiteur.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private timer: NodeJS.Timeout;

  constructor() {
    this.timer = setInterval(() => this.sweep(), 60_000);
    this.timer.unref();
  }

  /** Renvoie le nombre de secondes à attendre si la limite est dépassée, sinon 0. */
  hit(key: string, max: number, windowSec: number, now = Date.now()): number {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowSec * 1000 });
      return 0;
    }
    entry.count++;
    return entry.count > max ? Math.ceil((entry.resetAt - now) / 1000) : 0;
  }

  reset(): void {
    this.hits.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}

/* ------------------------------------------------------------------ */
/* Routeur                                                             */
/* ------------------------------------------------------------------ */

export class Router {
  readonly routes: Route[] = [];

  add(method: string, pattern: string, opts: RouteOptions, handler: Handler): void {
    const keys: string[] = [];
    const regex = new RegExp(
      '^' +
        pattern.replace(/:([a-zA-Z]+)/g, (_m, k) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '/?$',
    );
    this.routes.push({ method, pattern, regex, keys, opts, handler });
  }

  get = (p: string, o: RouteOptions, h: Handler) => this.add('GET', p, o, h);
  post = (p: string, o: RouteOptions, h: Handler) => this.add('POST', p, o, h);
  put = (p: string, o: RouteOptions, h: Handler) => this.add('PUT', p, o, h);
  patch = (p: string, o: RouteOptions, h: Handler) => this.add('PATCH', p, o, h);
  delete = (p: string, o: RouteOptions, h: Handler) => this.add('DELETE', p, o, h);

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | 'METHOD' | null {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route, params };
    }
    return pathMatched ? 'METHOD' : null;
  }
}

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    req.on('data', (c: Buffer) => {
      if (overflow) return; // le reste est ignoré ; la connexion est fermée après la réponse
      size += c.length;
      if (size > limit) {
        overflow = true;
        chunks.length = 0;
        (req as http.IncomingMessage & { bodyTooLarge?: boolean }).bodyTooLarge = true;
        reject(new DomainError('VALIDATION_FAILED', { reason: 'body_too_large', limit }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function zodDetails(err: z.ZodError): Record<string, unknown> {
  return {
    fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, rule: i.code })),
  };
}

export function errorBody(code: ErrorCode, details?: Record<string, unknown>, requestId?: string) {
  const d = ERRORS[code];
  return { error: { code: d.code, message: d.message, action: d.action, details: details ?? null, requestId } };
}

/* ------------------------------------------------------------------ */
/* Serveur                                                             */
/* ------------------------------------------------------------------ */

const API_PREFIX = '/api/v1';

/**
 * Adresse du visiteur derrière le serveur mandataire de l'hébergeur.
 * Chaque mandataire AJOUTE l'adresse qu'il voit à la fin de X-Forwarded-For : seules les `hops`
 * dernières entrées sont fiables. La première entrée, elle, est écrite par le client et se falsifie
 * (elle permettait de contourner les limites de tentatives de connexion).
 */
export function forwardedIp(xff: string | string[] | undefined, remote: string | undefined, hops = 1): string {
  const list = (Array.isArray(xff) ? xff.join(',') : (xff ?? '')).split(',').map((s) => s.trim()).filter(Boolean);
  const pick = hops > 0 && list.length ? list[Math.max(0, list.length - hops)] : '';
  return (pick || remote || '').replace(/^::ffff:/, '');
}

export function createHttpServer(app: App): http.Server {
  const { config } = app;
  const staticCache = new Map<string, { buf: Buffer; gz: Buffer | null; type: string; etag: string }>();

  const securityHeaders: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), geolocation=(), microphone=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ...(config.publicUrl.startsWith('https://')
      ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
      : {}),
  };
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' https:",
    "font-src 'self'",
    "connect-src 'self'",
    'frame-src https://www.openstreetmap.org',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.flutterwave.com",
    "object-src 'none'",
  ].join('; ');

  function send(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string | string[]> = {},
  ): void {
    let payload: Buffer | null = null;
    const h: Record<string, string | string[]> = { ...securityHeaders, ...headers };
    if (Buffer.isBuffer(body)) {
      payload = body;
    } else if (body !== null && body !== undefined) {
      payload = Buffer.from(JSON.stringify(body), 'utf8');
      h['Content-Type'] = 'application/json; charset=utf-8';
      h['Cache-Control'] = h['Cache-Control'] ?? 'no-store';
    }
    if (payload && payload.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      const type = String(h['Content-Type'] ?? '');
      if (/json|text|javascript|svg/.test(type)) {
        payload = zlib.gzipSync(payload, { level: 6 });
        h['Content-Encoding'] = 'gzip';
        h['Vary'] = 'Accept-Encoding';
      }
    }
    if (payload) h['Content-Length'] = String(payload.length);
    if ((req as http.IncomingMessage & { bodyTooLarge?: boolean }).bodyTooLarge) {
      // On répond, puis on coupe : pas question de lire un envoi démesuré jusqu'au bout.
      h['Connection'] = 'close';
      res.once('finish', () => req.destroy());
    }
    res.writeHead(status, h);
    res.end(req.method === 'HEAD' ? undefined : (payload ?? undefined));
  }

  function clientIp(req: http.IncomingMessage): string {
    return forwardedIp(config.trustProxy ? req.headers['x-forwarded-for'] : undefined, req.socket.remoteAddress, config.proxyHops);
  }

  function corsHeaders(req: http.IncomingMessage): Record<string, string> {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Requested-With, X-Country, Accept-Language',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      };
    }
    return {};
  }

  function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
    // Médias envoyés par l'administration
    if (pathname.startsWith('/media/')) {
      const file = path.join(config.uploadsDir, path.normalize(pathname.slice('/media/'.length)));
      if (!file.startsWith(config.uploadsDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      const stat = fs.statSync(file);
      const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
      const base = { ...securityHeaders, 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Accept-Ranges': 'bytes' };
      if (range) {
        const start = parseInt(range[1], 10);
        const end = range[2] ? Math.min(parseInt(range[2], 10), stat.size - 1) : stat.size - 1;
        if (start > end || start >= stat.size) {
          res.writeHead(416, { ...base, 'Content-Range': `bytes */${stat.size}` });
          res.end();
          return true;
        }
        res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) });
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...base, 'Content-Length': String(stat.size) });
        if (req.method === 'HEAD') res.end();
        else fs.createReadStream(file).pipe(res);
      }
      return true;
    }

    if (!config.webDir) return false;
    let rel = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    let file = path.join(config.webDir, rel);
    let isAsset = true;
    if (!file.startsWith(config.webDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      // Application monopage : toute URL inconnue (hors fichiers) renvoie index.html
      if (path.extname(rel)) return false;
      file = path.join(config.webDir, 'index.html');
      isAsset = false;
      if (!fs.existsSync(file)) return false;
    }
    let entry = staticCache.get(file);
    if (!entry || !config.isProd) {
      const buf = fs.readFileSync(file);
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      entry = {
        buf,
        gz: /json|text|javascript|svg/.test(type) && buf.length > 1024 ? zlib.gzipSync(buf, { level: 9 }) : null,
        type,
        etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url') + '"',
      };
      staticCache.set(file, entry);
    }
    const hashed = /\.[A-Z0-9]{8}\.(js|css)$/i.test(file);
    const headers: Record<string, string> = {
      ...securityHeaders,
      'Content-Type': entry.type,
      ETag: entry.etag,
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : isAsset && !file.endsWith('.html') ? 'public, max-age=3600' : 'no-cache',
    };
    if (file.endsWith('.html')) headers['Content-Security-Policy'] = csp;
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    // Vidéos : lecture par morceaux (Range), sans laquelle Safari refuse de les lire.
    if (entry.type.startsWith('video/')) {
      headers['Accept-Ranges'] = 'bytes';
      const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
      if (range) {
        const size = entry.buf.length;
        const start = parseInt(range[1], 10);
        const end = range[2] ? Math.min(parseInt(range[2], 10), size - 1) : size - 1;
        if (start > end || start >= size) {
          res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
          res.end();
          return true;
        }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) });
        res.end(req.method === 'HEAD' ? undefined : entry.buf.subarray(start, end + 1));
        return true;
      }
    }
    const useGz = entry.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    const out = useGz ? (entry.gz as Buffer) : entry.buf;
    if (useGz) {
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
    }
    headers['Content-Length'] = String(out.length);
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : out);
    return true;
  }

  async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');
    const pathname = url.pathname.slice(API_PREFIX.length) || '/';
    const ip = clientIp(req);
    const cors = corsHeaders(req);
    let status = 500;
    let userId: string | null = null;
    let errorCode: string | null = null;

    const fail = (code: ErrorCode, details?: Record<string, unknown>, extra: Record<string, string> = {}) => {
      status = ERRORS[code].http;
      errorCode = code;
      send(req, res, status, errorBody(code, details, requestId), { ...cors, ...extra, 'X-Request-Id': requestId });
    };

    try {
      if (req.method === 'OPTIONS') {
        status = 204;
        send(req, res, 204, null, cors);
        return;
      }

      // Limite générale par adresse IP
      const wait = app.rateLimiter.hit(`ip:${ip}`, 600, 60);
      if (wait) return fail('RATE_LIMITED', { retryAfterSec: wait }, { 'Retry-After': String(wait) });

      const matched = app.router.match(method, pathname);
      if (matched === null) return fail('NOT_FOUND');
      if (matched === 'METHOD') {
        status = 405;
        errorCode = 'METHOD_NOT_ALLOWED';
        send(req, res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Méthode non autorisée.', action: 'NONE', details: null, requestId } }, cors);
        return;
      }
      const { route, params } = matched;
      const opts = route.opts;

      if (opts.rateLimit) {
        const w = app.rateLimiter.hit(`${route.method}:${route.pattern}:${ip}`, opts.rateLimit.max, opts.rateLimit.windowSec);
        if (w) return fail('RATE_LIMITED', { retryAfterSec: w }, { 'Retry-After': String(w) });
      }

      if (opts.csrf) {
        const origin = req.headers.origin;
        const allowed = [config.publicUrl, ...config.corsOrigins];
        if (req.headers['x-requested-with'] !== 'groupdeals' || (origin && !allowed.includes(origin) && config.isProd)) {
          return fail('FORBIDDEN', { reason: 'csrf' });
        }
      }

      // Authentification
      const authMode = opts.permission ? 'required' : (opts.auth ?? 'required');
      let user: AuthUser | null = null;
      const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
      if (bearer && authMode !== 'none') {
        user = await app.auth.resolveAccessToken(bearer);
        if (!user && authMode === 'required') return fail('AUTH_TOKEN_INVALID');
      }
      if (authMode === 'required' && !user) return fail('AUTH_REQUIRED');
      userId = user?.id ?? null;

      if (opts.permission && user) {
        const wanted = Array.isArray(opts.permission) ? opts.permission : [opts.permission];
        if (!wanted.some((p) => user!.permissions.has(p))) return fail('FORBIDDEN');
        if (config.requireStaff2fa && !user.mfa && !opts.allowWithoutMfa) {
          return fail('AUTH_2FA_REQUIRED', { setupRequired: !user.twoFactorEnabled });
        }
      }

      // Corps et paramètres
      const rawBody =
        method === 'GET' || method === 'DELETE'
          ? Buffer.alloc(0)
          : await readBody(req, opts.maxBodyBytes ?? (opts.raw ? 2 * 1024 * 1024 : 256 * 1024));
      let body: unknown = undefined;
      if (!opts.raw && rawBody.length) {
        const type = String(req.headers['content-type'] ?? '');
        if (!type.includes('application/json')) return fail('VALIDATION_FAILED', { reason: 'content_type' });
        try {
          body = JSON.parse(rawBody.toString('utf8'));
        } catch {
          return fail('VALIDATION_FAILED', { reason: 'invalid_json' });
        }
      }
      if (opts.body) {
        const parsed = opts.body.safeParse(body ?? {});
        if (!parsed.success) return fail('VALIDATION_FAILED', zodDetails(parsed.error));
        body = parsed.data;
      }
      let query: unknown = Object.fromEntries(url.searchParams);
      if (opts.query) {
        const parsed = opts.query.safeParse(query);
        if (!parsed.success) return fail('VALIDATION_FAILED', zodDetails(parsed.error));
        query = parsed.data;
      }

      const responseHeaders: Record<string, string | string[]> = {};
      const ctx: Ctx = {
        app,
        req,
        method,
        path: pathname,
        params,
        query,
        body,
        rawBody,
        user,
        ip,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        requestId,
        now: app.clock.now(),
        cookies: parseCookies(req.headers.cookie),
        responseHeaders,
        setCookie(name, value, o) {
          const parts = [
            `${name}=${encodeURIComponent(value)}`,
            `Path=${o.path ?? '/'}`,
            `Max-Age=${o.maxAgeSec}`,
            `SameSite=${o.sameSite ?? 'Strict'}`,
          ];
          if (o.httpOnly ?? true) parts.push('HttpOnly');
          if (config.publicUrl.startsWith('https://')) parts.push('Secure');
          const prev = responseHeaders['Set-Cookie'];
          responseHeaders['Set-Cookie'] = [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join('; ')];
        },
        header: (name) => {
          const v = req.headers[name.toLowerCase()];
          return Array.isArray(v) ? v[0] : v;
        },
        me() {
          if (!user) throw new DomainError('AUTH_REQUIRED');
          return user;
        },
        can: (p) => !!user?.permissions.has(p),
      };

      const result = await route.handler(ctx);
      const common = { ...cors, ...responseHeaders, 'X-Request-Id': requestId };
      if (result instanceof Reply) {
        status = result.status;
        send(req, res, result.status, result.body, { ...common, ...result.headers });
      } else {
        status = 200;
        send(req, res, 200, result ?? {}, common);
      }
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e instanceof DomainError) {
        fail(e.code, e.details);
      } else if (e instanceof z.ZodError) {
        fail('VALIDATION_FAILED', zodDetails(e));
      } else if ((e as { code?: string }).code === '22P02') {
        // Identifiant mal formé (UUID invalide) : traité comme « introuvable »
        fail('NOT_FOUND');
      } else {
        status = 500;
        errorCode = 'INTERNAL';
        app.log.error('unhandled', { requestId, method, path: pathname, error: String((e as Error)?.stack ?? e) });
        send(req, res, 500, {
          error: { code: 'INTERNAL', message: 'Une erreur est survenue. Réessayez plus tard.', action: 'RETRY', details: null, requestId },
        }, cors);
      }
    } finally {
      app.log.request({ requestId, method, path: pathname, status, ms: Date.now() - started, userId, ip, errorCode });
    }
  }

  return http.createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (url.pathname === API_PREFIX || url.pathname.startsWith(API_PREFIX + '/')) {
      void handleApi(req, res, url);
      return;
    }
    if (url.pathname === '/healthz') {
      app.db
        .one('SELECT 1 AS ok')
        .then(() => send(req, res, 200, { status: 'ok' }))
        .catch(() => send(req, res, 503, { status: 'database_unreachable' }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(req, res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } });
      return;
    }
    // Référencement : robots.txt et plan du site, construits avec l'adresse publique (PUBLIC_URL).
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      res.end(['User-agent: *', 'Disallow: /admin', 'Disallow: /agent', 'Disallow: /api', 'Disallow: /checkout', 'Disallow: /orders', '', `Sitemap: ${config.publicUrl}/sitemap.xml`, ''].join('\n'));
      return;
    }
    if (url.pathname === '/sitemap.xml') {
      app.db
        .all(`SELECT slug, updated_at FROM group_deals WHERE stored_status IN ('PUBLISHED') ORDER BY updated_at DESC LIMIT 5000`)
        .then((deals) => {
          const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');
          const pages = ['/', '/deals', '/deals?status=upcoming', '/matching', '/partners', '/support', '/legal/mentions-legales', '/legal/conditions', '/legal/confidentialite'];
          const urls = [
            ...pages.map((p) => `<url><loc>${esc(config.publicUrl + p)}</loc></url>`),
            ...deals.map((d) => `<url><loc>${esc(`${config.publicUrl}/deals/${d.slug}`)}</loc><lastmod>${new Date(d.updated_at).toISOString().slice(0, 10)}</lastmod></url>`),
          ];
          res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
          res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>\n`);
        })
        .catch(() => send(req, res, 503, { status: 'database_unreachable' }));
      return;
    }
    try {
      if (!serveStatic(req, res, decodeURIComponent(url.pathname))) {
        send(req, res, 404, errorBody('NOT_FOUND'));
      }
    } catch {
      send(req, res, 404, errorBody('NOT_FOUND'));
    }
  });
}
