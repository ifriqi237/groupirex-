/**
 * Sessions : jeton d'accès court (JWT, 15 min) + jeton de rafraîchissement long,
 * stocké haché, à usage unique (rotation). Réutiliser un jeton déjà remplacé
 * révoque toute la session : c'est le signe d'un vol.
 */

import crypto from 'node:crypto';
import { DomainError, Role } from '@groupdeals/core';
import type { App } from '../app';
import type { Db } from '../db/pool';
import type { AuthUser } from '../http/server';
import { randomToken, sha256, signJwt, verifyJwt } from '../lib/crypto';

export interface SessionTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  sessionId: string;
}

export class AuthService {
  constructor(private readonly app: App) {}

  /** Charge l'utilisateur d'un jeton d'accès ; null si le jeton ou la session n'est plus valide. */
  async resolveAccessToken(token: string): Promise<AuthUser | null> {
    const now = this.app.clock.now();
    const claims = verifyJwt(token, this.app.config.jwtSecret, now.getTime());
    if (!claims) return null;
    const row = await this.app.db.one(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.country_code, u.language_code,
              u.email_verified_at, u.totp_enabled_at, u.status,
              COALESCE((SELECT array_agg(role_code) FROM user_roles WHERE user_id = u.id), '{}') AS roles,
              COALESCE((SELECT array_agg(office_id::text) FROM local_office_agents
                         WHERE user_id = u.id AND is_active), '{}') AS office_ids,
              EXISTS (SELECT 1 FROM refresh_tokens rt
                       WHERE rt.family_id = $2 AND rt.user_id = u.id
                         AND rt.revoked_at IS NULL AND rt.expires_at > $3) AS session_ok
         FROM users u WHERE u.id = $1`,
      [claims.sub, claims.sid, now],
    );
    if (!row || row.status !== 'ACTIVE' || !row.session_ok) return null;
    const roles = row.roles as Role[];
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      roles,
      permissions: await this.app.rbac.permissionsFor(roles),
      officeIds: row.office_ids,
      countryCode: row.country_code,
      languageCode: row.language_code,
      emailVerified: row.email_verified_at !== null,
      mfa: claims.mfa === true,
      twoFactorEnabled: row.totp_enabled_at !== null,
      sessionId: claims.sid,
    };
  }

  private access(userId: string, sessionId: string, mfa: boolean): string {
    return signJwt({ sub: userId, sid: sessionId, mfa }, this.app.config.jwtSecret, this.app.config.accessTokenTtlSec, this.app.clock.now().getTime());
  }

  /** Ouvre une nouvelle session. */
  async openSession(db: Db, userId: string, meta: { mfa: boolean; ip: string; userAgent: string }): Promise<SessionTokens> {
    const sessionId = crypto.randomUUID();
    const refreshToken = await this.insertRefresh(db, userId, sessionId, meta);
    return { accessToken: this.access(userId, sessionId, meta.mfa), expiresIn: this.app.config.accessTokenTtlSec, refreshToken, sessionId };
  }

  private async insertRefresh(db: Db, userId: string, familyId: string, meta: { mfa: boolean; ip: string; userAgent: string }): Promise<string> {
    const token = randomToken(48);
    const expires = new Date(this.app.clock.now().getTime() + this.app.config.refreshTokenTtlDays * 86_400_000);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, mfa, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, familyId, sha256(token), expires, meta.mfa, meta.userAgent, /^[0-9a-fA-F:.]+$/.test(meta.ip) ? meta.ip : null],
    );
    return token;
  }

  /** Échange un jeton de rafraîchissement contre une nouvelle paire. */
  async rotate(refreshToken: string, meta: { ip: string; userAgent: string }): Promise<SessionTokens & { userId: string }> {
    const now = this.app.clock.now();
    const outcome = await this.app.db.tx(async (tx) => {
      const row = await tx.one(
        `SELECT rt.*, u.status FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
          WHERE rt.token_hash = $1 FOR UPDATE OF rt`,
        [sha256(refreshToken)],
      );
      if (!row || row.status !== 'ACTIVE') return { error: true } as const;
      if (row.revoked_at && row.replaced_by && now.getTime() - row.revoked_at.getTime() < 10_000) {
        // Deux onglets ont rafraîchi en même temps : on refuse celui-ci sans fermer la session.
        return { error: true } as const;
      }
      if (row.revoked_at || row.expires_at <= now) {
        // Jeton déjà utilisé ou révoqué : on ferme toute la session. La révocation doit
        // survivre à l'erreur renvoyée, donc elle est validée avant de signaler l'échec.
        await tx.query('UPDATE refresh_tokens SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id, now]);
        return { error: true } as const;
      }
      const token = await this.insertRefresh(tx, row.user_id, row.family_id, { mfa: row.mfa, ...meta });
      await tx.query(
        `UPDATE refresh_tokens SET revoked_at = $2, replaced_by = (SELECT id FROM refresh_tokens WHERE token_hash = $3) WHERE id = $1`,
        [row.id, now, sha256(token)],
      );
      return { error: false, userId: row.user_id as string, sessionId: row.family_id as string, mfa: row.mfa as boolean, token } as const;
    });
    if (outcome.error) throw new DomainError('AUTH_TOKEN_INVALID');
    return {
      userId: outcome.userId,
      sessionId: outcome.sessionId,
      accessToken: this.access(outcome.userId, outcome.sessionId, outcome.mfa),
      expiresIn: this.app.config.accessTokenTtlSec,
      refreshToken: outcome.token,
    };
  }

  /** Marque la session comme ayant validé la 2FA et renvoie un nouveau jeton d'accès. */
  async elevate(db: Db, userId: string, sessionId: string): Promise<{ accessToken: string; expiresIn: number }> {
    await db.query('UPDATE refresh_tokens SET mfa = true WHERE family_id = $1 AND user_id = $2', [sessionId, userId]);
    return { accessToken: this.access(userId, sessionId, true), expiresIn: this.app.config.accessTokenTtlSec };
  }

  async revokeSession(db: Db, userId: string, sessionId: string): Promise<void> {
    await db.query('UPDATE refresh_tokens SET revoked_at = $3 WHERE family_id = $1 AND user_id = $2 AND revoked_at IS NULL', [
      sessionId,
      userId,
      this.app.clock.now(),
    ]);
  }

  async revokeAllSessions(db: Db, userId: string, exceptSessionId?: string): Promise<void> {
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = $2
        WHERE user_id = $1 AND revoked_at IS NULL AND ($3::uuid IS NULL OR family_id <> $3::uuid)`,
      [userId, this.app.clock.now(), exceptSessionId ?? null],
    );
  }

  /** Jeton à usage unique (vérification d'email, mot de passe oublié). Renvoie le jeton en clair. */
  async createOneTimeToken(db: Db, userId: string, kind: 'EMAIL_VERIFY' | 'PASSWORD_RESET', ttlMinutes: number): Promise<string> {
    const token = randomToken(32);
    await db.query(`UPDATE auth_tokens SET used_at = $3 WHERE user_id = $1 AND kind = $2 AND used_at IS NULL`, [userId, kind, this.app.clock.now()]);
    await db.query(`INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, $4)`, [
      userId,
      kind,
      sha256(token),
      new Date(this.app.clock.now().getTime() + ttlMinutes * 60_000),
    ]);
    return token;
  }

  /** Consomme un jeton à usage unique ; renvoie l'utilisateur ou lève AUTH_TOKEN_INVALID. */
  async consumeOneTimeToken(db: Db, token: string, kind: 'EMAIL_VERIFY' | 'PASSWORD_RESET'): Promise<string> {
    const row = await db.one(
      `UPDATE auth_tokens SET used_at = $3
        WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > $3
        RETURNING user_id`,
      [sha256(token), kind, this.app.clock.now()],
    );
    if (!row) throw new DomainError('AUTH_TOKEN_INVALID');
    return row.user_id;
  }
}
