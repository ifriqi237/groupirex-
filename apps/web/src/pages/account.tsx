import { useEffect, useState } from 'react';
import { DealGrid, Deal } from '../components/deal';
import { Empty, ErrorNote, Form, Icon, Input, Loading, Select, Tabs, useAction, useApi, useChooseLanguage, useToast } from '../components/ui';
import { ApiError, del, get, patch, post, session } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DEMO } from '../lib/env';
import { N_, formatDate, useI18n, useT } from '../lib/i18n';
import { Link, navigate, useLocation } from '../lib/router';
import { STEP_LABEL } from './orders';
import { fieldError, safeNext } from './welcome';
import { LOGISTICS_STEPS } from '@groupdeals/core';

/* -------------------------------------------------------------------------- */
/* Vérification de l'email                                                     */
/* -------------------------------------------------------------------------- */

export function VerifyEmailPage() {
  const t = useT();
  const { search } = useLocation();
  const { user, setUser } = useAuth();
  const token = search.get('token');
  const [state, setState] = useState<'idle' | 'ok' | 'error'>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    if (!token) return;
    post('/auth/verify-email', { token })
      .then(async () => {
        setState('ok');
        if (session.token) setUser((await get('/me')).user);
      })
      .catch((e) => {
        setError(e);
        setState('error');
      });
  }, [token]);
  // Hors production, l'API renvoie le lien : aucun fournisseur d'email n'est branché en démonstration.
  const [demoToken, setDemoToken] = useState<string | null>(null);
  const resend = useAction(async () => {
    const r = await post<{ debug?: { verifyToken?: string } }>('/auth/resend-verification');
    setDemoToken(r.debug?.verifyToken ?? null);
  });
  const [resent, setResent] = useState(false);

  return (
    <div className="wrap wrap--form page">
      <h1 className="h1">{t('Vérification de votre email')}</h1>
      <div className="stack" style={{ marginTop: 16 }}>
        {token && state === 'idle' && <Loading />}
        {state === 'ok' && (
          <>
            <div className="notice notice--ok"><Icon name="check" /><span>{t('Adresse vérifiée. Vous pouvez maintenant participer aux commandes groupées.')}</span></div>
            {search.get('next') ? <Link to={safeNext(search)} className="btn btn--primary btn--block">{t('Continuer')}</Link> : <Link to="/deals" className="btn btn--primary btn--block">{t('Voir les offres en cours')}</Link>}
          </>
        )}
        {/* Adresse déjà vérifiée (toujours le cas dans la démonstration, où aucun email n'est envoyé). */}
        {!token && user?.emailVerified && (
          <>
            <div className="notice notice--ok"><Icon name="check" /><span>{DEMO ? t('Démonstration : aucun email n’est envoyé. Votre adresse est considérée comme vérifiée, vous pouvez commander.') : t('Votre adresse est déjà vérifiée. Vous pouvez commander.')}</span></div>
            <Link to={safeNext(search)} className="btn btn--primary btn--block">{t('Continuer')}</Link>
          </>
        )}
        {state === 'error' && <ErrorNote error={error} />}
        {(!token || state === 'error') && !(!token && user?.emailVerified) && (
          <>
            {!token && <p>{t('Nous avons envoyé un lien à {email}. Ouvrez-le pour activer les commandes.', { email: user?.email ?? t('votre adresse') })}</p>}
            {user && !user.emailVerified && (
              resent ? <div className="notice notice--ok"><Icon name="check" /><span>{t('Lien renvoyé.')}</span></div> : (
                <button className="btn btn--ghost btn--block" disabled={resend.busy} onClick={async () => (await resend.run()) && setResent(true)}>{t('Renvoyer le lien')}</button>
              )
            )}
            {demoToken && (
              <div className="notice">
                <Icon name="shield" />
                <span>
                  {t('Mode démonstration : aucun email n’est envoyé.')}{' '}
                  <Link className="link" to={`/verify-email?token=${demoToken}`}>{t('Ouvrir le lien de vérification')}</Link>
                </span>
              </div>
            )}
            <ErrorNote error={resend.error} />
            <Link to={safeNext(search)} className="btn btn--navy btn--block">{t('Continuer')}</Link>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Profil                                                                      */
/* -------------------------------------------------------------------------- */

function ProfileInfo() {
  const t = useT();
  const { user, setUser, countries } = useAuth();
  const { languages } = useI18n();
  const chooseLanguage = useChooseLanguage();
  const toast = useToast();
  const [form, setForm] = useState({ firstName: user!.firstName, lastName: user!.lastName, whatsapp: user!.whatsapp, countryCode: user!.country.code, languageCode: user!.languageCode });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const save = useAction(async () => {
    setErrors({});
    try {
      const res = await patch('/me', form);
      setUser(res.user);
      toast(t('Profil enregistré'));
      chooseLanguage(res.user.languageCode);
    } catch (e) {
      setErrors((e as ApiError).fields);
      throw e;
    }
  });
  const resend = useAction(async () => {
    await post('/auth/resend-verification');
    toast(t('Lien renvoyé.'));
  });
  const countryChanged = form.countryCode !== user!.country.code;

  return (
    <Form onSubmit={() => save.run()}>
      {!user!.emailVerified && (
        <div className="notice notice--warn">
          <Icon name="info" />
          <div><p className="strong">{t('Vérifiez votre adresse email pour commander.')}</p><button type="button" className="link small" onClick={() => resend.run()} disabled={resend.busy}>{t('Renvoyer le lien')}</button></div>
        </div>
      )}
      <div className="form-grid form-grid--2">
        <Input label={t('Prénom')} value={form.firstName} onChange={set('firstName')} error={fieldError(errors, 'firstName')} />
        <Input label={t('Nom')} value={form.lastName} onChange={set('lastName')} error={fieldError(errors, 'lastName')} />
      </div>
      <Input label={t('Adresse email')} value={user!.email} disabled readOnly />
      <Input label={t('Numéro WhatsApp')} type="tel" value={form.whatsapp} onChange={set('whatsapp')} error={fieldError(errors, 'whatsapp')} />
      <div className="form-grid form-grid--2">
        <Select label={t('Pays')} value={form.countryCode} onChange={set('countryCode')}>
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.currencySymbol})</option>)}
        </Select>
        <Select label={t('Langue')} value={form.languageCode} onChange={set('languageCode')}>
          {languages.map((l) => <option key={l.code} value={l.code}>{l.nativeName}</option>)}
        </Select>
      </div>
      {countryChanged && <div className="notice"><Icon name="info" /><span>{t('En changeant de pays, les prix s’afficheront dans la devise et avec la livraison de ce pays. Vos commandes déjà passées ne changent pas.')}</span></div>}
      {save.error && !Object.keys(errors).length && <ErrorNote error={save.error} />}
      <div><button className="btn btn--primary" disabled={save.busy}>{t('Enregistrer')}</button></div>
    </Form>
  );
}

function ProfileSecurity() {
  const t = useT();
  const { lang } = useI18n();
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState('');
  const sessions = useApi<{ sessions: { id: string; userAgent: string | null; ip: string | null; lastSeenAt: string; current: boolean }[] }>('/auth/sessions');

  const change = useAction(async () => {
    setErrors({});
    try {
      await post('/auth/change-password', pw);
      setPw({ currentPassword: '', newPassword: '' });
      toast(t('Mot de passe modifié. Vos autres appareils ont été déconnectés.'));
      sessions.reload();
    } catch (e) {
      setErrors((e as ApiError).fields);
      throw e;
    }
  });
  const start = useAction(async () => setSetup(await post('/auth/2fa/setup')));
  const enable = useAction(async () => {
    const res = await post('/auth/2fa/enable', { code });
    session.set(res.accessToken);
    setUser((await get('/me')).user);
    setSetup(null);
    toast(t('Double authentification activée'));
  });
  const revoke = useAction(async (id: string) => {
    await del(`/auth/sessions/${id}`);
    sessions.reload();
  });

  return (
    <div className="stack-l">
      <section>
        <h2 className="h2" style={{ marginBottom: 12 }}>{t('Double authentification')}</h2>
        {user!.twoFactorEnabled ? (
          <div className="notice notice--ok"><Icon name="shield" /><span>{t('Activée. Un code vous est demandé à chaque connexion.')}</span></div>
        ) : setup ? (
          <Form onSubmit={() => enable.run()}>
            <p>{t('Scannez ce QR Code avec une application d’authentification (Google Authenticator, Authy…), puis saisissez le code affiché.')}</p>
            <div className="qr" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} role="img" aria-label={t('QR Code de configuration')} />
            <p className="small muted">{t('Saisie manuelle :')} <span className="num" style={{ overflowWrap: 'anywhere' }}>{setup.secret}</span></p>
            <Input label={t('Code à 6 chiffres')} inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <ErrorNote error={enable.error} />
            <div><button className="btn btn--primary" disabled={enable.busy || code.length !== 6}>{t('Activer')}</button></div>
          </Form>
        ) : (
          <div className="stack">
            {user!.twoFactorRequired && <div className="notice notice--warn"><Icon name="alert" /><span>{t('Votre rôle exige la double authentification. Activez-la pour accéder au back-office.')}</span></div>}
            <p className="muted">{t('Protégez votre compte : en plus du mot de passe, un code à usage unique sera demandé à la connexion.')}</p>
            <ErrorNote error={start.error} />
            <div><button className="btn btn--navy" onClick={() => start.run()} disabled={start.busy}>{t('Activer la double authentification')}</button></div>
          </div>
        )}
      </section>

      <section>
        <h2 className="h2" style={{ marginBottom: 12 }}>{t('Mot de passe')}</h2>
        <Form onSubmit={() => change.run()}>
          <Input label={t('Mot de passe actuel')} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          <Input label={t('Nouveau mot de passe')} type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} error={fieldError(errors, 'newPassword')} hint={t('8 caractères au moins, dont une lettre et un chiffre.')} />
          {change.error && !Object.keys(errors).length && <ErrorNote error={change.error} />}
          <div><button className="btn btn--navy" disabled={change.busy}>{t('Changer le mot de passe')}</button></div>
        </Form>
      </section>

      <section>
        <h2 className="h2" style={{ marginBottom: 12 }}>{t('Appareils connectés')}</h2>
        <ErrorNote error={revoke.error} />
        <ul className="stack-s">
          {sessions.data?.sessions.map((s) => (
            <li key={s.id} className="row row--between panel" style={{ padding: 12 }}>
              <div className="grow">
                <div className="small strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{describeAgent(s.userAgent, t)}</div>
                <div className="tiny muted">{s.current ? t('Cet appareil') : formatDate(s.lastSeenAt, lang, true)}{s.ip ? `, ${s.ip}` : ''}</div>
              </div>
              {!s.current && <button className="btn btn--ghost btn--s" onClick={() => revoke.run(s.id)}>{t('Déconnecter')}</button>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function describeAgent(ua: string | null, t: (s: string) => string): string {
  if (!ua) return t('Appareil inconnu');
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /okhttp|Dart/.test(ua) ? t('Application mobile') : '';
  return [browser, os].filter(Boolean).join(', ') || ua.slice(0, 40);
}

function ProfileNotifications() {
  const t = useT();
  const { user, setUser } = useAuth();
  const toast = useToast();
  const prefs = user!.notificationPrefs;
  const toggle = useAction(async (key: 'push' | 'email' | 'whatsapp') => {
    const res = await patch('/me', { notificationPrefs: { [key]: !prefs[key] } });
    setUser(res.user);
    toast(t('Préférences enregistrées'));
  });
  const rows: ['push' | 'email' | 'whatsapp', string, string][] = [
    ['push', t('Notifications sur cet appareil'), t('Paiement confirmé, colis arrivé, nouvelle offre.')],
    ['email', t('Email'), t('Confirmations de commande, factures et suivi.')],
    ['whatsapp', t('WhatsApp'), t('Messages de suivi sur votre numéro WhatsApp.')],
  ];
  return (
    <div className="stack">
      <p className="muted">{t('Choisissez comment être prévenu. Les messages de sécurité (mot de passe, vérification) sont toujours envoyés par email.')}</p>
      <ErrorNote error={toggle.error} />
      {rows.map(([key, label, hint]) => (
        <label className="check panel" key={key}>
          <input type="checkbox" checked={prefs[key] !== false} onChange={() => toggle.run(key)} disabled={toggle.busy} />
          <span><span className="strong">{label}</span><br /><span className="small muted">{hint}</span></span>
        </label>
      ))}
    </div>
  );
}

function ProfileFavorites() {
  const t = useT();
  const { data, error, loading, reload } = useApi<{ items: Deal[] }>('/me/favorites');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data?.items.length) return <Empty title={t('Aucun favori')} action={<Link to="/deals" className="btn btn--navy">{t('Voir les offres en cours')}</Link>}>{t('Touchez le cœur d’une offre pour la retrouver ici et être prévenu avant sa fin.')}</Empty>;
  return <DealGrid deals={data.items} />;
}

export function ProfilePage() {
  const t = useT();
  const { user, logout, isStaff, can } = useAuth();
  const { search } = useLocation();
  const tab = (search.get('tab') ?? 'info') as 'info' | 'favorites' | 'notifications' | 'security';
  if (!user) return null;
  return (
    <div className={`wrap ${tab === 'favorites' ? '' : 'wrap--narrow'} page`}>
      <div className="row row--between row--wrap">
        <div className="row">
          <div className="avatar" style={{ width: 52, height: 52, fontSize: '1.05rem' }}>{user.firstName[0]}{user.lastName[0]}</div>
          <div>
            <h1 className="h2">{user.firstName} {user.lastName}</h1>
            <p className="small muted">{user.country.name}, {user.country.currency}</p>
          </div>
        </div>
        <button className="btn btn--ghost btn--s" onClick={async () => { await logout(); navigate('/'); }}><Icon name="logout" size={16} /> {t('Se déconnecter')}</button>
      </div>

      {isStaff && (
        <div className="row row--wrap" style={{ marginTop: 16 }}>
          {can('dashboard.view') || can('catalog.read') || can('logistics.read') || can('orders.read') ? <Link to="/admin" className="btn btn--navy btn--s"><Icon name="chart" size={16} /> {t('Back-office')}</Link> : null}
          {can('office.payments.record') && <Link to="/agent" className="btn btn--navy btn--s"><Icon name="store" size={16} /> {t('Espace bureau')}</Link>}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <Tabs
          value={tab}
          onChange={(v) => navigate(`/profile?tab=${v}`, { keepScroll: true })}
          items={[
            { value: 'info', label: t('Informations') },
            { value: 'favorites', label: t('Favoris') },
            { value: 'notifications', label: t('Préférences') },
            { value: 'security', label: t('Sécurité') },
          ]}
        />
      </div>
      <div style={{ marginTop: 24 }}>
        {tab === 'info' && <ProfileInfo />}
        {tab === 'favorites' && <ProfileFavorites />}
        {tab === 'notifications' && <ProfileNotifications />}
        {tab === 'security' && <ProfileSecurity />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

const NOTIFICATION_TEXT: Record<string, string> = {
  WELCOME: N_('Bienvenue sur GROUPDEALS. Découvrez les offres en cours.'),
  DEAL_NEW: N_('Nouvelle offre : {title}'),
  DEAL_ENDING: N_('L’offre « {title} » se termine bientôt'),
  DEAL_CANCELLED: N_('La campagne « {title} » a été annulée'),
  DEAL_CONFIRMED: N_('La campagne « {title} » est confirmée : la commande groupée est lancée'),
  ORDER_CREATED: N_('Commande {number} enregistrée'),
  ORDER_EXPIRED: N_('Commande {number} : le délai de paiement est dépassé'),
  PAYMENT_CONFIRMED: N_('Paiement confirmé pour la commande {number}'),
  PAYMENT_FAILED: N_('Le paiement de la commande {number} n’a pas abouti'),
  REFUND_PENDING: N_('Un remboursement est en cours pour la commande {number}'),
  REFUND_DONE: N_('La commande {number} a été remboursée'),
  MATCHING_PUBLISHED: N_('Votre demande « {title} » est publiée'),
  MATCHING_REJECTED: N_('Votre demande « {title} » n’a pas été retenue'),
  MATCHING_CONVERTED: N_('« {title} » est devenue une offre GROUPDEALS'),
  MATCHING_THRESHOLD: N_('Matching : « {title} » atteint {interests} membres intéressés'),
};

export function NotificationsPage() {
  const t = useT();
  const { lang } = useI18n();
  const { refreshUnread } = useAuth();
  const { data, error, loading, reload } = useApi<{ items: { id: string; type: string; params: Record<string, any>; link: string | null; read: boolean; createdAt: string }[]; unread: number }>('/me/notifications?pageSize=60');
  const readAll = useAction(async () => {
    await post('/me/notifications/read', {});
    reload();
    refreshUnread();
  });
  const text = (n: { type: string; params: Record<string, any> }) => {
    if (n.type === 'LOGISTICS_STEP') {
      const def = LOGISTICS_STEPS.find((s) => s.step === n.params.step);
      return `${t('Suivi de commande')} : ${def ? t(STEP_LABEL[def.code]) : ''}`;
    }
    return t(NOTIFICATION_TEXT[n.type] ?? n.type, n.params);
  };
  const open = async (n: { id: string; link: string | null; read: boolean }) => {
    if (!n.read) post('/me/notifications/read', { ids: [n.id] }).then(refreshUnread).catch(() => undefined);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="wrap wrap--narrow page">
      <div className="row row--between row--wrap">
        <h1 className="h1">{t('Notifications')}</h1>
        {data && data.unread > 0 && <button className="btn btn--ghost btn--s" onClick={() => readAll.run()} disabled={readAll.busy}>{t('Tout marquer comme lu')}</button>}
      </div>
      <div className="stack-s" style={{ marginTop: 20 }}>
        {loading && !data && <Loading />}
        <ErrorNote error={error} onRetry={reload} />
        {data && data.items.length === 0 && <Empty title={t('Aucune notification')}>{t('Vous serez prévenu ici à chaque étape de vos commandes.')}</Empty>}
        {data?.items.map((n) => (
          <button key={n.id} className="orderrow" style={{ gridTemplateColumns: '12px 1fr', width: '100%', background: n.read ? 'var(--white)' : 'var(--mist-2)', textAlign: 'start', cursor: n.link ? 'pointer' : 'default' }} onClick={() => open(n)}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, background: n.read ? 'transparent' : 'var(--pink)' }} />
            <span>
              <span className={n.read ? '' : 'strong'}>{text(n)}</span>
              {!n.read && <span className="sr-only"> ({t('non lue')})</span>}
              <br />
              <span className="tiny muted">{formatDate(n.createdAt, lang, true)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
