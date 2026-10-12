/**
 * Back-office : tableau de bord, statistiques, utilisateurs et rôles, commandes,
 * paiements et remboursements, bureaux et agents, devises et taux, langues,
 * réglages, journal d'audit (§35, §38, §46).
 */

import { z } from 'zod';
import { DomainError, PERMISSIONS, ROLES, Role, convertPlain, effectiveOrderStep } from '@groupdeals/core';
import type { App } from '../app';
import type { Row } from '../db/pool';
import { Ctx, Reply } from '../http/server';
import { pageOf } from '../http/viewer';
import { hashPassword, randomToken } from '../lib/crypto';
import { audit } from '../services/audit';
import { notify } from '../services/notify';
import { ORDER_BUCKET_SQL, ORDER_SELECT, cancelOrder, officeDto } from '../services/orders';

const like = (q?: string) => (q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null);

export function registerAdminRoutes(app: App): void {
  const r = app.router;

  /** Convertit une liste de montants (devises diverses) vers la devise de pilotage, sans marge de change. */
  async function consolidate(rows: { amount: number; currency: string }[], target: string): Promise<{ total: number; missing: string[] }> {
    const ctx = { ...(await app.reference.priceContext()), maxRateAgeHours: 0 };
    let total = 0;
    const missing: string[] = [];
    for (const row of rows) {
      try {
        total += convertPlain({ amount: row.amount, currency: row.currency }, target, ctx);
      } catch {
        missing.push(row.currency);
      }
    }
    return { total, missing: [...new Set(missing)] };
  }

  /* ----------------------------- Tableau de bord ----------------------------- */

  r.get('/admin/dashboard', { permission: 'dashboard.view' }, async (ctx) => {
    const ref = await app.reference.get();
    const reporting = (await app.reference.setting('reporting.currency', 'XAF')) as string;
    const since = new Date(ctx.now.getTime() - 30 * 86_400_000);
    const [counts, revenue, revenue30, byCountry, byStep, recent, daily] = await Promise.all([
      app.db.one(
        `SELECT (SELECT count(*)::int FROM users) AS users,
                (SELECT count(*)::int FROM users WHERE created_at >= $2) AS users_30d,
                (SELECT count(DISTINCT user_id)::int FROM group_deal_participants) AS participants,
                (SELECT count(*)::int FROM countries WHERE is_active) AS countries,
                (SELECT count(*)::int FROM products WHERE deleted_at IS NULL AND is_active) AS products,
                (SELECT count(*)::int FROM group_deals WHERE stored_status = 'PUBLISHED' AND starts_at <= $1 AND ends_at > $1) AS active_deals,
                (SELECT count(*)::int FROM group_deals WHERE stored_status = 'PUBLISHED' AND ends_at <= $1) AS deals_to_decide,
                (SELECT count(*)::int FROM orders) AS orders,
                (SELECT count(*)::int FROM orders WHERE payment_status = 'PAID') AS paid_orders,
                (SELECT count(*)::int FROM orders WHERE payment_status IN ('PENDING','FAILED')) AS pending_orders,
                (SELECT count(*)::int FROM payments WHERE status = 'SUCCESSFUL') AS payments,
                (SELECT count(*)::int FROM payments WHERE status = 'SUCCESSFUL' AND provider = 'OFFICE') AS office_payments,
                (SELECT count(*)::int FROM office_payments WHERE status IN ('PENDING_PAYMENT','CONFIRMED') AND expires_at > $1) AS office_pending,
                (SELECT count(*)::int FROM refunds WHERE status = 'PENDING') AS refunds_pending,
                (SELECT count(*)::int FROM matching_requests WHERE status = 'PENDING_REVIEW') AS matching_to_review,
                (SELECT count(*)::int FROM matching_requests WHERE status = 'PUBLISHED' AND threshold_alerted_at IS NOT NULL) AS matching_hot,
                (SELECT count(*)::int FROM shipments WHERE current_step < 7) AS shipments_in_progress`,
        [ctx.now, since],
      ),
      app.db.all(`SELECT currency_code AS currency, sum(total_amount)::bigint AS amount FROM orders WHERE payment_status = 'PAID' GROUP BY 1`),
      app.db.all(`SELECT currency_code AS currency, sum(total_amount)::bigint AS amount FROM orders WHERE payment_status = 'PAID' AND paid_at >= $1 GROUP BY 1`, [since]),
      app.db.all(
        `SELECT o.country_code, c.name, o.currency_code AS currency, count(*)::int AS orders, sum(o.total_amount)::bigint AS amount, sum(o.total_quantity)::int AS units
           FROM orders o JOIN countries c ON c.code = o.country_code WHERE o.payment_status = 'PAID'
          GROUP BY o.country_code, c.name, o.currency_code ORDER BY orders DESC LIMIT 12`,
      ),
      app.db.all(
        `SELECT ${ORDER_BUCKET_SQL} AS bucket, count(*)::int AS n FROM orders o LEFT JOIN shipments s ON s.id = o.shipment_id GROUP BY 1`,
      ),
      app.db.all(`${ORDER_SELECT} ORDER BY o.created_at DESC LIMIT 8`),
      app.db.all(
        `SELECT to_char(date_trunc('day', paid_at), 'YYYY-MM-DD') AS day, currency_code AS currency, count(*)::int AS orders, sum(total_amount)::bigint AS amount
           FROM orders WHERE payment_status = 'PAID' AND paid_at >= $1 GROUP BY 1, 2 ORDER BY 1`,
        [since],
      ),
    ]);
    const total = await consolidate(revenue as any, reporting);
    const total30 = await consolidate(revenue30 as any, reporting);
    // Série quotidienne consolidée dans la devise de pilotage
    const days = new Map<string, { orders: number; amount: number }>();
    for (const d of daily) {
      const conv = await consolidate([{ amount: d.amount, currency: d.currency }], reporting);
      const cur = days.get(d.day) ?? { orders: 0, amount: 0 };
      days.set(d.day, { orders: cur.orders + d.orders, amount: cur.amount + conv.total });
    }
    const series = [];
    for (let i = 29; i >= 0; i--) {
      const day = new Date(ctx.now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      series.push({ day, orders: days.get(day)?.orders ?? 0, amount: days.get(day)?.amount ?? 0 });
    }
    return {
      reportingCurrency: reporting,
      revenue: {
        total: app.reference.moneySync(ref, total.total, reporting),
        last30Days: app.reference.moneySync(ref, total30.total, reporting),
        byCurrency: revenue.map((x) => app.reference.moneySync(ref, x.amount, x.currency)),
        /** Devises sans taux de change : exclues du total consolidé. */
        unconverted: total.missing,
      },
      counts: {
        users: counts!.users, newUsers30Days: counts!.users_30d, participants: counts!.participants, countries: counts!.countries,
        products: counts!.products, activeDeals: counts!.active_deals, dealsToDecide: counts!.deals_to_decide,
        orders: counts!.orders, paidOrders: counts!.paid_orders, pendingOrders: counts!.pending_orders,
        payments: counts!.payments, officePayments: counts!.office_payments, officePending: counts!.office_pending,
        refundsPending: counts!.refunds_pending, matchingToReview: counts!.matching_to_review, matchingHot: counts!.matching_hot,
        shipmentsInProgress: counts!.shipments_in_progress,
      },
      ordersByStatus: Object.fromEntries(byStep.map((x) => [x.bucket, x.n])),
      byCountry: byCountry.map((x) => ({ country: { code: x.country_code, name: x.name }, orders: x.orders, units: x.units, revenue: app.reference.moneySync(ref, x.amount, x.currency) })),
      series,
      recentOrders: recent.map((o) => ({
        id: o.id, number: o.number, status: o.bucket, productName: o.product_name, country: o.country_code,
        total: app.reference.moneySync(ref, o.total_amount, o.currency_code), createdAt: o.created_at,
      })),
    };
  });

  /* ------------------------------- Statistiques ------------------------------- */

  r.get('/admin/analytics', { permission: 'analytics.view', query: z.object({ days: z.string().regex(/^\d{1,3}$/).optional() }) }, async (ctx) => {
    const days = Math.min(365, Math.max(1, parseInt(ctx.query.days ?? '30', 10)));
    const since = new Date(ctx.now.getTime() - days * 86_400_000);
    const ref = await app.reference.get();
    const reporting = (await app.reference.setting('reporting.currency', 'XAF')) as string;
    const [signups, active, funnel, topViewed, topFavorites, byCategory, byCountry, paid, matching, methods] = await Promise.all([
      app.db.one(`SELECT count(*)::int AS n FROM users WHERE created_at >= $1`, [since]),
      app.db.one(`SELECT count(DISTINCT user_id)::int AS n FROM analytics_events WHERE created_at >= $1 AND user_id IS NOT NULL`, [since]),
      app.db.all(`SELECT type, count(*)::int AS n FROM analytics_events WHERE created_at >= $1 GROUP BY type`, [since]),
      app.db.all(
        `SELECT p.id, p.name, count(*)::int AS views FROM analytics_events e JOIN group_deals d ON d.id = e.entity_id JOIN products p ON p.id = d.product_id
          WHERE e.type = 'deal_view' AND e.created_at >= $1 GROUP BY p.id, p.name ORDER BY views DESC LIMIT 10`,
        [since],
      ),
      app.db.all(`SELECT p.id, p.name, count(*)::int AS favorites FROM favorites f JOIN products p ON p.id = f.product_id GROUP BY p.id, p.name ORDER BY favorites DESC LIMIT 10`),
      app.db.all(
        `SELECT c.name, o.currency_code AS currency, count(*)::int AS orders, sum(o.total_amount)::bigint AS amount
           FROM orders o JOIN group_deals d ON d.id = o.deal_id JOIN products p ON p.id = d.product_id JOIN categories c ON c.id = p.category_id
          WHERE o.payment_status = 'PAID' AND o.paid_at >= $1 GROUP BY c.name, o.currency_code`,
        [since],
      ),
      app.db.all(
        `SELECT u.country_code, c.name, count(*)::int AS users FROM users u JOIN countries c ON c.code = u.country_code GROUP BY 1, 2 ORDER BY users DESC LIMIT 15`,
      ),
      app.db.all(`SELECT currency_code AS currency, count(*)::int AS orders, sum(total_amount)::bigint AS amount FROM orders WHERE payment_status = 'PAID' AND paid_at >= $1 GROUP BY 1`, [since]),
      app.db.one(
        `SELECT (SELECT count(*)::int FROM matching_requests WHERE created_at >= $1) AS requests,
                (SELECT count(*)::int FROM matching_interests WHERE created_at >= $1) AS interests,
                (SELECT count(*)::int FROM matching_requests WHERE status = 'CONVERTED' AND moderated_at >= $1) AS converted`,
        [since],
      ),
      app.db.all(`SELECT provider, COALESCE(channel, 'online') AS channel, count(*)::int AS n FROM payments WHERE status = 'SUCCESSFUL' AND created_at >= $1 GROUP BY 1, 2`, [since]),
    ]);
    const f = Object.fromEntries(funnel.map((x) => [x.type, x.n]));
    const revenue = await consolidate(paid as any, reporting);
    const paidOrders = paid.reduce((s, x) => s + x.orders, 0);
    const categories = new Map<string, { orders: number; amount: number }>();
    for (const c of byCategory) {
      const conv = await consolidate([{ amount: c.amount, currency: c.currency }], reporting);
      const cur = categories.get(c.name) ?? { orders: 0, amount: 0 };
      categories.set(c.name, { orders: cur.orders + c.orders, amount: cur.amount + conv.total });
    }
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
    return {
      days,
      reportingCurrency: reporting,
      signups: signups!.n,
      activeUsers: active!.n,
      funnel: {
        dealViews: f.deal_view ?? 0,
        participateClicks: f.participate_click ?? 0,
        ordersCreated: f.order_created ?? 0,
        checkoutStarts: f.checkout_start ?? 0,
        ordersPaid: f.order_paid ?? 0,
        /** Commandes payées rapportées aux vues d'offres. */
        viewToPaidPercent: pct(f.order_paid ?? 0, f.deal_view ?? 0),
        /** Commandes payées rapportées aux commandes créées. */
        orderToPaidPercent: pct(f.order_paid ?? 0, f.order_created ?? 0),
      },
      revenue: app.reference.moneySync(ref, revenue.total, reporting),
      paidOrders,
      averageBasket: app.reference.moneySync(ref, paidOrders ? Math.round(revenue.total / paidOrders) : 0, reporting),
      topViewed: topViewed.map((x) => ({ id: x.id, name: x.name, views: x.views })),
      topFavorites: topFavorites.map((x) => ({ id: x.id, name: x.name, favorites: x.favorites })),
      byCategory: [...categories].map(([name, v]) => ({ name, orders: v.orders, revenue: app.reference.moneySync(ref, v.amount, reporting) })).sort((a, b) => b.revenue.amount - a.revenue.amount),
      usersByCountry: byCountry.map((x) => ({ country: { code: x.country_code, name: x.name }, users: x.users })),
      paymentMethods: methods.map((m) => ({ provider: m.provider, channel: m.channel, count: m.n })),
      matching: { requests: matching!.requests, interests: matching!.interests, converted: matching!.converted },
    };
  });

  /* ------------------------------- Utilisateurs ------------------------------- */

  const USER_SELECT = `
    SELECT u.id, u.email, u.first_name, u.last_name, u.whatsapp, u.country_code, u.status, u.email_verified_at, u.totp_enabled_at,
           u.last_login_at, u.created_at, c.name AS country_name,
           COALESCE((SELECT array_agg(role_code ORDER BY role_code) FROM user_roles WHERE user_id = u.id), '{}') AS roles,
           COALESCE((SELECT json_agg(json_build_object('id', f.id, 'name', f.name, 'position', a.position))
                       FROM local_office_agents a JOIN local_offices f ON f.id = a.office_id WHERE a.user_id = u.id AND a.is_active), '[]'::json) AS offices,
           (SELECT count(*)::int FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'PAID') AS paid_orders
      FROM users u JOIN countries c ON c.code = u.country_code`;
  const userDto = (u: Row) => ({
    id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name, whatsapp: u.whatsapp,
    country: { code: u.country_code, name: u.country_name }, status: u.status, emailVerified: u.email_verified_at !== null,
    twoFactorEnabled: u.totp_enabled_at !== null, lastLoginAt: u.last_login_at, createdAt: u.created_at,
    roles: u.roles, offices: u.offices, paidOrders: u.paid_orders,
  });

  r.get(
    '/admin/users',
    { permission: 'users.read', query: z.object({ q: z.string().trim().max(80).optional(), role: z.enum(ROLES).optional(), staff: z.enum(['1']).optional(), country: z.string().length(2).optional(), page: z.string().optional(), pageSize: z.string().optional() }) },
    async (ctx) => {
      const page = pageOf(ctx.query, 30, 100);
      const params = [like(ctx.query.q), ctx.query.role ?? null, ctx.query.country ?? null, ctx.query.staff ? true : null];
      const where = `
        WHERE ($1::text IS NULL OR u.email ILIKE $1 OR (u.first_name || ' ' || u.last_name) ILIKE $1 OR u.whatsapp ILIKE $1)
          AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_code = $2))
          AND ($3::text IS NULL OR u.country_code = $3)
          AND ($4::boolean IS NULL OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_code <> 'CUSTOMER'))`;
      const rows = await app.db.all(`${USER_SELECT} ${where} ORDER BY u.created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`, params);
      const total = await app.db.one(`SELECT count(*)::int AS n FROM users u ${where}`, params);
      return { items: rows.map(userDto), total: total!.n, page: page.page, pageSize: page.pageSize, roles: ROLES };
    },
  );

  /** Créer un compte du personnel. Le mot de passe provisoire est affiché une seule fois. */
  r.post(
    '/admin/users',
    {
      permission: 'users.manage',
      body: z.object({
        email: z.string().trim().toLowerCase().email(),
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        countryCode: z.string().length(2).toUpperCase(),
        whatsapp: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
        roles: z.array(z.enum(ROLES)).min(1),
      }),
    },
    async (ctx) => {
      const b = ctx.body;
      if (!ctx.can('roles.manage') && (b.roles as Role[]).some((x) => x !== 'CUSTOMER')) throw new DomainError('FORBIDDEN', { reason: 'roles.manage required' });
      await app.reference.country(b.countryCode);
      const temporaryPassword = randomToken(9) + 'a1';
      const hash = await hashPassword(temporaryPassword);
      const exists = await app.db.one(`SELECT 1 FROM users WHERE email = $1`, [b.email]);
      if (exists) throw new DomainError('AUTH_EMAIL_TAKEN');
      const id = await app.db.tx(async (tx) => {
        const u = await tx.one(
          `INSERT INTO users (email, password_hash, first_name, last_name, country_code, whatsapp, email_verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [b.email, hash, b.firstName, b.lastName, b.countryCode, b.whatsapp, ctx.now],
        );
        for (const role of new Set(['CUSTOMER', ...(b.roles as string[])])) {
          await tx.query(`INSERT INTO user_roles (user_id, role_code, granted_by) VALUES ($1, $2, $3)`, [u!.id, role, ctx.me().id]);
        }
        await audit(tx, ctx, { action: 'user.create', entityType: 'user', entityId: u!.id, after: { email: b.email, roles: b.roles } });
        return u!.id as string;
      });
      return Reply.created({ id, temporaryPassword });
    },
  );

  r.get('/admin/users/:id', { permission: 'users.read' }, async (ctx) => {
    const u = await app.db.one(`${USER_SELECT} WHERE u.id = $1`, [ctx.params.id]);
    if (!u) throw new DomainError('NOT_FOUND');
    return { user: userDto(u) };
  });

  r.patch('/admin/users/:id', { permission: 'users.manage', body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }) }, async (ctx) => {
    if (ctx.params.id === ctx.me().id) throw new DomainError('FORBIDDEN', { reason: 'cannot_change_own_status' });
    await app.db.tx(async (tx) => {
      const before = await tx.one(`SELECT status FROM users WHERE id = $1 FOR UPDATE`, [ctx.params.id]);
      if (!before) throw new DomainError('NOT_FOUND');
      await tx.query(`UPDATE users SET status = $2 WHERE id = $1`, [ctx.params.id, ctx.body.status]);
      if (ctx.body.status === 'SUSPENDED') await app.auth.revokeAllSessions(tx, ctx.params.id);
      await audit(tx, ctx, { action: 'user.status', entityType: 'user', entityId: ctx.params.id, before, after: { status: ctx.body.status } });
    });
    return { status: ctx.body.status };
  });

  /** Attribution des rôles : réservée au super-admin. */
  r.put('/admin/users/:id/roles', { permission: 'roles.manage', body: z.object({ roles: z.array(z.enum(ROLES)) }) }, async (ctx) => {
    const roles = [...new Set(['CUSTOMER', ...(ctx.body.roles as string[])])];
    await app.db.tx(async (tx) => {
      const before = await tx.all(`SELECT role_code FROM user_roles WHERE user_id = $1`, [ctx.params.id]);
      const user = await tx.one(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [ctx.params.id]);
      if (!user) throw new DomainError('NOT_FOUND');
      if (ctx.params.id === ctx.me().id && !roles.includes('SUPER_ADMIN')) throw new DomainError('FORBIDDEN', { reason: 'cannot_remove_own_super_admin' });
      await tx.query(`DELETE FROM user_roles WHERE user_id = $1`, [user.id]);
      for (const role of roles) await tx.query(`INSERT INTO user_roles (user_id, role_code, granted_by) VALUES ($1, $2, $3)`, [user.id, role, ctx.me().id]);
      // Les droits changent : les sessions ouvertes sont fermées.
      await app.auth.revokeAllSessions(tx, user.id, ctx.params.id === ctx.me().id ? ctx.me().sessionId : undefined);
      await audit(tx, ctx, { action: 'user.roles', entityType: 'user', entityId: user.id, before: { roles: before.map((x) => x.role_code) }, after: { roles } });
    });
    return { roles };
  });

  r.get('/admin/roles', { permission: ['roles.manage', 'users.read'] }, async () => {
    const rows = await app.db.all(
      `SELECT r.code, r.label, COALESCE((SELECT array_agg(permission_code ORDER BY permission_code) FROM role_permissions WHERE role_code = r.code), '{}') AS permissions,
              (SELECT count(*)::int FROM user_roles ur WHERE ur.role_code = r.code) AS users
         FROM roles r ORDER BY r.code`,
    );
    return { roles: rows.map((x) => ({ code: x.code, label: x.label, permissions: x.permissions, users: x.users })), permissions: PERMISSIONS };
  });

  r.put('/admin/roles/:code/permissions', { permission: 'roles.manage', body: z.object({ permissions: z.array(z.enum(PERMISSIONS)) }) }, async (ctx) => {
    if (ctx.params.code === 'SUPER_ADMIN' || ctx.params.code === 'CUSTOMER') throw new DomainError('FORBIDDEN', { reason: 'role_not_editable' });
    await app.db.tx(async (tx) => {
      const role = await tx.one(`SELECT code FROM roles WHERE code = $1`, [ctx.params.code]);
      if (!role) throw new DomainError('NOT_FOUND');
      const before = await tx.all(`SELECT permission_code FROM role_permissions WHERE role_code = $1`, [role.code]);
      await tx.query(`DELETE FROM role_permissions WHERE role_code = $1`, [role.code]);
      await tx.query(`INSERT INTO role_permissions (role_code, permission_code) SELECT $1, unnest($2::text[])`, [role.code, ctx.body.permissions]);
      await audit(tx, ctx, { action: 'role.permissions', entityType: 'role', entityId: role.code, before: { permissions: before.map((x) => x.permission_code) }, after: { permissions: ctx.body.permissions } });
    });
    app.rbac.invalidate();
    return { updated: true };
  });

  /* -------------------------------- Commandes -------------------------------- */

  r.get(
    '/admin/orders',
    { permission: 'orders.read', query: z.object({ q: z.string().trim().max(80).optional(), status: z.string().max(30).optional(), country: z.string().length(2).optional(), dealId: z.string().uuid().optional(), method: z.enum(['ONLINE', 'OFFICE']).optional(), page: z.string().optional(), pageSize: z.string().optional() }) },
    async (ctx) => {
      const page = pageOf(ctx.query, 30, 100);
      const ref = await app.reference.get();
      const params = [like(ctx.query.q), ctx.query.status ?? null, ctx.query.country ?? null, ctx.query.dealId ?? null, ctx.query.method ?? null];
      const where = `
        WHERE ($1::text IS NULL OR o.number ILIKE $1 OR u.email ILIKE $1 OR (u.first_name || ' ' || u.last_name) ILIKE $1)
          AND ($2::text IS NULL OR ${ORDER_BUCKET_SQL} = $2)
          AND ($3::text IS NULL OR o.country_code = $3)
          AND ($4::uuid IS NULL OR o.deal_id = $4)
          AND ($5::text IS NULL OR o.payment_method = $5)`;
      const rows = await app.db.all(
        `SELECT q.*, u.first_name, u.last_name, u.email FROM (${ORDER_SELECT}) q JOIN users u ON u.id = q.user_id
          WHERE q.id IN (SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN shipments s ON s.id = o.shipment_id ${where})
          ORDER BY q.created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
        params,
      );
      const total = await app.db.one(`SELECT count(*)::int AS n FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN shipments s ON s.id = o.shipment_id ${where}`, params);
      return {
        items: rows.map((o) => ({
          id: o.id, number: o.number, status: o.bucket, paymentStatus: o.payment_status, paymentMethod: o.payment_method,
          customer: { name: `${o.first_name} ${o.last_name}`, email: o.email }, country: o.country_code, productName: o.product_name,
          quantity: o.total_quantity, total: app.reference.moneySync(ref, o.total_amount, o.currency_code),
          logisticsStep: o.payment_status === 'PAID' ? effectiveOrderStep(o.shipment_step ?? 0, o.pickup_step) : 0,
          createdAt: o.created_at, paidAt: o.paid_at, expiresAt: o.expires_at,
        })),
        total: total!.n, page: page.page, pageSize: page.pageSize,
      };
    },
  );

  /** Détail interne d'une commande : c'est ici, et seulement ici, qu'apparaissent les composants du prix (§17). */
  r.get('/admin/orders/:id', { permission: 'orders.read' }, async (ctx) => {
    const o = await app.db.one(`SELECT q.*, u.first_name, u.last_name, u.email, u.whatsapp FROM (${ORDER_SELECT}) q JOIN users u ON u.id = q.user_id WHERE q.id = $1`, [ctx.params.id]);
    if (!o) throw new DomainError('NOT_FOUND');
    const ref = await app.reference.get();
    const money = (a: number) => app.reference.moneySync(ref, a, o.currency_code);
    const showMargin = ctx.can('margins.view');
    const [items, payments, refunds, reservation, invoices, tracking, auditRows, pickup] = await Promise.all([
      app.db.all(`SELECT * FROM order_items WHERE order_id = $1`, [o.id]),
      app.db.all(`SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at`, [o.id]),
      app.db.all(`SELECT * FROM refunds WHERE order_id = $1 ORDER BY created_at`, [o.id]),
      app.db.one(`SELECT r.*, f.name AS office_name, f.city FROM office_payments r JOIN local_offices f ON f.id = r.office_id WHERE r.order_id = $1`, [o.id]),
      app.db.all(`SELECT kind, number, issued_at FROM invoices WHERE order_id = $1 ORDER BY issued_at`, [o.id]),
      app.db.all(`SELECT step, status, note, is_override, override_reason, occurred_at FROM logistics_tracking WHERE shipment_id = $1 OR order_id = $2 ORDER BY created_at`, [o.shipment_id, o.id]),
      app.db.all(`SELECT a.action, a.reason, a.created_at, u.first_name || ' ' || u.last_name AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE a.entity_type = 'order' AND a.entity_id = $1 ORDER BY a.id DESC LIMIT 30`, [o.id]),
      o.pickup_office_id ? app.db.one(`SELECT * FROM local_offices WHERE id = $1`, [o.pickup_office_id]) : Promise.resolve(null),
    ]);
    return {
      order: {
        id: o.id, number: o.number, status: o.bucket, paymentStatus: o.payment_status, paymentMethod: o.payment_method,
        customer: { id: o.user_id, name: `${o.first_name} ${o.last_name}`, email: o.email, whatsapp: o.whatsapp },
        country: o.country_code, currency: o.currency_code, total: money(o.total_amount), quantity: o.total_quantity,
        deal: { id: o.deal_id, slug: o.deal_slug, title: o.deal_title ?? o.product_name }, productName: o.product_name,
        txRef: o.tx_ref, createdAt: o.created_at, expiresAt: o.expires_at, paidAt: o.paid_at, cancelReason: o.cancel_reason,
        shipment: o.shipment_id ? { id: o.shipment_id, reference: o.shipment_reference, step: o.shipment_step } : null,
        pickupStep: o.pickup_step, pickupOffice: pickup ? officeDto(pickup) : null, pickedUpAt: o.picked_up_at,
        logisticsStep: o.payment_status === 'PAID' ? effectiveOrderStep(o.shipment_step ?? 0, o.pickup_step) : 0,
      },
      items: items.map((i) => ({
        productName: i.product_name, variantLabel: i.variant_label, quantity: i.quantity, saleUnit: i.sale_unit,
        unitFinal: money(i.unit_final_amount), lineTotal: money(i.line_total_amount),
        priceBreakdown: {
          baseSource: { amount: i.base_source_amount, currency: i.base_source_currency },
          baseConverted: money(i.base_converted_amount),
          shippingSource: { amount: i.shipping_source_amount, currency: i.shipping_source_currency },
          shippingConverted: money(i.shipping_converted_amount),
          roundingAdjustment: money(i.rounding_adjustment),
          fxBufferBps: i.fx_buffer_bps, referenceCurrency: i.reference_currency, ratesUsed: i.rates_used, computedAt: i.computed_at,
          estimatedUnitMargin: showMargin && i.estimated_unit_margin !== null ? { ...money(Math.abs(i.estimated_unit_margin)), negative: i.estimated_unit_margin < 0 } : null,
        },
      })),
      payments: payments.map((p) => ({ id: p.id, provider: p.provider, providerTxId: p.provider_tx_id, status: p.status, amount: money(p.amount), channel: p.channel, rejectReason: p.reject_reason, createdAt: p.created_at })),
      refunds: refunds.map((x) => ({ id: x.id, status: x.status, amount: money(x.amount), reason: x.reason, providerRef: x.provider_ref, processedAt: x.processed_at })),
      reservation: reservation ? { id: reservation.id, number: reservation.number, status: reservation.status, office: `${reservation.office_name} — ${reservation.city}`, expiresAt: reservation.expires_at, paidAt: reservation.paid_at } : null,
      documents: invoices.map((i) => ({ kind: i.kind, number: i.number, url: `/api/v1/orders/${o.id}/documents/${String(i.kind).toLowerCase()}` })),
      tracking: tracking.map((t) => ({ step: t.step, status: t.status, note: t.note, isOverride: t.is_override, overrideReason: t.override_reason, occurredAt: t.occurred_at })),
      audit: auditRows.map((a) => ({ action: a.action, reason: a.reason, actor: a.actor, createdAt: a.created_at })),
    };
  });

  r.post('/admin/orders/:id/cancel', { permission: 'orders.manage', body: z.object({ reason: z.string().trim().min(3).max(300) }) }, async (ctx) => {
    await cancelOrder(app, ctx.params.id, ctx.body.reason, { userId: ctx.me().id, asStaff: true });
    await audit(app.db, ctx, { action: 'order.cancel', entityType: 'order', entityId: ctx.params.id, reason: ctx.body.reason });
    return { cancelled: true };
  });

  /* ------------------------ Paiements et remboursements ------------------------ */

  r.get(
    '/admin/payments',
    { permission: 'payments.read', query: z.object({ status: z.string().max(20).optional(), provider: z.enum(['FLUTTERWAVE', 'SANDBOX', 'OFFICE']).optional(), page: z.string().optional(), pageSize: z.string().optional() }) },
    async (ctx) => {
      const page = pageOf(ctx.query, 30, 100);
      const ref = await app.reference.get();
      const rows = await app.db.all(
        `SELECT p.*, o.number AS order_number, u.first_name || ' ' || u.last_name AS customer, f.name AS office_name
           FROM payments p JOIN orders o ON o.id = p.order_id JOIN users u ON u.id = o.user_id
           LEFT JOIN office_payments r ON r.order_id = o.id AND p.provider = 'OFFICE' LEFT JOIN local_offices f ON f.id = r.office_id
          WHERE ($1::text IS NULL OR p.status = $1) AND ($2::text IS NULL OR p.provider = $2)
          ORDER BY p.created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
        [ctx.query.status ?? null, ctx.query.provider ?? null],
      );
      const totals = await app.db.all(`SELECT status, count(*)::int AS n FROM payments GROUP BY status`);
      return {
        items: rows.map((p) => ({
          id: p.id, orderId: p.order_id, orderNumber: p.order_number, customer: p.customer, provider: p.provider, providerTxId: p.provider_tx_id,
          status: p.status, amount: app.reference.moneySync(ref, p.amount, p.currency_code), channel: p.channel, office: p.office_name,
          rejectReason: p.reject_reason, createdAt: p.created_at,
        })),
        counts: Object.fromEntries(totals.map((t) => [t.status, t.n])),
      };
    },
  );

  r.get('/admin/refunds', { permission: ['refunds.manage', 'payments.read'], query: z.object({ status: z.enum(['PENDING', 'DONE', 'FAILED']).optional() }) }, async (ctx) => {
    const ref = await app.reference.get();
    const rows = await app.db.all(
      `SELECT x.*, o.number AS order_number, o.payment_method, u.first_name || ' ' || u.last_name AS customer, u.whatsapp, p.provider, p.provider_tx_id
         FROM refunds x JOIN orders o ON o.id = x.order_id JOIN users u ON u.id = o.user_id LEFT JOIN payments p ON p.id = x.payment_id
        WHERE ($1::text IS NULL OR x.status = $1) ORDER BY (x.status = 'PENDING') DESC, x.created_at DESC LIMIT 200`,
      [ctx.query.status ?? null],
    );
    return {
      items: rows.map((x) => ({
        id: x.id, orderId: x.order_id, orderNumber: x.order_number, customer: x.customer, whatsapp: x.whatsapp, status: x.status,
        amount: app.reference.moneySync(ref, x.amount, x.currency_code), reason: x.reason, provider: x.provider, providerTxId: x.provider_tx_id,
        providerRef: x.provider_ref, createdAt: x.created_at, processedAt: x.processed_at,
      })),
    };
  });

  /** La finance confirme qu'un remboursement a été effectué (référence du virement ou de l'opération). */
  r.post('/admin/refunds/:id/complete', { permission: 'refunds.manage', body: z.object({ providerRef: z.string().trim().min(2).max(120) }) }, async (ctx) => {
    await app.db.tx(async (tx) => {
      const x = await tx.one(`SELECT * FROM refunds WHERE id = $1 FOR UPDATE`, [ctx.params.id]);
      if (!x) throw new DomainError('NOT_FOUND');
      if (x.status !== 'PENDING') throw new DomainError('CONFLICT', { status: x.status });
      await tx.query(`UPDATE refunds SET status = 'DONE', provider_ref = $2, processed_by = $3, processed_at = $4 WHERE id = $1`, [x.id, ctx.body.providerRef, ctx.me().id, ctx.now]);
      if (x.payment_id) await tx.query(`UPDATE payments SET status = 'REFUNDED' WHERE id = $1`, [x.payment_id]);
      const order = await tx.one(`UPDATE orders SET payment_status = 'REFUNDED' WHERE id = $1 AND payment_status = 'REFUND_PENDING' RETURNING user_id, number`, [x.order_id]);
      const owner = order ?? (await tx.one(`SELECT user_id, number FROM orders WHERE id = $1`, [x.order_id]));
      await notify(tx, { userId: owner!.user_id, type: 'REFUND_DONE', params: { number: owner!.number }, link: `/orders/${x.order_id}` });
      await audit(tx, ctx, { action: 'refund.complete', entityType: 'order', entityId: x.order_id, after: { refundId: x.id, amount: x.amount, currency: x.currency_code, providerRef: ctx.body.providerRef } });
    });
    return { status: 'DONE' };
  });

  /* ---------------------------- Bureaux et agents ---------------------------- */

  const officeSchema = z.object({
    countryCode: z.string().length(2).toUpperCase(),
    name: z.string().trim().min(2).max(120),
    city: z.string().trim().min(1).max(80),
    address: z.string().trim().min(2).max(300),
    phone: z.string().trim().max(30).nullish(),
    whatsapp: z.string().trim().max(30).nullish(),
    email: z.string().trim().email().nullish(),
    openingHours: z.record(z.string(), z.array(z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)]))).default({}),
    timezone: z.string().max(60).default('Africa/Douala'),
    latitude: z.number().min(-90).max(90).nullish(),
    longitude: z.number().min(-180).max(180).nullish(),
    acceptsPayments: z.boolean().default(true),
    isPickupPoint: z.boolean().default(true),
    isActive: z.boolean().default(true),
  });

  r.get('/admin/offices', { permission: ['offices.manage', 'orders.read'] }, async () => {
    const rows = await app.db.all(
      `SELECT f.*, c.name AS country_name,
              COALESCE((SELECT json_agg(json_build_object('userId', u.id, 'name', u.first_name || ' ' || u.last_name, 'email', u.email, 'position', a.position))
                          FROM local_office_agents a JOIN users u ON u.id = a.user_id WHERE a.office_id = f.id AND a.is_active), '[]'::json) AS agents
         FROM local_offices f JOIN countries c ON c.code = f.country_code ORDER BY c.name, f.city, f.name`,
    );
    return {
      offices: rows.map((o) => ({
        ...officeDto(o), countryCode: o.country_code, countryName: o.country_name, timezone: o.timezone,
        acceptsPayments: o.accepts_payments, isPickupPoint: o.is_pickup_point, isActive: o.is_active, agents: o.agents,
      })),
    };
  });

  const writeOffice = async (ctx: Ctx, id: string | null) => {
    const b = ctx.body as z.infer<typeof officeSchema>;
    await app.reference.country(b.countryCode);
    try {
      new Intl.DateTimeFormat('en', { timeZone: b.timezone });
    } catch {
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'timezone', message: 'Fuseau horaire inconnu' }] });
    }
    const values = [b.countryCode, b.name, b.city, b.address, b.phone ?? null, b.whatsapp ?? null, b.email ?? null, JSON.stringify(b.openingHours),
      b.timezone, b.latitude ?? null, b.longitude ?? null, b.acceptsPayments, b.isPickupPoint, b.isActive];
    return app.db.tx(async (tx) => {
      let officeId = id;
      if (id) {
        const res = await tx.query(
          `UPDATE local_offices SET country_code=$2, name=$3, city=$4, address=$5, phone=$6, whatsapp=$7, email=$8, opening_hours=$9, timezone=$10,
                  latitude=$11, longitude=$12, accepts_payments=$13, is_pickup_point=$14, is_active=$15 WHERE id=$1`,
          [id, ...values],
        );
        if (!res.rowCount) throw new DomainError('NOT_FOUND');
      } else {
        const row = await tx.one(
          `INSERT INTO local_offices (country_code, name, city, address, phone, whatsapp, email, opening_hours, timezone, latitude, longitude, accepts_payments, is_pickup_point, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
          values,
        );
        officeId = row!.id;
      }
      await audit(tx, ctx, { action: id ? 'office.update' : 'office.create', entityType: 'office', entityId: officeId, after: b });
      return officeId as string;
    });
  };
  r.post('/admin/offices', { permission: 'offices.manage', body: officeSchema }, async (ctx) => Reply.created({ id: await writeOffice(ctx, null) }));
  r.put('/admin/offices/:id', { permission: 'offices.manage', body: officeSchema }, async (ctx) => ({ id: await writeOffice(ctx, ctx.params.id) }));

  /** Rattacher un membre du personnel à un bureau. Lui donne le rôle correspondant. */
  r.put(
    '/admin/offices/:id/agents/:userId',
    { permission: 'offices.manage', body: z.object({ position: z.enum(['MANAGER', 'AGENT']) }) },
    async (ctx) => {
      await app.db.tx(async (tx) => {
        const office = await tx.one(`SELECT id FROM local_offices WHERE id = $1`, [ctx.params.id]);
        const user = await tx.one(`SELECT id FROM users WHERE id = $1`, [ctx.params.userId]);
        if (!office || !user) throw new DomainError('NOT_FOUND');
        await tx.query(
          `INSERT INTO local_office_agents (office_id, user_id, position) VALUES ($1, $2, $3)
           ON CONFLICT (office_id, user_id) DO UPDATE SET position = EXCLUDED.position, is_active = true`,
          [office.id, user.id, ctx.body.position],
        );
        await tx.query(`INSERT INTO user_roles (user_id, role_code, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
          user.id, ctx.body.position === 'MANAGER' ? 'OFFICE_MANAGER' : 'OFFICE_AGENT', ctx.me().id,
        ]);
        await app.auth.revokeAllSessions(tx, user.id);
        await audit(tx, ctx, { action: 'office.agent_add', entityType: 'office', entityId: office.id, after: { userId: user.id, position: ctx.body.position } });
      });
      return { updated: true };
    },
  );

  r.delete('/admin/offices/:id/agents/:userId', { permission: 'offices.manage' }, async (ctx) => {
    await app.db.tx(async (tx) => {
      await tx.query(`UPDATE local_office_agents SET is_active = false WHERE office_id = $1 AND user_id = $2`, [ctx.params.id, ctx.params.userId]);
      // Sans autre bureau, l'utilisateur perd ses rôles de bureau.
      const left = await tx.one(`SELECT count(*)::int AS n FROM local_office_agents WHERE user_id = $1 AND is_active`, [ctx.params.userId]);
      if (left!.n === 0) await tx.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_code IN ('OFFICE_AGENT', 'OFFICE_MANAGER')`, [ctx.params.userId]);
      await app.auth.revokeAllSessions(tx, ctx.params.userId);
      await audit(tx, ctx, { action: 'office.agent_remove', entityType: 'office', entityId: ctx.params.id, after: { userId: ctx.params.userId } });
    });
    return Reply.noContent();
  });

  /* ------------------------ Devises, taux, pays, langues ------------------------ */

  r.get('/admin/currencies', { permission: ['currencies.manage', 'pricing.manage', 'payments.read'] }, async () => {
    const ref = await app.reference.get();
    const history = await app.db.all(
      `SELECT e.currency_code, e.rate, e.as_of, e.source, u.first_name || ' ' || u.last_name AS author
         FROM exchange_rates e LEFT JOIN users u ON u.id = e.created_by ORDER BY e.as_of DESC LIMIT 60`,
    );
    const maxAge = (ref.settings['pricing.max_rate_age_hours'] as number) ?? 0;
    return {
      referenceCurrency: ref.settings['pricing.reference_currency'] ?? 'USD',
      fxBufferBps: ref.settings['pricing.fx_buffer_bps'] ?? 0,
      maxRateAgeHours: maxAge,
      currencies: Object.values(ref.currencies)
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((c) => {
          const rate = ref.rates[c.code];
          const ageHours = rate ? (Date.now() - new Date(rate.asOf).getTime()) / 3_600_000 : null;
          return {
            code: c.code, name: c.name, symbol: c.symbol, decimals: c.decimals, roundingStep: c.roundingStep, isActive: c.isActive,
            rate: rate ?? null,
            stale: maxAge > 0 && ageHours !== null && ageHours > maxAge,
          };
        }),
      history: history.map((h) => ({ currency: h.currency_code, rate: String(h.rate).replace(/\.?0+$/, ''), asOf: h.as_of, source: h.source, author: h.author })),
    };
  });

  /** Saisie d'un taux : unités de la devise pour 1 unité de la devise de référence. Historisé, jamais écrasé. */
  r.post(
    '/admin/exchange-rates',
    {
      permission: 'currencies.manage',
      body: z.object({ rates: z.array(z.object({ currency: z.string().length(3).toUpperCase(), rate: z.string().regex(/^\d+(\.\d{1,8})?$/), source: z.string().trim().min(2).max(120), asOf: z.string().datetime().optional() })).min(1).max(60) }),
    },
    async (ctx) => {
      const ref = await app.reference.get();
      await app.db.tx(async (tx) => {
        for (const x of ctx.body.rates as { currency: string; rate: string; source: string; asOf?: string }[]) {
          if (!ref.currencies[x.currency]) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'currency', message: `Devise inconnue : ${x.currency}` }] });
          if (Number(x.rate) <= 0) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'rate', message: 'Le taux doit être positif' }] });
          await tx.query(`INSERT INTO exchange_rates (currency_code, rate, as_of, source, created_by) VALUES ($1, $2, $3, $4, $5)`, [
            x.currency, x.rate, x.asOf ? new Date(x.asOf) : ctx.now, x.source, ctx.me().id,
          ]);
          await audit(tx, ctx, { action: 'exchange_rate.set', entityType: 'currency', entityId: x.currency, before: ref.rates[x.currency] ?? null, after: { rate: x.rate, source: x.source } });
        }
      });
      app.reference.invalidate();
      return Reply.created({ saved: ctx.body.rates.length });
    },
  );

  r.patch('/admin/currencies/:code', { permission: 'currencies.manage', body: z.object({ roundingStep: z.number().int().min(1).max(10_000_000).optional(), isActive: z.boolean().optional() }) }, async (ctx) => {
    const res = await app.db.query(`UPDATE currencies SET rounding_step = COALESCE($2, rounding_step), is_active = COALESCE($3, is_active) WHERE code = $1`, [
      ctx.params.code.toUpperCase(), ctx.body.roundingStep ?? null, ctx.body.isActive ?? null,
    ]);
    if (!res.rowCount) throw new DomainError('NOT_FOUND');
    await audit(app.db, ctx, { action: 'currency.update', entityType: 'currency', entityId: ctx.params.code, after: ctx.body });
    app.reference.invalidate();
    return { updated: true };
  });

  r.get('/admin/countries', { permission: ['settings.manage', 'currencies.manage', 'pricing.manage'] }, async () => {
    const rows = await app.db.all(
      `SELECT c.*, (SELECT count(*)::int FROM users u WHERE u.country_code = c.code) AS users,
              (SELECT count(*)::int FROM local_offices f WHERE f.country_code = c.code AND f.is_active) AS offices FROM countries c ORDER BY c.name`,
    );
    return { countries: rows.map((c) => ({ code: c.code, name: c.name, currency: c.currency_code, phonePrefix: c.phone_prefix, defaultLanguage: c.default_language, fxBufferBps: c.fx_buffer_bps, isActive: c.is_active, users: c.users, offices: c.offices })) };
  });

  r.patch('/admin/countries/:code', { permission: 'settings.manage', body: z.object({ isActive: z.boolean().optional(), fxBufferBps: z.number().int().min(0).max(5000).nullable().optional(), defaultLanguage: z.string().min(2).max(5).optional() }) }, async (ctx) => {
    const b = ctx.body;
    const res = await app.db.query(
      `UPDATE countries SET is_active = COALESCE($2, is_active), fx_buffer_bps = CASE WHEN $3::boolean THEN $4 ELSE fx_buffer_bps END,
              default_language = COALESCE($5, default_language) WHERE code = $1`,
      [ctx.params.code.toUpperCase(), b.isActive ?? null, b.fxBufferBps !== undefined, b.fxBufferBps ?? null, b.defaultLanguage ?? null],
    );
    if (!res.rowCount) throw new DomainError('NOT_FOUND');
    await audit(app.db, ctx, { action: 'country.update', entityType: 'country', entityId: ctx.params.code, after: b });
    app.reference.invalidate();
    return { updated: true };
  });

  /** Langues : activer une langue et saisir ses textes ne demande aucune modification du code (§34). */
  r.get('/admin/languages', { permission: ['content.manage', 'settings.manage'] }, async () => {
    const rows = await app.db.all(
      `SELECT l.*, (SELECT count(*)::int FROM translations t WHERE t.language_code = l.code) AS translated,
              (SELECT count(*)::int FROM translations t WHERE t.language_code = 'fr') AS total FROM languages l ORDER BY l.sort_order`,
    );
    return { languages: rows.map((l) => ({ code: l.code, name: l.name, nativeName: l.native_name, isRtl: l.is_rtl, isActive: l.is_active, translated: l.translated, total: l.total })) };
  });

  r.patch('/admin/languages/:code', { permission: 'settings.manage', body: z.object({ isActive: z.boolean() }) }, async (ctx) => {
    if (ctx.params.code === 'fr' && !ctx.body.isActive) throw new DomainError('FORBIDDEN', { reason: 'french_is_the_fallback_language' });
    const res = await app.db.query(`UPDATE languages SET is_active = $2 WHERE code = $1`, [ctx.params.code, ctx.body.isActive]);
    if (!res.rowCount) throw new DomainError('NOT_FOUND');
    await audit(app.db, ctx, { action: 'language.update', entityType: 'language', entityId: ctx.params.code, after: ctx.body });
    app.reference.invalidate();
    return { updated: true };
  });

  r.get('/admin/translations/:lang', { permission: ['content.manage', 'settings.manage'] }, async (ctx) => {
    const rows = await app.db.all(
      `SELECT f.key, f.value AS source, t.value FROM translations f
         LEFT JOIN translations t ON t.key = f.key AND t.language_code = $1 WHERE f.language_code = 'fr' ORDER BY f.key`,
      [ctx.params.lang],
    );
    return { language: ctx.params.lang, entries: rows.map((x) => ({ key: x.key, source: x.source, value: x.value })) };
  });

  r.put('/admin/translations/:lang', { permission: 'content.manage', body: z.object({ entries: z.record(z.string().max(600), z.string().max(2000)) }) }, async (ctx) => {
    const lang = await app.db.one(`SELECT code FROM languages WHERE code = $1`, [ctx.params.lang]);
    if (!lang) throw new DomainError('NOT_FOUND');
    const entries = Object.entries(ctx.body.entries as Record<string, string>);
    await app.db.tx(async (tx) => {
      for (const [key, value] of entries) {
        if (value.trim() === '' && lang.code !== 'fr') await tx.query(`DELETE FROM translations WHERE language_code = $1 AND key = $2`, [lang.code, key]);
        else await tx.query(
          `INSERT INTO translations (language_code, key, value) VALUES ($1, $2, $3)
           ON CONFLICT (language_code, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [lang.code, key, value],
        );
      }
      await audit(tx, ctx, { action: 'translations.update', entityType: 'language', entityId: lang.code, after: { keys: entries.length } });
    });
    app.reference.invalidate(); // le nombre de textes traduits de la langue vient de changer
    return { saved: entries.length };
  });

  /* --------------------------------- Réglages --------------------------------- */

  const SETTINGS: Record<string, z.ZodTypeAny> = {
    'pricing.reference_currency': z.string().length(3),
    'pricing.fx_buffer_bps': z.number().int().min(0).max(5000),
    'pricing.max_rate_age_hours': z.number().int().min(0).max(24 * 365),
    'pricing.pegged_currencies': z.array(z.array(z.string().length(3)).min(2).max(10)).max(10),
    'orders.online_hold_minutes': z.number().int().min(5).max(24 * 60),
    'orders.office_hold_hours': z.number().int().min(1).max(24 * 30),
    'orders.require_verified_email': z.boolean(),
    'matching.alert_threshold': z.number().int().min(1).max(1_000_000),
    'deals.ending_soon_hours': z.number().int().min(1).max(24 * 14),
    'reporting.currency': z.string().length(3),
    'company.legal_name': z.string().trim().min(1).max(120),
    'company.legal_form': z.string().trim().max(120),
    'company.capital': z.string().trim().max(80),
    'company.address': z.string().trim().max(300),
    'company.rccm': z.string().trim().max(80),
    'company.tax_id': z.string().trim().max(80),
    'company.phone': z.string().trim().max(60),
    'company.email': z.string().trim().max(120),
    'company.publication_director': z.string().trim().max(120),
    'company.host': z.string().trim().max(300),
    'support.email': z.union([z.literal(''), z.string().trim().email().max(120)]),
    'support.phone': z.string().trim().max(40),
    'support.whatsapp': z.string().trim().regex(/^(\+?[0-9 ().-]{6,30})?$/, 'Numéro WhatsApp invalide'),
  };

  r.get('/admin/settings', { permission: 'settings.manage' }, async () => {
    const ref = await app.reference.get();
    const office = await app.db.one(`SELECT * FROM payment_methods WHERE code = 'OFFICE'`);
    return {
      settings: Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, ref.settings[k] ?? null])),
      officePayment: { isActive: office!.is_active, minTotalAmount: office!.min_total_amount, minTotalCurrency: office!.min_total_currency },
    };
  });

  r.put('/admin/settings', { permission: 'settings.manage', body: z.object({ settings: z.record(z.string(), z.any()) }) }, async (ctx) => {
    const ref = await app.reference.get();
    const entries = Object.entries(ctx.body.settings as Record<string, unknown>);
    await app.db.tx(async (tx) => {
      for (const [key, value] of entries) {
        const schema = SETTINGS[key];
        if (!schema) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: key, message: 'Réglage inconnu' }] });
        const parsed = schema.safeParse(value);
        if (!parsed.success) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: key, message: parsed.error.issues[0].message }] });
        if (key.endsWith('currency') && !ref.currencies[String(value)]) throw new DomainError('VALIDATION_FAILED', { fields: [{ path: key, message: 'Devise inconnue' }] });
        await tx.query(
          `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
          [key, JSON.stringify(parsed.data), ctx.me().id, ctx.now],
        );
        await audit(tx, ctx, { action: 'setting.update', entityType: 'setting', entityId: key, before: { value: ref.settings[key] ?? null }, after: { value: parsed.data } });
      }
    });
    app.reference.invalidate();
    return { saved: entries.length };
  });

  /** Seuil du paiement en bureau (500 000 FCFA par défaut). */
  r.put(
    '/admin/settings/office-payment',
    { permission: 'settings.manage', body: z.object({ isActive: z.boolean(), minTotalAmount: z.number().int().min(0).nullable(), minTotalCurrency: z.string().length(3).toUpperCase().nullable() }) },
    async (ctx) => {
      const b = ctx.body;
      if ((b.minTotalAmount === null) !== (b.minTotalCurrency === null)) throw new DomainError('VALIDATION_FAILED', { reason: 'amount_and_currency_together' });
      const before = await app.db.one(`SELECT is_active, min_total_amount, min_total_currency FROM payment_methods WHERE code = 'OFFICE'`);
      await app.db.query(`UPDATE payment_methods SET is_active = $1, min_total_amount = $2, min_total_currency = $3 WHERE code = 'OFFICE'`, [b.isActive, b.minTotalAmount, b.minTotalCurrency]);
      await audit(app.db, ctx, { action: 'setting.office_payment', entityType: 'payment_method', entityId: 'OFFICE', before, after: b });
      app.reference.invalidate();
      return { updated: true };
    },
  );

  /* ------------------------------ Journal d'audit ------------------------------ */

  r.get(
    '/admin/audit-logs',
    { permission: 'audit.read', query: z.object({ action: z.string().max(60).optional(), entityType: z.string().max(40).optional(), entityId: z.string().max(60).optional(), actorId: z.string().uuid().optional(), page: z.string().optional(), pageSize: z.string().optional() }) },
    async (ctx) => {
      const page = pageOf(ctx.query, 50, 200);
      const rows = await app.db.all(
        `SELECT a.*, host(a.ip) AS ip_text, u.first_name || ' ' || u.last_name AS actor_name, u.email AS actor_email
           FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
          WHERE ($1::text IS NULL OR a.action LIKE $1 || '%') AND ($2::text IS NULL OR a.entity_type = $2)
            AND ($3::text IS NULL OR a.entity_id = $3) AND ($4::uuid IS NULL OR a.actor_id = $4)
          ORDER BY a.id DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
        [ctx.query.action ?? null, ctx.query.entityType ?? null, ctx.query.entityId ?? null, ctx.query.actorId ?? null],
      );
      return {
        items: rows.map((a) => ({
          id: a.id, action: a.action, entityType: a.entity_type, entityId: a.entity_id, before: a.before, after: a.after, reason: a.reason,
          actor: a.actor_id ? { id: a.actor_id, name: a.actor_name, email: a.actor_email, roles: a.actor_roles } : null, ip: a.ip_text, createdAt: a.created_at,
        })),
        page: page.page, pageSize: page.pageSize,
      };
    },
  );

  /** Boîte d'envoi : messages émis par la plateforme (utile tant qu'aucun fournisseur d'email n'est branché). */
  r.get('/admin/outbox', { permission: 'audit.read' }, async () => {
    const rows = await app.db.all(
      `SELECT o.channel, o.status, o.attempts, o.last_error, o.sent_at, n.type, n.params, n.link, n.created_at, u.email
         FROM notification_outbox o JOIN notifications n ON n.id = o.notification_id JOIN users u ON u.id = n.user_id
        ORDER BY n.created_at DESC LIMIT 100`,
    );
    return { items: rows.map((x) => ({ channel: x.channel, status: x.status, attempts: x.attempts, lastError: x.last_error, sentAt: x.sent_at, type: x.type, params: x.params, link: x.link, to: x.email, createdAt: x.created_at })) };
  });
}
