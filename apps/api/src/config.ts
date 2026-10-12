/**
 * Configuration : tout vient des variables d'environnement (voir .env.example).
 * En production, l'API refuse de démarrer si un secret manque ou est trop faible.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PoolOptions, parseDatabaseUrl } from './db/pool';
import type { SmtpConfig } from './services/email';

export type Env = 'development' | 'test' | 'staging' | 'production';

export interface Config {
  env: Env;
  isProd: boolean;
  port: number;
  /** URL publique du site (liens des emails, retour de paiement). */
  publicUrl: string;
  /** Origines autorisées à appeler l'API depuis un navigateur. */
  corsOrigins: string[];
  trustProxy: boolean;
  /** Nombre de serveurs mandataires devant l'API (hébergeur, Caddy) : 1 par défaut. */
  proxyHops: number;
  database: PoolOptions;
  jwtSecret: string;
  /** Clé de chiffrement des secrets 2FA (32 octets, hex). */
  encryptionKey: Buffer;
  accessTokenTtlSec: number;
  refreshTokenTtlDays: number;
  requireStaff2fa: boolean;
  payments: {
    provider: 'flutterwave' | 'sandbox';
    flutterwaveSecretKey: string;
    flutterwaveWebhookHash: string;
    flutterwaveBaseUrl: string;
  };
  /** Envoi des emails ; null = emails écrits dans le journal (développement). */
  smtp: SmtpConfig | null;
  uploadsDir: string;
  webDir: string | null;
  defaultCountry: string;
  runJobs: boolean;
  logLevel: 'silent' | 'info' | 'debug';
}

function loadDotEnv(): void {
  const file = process.env.ENV_FILE ?? path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

export function loadConfig(overrides: Partial<Record<string, string>> = {}): Config {
  loadDotEnv();
  const e = { ...process.env, ...overrides } as Record<string, string | undefined>;
  const env = (e.NODE_ENV ?? 'development') as Env;
  const isProd = env === 'production' || env === 'staging';
  const problems: string[] = [];

  const need = (name: string, devDefault: string): string => {
    const v = e[name];
    if (v) return v;
    if (isProd) problems.push(`${name} est obligatoire`);
    return devDefault;
  };

  const jwtSecret = need('JWT_SECRET', 'dev-only-jwt-secret-change-me-0123456789abcdef');
  if (isProd && jwtSecret.length < 32) problems.push('JWT_SECRET doit faire au moins 32 caractères');

  const keyHex = need('ENCRYPTION_KEY', crypto.createHash('sha256').update('dev-only-encryption-key').digest('hex'));
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) problems.push('ENCRYPTION_KEY doit contenir 64 caractères hexadécimaux (openssl rand -hex 32)');

  const provider = (e.PAYMENT_PROVIDER ?? (isProd ? 'flutterwave' : 'sandbox')) as 'flutterwave' | 'sandbox';
  if (env === 'production' && provider !== 'flutterwave') problems.push('PAYMENT_PROVIDER=sandbox est interdit en production');
  if (provider === 'flutterwave') {
    if (!e.FLUTTERWAVE_SECRET_KEY) problems.push('FLUTTERWAVE_SECRET_KEY est obligatoire');
    if (!e.FLUTTERWAVE_WEBHOOK_HASH) problems.push('FLUTTERWAVE_WEBHOOK_HASH est obligatoire');
  }

  const dbUrl = need('DATABASE_URL', 'postgres://postgres@127.0.0.1:5432/groupdeals');
  let database: PoolOptions;
  try {
    database = {
      ...parseDatabaseUrl(dbUrl),
      max: parseInt(e.DATABASE_POOL_SIZE ?? '10', 10),
      driver: e.DATABASE_DRIVER === 'pg' ? 'pg' : 'builtin',
      statementTimeoutMs: 15_000,
    };
    if (e.DATABASE_CA_FILE) {
      database.ssl = { rejectUnauthorized: true, ca: fs.readFileSync(e.DATABASE_CA_FILE, 'utf8') };
    }
  } catch {
    problems.push('DATABASE_URL est invalide');
    database = parseDatabaseUrl('postgres://postgres@127.0.0.1:5432/groupdeals');
  }

  // Emails (vérification de l'adresse, mot de passe oublié, notifications).
  let smtp: SmtpConfig | null = null;
  if (e.SMTP_HOST) {
    const port = parseInt(e.SMTP_PORT ?? '465', 10);
    const security = (e.SMTP_SECURITY ?? (port === 465 ? 'ssl' : 'starttls')) as SmtpConfig['security'];
    if (!['ssl', 'starttls', 'none'].includes(security)) problems.push('SMTP_SECURITY doit valoir ssl, starttls ou none');
    if (isProd && security === 'none') problems.push('SMTP_SECURITY=none (email en clair) est interdit en production');
    if (!e.MAIL_FROM) problems.push('MAIL_FROM est obligatoire avec SMTP_HOST (ex. « GROUPDEALS <no-reply@votre-domaine.com> »)');
    smtp = {
      host: e.SMTP_HOST,
      port,
      security,
      user: e.SMTP_USER ?? '',
      password: e.SMTP_PASSWORD ?? '',
      from: e.MAIL_FROM ?? '',
      rejectUnauthorized: !bool(e.SMTP_ALLOW_SELF_SIGNED, false),
      timeoutMs: parseInt(e.SMTP_TIMEOUT_MS ?? '20000', 10),
    };
  } else if (env === 'production') {
    problems.push('SMTP_HOST est obligatoire en production : sans lui, les emails de vérification et de mot de passe oublié ne partent pas');
  }

  const publicUrl = (e.PUBLIC_URL ?? `http://localhost:${e.PORT ?? '4000'}`).replace(/\/$/, '');
  if (env === 'production' && !publicUrl.startsWith('https://')) problems.push('PUBLIC_URL doit être en https en production');

  if (problems.length) {
    throw new Error('Configuration invalide :\n  - ' + problems.join('\n  - '));
  }

  const webDefault = path.resolve(__dirname, '../../web/dist');
  const webDir = e.WEB_DIR ?? (fs.existsSync(webDefault) ? webDefault : null);

  return {
    env,
    isProd,
    port: parseInt(e.PORT ?? '4000', 10),
    publicUrl,
    corsOrigins: (e.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: bool(e.TRUST_PROXY, isProd),
    proxyHops: Math.max(1, parseInt(e.TRUST_PROXY_HOPS ?? '1', 10) || 1),
    database,
    jwtSecret,
    encryptionKey: Buffer.from(keyHex, 'hex'),
    accessTokenTtlSec: parseInt(e.ACCESS_TOKEN_TTL_SEC ?? '900', 10),
    refreshTokenTtlDays: parseInt(e.REFRESH_TOKEN_TTL_DAYS ?? '30', 10),
    requireStaff2fa: bool(e.REQUIRE_STAFF_2FA, isProd),
    payments: {
      provider,
      flutterwaveSecretKey: e.FLUTTERWAVE_SECRET_KEY ?? '',
      flutterwaveWebhookHash: e.FLUTTERWAVE_WEBHOOK_HASH ?? '',
      flutterwaveBaseUrl: e.FLUTTERWAVE_BASE_URL ?? 'https://api.flutterwave.com/v3',
    },
    smtp,
    uploadsDir: path.resolve(e.UPLOADS_DIR ?? './uploads'),
    webDir: webDir === '' ? null : webDir,
    defaultCountry: e.DEFAULT_COUNTRY ?? 'CM',
    runJobs: bool(e.RUN_JOBS, env !== 'test'),
    logLevel: (e.LOG_LEVEL as Config['logLevel']) ?? (env === 'test' ? 'silent' : 'info'),
  };
}
