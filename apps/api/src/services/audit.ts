/**
 * Journal d'audit : toute action du personnel (et toute action sensible) y est
 * écrite, dans la même transaction que l'action elle-même.
 */

import type { Db } from '../db/pool';
import type { Ctx } from '../http/server';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export async function audit(db: Db, ctx: Pick<Ctx, 'user' | 'ip' | 'userAgent'> | null, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_roles, action, entity_type, entity_id, before, after, reason, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      ctx?.user?.id ?? null,
      ctx?.user?.roles ?? [],
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.reason ?? null,
      ctx?.ip && /^[0-9a-fA-F:.]+$/.test(ctx.ip) ? ctx.ip : null,
      ctx?.userAgent ?? null,
    ],
  );
}
