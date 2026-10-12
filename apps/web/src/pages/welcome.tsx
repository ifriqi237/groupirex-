/**
 * Écran d'accueil des visiteurs (inscription), connexion et mot de passe oublié.
 * Ces écrans partagent le même habillage : fond rose, bulles, routes d'importation,
 * logo et champs en pastilles blanches. Ils s'affichent sans en-tête ni barre d'onglets.
 */

import { CSSProperties, ReactNode, useEffect, useState } from 'react';
import { ErrorNote, Form, Icon, useAction } from '../components/ui';
import { CountryPicker, Flag } from '../components/country-picker';
import { LegalConsent } from './legal';
import { ApiError, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { asset } from '../lib/env';
import { N_, useI18n, useT } from '../lib/i18n';
import { Link, navigate, useLocation } from '../lib/router';

/** Réduction maximale annoncée dans le slogan. */
const MAX_DISCOUNT = '(-60%)';

/** Messages d'erreur par champ, écrits pour l'utilisateur plutôt que repris du serveur. */
const FIELD_HELP: Record<string, string> = {
  firstName: N_('Indiquez votre prénom.'),
  lastName: N_('Indiquez votre nom.'),
  name: N_('Indiquez votre nom.'),
  countryCode: N_('Choisissez votre pays.'),
  email: N_('Cette adresse email n’est pas valide.'),
  whatsapp: N_('Indiquez votre numéro WhatsApp avec l’indicatif du pays, par exemple +237 6 00 00 00 00.'),
  password: N_('Le mot de passe doit contenir au moins 8 caractères, dont une lettre et un chiffre.'),
  newPassword: N_('Le mot de passe doit contenir au moins 8 caractères, dont une lettre et un chiffre.'),
};
export const fieldError = (errors: Record<string, string>, name: string) => (errors[name] ? (FIELD_HELP[name] ?? errors[name]) : undefined);

/** Destination après connexion : uniquement une adresse interne au site. */
export function safeNext(search: URLSearchParams): string {
  const next = search.get('next') ?? '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

/* -------------------------------------------------------------------------- */
/* Habillage                                                                   */
/* -------------------------------------------------------------------------- */

/** Bulles du décor : position en % de l'écran, diamètre en pixels sur la maquette (592 px de large). */
const BUBBLES: [x: number, y: number, size: number, letter: boolean][] = [
  [10, 4, 48, true], [22, 3.5, 24, false], [48, 3.2, 96, true], [73, 6, 14, false], [89, 3.6, 44, true],
  [10, 23.5, 36, true], [82, 26, 22, false], [88, 31, 44, false], [4.5, 53.5, 22, false], [93, 55, 50, true],
  [92, 65.5, 30, false], [2, 72.5, 64, false], [5, 62, 40, true], [95, 75.5, 92, true], [6, 84, 38, true],
  [13, 91.5, 98, true], [37, 91, 26, false], [68, 92.5, 58, false], [84, 87.5, 56, true], [94, 88, 20, false],
  [5.5, 98, 20, false], [65, 97.5, 14, false], [93, 99.5, 72, true],
];

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="welcome">
      <div className="welcome__art" aria-hidden="true">
        <img className="welcome__map" src={asset('/welcome/map.svg')} alt="" />
        <img className="welcome__plane" src={asset('/welcome/plane.svg')} alt="" />
        <img className="welcome__ship" src={asset('/welcome/ship.svg')} alt="" />
        <img className="welcome__truck" src={asset('/welcome/truck.svg')} alt="" />
        {BUBBLES.map(([x, y, size, letter], i) => (
          <span
            key={i}
            className="bubble"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: `clamp(${Math.round(size * 0.62)}px, ${(size / 5.92).toFixed(1)}vw, ${Math.round(size * 1.15)}px)`,
              animationDelay: `${-(i * 1.7) % 9}s`,
            } as CSSProperties}
          >
            {letter && <span>G</span>}
          </span>
        ))}
      </div>
      <div className="welcome__col">
        <Link to="/" className="brand" aria-label="GROUPDEALS by GROUPIREX">
          <img className="brand__mark" src={asset('/welcome/mark.svg')} width="88" height="88" alt="" />
          <span className="brand__name">GROUP<b>DEALS</b></span>
          <span className="brand__by">By <b>GROUPIREX</b></span>
        </Link>
        {children}
      </div>
    </div>
  );
}

/** Champ en pastille blanche : icône à gauche, saisie, action éventuelle à droite. */
function Pill({ icon, error, children }: { icon: string; error?: string; children: ReactNode }) {
  const t = useT();
  return (
    <div className="pillfield">
      <div className={`pill ${error ? 'is-error' : ''}`}>
        <span className="pill__icon"><Icon name={icon} size={24} /></span>
        {children}
      </div>
      {error && <span className="pill__error">{t(error)}</span>}
    </div>
  );
}

function PasswordPill({ value, onChange, error, autoComplete, placeholder }: { value: string; onChange: (v: string) => void; error?: string; autoComplete: string; placeholder: string }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <Pill icon="lock" error={error}>
      <input type={shown ? 'text' : 'password'} autoComplete={autoComplete} placeholder={placeholder} aria-label={placeholder} aria-invalid={error ? true : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="pill__action" onClick={() => setShown(!shown)} aria-pressed={shown} aria-label={t('Afficher le mot de passe')}>
        <Icon name={shown ? 'eye' : 'eyeOff'} size={24} />
      </button>
    </Pill>
  );
}

/* -------------------------------------------------------------------------- */
/* Accueil : inscription                                                       */
/* -------------------------------------------------------------------------- */

export function WelcomePage() {
  const t = useT();
  const { accept, countries, country, user } = useAuth();
  const { lang } = useI18n();
  const { search } = useLocation();
  const [form, setForm] = useState({ name: '', countryCode: '', email: '', number: '', password: '' });
  // L'indicatif suit le pays choisi, mais reste modifiable (numéro d'un autre pays).
  const [prefixCountry, setPrefixCountry] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (user) navigate(safeNext(search), { replace: true });
  }, [user]);

  const prefix = countries.find((c) => c.code === (prefixCountry || form.countryCode || country))?.phonePrefix ?? '+237';
  /** Corriger un champ efface aussitôt son message d'erreur. */
  const clear = (...keys: string[]) => setErrors((prev) => (keys.some((k) => prev[k]) ? Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.includes(k))) : prev));
  const ERROR_KEY: Record<string, string> = { name: 'firstName', number: 'whatsapp' };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [k]: e.target.value });
    clear(ERROR_KEY[k] ?? k);
  };

  const register = useAction(async () => {
    setErrors({});
    // Un seul champ « Nom » : le premier mot est le prénom, le reste le nom.
    const [firstName = '', ...rest] = form.name.trim().split(/\s+/);
    const number = form.number.trim();
    try {
      const data = await post('/auth/register', {
        firstName,
        lastName: rest.join(' '),
        countryCode: form.countryCode,
        email: form.email,
        whatsapp: number.startsWith('+') || number === '' ? number : prefix + number,
        password: form.password,
        languageCode: lang,
      });
      accept(data);
      navigate(`/verify-email?sent=1&next=${encodeURIComponent(safeNext(search))}`, { replace: true });
    } catch (e) {
      setErrors((e as ApiError).fields);
      throw e;
    }
  });

  // Le slogan tient en trois lignes séparées par « | » ; {discount} est mis en couleur.
  const slogan = t('Obtenons les prix usines,|jusqu’à {discount}|en important ensemble.').split('|');

  return (
    <AuthShell>
      <h1 className="welcome__slogan">
        {slogan.map((line, i) => {
          const [before, after] = line.split('{discount}');
          return (
            <span key={i}>
              {before}
              {after !== undefined && <em>{MAX_DISCOUNT}</em>}
              {after}
            </span>
          );
        })}
      </h1>
      <Form onSubmit={() => register.run()} className="welcome__form">
        <Pill icon="user" error={errors.firstName ? FIELD_HELP.name : undefined}>
          <input autoComplete="name" placeholder={t('Nom§nom complet')} aria-label={t('Nom§nom complet')} aria-invalid={errors.firstName ? true : undefined} value={form.name} onChange={set('name')} />
        </Pill>
        <Pill icon="globe" error={fieldError(errors, 'countryCode')}>
          {/* Liste dessinée (un menu natif ne peut pas montrer de drapeau) : toute la ligne, flèche comprise, ouvre le menu. */}
          <CountryPicker
            id="register-country"
            variant="pill"
            label={t('Pays')}
            placeholder={t('Pays')}
            countries={countries}
            value={form.countryCode}
            invalid={!!errors.countryCode}
            onChange={(code) => {
              setForm({ ...form, countryCode: code });
              setPrefixCountry(code);
              clear('countryCode');
            }}
          />
        </Pill>
        <Pill icon="mail" error={fieldError(errors, 'email')}>
          <input type="email" autoComplete="email" inputMode="email" placeholder={t('Email')} aria-label={t('Email')} aria-invalid={errors.email ? true : undefined} value={form.email} onChange={set('email')} />
        </Pill>
        <Pill icon="phoneCall" error={fieldError(errors, 'whatsapp')}>
          <span className="pill__prefix">
            <Flag code={prefixCountry || form.countryCode || country || 'CM'} size={22} />
            <span className="num">{prefix}</span>
            <Icon name="down" size={18} />
            <select aria-label={t('Indicatif du pays')} value={prefixCountry || form.countryCode || country} onChange={(e) => setPrefixCountry(e.target.value)}>
              {countries.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.phonePrefix})</option>)}
            </select>
          </span>
          <span className="pill__sep" />
          <input type="tel" autoComplete="tel-national" inputMode="tel" placeholder={t('Numéro WhatsApp')} aria-label={t('Numéro WhatsApp')} aria-invalid={errors.whatsapp ? true : undefined} value={form.number} onChange={set('number')} />
        </Pill>
        <PasswordPill value={form.password} onChange={(v) => set('password')({ target: { value: v } })} error={fieldError(errors, 'password')} autoComplete="new-password" placeholder={t('Mot de passe')} />
        {register.error && !Object.keys(errors).length && <ErrorNote error={register.error} />}
        <button className="welcome__cta" disabled={register.busy}>{t('Validez')}</button>
        <LegalConsent />
      </Form>
      <p className="welcome__alt">{t('Déjà membre ?')} <Link to={`/login?next=${encodeURIComponent(safeNext(search))}`}>{t('Se connecter')}</Link></p>
      <p className="welcome__alt welcome__alt--quiet"><Link to="/deals">{t('Voir les offres sans créer de compte')}</Link></p>
    </AuthShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Connexion                                                                   */
/* -------------------------------------------------------------------------- */

export function LoginPage() {
  const t = useT();
  const { accept, user } = useAuth();
  const { search } = useLocation();
  const [form, setForm] = useState({ email: '', password: '', totp: '' });
  const [needTotp, setNeedTotp] = useState(false);
  useEffect(() => {
    if (user) navigate(safeNext(search), { replace: true });
  }, [user]);

  const login = useAction(async () => {
    try {
      const data = await post('/auth/login', { email: form.email, password: form.password, ...(needTotp ? { totp: form.totp } : {}) });
      accept(data);
      navigate(data.twoFactorSetupRequired ? '/profile?tab=security' : safeNext(search), { replace: true });
    } catch (e) {
      if ((e as ApiError).code === 'AUTH_2FA_REQUIRED') {
        setNeedTotp(true);
        return;
      }
      throw e;
    }
  });

  return (
    <AuthShell>
      <h1 className="welcome__slogan"><span>{t('Connexion')}</span></h1>
      <Form onSubmit={() => login.run()} className="welcome__form">
        {!needTotp ? (
          <>
            <Pill icon="mail">
              <input type="email" autoComplete="email" inputMode="email" placeholder={t('Email')} aria-label={t('Email')} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Pill>
            <PasswordPill value={form.password} onChange={(v) => setForm({ ...form, password: v })} autoComplete="current-password" placeholder={t('Mot de passe')} />
          </>
        ) : (
          <>
            <Pill icon="shield">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                placeholder={t('Code à 6 chiffres')}
                aria-label={t('Code de double authentification')}
                value={form.totp}
                onChange={(e) => setForm({ ...form, totp: e.target.value.replace(/\D/g, '') })}
              />
            </Pill>
            <p className="welcome__hint">{t('Le code à 6 chiffres affiché par votre application d’authentification.')}</p>
          </>
        )}
        <ErrorNote error={login.error} />
        <button className="welcome__cta" disabled={login.busy}>{t('Se connecter')}</button>
      </Form>
      <p className="welcome__alt">{t('Pas encore membre ?')} <Link to={`/register?next=${encodeURIComponent(safeNext(search))}`}>{t('Créer un compte')}</Link></p>
      <p className="welcome__alt welcome__alt--quiet"><Link to="/forgot-password">{t('Mot de passe oublié')}</Link></p>
    </AuthShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Mot de passe oublié                                                         */
/* -------------------------------------------------------------------------- */

export function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const send = useAction(async () => {
    await post('/auth/forgot-password', { email });
    setSent(true);
  });
  return (
    <AuthShell>
      <h1 className="welcome__slogan"><span>{t('Mot de passe oublié')}</span></h1>
      {sent ? (
        <div className="welcome__form">
          <div className="notice notice--ok"><Icon name="check" /><span>{t('Si un compte existe avec cette adresse, un lien de réinitialisation vient de lui être envoyé. Il est valable une heure.')}</span></div>
          <Link to="/login" className="welcome__cta">{t('Retour à la connexion')}</Link>
        </div>
      ) : (
        <Form onSubmit={() => send.run()} className="welcome__form">
          <p className="welcome__hint">{t('Indiquez l’adresse email de votre compte : nous vous enverrons un lien pour choisir un nouveau mot de passe.')}</p>
          <Pill icon="mail">
            <input type="email" autoComplete="email" inputMode="email" placeholder={t('Email')} aria-label={t('Email')} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Pill>
          <ErrorNote error={send.error} />
          <button className="welcome__cta" disabled={send.busy}>{t('Envoyer le lien')}</button>
        </Form>
      )}
      <p className="welcome__alt"><Link to="/login">{t('Retour à la connexion')}</Link></p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const t = useT();
  const { search } = useLocation();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const reset = useAction(async () => {
    setErrors({});
    try {
      await post('/auth/reset-password', { token: search.get('token') ?? '', password });
      setDone(true);
    } catch (e) {
      setErrors((e as ApiError).fields);
      throw e;
    }
  });
  return (
    <AuthShell>
      <h1 className="welcome__slogan"><span>{t('Nouveau mot de passe')}</span></h1>
      {done ? (
        <div className="welcome__form">
          <div className="notice notice--ok"><Icon name="check" /><span>{t('Mot de passe modifié. Vos autres appareils ont été déconnectés.')}</span></div>
          <Link to="/login" className="welcome__cta">{t('Se connecter')}</Link>
        </div>
      ) : (
        <Form onSubmit={() => reset.run()} className="welcome__form">
          <PasswordPill value={password} onChange={setPassword} error={fieldError(errors, 'password')} autoComplete="new-password" placeholder={t('Nouveau mot de passe')} />
          <p className="welcome__hint">{t('8 caractères au moins, dont une lettre et un chiffre.')}</p>
          {reset.error && !Object.keys(errors).length && <ErrorNote error={reset.error} />}
          <button className="welcome__cta" disabled={reset.busy}>{t('Enregistrer le mot de passe')}</button>
        </Form>
      )}
    </AuthShell>
  );
}
