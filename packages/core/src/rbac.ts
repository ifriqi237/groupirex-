/**
 * Rôles et permissions (§38). Le contrôle se fait toujours côté API.
 * Les rôles de bureau sont en plus limités à LEUR bureau : la vérification du
 * périmètre (officeId) est faite par l'API, pas par cette matrice.
 */

export const ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'LOGISTICS_MANAGER',
  'FINANCE_MANAGER',
  'OFFICE_MANAGER',
  'OFFICE_AGENT',
  'MODERATOR',
  'CUSTOMER',
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'dashboard.view',
  'users.read',
  'users.manage',
  'roles.manage',
  'catalog.read',
  'catalog.manage',
  'categories.delete',
  'deals.manage',
  'deals.decide',
  'pricing.manage',
  'margins.view',
  'currencies.manage',
  'orders.read',
  'orders.manage',
  'payments.read',
  'payments.reconcile',
  'refunds.manage',
  'offices.manage',
  'office.payments.record',
  'office.cash.close',
  'office.pickup.confirm',
  'logistics.read',
  'logistics.advance',
  'logistics.override',
  'matching.moderate',
  'matching.convert',
  'content.manage',
  'settings.manage',
  'audit.read',
  'analytics.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL,
  // Gestion opérationnelle : tout sauf les rôles, les réglages et la suppression de
  // catégories (réservée au super-admin, §10).
  ADMIN: ALL.filter(
    (p) => !['roles.manage', 'settings.manage', 'categories.delete'].includes(p),
  ),
  LOGISTICS_MANAGER: [
    'dashboard.view',
    'catalog.read',
    'orders.read',
    'logistics.read',
    'logistics.advance',
    'logistics.override',
  ],
  FINANCE_MANAGER: [
    'dashboard.view',
    'orders.read',
    'payments.read',
    'payments.reconcile',
    'refunds.manage',
    'margins.view',
    'analytics.view',
    'audit.read',
  ],
  OFFICE_MANAGER: [
    'orders.read',
    'payments.read',
    'office.payments.record',
    'office.cash.close',
    'office.pickup.confirm',
    'logistics.read',
  ],
  // L'agent encaisse et remet les colis. Il ne peut modifier ni prix, ni commande,
  // ni tarif de livraison (§25) : il n'a aucune permission d'écriture sur ces objets.
  OFFICE_AGENT: ['office.payments.record', 'office.pickup.confirm'],
  MODERATOR: ['catalog.read', 'catalog.manage', 'matching.moderate', 'content.manage'],
  CUSTOMER: [],
};

export function permissionsOf(roles: readonly Role[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) set.add(p);
  return set;
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r]?.includes(permission));
}

/** Rôles du personnel : la double authentification est obligatoire pour eux (§42). */
export const STAFF_ROLES: Role[] = ROLES.filter((r) => r !== 'CUSTOMER');

export function requiresTwoFactor(roles: readonly Role[]): boolean {
  return roles.some((r) => r !== 'CUSTOMER');
}

/** Rôles dont l'action est limitée à un seul bureau. */
export function isOfficeScoped(roles: readonly Role[]): boolean {
  const scoped = roles.some((r) => r === 'OFFICE_AGENT' || r === 'OFFICE_MANAGER');
  const global = roles.some((r) => r === 'SUPER_ADMIN' || r === 'ADMIN' || r === 'FINANCE_MANAGER');
  return scoped && !global;
}
