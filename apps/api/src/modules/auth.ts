/**
 * Inscription et authentification (§8, §42).
 */

import { z } from 'zod';
import { DomainError, requiresTwoFactor } from '@groupdeals/core';
import type { App } from '../app';
import { Db, uniqueViolation } from '../db/pool';
import { Ctx, Reply } from '../http/server';
import {
  DUMMY_HASH,
  decrypt,
  encrypt,
  hashPassword,
  newTotpSecret,
  otpauthUrl,
  verifyPassword,
  verifyTotp,
} from '../lib/crypto';
import { qrSvg } from '../lib/qr';
import { audit } from '../services/audit';
import { notify } from '../services/notify';
import type { SessionTokens } from '../services/auth-service';

const REFRESH_COOKIE = 'gd_refresh';
const COOKIE_PATH = '/api/v1/auth';
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

const password = z
  .string()
  .min(8, 'Au moins 8 caractères')
  .max(128)
  .regex(/[A-Za-zÀ-ÿ]/, 'Au moins une lettre')
  .regex(/\d/, 'Au moins un chiffre');
const email = z.string().trim().toLowerCase().email().max(254);
const whatsapp = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s().-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Numéro international attendu, ex. +237600000000'));
const name = z.string().trim().min(1).max(80);

const registerSchema = z.object({
  firstName: name,
  // L'écran d'inscription n'a qu'un champ « Nom » : le nom de famille peut être vide.
  lastName: z.string().trim().max(80).default(''),
  countryCode: z.string().length(2).toUpperCase(),
  email,
  whatsapp,
  password,
  languageCode: z.string().min(2).max(5).optional(),
  client: z.enum(['web', 'mobile']).default('web'),
});

const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  totp: z.string().regex(/^\d{6}$/).optional(),
  client: z.enum(['web', 'mobile']).default('web'),
});

export async function loadProfile(app: App, db: Db, userId: string) {
  const u = await db.one(
    `SELECT u.*, c.name AS country_name, c.currency_code,
            COALESCE((SELECT array_agg(role_code) FROM user_roles WHERE user_id = u.id), '{}') AS roles,
            COALESCE((SELECT array_agg(office_id::text) FROM local_office_agents WHERE user_id = u.id AND is_active), '{}') AS office_ids
       FROM users u JOIN countries c ON c.code = u.country_code WHERE u.id = $1`,
    [userId],
  );
  if (!u) throw new DomainError('NOT_FOUND');
  const permissions = [...(await app.rbac.permissionsFor(u.roles))].sort();
  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    whatsapp: u.whatsapp,
    avatarUrl: u.avatar_url,
    country: { code: u.country_code, name: u.country_name, currency: u.currency_code },
    languageCode: u.language_code,
    emailVerified: u.email_verified_at !== null,
    twoFactorEnabled: u.totp_enabled_at !== null,
    twoFactorRequired: app.config.requireStaff2fa && requiresTwoFactor(u.roles),
    roles: u.roles as string[],
    permissions,
    officeIds: u.office_ids as string[],
    notificationPrefs: u.notification_prefs,
    createdAt: u.created_at,
  };
}

function sessionReply(ctx: Ctx, tokens: SessionTokens, extra: Record<string, unknown>, client: 'web' | 'mobile') {
  ctx.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    maxAgeSec: ctx.app.config.refreshTokenTtlDays * 86_400,
    path: COOKIE_PATH,
  });
  return {
    accessToken: tokens.accessToken,
    expiresIn: tokens.expiresIn,
    // Le navigateur garde le jeton de rafraîchissement dans un cookie HttpOnly ;
    // l'application mobile, qui n'a pas de cookies, le reçoit dans la réponse.
    ...(client === 'mobile' ? { refreshToken: tokens.refreshToken } : {}),
    ...extra,
  };
}

async function sendVerification(app: App, db: Db, userId: string): Promise<string> {
  const token = await app.auth.createOneTimeToken(db, userId, 'EMAIL_VERIFY', 60 * 48);
  await notify(db, { userId, type: 'EMAIL_VERIFY', params: {}, link: `/verify-email?token=${token}`, silent: true });
  return token;
}

export function registerAuthRoutes(app: App): void {
  const r = app.router;
  const strict = { max: 10, windowSec: 60 };
  const debug = <T extends object>(data: T) => (app.config.isProd ? {} : { debug: data });

  r.post('/auth/register', { auth: 'none', body: registerSchema, rateLimit: strict }, async (ctx) => {
    const b = ctx.body as z.infer<typeof registerSchema>;
    const country = await app.reference.country(b.countryCode);
    const ref = await app.reference.get();
    const lang = ref.languages.find((l) => l.code === b.languageCode && l.isActive)?.code ?? country.defaultLanguage;
    const hash = await hashPassword(b.password);

    try {
      const out = await app.db.tx(async (tx) => {
        const user = await tx.one(
          `INSERT INTO users (email, password_hash, first_name, last_name, country_code, whatsapp, language_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [b.email, hash, b.firstName, b.lastName, country.code, b.whatsapp, lang],
        );
        await tx.query(`INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'CUSTOMER')`, [user!.id]);
        const verifyToken = await sendVerification(app, tx, user!.id);
        await notify(tx, { userId: user!.id, type: 'WELCOME', params: { firstName: b.firstName }, link: '/deals' });
        await tx.query(`INSERT INTO analytics_events (type, user_id, country_code) VALUES ('signup', $1, $2)`, [user!.id, country.code]);
        const tokens = await app.auth.openSession(tx, user!.id, { mfa: false, ip: ctx.ip, userAgent: ctx.userAgent });
        return { userId: user!.id as string, tokens, verifyToken };
      });
      const profile = await loadProfile(app, app.db, out.userId);
      return Reply.created(sessionReply(ctx, out.tokens, { user: profile, ...debug({ verifyToken: out.verifyToken }) }, b.client));
    } catch (e) {
      if (uniqueViolation(e)) throw new DomainError('AUTH_EMAIL_TAKEN');
      throw e;
    }
  });

  r.post('/auth/login', { auth: 'none', body: loginSchema, rateLimit: strict }, async (ctx) => {
    const b = ctx.body as z.infer<typeof loginSchema>;
    const now = ctx.now;
    const user = await app.db.one(
      `SELECT u.id, u.password_hash, u.status, u.locked_until, u.totp_enabled_at, u.totp_secret_enc,
              COALESCE((SELECT array_agg(role_code) FROM user_roles WHERE user_id = u.id), '{}') AS roles
         FROM users u WHERE u.email = $1`,
      [b.email],
    );
    if (!user) {
      await verifyPassword(b.password, DUMMY_HASH); // même durée que pour un compte existant
      throw new DomainError('AUTH_INVALID_CREDENTIALS');
    }
    if (user.locked_until && user.locked_until > now) {
      throw new DomainError('AUTH_LOCKED', { retryAfterSec: Math.ceil((user.locked_until.getTime() - now.getTime()) / 1000) });
    }

    const failed = async (code: 'AUTH_INVALID_CREDENTIALS' | 'AUTH_2FA_INVALID'): Promise<never> => {
      const row = await app.db.one(
        `UPDATE users SET failed_login_count = failed_login_count + 1 WHERE id = $1 RETURNING failed_login_count`,
        [user.id],
      );
      if (row!.failed_login_count >= MAX_FAILED_LOGINS) {
        await app.db.query(`UPDATE users SET failed_login_count = 0, locked_until = $2 WHERE id = $1`, [
          user.id,
          new Date(now.getTime() + LOCK_MINUTES * 60_000),
        ]);
        await audit(app.db, { user: null, ip: ctx.ip, userAgent: ctx.userAgent }, { action: 'auth.locked', entityType: 'user', entityId: user.id });
      }
      throw new DomainError(code);
    };

    if (!(await verifyPassword(b.password, user.password_hash))) await failed('AUTH_INVALID_CREDENTIALS');
    if (user.status !== 'ACTIVE') throw new DomainError('FORBIDDEN', { reason: 'account_' + String(user.status).toLowerCase() });

    let mfa = false;
    if (user.totp_enabled_at) {
      if (!b.totp) throw new DomainError('AUTH_2FA_REQUIRED');
      if (!verifyTotp(decrypt(user.totp_secret_enc, app.config.encryptionKey), b.totp, now.getTime())) await failed('AUTH_2FA_INVALID');
      mfa = true;
    }

    const tokens = await app.db.tx(async (tx) => {
      await tx.query(`UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = $2 WHERE id = $1`, [user.id, now]);
      await tx.query(`INSERT INTO analytics_events (type, user_id) VALUES ('login', $1)`, [user.id]);
      return app.auth.openSession(tx, user.id, { mfa, ip: ctx.ip, userAgent: ctx.userAgent });
    });
    const profile = await loadProfile(app, app.db, user.id);
    return sessionReply(ctx, tokens, { user: profile, twoFactorSetupRequired: profile.twoFactorRequired && !profile.twoFactorEnabled }, b.client);
  });

  r.post(
    '/auth/refresh',
    { auth: 'none', csrf: true, body: z.object({ refreshToken: z.string().optional() }), rateLimit: { max: 60, windowSec: 60 } },
    async (ctx) => {
      const fromBody = (ctx.body as { refreshToken?: string }).refreshToken;
      const token = fromBody ?? ctx.cookies[REFRESH_COOKIE];
      if (!token) throw new DomainError('AUTH_TOKEN_INVALID');
      const out = await app.auth.rotate(token, { ip: ctx.ip, userAgent: ctx.userAgent });
      const profile = await loadProfile(app, app.db, out.userId);
      return sessionReply(ctx, out, { user: profile }, fromBody ? 'mobile' : 'web');
    },
  );

  r.post('/auth/logout', { auth: 'optional', csrf: true }, async (ctx) => {
    if (ctx.user) await app.auth.revokeSession(app.db, ctx.user.id, ctx.user.sessionId);
    ctx.setCookie(REFRESH_COOKIE, '', { maxAgeSec: 0, path: COOKIE_PATH });
    return Reply.noContent();
  });

  r.post('/auth/verify-email', { auth: 'none', body: z.object({ token: z.string().min(10).max(200) }), rateLimit: strict }, async (ctx) => {
    await app.db.tx(async (tx) => {
      const userId = await app.auth.consumeOneTimeToken(tx, ctx.body.token, 'EMAIL_VERIFY');
      await tx.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, $2) WHERE id = $1`, [userId, ctx.now]);
    });
    return { verified: true };
  });

  r.post('/auth/resend-verification', { rateLimit: { max: 3, windowSec: 300 } }, async (ctx) => {
    const me = ctx.me();
    if (me.emailVerified) return { sent: false, alreadyVerified: true };
    const verifyToken = await app.db.tx((tx) => sendVerification(app, tx, me.id));
    return { sent: true, ...debug({ verifyToken }) };
  });

  r.post('/auth/forgot-password', { auth: 'none', body: z.object({ email }), rateLimit: { max: 5, windowSec: 300 } }, async (ctx) => {
    const user = await app.db.one(`SELECT id FROM users WHERE email = $1 AND status = 'ACTIVE'`, [ctx.body.email]);
    let resetToken: string | undefined;
    if (user) {
      resetToken = await app.db.tx(async (tx) => {
        const token = await app.auth.createOneTimeToken(tx, user.id, 'PASSWORD_RESET', 60);
        await notify(tx, { userId: user.id, type: 'PASSWORD_RESET', link: `/reset-password?token=${token}`, silent: true });
        return token;
      });
    }
    // Réponse identique que le compte existe ou non.
    return { sent: true, ...debug({ resetToken }) };
  });

  r.post(
    '/auth/reset-password',
    { auth: 'none', body: z.object({ token: z.string().min(10).max(200), password }), rateLimit: strict },
    async (ctx) => {
      const hash = await hashPassword(ctx.body.password);
      await app.db.tx(async (tx) => {
        const userId = await app.auth.consumeOneTimeToken(tx, ctx.body.token, 'PASSWORD_RESET');
        await tx.query(`UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1`, [userId, hash]);
        await app.auth.revokeAllSessions(tx, userId);
        await audit(tx, { user: null, ip: ctx.ip, userAgent: ctx.userAgent }, { action: 'auth.password_reset', entityType: 'user', entityId: userId });
      });
      return { reset: true };
    },
  );

  r.post(
    '/auth/change-password',
    { body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }), rateLimit: strict },
    async (ctx) => {
      const me = ctx.me();
      const row = await app.db.one(`SELECT password_hash FROM users WHERE id = $1`, [me.id]);
      if (!(await verifyPassword(ctx.body.currentPassword, row!.password_hash))) throw new DomainError('AUTH_INVALID_CREDENTIALS');
      const hash = await hashPassword(ctx.body.newPassword);
      await app.db.tx(async (tx) => {
        await tx.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [me.id, hash]);
        await app.auth.revokeAllSessions(tx, me.id, me.sessionId); // les autres appareils sont déconnectés
        await audit(tx, ctx, { action: 'auth.password_change', entityType: 'user', entityId: me.id });
      });
      return { changed: true };
    },
  );

  /* ----------------------- Double authentification ----------------------- */

  r.post('/auth/2fa/setup', { rateLimit: strict }, async (ctx) => {
    const me = ctx.me();
    if (me.twoFactorEnabled) throw new DomainError('CONFLICT', { reason: '2fa_already_enabled' });
    const secret = newTotpSecret();
    await app.db.query(`UPDATE users SET totp_secret_enc = $2 WHERE id = $1`, [me.id, encrypt(secret, app.config.encryptionKey)]);
    const url = otpauthUrl(secret, me.email);
    return { secret, otpauthUrl: url, qrSvg: qrSvg(url) };
  });

  r.post('/auth/2fa/enable', { body: z.object({ code: z.string().regex(/^\d{6}$/) }), rateLimit: strict }, async (ctx) => {
    const me = ctx.me();
    const row = await app.db.one(`SELECT totp_secret_enc, totp_enabled_at FROM users WHERE id = $1`, [me.id]);
    if (!row?.totp_secret_enc) throw new DomainError('VALIDATION_FAILED', { reason: '2fa_setup_missing' });
    if (!verifyTotp(decrypt(row.totp_secret_enc, app.config.encryptionKey), ctx.body.code, ctx.now.getTime())) {
      throw new DomainError('AUTH_2FA_INVALID');
    }
    const access = await app.db.tx(async (tx) => {
      await tx.query(`UPDATE users SET totp_enabled_at = COALESCE(totp_enabled_at, $2) WHERE id = $1`, [me.id, ctx.now]);
      await audit(tx, ctx, { action: 'auth.2fa_enable', entityType: 'user', entityId: me.id });
      return app.auth.elevate(tx, me.id, me.sessionId);
    });
    return { enabled: true, ...access };
  });

  r.post(
    '/auth/2fa/disable',
    { body: z.object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) }), rateLimit: strict },
    async (ctx) => {
      const me = ctx.me();
      if (app.config.requireStaff2fa && requiresTwoFactor(me.roles)) throw new DomainError('FORBIDDEN', { reason: '2fa_mandatory_for_staff' });
      const row = await app.db.one(`SELECT password_hash, totp_secret_enc, totp_enabled_at FROM users WHERE id = $1`, [me.id]);
      if (!row?.totp_enabled_at) throw new DomainError('CONFLICT', { reason: '2fa_not_enabled' });
      if (!(await verifyPassword(ctx.body.password, row.password_hash))) throw new DomainError('AUTH_INVALID_CREDENTIALS');
      if (!verifyTotp(decrypt(row.totp_secret_enc, app.config.encryptionKey), ctx.body.code, ctx.now.getTime())) {
        throw new DomainError('AUTH_2FA_INVALID');
      }
      await app.db.tx(async (tx) => {
        await tx.query(`UPDATE users SET totp_enabled_at = NULL, totp_secret_enc = NULL WHERE id = $1`, [me.id]);
        await audit(tx, ctx, { action: 'auth.2fa_disable', entityType: 'user', entityId: me.id });
      });
      return { enabled: false };
    },
  );

  /* ------------------------------- Sessions ------------------------------ */

  r.get('/auth/sessions', {}, async (ctx) => {
    const me = ctx.me();
    const rows = await app.db.all(
      `SELECT DISTINCT ON (family_id) family_id, user_agent, host(ip) AS ip, created_at,
              (SELECT min(created_at) FROM refresh_tokens f WHERE f.family_id = rt.family_id) AS started_at
         FROM refresh_tokens rt
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2
        ORDER BY family_id, created_at DESC`,
      [me.id, ctx.now],
    );
    return {
      sessions: rows
        .map((s) => ({
          id: s.family_id,
          userAgent: s.user_agent,
          ip: s.ip,
          startedAt: s.started_at,
          lastSeenAt: s.created_at,
          current: s.family_id === me.sessionId,
        }))
        .sort((a, b) => +b.lastSeenAt - +a.lastSeenAt),
    };
  });

  r.delete('/auth/sessions/:id', {}, async (ctx) => {
    const me = ctx.me();
    await app.auth.revokeSession(app.db, me.id, ctx.params.id);
    return Reply.noContent();
  });
}
