import { ReactNode, Suspense, lazy, useEffect, useState } from 'react';
import { BackButton, Icon, Loading, ToastProvider, useApi, useChooseLanguage } from './components/ui';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, resetDemo } from './demo/backend';
import { post } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { DEMO, asset } from './lib/env';
import { I18nProvider, useI18n, useT } from './lib/i18n';
import { Link, RouteDef, matchRoute, navigate, resetTrail, useLocation } from './lib/router';
import { NotificationsPage, ProfilePage, VerifyEmailPage } from './pages/account';
import { CheckoutPage, DealPage, DealsPage } from './pages/deals';
import { HomePage } from './pages/home';
import { MatchingPage } from './pages/matching';
import { OrderPage, OrdersPage, PaymentReturnPage, SandboxPayPage } from './pages/orders';
import { CountryPartnersPage, PartnersPage } from './pages/partners';
import { LegalPageView } from './pages/legal';
import { SupportPage } from './pages/support';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, WelcomePage } from './pages/welcome';

// Le back-office et l'espace agent ne sont chargés que pour le personnel.
const AdminApp = lazy(() => import('./admin/index'));
const AgentApp = lazy(() => import('./agent/index'));

/** Redirige vers la connexion si la page demande un compte. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { full } = useLocation();
  useEffect(() => {
    if (!user) navigate(`/login?next=${encodeURIComponent(full)}`, { replace: true });
  }, [user, full]);
  return user ? <>{children}</> : null;
}

/** Accueil : l'écran d'inscription pour un visiteur, les offres pour un membre connecté. */
function Root() {
  const { user } = useAuth();
  return user ? <HomePage /> : <WelcomePage />;
}

/** Écrans plein cadre, sans en-tête ni barre d'onglets. */
const BARE = ['/login', '/register', '/forgot-password', '/reset-password'];

const routes: RouteDef[] = [
  { pattern: '/', render: () => <Root /> },
  { pattern: '/deals', render: () => <DealsPage /> },
  { pattern: '/deals/:slug', render: (p) => <DealPage slug={p.slug} /> },
  { pattern: '/checkout/:slug', render: (p) => <RequireAuth><CheckoutPage slug={p.slug} /></RequireAuth> },
  { pattern: '/orders', render: () => <RequireAuth><OrdersPage /></RequireAuth> },
  { pattern: '/orders/:id', render: (p) => <RequireAuth><OrderPage id={p.id} /></RequireAuth> },
  { pattern: '/payment/return', render: () => <RequireAuth><PaymentReturnPage /></RequireAuth> },
  { pattern: '/sandbox/pay', render: () => <SandboxPayPage /> },
  { pattern: '/matching', render: () => <MatchingPage /> },
  { pattern: '/partners', render: () => <PartnersPage /> },
  { pattern: '/support', render: () => <SupportPage /> },
  { pattern: '/legal/:page', render: (p) => <LegalPageView key={p.page} page={p.page} /> },
  { pattern: '/partners/:country', render: (p) => <CountryPartnersPage key={p.country} country={p.country} /> },
  { pattern: '/profile', render: () => <RequireAuth><ProfilePage /></RequireAuth> },
  { pattern: '/notifications', render: () => <RequireAuth><NotificationsPage /></RequireAuth> },
  { pattern: '/login', render: () => <LoginPage /> },
  { pattern: '/register', render: () => <WelcomePage /> },
  { pattern: '/forgot-password', render: () => <ForgotPasswordPage /> },
  { pattern: '/reset-password', render: () => <ResetPasswordPage /> },
  { pattern: '/verify-email', render: () => <VerifyEmailPage /> },
];

function Header() {
  const t = useT();
  const { user, unread, countries, country, setVisitorCountry } = useAuth();
  const { languages, lang } = useI18n();
  const chooseLanguage = useChooseLanguage();
  const { search, path } = useLocation();
  const [q, setQ] = useState(search.get('q') ?? '');
  useEffect(() => setQ(path === '/deals' ? (search.get('q') ?? '') : ''), [path, search.get('q')]);

  const searchForm = (
    <form
      className="header__search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        navigate(`/deals${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
      }}
    >
      <Icon name="search" size={18} />
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Rechercher un produit')} aria-label={t('Rechercher un produit')} />
    </form>
  );
  const prefsControls = (
    <>
      {!user && countries.length > 0 && (
        <select className="select select--s" value={country} onChange={(e) => setVisitorCountry(e.target.value)} aria-label={t('Votre pays')}>
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      )}
      {languages.length > 1 && (
        <select className="select select--s" value={lang} onChange={(e) => chooseLanguage(e.target.value)} aria-label={t('Langue')}>
          {languages.map((l) => <option key={l.code} value={l.code}>{l.nativeName}</option>)}
        </select>
      )}
    </>
  );

  return (
    <>
      <header className="header">
        <div className="wrap header__in">
          <Link to="/" className="logo" aria-label="GROUPDEALS"><img src={asset('/welcome/mark.svg')} width="30" height="30" alt="" />GROUP<b>DEALS</b></Link>
          <nav className="header__nav" aria-label={t('Navigation principale')}>
            <Link to="/deals" nav>{t('Deals')}</Link>
            <Link to="/matching" nav>{t('Matching')}</Link>
            {user && <Link to="/orders" nav>{t('Commandes')}</Link>}
            <Link to="/partners" nav>{t('Partenaires locaux')}</Link>
          </nav>
          <div className="header__wide">{searchForm}</div>
          <div className="header__wide header__prefs">{prefsControls}</div>
          <div className="header__actions">
            {user ? (
              <>
                <Link to="/notifications" className="iconbtn" aria-label={unread ? t('Notifications, {n} non lues', { n: unread }) : t('Notifications')}>
                  <Icon name="bell" />
                  {unread > 0 && <span className="dot num">{unread > 99 ? '99+' : unread}</span>}
                </Link>
                <Link to="/profile" className="iconbtn" aria-label={t('Profil')}>
                  <span className="avatar">{user.firstName[0]}{user.lastName[0]}</span>
                </Link>
              </>
            ) : (
              <Link to="/login" className="btn btn--navy btn--s">{t('Connexion')}</Link>
            )}
          </div>
        </div>
      </header>
      {/* Sur mobile, la recherche et le choix du pays passent sous l'en-tête. */}
      <div className="subheader">
        <div className="wrap">
          {searchForm}
          <div className="subheader__prefs">{prefsControls}</div>
        </div>
      </div>
    </>
  );
}

/** Navigation principale sur mobile : Accueil | Deals | Matching | Commandes | Partenaires | Profil (§7, plus l'annuaire des partenaires). */
function TabBar() {
  const t = useT();
  const { user } = useAuth();
  const items: [string, string, string][] = [
    ['/', 'home', t('Accueil')],
    ['/deals', 'tag', t('Deals')],
    ['/matching', 'users', t('Matching')],
    ['/orders', 'box', t('Commandes')],
    ['/partners', 'pin', t('Partenaires')],
    [user ? '/profile' : '/login', 'user', t('Profil')],
  ];
  return (
    <nav className="tabbar" aria-label={t('Navigation principale')}>
      {items.map(([to, icon, label]) => (
        <Link key={icon} to={to} nav>
          <Icon name={icon} size={22} />
          {label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Site de pré-ouverture (NODE_ENV=staging) avec le paiement simulé : chaque visiteur est prévenu
 * qu'aucun paiement réel n'est encaissé, pour qu'aucune commande « payée » ne soit prise pour vraie.
 */
function PreviewBar() {
  const t = useT();
  const cfg = useApi<{ environment?: string; paymentProvider?: string }>(DEMO ? null : '/config').data;
  if (!cfg || cfg.environment !== 'staging' || cfg.paymentProvider !== 'sandbox') return null;
  return (
    <div className="previewbar" role="note">
      <b>{t('Pré-ouverture')}</b> {t('Les paiements sont simulés : aucune somme n’est prélevée et aucune commande n’est expédiée.')}
    </div>
  );
}

function Footer() {
  const t = useT();
  const support = useApi<{ support?: { email: string; phone: string } }>('/config').data?.support;
  return (
    <footer className="footer">
      <div className="wrap footer__grid">
        <div>
          <div className="logo logo--light"><img src={asset('/welcome/mark.svg')} width="30" height="30" alt="" />GROUP<b>DEALS</b></div>
          <p style={{ marginTop: 12, maxWidth: '36ch' }}>{t('Importons ensemble et obtenons les prix usines.')}</p>
          <p className="small" style={{ marginTop: 8 }}>{t('Une plateforme GROUPIREX.')}</p>
        </div>
        <div className="stack-s">
          <div className="strong" style={{ color: 'var(--white)' }}>{t('Acheter')}</div>
          <div><Link to="/deals">{t('Offres en cours')}</Link></div>
          <div><Link to="/deals?status=upcoming">{t('Offres à venir')}</Link></div>
          <div><Link to="/matching">{t('Matching')}</Link></div>
          <div><Link to="/partners">{t('Partenaires locaux')}</Link></div>
        </div>
        <div className="stack-s">
          <div className="strong" style={{ color: 'var(--white)' }}>{t('Mon compte')}</div>
          <div><Link to="/orders">{t('Mes commandes')}</Link></div>
          <div><Link to="/profile">{t('Profil')}</Link></div>
          <div><Link to="/notifications">{t('Notifications')}</Link></div>
        </div>
        <div className="stack-s">
          <div className="strong" style={{ color: 'var(--white)' }}>{t('Besoin d’aide ?')}</div>
          {support?.phone && <div><a href={`tel:+${support.phone.replace(/\D/g, '')}`} className="strong">{support.phone}</a></div>}
          {support?.email && <div><a href={`mailto:${support.email}`}>{support.email}</a></div>}
          <div><Link to="/support">{t('Support et contact')}</Link></div>
        </div>
      </div>
      <nav className="wrap footer__legal" aria-label={t('Informations légales')}>
        <Link to="/support">{t('Support et contact')}</Link>
        <Link to="/legal/mentions-legales">{t('Mentions légales')}</Link>
        <Link to="/legal/conditions">{t('Conditions générales')}</Link>
        <Link to="/legal/confidentialite">{t('Confidentialité')}</Link>
      </nav>
    </footer>
  );
}

function NotFound() {
  const t = useT();
  return (
    <div className="wrap wrap--form page">
      <h1 className="h1">{t('Cette page n’existe pas')}</h1>
      <p className="muted" style={{ marginTop: 8 }}>{t('L’adresse est peut-être incomplète, ou l’offre a été retirée.')}</p>
      <Link to="/deals" className="btn btn--primary" style={{ marginTop: 20 }}>{t('Voir les offres en cours')}</Link>
    </div>
  );
}

/** Bandeau de la démonstration : rappelle que tout est fictif et permet de changer de rôle d'un geste. */
function DemoBar() {
  const t = useT();
  const { user, accept, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const accounts = Object.entries(DEMO_ACCOUNTS) as [keyof typeof DEMO_ACCOUNTS, string][];
  const current = !user ? 'visitor' : (accounts.find(([, email]) => email === user.email)?.[0] ?? 'new');
  const change = async (role: string) => {
    setBusy(true);
    try {
      if (role === 'visitor') {
        await logout();
        navigate('/');
      } else if (role === 'restart') {
        await logout();
        resetDemo();
        navigate('/');
      } else {
        accept(await post('/auth/login', { email: DEMO_ACCOUNTS[role as keyof typeof DEMO_ACCOUNTS], password: DEMO_PASSWORD }));
        navigate(role === 'admin' ? '/admin' : role === 'agent' ? '/agent' : '/');
      }
      resetTrail(); // « Précédent » ne ramène pas aux pages d'un autre compte
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="demobar" role="note">
      <b>{t('Démonstration')}</b>
      <span className="demobar__note">{t('Données fictives : rien n’est enregistré ni payé.')}</span>
      <label>
        <span className="demobar__as">{t('Voir en tant que')}</span>
        <select id="demo-role" aria-label={t('Voir en tant que')} value={current} disabled={busy} onChange={(e) => change(e.target.value)}>
          <option value="visitor">{t('Visiteur')}</option>
          {current === 'new' && <option value="new">{t('Mon compte d’essai')}</option>}
          <option value="paul">{t('Client (Paul, Cameroun)')}</option>
          <option value="admin">{t('Administrateur')}</option>
          <option value="agent">{t('Agent de bureau')}</option>
          <option value="restart">{t('Recommencer à zéro')}</option>
        </select>
      </label>
    </div>
  );
}

function Shell() {
  const { ready, user } = useAuth();
  const { path } = useLocation();

  if (!ready) return <Loading />;
  if (path === '/admin' || path.startsWith('/admin/')) return <Suspense fallback={<Loading />}><RequireAuth><AdminApp /></RequireAuth></Suspense>;
  if (path === '/agent' || path.startsWith('/agent/')) return <Suspense fallback={<Loading />}><RequireAuth><AgentApp /></RequireAuth></Suspense>;

  if (BARE.includes(path) || (path === '/' && !user)) {
    return (
      <>
      <PreviewBar />
      <main id="main">
        <BackButton className="back--float" />
        {matchRoute(routes, path)}
      </main>
      </>
    );
  }

  return (
    <>
      <PreviewBar />
      <Header />
      {path !== '/' && <div className="wrap backbar"><BackButton /></div>}
      <main id="main">{matchRoute(routes, path) ?? <NotFound />}</main>
      <Footer />
      <TabBar />
    </>
  );
}

export function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <ToastProvider>
          {DEMO && <DemoBar />}
          <Shell />
        </ToastProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
