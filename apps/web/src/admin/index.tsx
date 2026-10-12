import { ReactNode, useEffect, useState } from 'react';
import { BackButton, Icon, useApi } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { Link, RouteDef, matchRoute, navigate, useLocation } from '../lib/router';
import { CategoriesPage, ProductEditPage, ProductsPage } from './catalog';
import { AnalyticsPage, DashboardPage } from './dashboard';
import { DealAdminPage, DealsAdminPage } from './deals';
import { ShipmentPage, ShipmentsPage } from './logistics';
import { MatchingAdminPage, OfficesPage, UsersPage } from './people';
import { OrderAdminPage, OrdersAdminPage, PaymentsAdminPage } from './sales';
import { AuditPage, CurrenciesPage, LanguagesPage, SettingsPage } from './system';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** Une de ces permissions suffit pour voir l'entrée. */
  any: string[];
  group: string;
  badge?: number;
}

/** Bandeau affiché tant que la double authentification du personnel n'est pas active. */
function TwoFactorGate({ children }: { children: ReactNode }) {
  const t = useT();
  const { user } = useAuth();
  const probe = useApi<any>('/me');
  if (user?.twoFactorRequired && probe.data && !probe.data.mfa) {
    return (
      <div className="wrap wrap--form page">
        <h1 className="h1">{t('Double authentification requise')}</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {user.twoFactorEnabled
            ? t('Reconnectez-vous avec votre code à 6 chiffres pour accéder au back-office.')
            : t('Votre rôle donne accès à des données sensibles. Activez la double authentification pour ouvrir le back-office.')}
        </p>
        <Link to="/profile?tab=security" className="btn btn--primary" style={{ marginTop: 20 }}>{t('Ouvrir les réglages de sécurité')}</Link>
      </div>
    );
  }
  return <>{children}</>;
}

export default function AdminApp() {
  const t = useT();
  const { user, can, logout } = useAuth();
  const { path } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const dash = useApi<any>(can('dashboard.view') ? '/admin/dashboard' : null);
  const c = dash.data?.counts;

  const items: NavItem[] = [
    { to: '/admin', label: t('Tableau de bord'), icon: 'chart', any: ['dashboard.view'], group: '' },
    { to: '/admin/deals', label: t('Campagnes'), icon: 'tag', any: ['deals.manage', 'catalog.read'], group: t('Catalogue'), badge: c?.dealsToDecide },
    { to: '/admin/products', label: t('Produits'), icon: 'box', any: ['catalog.read', 'catalog.manage'], group: t('Catalogue') },
    { to: '/admin/categories', label: t('Catégories'), icon: 'list', any: ['catalog.read', 'catalog.manage'], group: t('Catalogue') },
    { to: '/admin/matching', label: t('Matching'), icon: 'users', any: ['matching.moderate', 'matching.convert'], group: t('Catalogue'), badge: (c?.matchingToReview ?? 0) + (c?.matchingHot ?? 0) },
    { to: '/admin/orders', label: t('Commandes'), icon: 'file', any: ['orders.read'], group: t('Ventes') },
    { to: '/admin/payments', label: t('Paiements'), icon: 'card', any: ['payments.read'], group: t('Ventes'), badge: c?.refundsPending },
    { to: '/admin/logistics', label: t('Logistique'), icon: 'ship', any: ['logistics.read'], group: t('Ventes') },
    { to: '/admin/offices', label: t('Bureaux locaux'), icon: 'store', any: ['offices.manage'], group: t('Ventes') },
    { to: '/admin/analytics', label: t('Statistiques'), icon: 'chart', any: ['analytics.view'], group: t('Pilotage') },
    { to: '/admin/users', label: t('Utilisateurs'), icon: 'user', any: ['users.read'], group: t('Pilotage') },
    { to: '/admin/currencies', label: t('Devises et pays'), icon: 'coins', any: ['currencies.manage', 'pricing.manage'], group: t('Pilotage') },
    { to: '/admin/languages', label: t('Langues'), icon: 'globe', any: ['content.manage', 'settings.manage'], group: t('Pilotage') },
    { to: '/admin/settings', label: t('Réglages'), icon: 'settings', any: ['settings.manage'], group: t('Pilotage') },
    { to: '/admin/audit', label: t('Journal d’audit'), icon: 'shield', any: ['audit.read'], group: t('Pilotage') },
  ];
  const visible = items.filter((i) => i.any.some(can));

  const routes: RouteDef[] = [
    { pattern: '/admin', render: () => (can('dashboard.view') ? <DashboardPage /> : null) },
    { pattern: '/admin/deals', render: () => <DealsAdminPage /> },
    { pattern: '/admin/deals/:id', render: (p) => <DealAdminPage id={p.id} /> },
    { pattern: '/admin/products', render: () => <ProductsPage /> },
    { pattern: '/admin/products/:id', render: (p) => <ProductEditPage key={p.id} id={p.id} /> },
    { pattern: '/admin/categories', render: () => <CategoriesPage /> },
    { pattern: '/admin/matching', render: () => <MatchingAdminPage /> },
    { pattern: '/admin/orders', render: () => <OrdersAdminPage /> },
    { pattern: '/admin/orders/:id', render: (p) => <OrderAdminPage id={p.id} /> },
    { pattern: '/admin/payments', render: () => <PaymentsAdminPage /> },
    { pattern: '/admin/logistics', render: () => <ShipmentsPage /> },
    { pattern: '/admin/logistics/:id', render: (p) => <ShipmentPage id={p.id} /> },
    { pattern: '/admin/offices', render: () => <OfficesPage /> },
    { pattern: '/admin/analytics', render: () => <AnalyticsPage /> },
    { pattern: '/admin/users', render: () => <UsersPage /> },
    { pattern: '/admin/currencies', render: () => <CurrenciesPage /> },
    { pattern: '/admin/languages', render: () => <LanguagesPage /> },
    { pattern: '/admin/settings', render: () => <SettingsPage /> },
    { pattern: '/admin/audit', render: () => <AuditPage /> },
  ];

  // Sans accès au tableau de bord, on ouvre la première rubrique autorisée.
  useEffect(() => {
    if (path === '/admin' && !can('dashboard.view') && visible[0]) navigate(visible[0].to, { replace: true });
  }, [path, visible.length]);

  if (!user) return null;
  if (visible.length === 0) {
    return (
      <div className="wrap wrap--form page">
        <h1 className="h1">{t('Accès réservé au personnel')}</h1>
        <p className="muted" style={{ marginTop: 8 }}>{t('Votre compte n’a pas accès au back-office.')}</p>
        <Link to="/" className="btn btn--navy" style={{ marginTop: 20 }}>{t('Retour au site')}</Link>
      </div>
    );
  }

  let lastGroup = '';
  return (
    <TwoFactorGate>
      <div className="bo">
        <aside className={`bo__side ${open ? 'is-open' : ''}`}>
          <div className="row row--between">
            <Link to="/admin" className="logo logo--light">GROUP<b>DEALS</b></Link>
            <button className="iconbtn bo__menu" style={{ color: '#fff' }} onClick={() => setOpen(false)} aria-label={t('Fermer le menu')}><Icon name="x" /></button>
          </div>
          <nav className="bo__nav" aria-label={t('Back-office')}>
            {visible.map((i) => {
              const head = i.group && i.group !== lastGroup ? <div className="bo__group" key={`g-${i.group}`}>{i.group}</div> : null;
              lastGroup = i.group;
              return (
                <span key={i.to} style={{ display: 'contents' }}>
                  {head}
                  <Link to={i.to} nav exact={i.to === '/admin'}>
                    <Icon name={i.icon} size={18} />
                    {i.label}
                    {i.badge ? <span className="dot num">{i.badge}</span> : null}
                  </Link>
                </span>
              );
            })}
            <div className="bo__group">{user.firstName} {user.lastName}</div>
            {can('office.payments.record') && <Link to="/agent"><Icon name="store" size={18} />{t('Espace bureau')}</Link>}
            <Link to="/"><Icon name="home" size={18} />{t('Retour au site')}</Link>
            <a href="/" onClick={async (e) => { e.preventDefault(); await logout(); navigate('/'); }}><Icon name="logout" size={18} />{t('Se déconnecter')}</a>
          </nav>
        </aside>
        <div style={{ minWidth: 0 }}>
          <div className="bo__top bo__menu">
            <button className="iconbtn" onClick={() => setOpen(true)} aria-label={t('Ouvrir le menu')}><Icon name="menu" /></button>
            <span className="logo">GROUP<b>DEALS</b></span>
          </div>
          <main className="bo__main">
            <div className="backbar"><BackButton /></div>
            {matchRoute(routes, path) ?? <p className="muted">{t('Cette page n’existe pas')}</p>}
          </main>
        </div>
      </div>
    </TwoFactorGate>
  );
}
