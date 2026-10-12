/**
 * Droits : la matrice de @groupdeals/core est copiée en base au démarrage, puis
 * la base fait foi (le super-admin peut l'ajuster). Gardée en mémoire 30 secondes.
 */

import { PERMISSIONS, Permission, ROLES, ROLE_PERMISSIONS, Role } from '@groupdeals/core';
import type { App } from '../app';

export class RbacCache {
  private map: Map<string, Set<Permission>> | null = null;
  private loadedAt = 0;

  constructor(private readonly app: App) {}

  /**
   * Ajoute les permissions et rôles nouveaux. Un rôle qui n'a encore aucune
   * permission en base reçoit celles de la matrice ; les rôles déjà configurés
   * ne sont pas écrasés.
   */
  async syncFromCode(): Promise<void> {
    await this.app.db.tx(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(727274002)');
      await tx.query('INSERT INTO permissions (code) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [[...PERMISSIONS]]);
      const configured = new Set((await tx.all('SELECT DISTINCT role_code FROM role_permissions')).map((r) => r.role_code));
      for (const role of ROLES) {
        await tx.query('INSERT INTO roles (code, label) VALUES ($1, $1) ON CONFLICT DO NOTHING', [role]);
        if (!configured.has(role) && ROLE_PERMISSIONS[role].length) {
          await tx.query(
            'INSERT INTO role_permissions (role_code, permission_code) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING',
            [role, ROLE_PERMISSIONS[role]],
          );
        }
      }
      // Le super-admin a toujours tout, y compris les permissions ajoutées par une mise à jour.
      await tx.query(
        `INSERT INTO role_permissions (role_code, permission_code)
         SELECT 'SUPER_ADMIN', code FROM permissions ON CONFLICT DO NOTHING`,
      );
    });
    this.map = null;
  }

  invalidate(): void {
    this.map = null;
  }

  async permissionsFor(roles: readonly Role[]): Promise<Set<Permission>> {
    if (!this.map || Date.now() - this.loadedAt > 30_000) {
      const rows = await this.app.db.all('SELECT role_code, permission_code FROM role_permissions');
      const map = new Map<string, Set<Permission>>();
      for (const r of rows) {
        if (!map.has(r.role_code)) map.set(r.role_code, new Set());
        map.get(r.role_code)!.add(r.permission_code);
      }
      this.map = map;
      this.loadedAt = Date.now();
    }
    const out = new Set<Permission>();
    for (const role of roles) for (const p of this.map.get(role) ?? []) out.add(p);
    return out;
  }
}
