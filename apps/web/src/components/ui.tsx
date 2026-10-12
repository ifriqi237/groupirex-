/**
 * Briques d'interface communes au site, au back-office et à l'espace agent.
 */

import {
  FormEvent,
  ImgHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { ApiError, get } from '../lib/api';
import { useI18n, useT } from '../lib/i18n';
import { goBack, useLocation } from '../lib/router';

/* --------------------------------- Icônes --------------------------------- */

const ICONS: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  tag: 'M3.5 12.6V4.5h8.1l8.9 8.9-8.1 8.1zM8 8.5h.01',
  users: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.25 3.25 0 0 1 0 6.2',
  box: 'M20.5 8 12 3.5 3.5 8v8l8.5 4.5 8.5-4.5zM3.8 8.2 12 12.6l8.2-4.4M12 12.6v7.6',
  user: 'M19 20v-1.5a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4V20M12 11a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13M20 20l-4.6-4.6',
  bell: 'M18 9a6 6 0 1 0-12 0c0 6.5-2.5 8-2.5 8h17S18 15.5 18 9M10 20.5a2.2 2.2 0 0 0 4 0',
  heart: 'M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.5 4.3 4.3 0 0 1 19.5 10C19.5 15.6 12 20 12 20',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7.5V12l3 2',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5.5M12 7.6v.2',
  alert: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17v.2',
  pin: 'M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0C5.5 15.4 12 21 12 21M12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4',
  phone: 'M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 5.3 5.3l1.4-2.2L19 14.5V18a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 3 6.2 2 2 0 0 1 5 4',
  file: 'M14 3.5H6.5v17h11V7zM14 3.5V7h3.5M9 12.5h6M9 16h6',
  ship: 'M3 17.5c1.5 1.4 3 1.4 4.5 0s3-1.4 4.5 0 3 1.4 4.5 0 3-1.4 4.5 0M5 14.5 4 11h16l-1.5 3.5M7 11V7h6l3 4M10 7V4.5',
  card: 'M3.5 6.5h17v11h-17zM3.5 10h17M7 14.5h3',
  store: 'M4 9.5 5.5 4h13L20 9.5M4 9.5V20h16V9.5M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M9.5 20v-5h5v5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  chevron: 'm9 6 6 6-6 6',
  back: 'm14.5 6-6 6 6 6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18',
  shield: 'M12 3.5 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6zM9 12l2.2 2.2L15.2 10',
  chart: 'M4 20V4M4 20h16M8.5 16v-5M12.5 16V8M16.5 16v-3',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4M19 12l1.8-1.4-1.7-3-2.2.7-1.6-1-.4-2.3h-3.5l-.4 2.3-1.6 1-2.2-.7-1.7 3L7 12l-1.8 1.4 1.7 3 2.2-.7 1.6 1 .4 2.3h3.5l.4-2.3 1.6-1 2.2.7 1.7-3z',
  list: 'M8.5 6.5h12M8.5 12h12M8.5 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01',
  coins: 'M9 13a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11M14.5 11.2A5.5 5.5 0 1 1 11 21a5.5 5.5 0 0 1-4.4-2.2',
  logout: 'M14 4.5H5.5v15H14M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 20h.01M20 14h.01',
  truck: 'M2.5 6.5h11v10h-11zM13.5 10h4l3 3v3.5h-7M7 19a1.8 1.8 0 1 0 0-3.6A1.8 1.8 0 0 0 7 19M17 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M5 7h14M9.5 7V4.5h5V7M7 7l.8 12.5h8.4L17 7',
  download: 'M12 4v11M7.5 11 12 15.5 16.5 11M5 19.5h14',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  scale: 'M12 4v16M6 20h12M4 9l3-5 3 5a3 3 0 0 1-6 0M14 9l3-5 3 5a3 3 0 0 1-6 0M7 4h10',
  mail: 'M3.5 6h17v12h-17zM3.5 6.5 12 13l8.5-6.5',
  lock: 'M6.5 10.5h11A1.5 1.5 0 0 1 19 12v6.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5V12a1.5 1.5 0 0 1 1.5-1.5M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.3v2.2',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6',
  eyeOff: 'M4 4l16 16M9.8 5.8A9.5 9.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.7 3.5M6.3 7.4A16.5 16.5 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 4.3-1.1M9.9 10.1a2.8 2.8 0 0 0 4 4',
  phoneCall: 'M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 5.3 5.3l1.4-2.2L19 14.5V18a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 3 6.2 2 2 0 0 1 5 4M14.5 3.5a6 6 0 0 1 6 6M14.5 7.2a2.3 2.3 0 0 1 2.3 2.3',
};

export function Icon({ name, size = 20, fill }: { name: string; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

/* ------------------------------ Chargement, erreurs ------------------------------ */

export function Loading() {
  const t = useT();
  return (
    <div className="loading" role="status">
      <div className="spinner" />
      <span className="sr-only">{t('Chargement…')}</span>
    </div>
  );
}

/** Message d'erreur : ce qui s'est passé, et quoi faire. */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div className="notice notice--error" role="alert">
      <Icon name="alert" />
      <div className="grow">
        <p className="strong">{t(e.message || 'Une erreur est survenue. Réessayez plus tard.')}</p>
        {onRetry && (
          <button className="link small" onClick={onRetry} style={{ marginTop: 4 }}>
            {t('Réessayer')}
          </button>
        )}
      </div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3 className="h3">{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

/* ------------------------------- Chargement de données ------------------------------- */

export interface Loaded<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload(): void;
  set(data: T): void;
}

/** Charge une ressource ; se relance quand l'adresse ou la langue change. */
export function useApi<T = any>(path: string | null): Loaded<T> {
  const { version } = useI18n();
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    get<T>(path)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error) => !cancelled && setState({ data: null, error, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [path, tick, version]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const set = useCallback((data: T) => setState({ data, error: null, loading: false }), []);
  return { ...state, reload, set };
}

/** Enveloppe une action : état d'attente, erreur, et protection contre le double clic. */
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<unknown>): { run: (...args: A) => Promise<boolean>; busy: boolean; error: ApiError | null; clear(): void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const lock = useRef(false);
  const run = async (...args: A) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn(...args);
      return true;
    } catch (e) {
      setError(e as ApiError);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return { run, busy, error, clear: () => setError(null) };
}

/* -------------------------------- Formulaires -------------------------------- */

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  children?: ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const t = useT();
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {error ? <span className="field__error">{t(error)}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function Input({ label, hint, error, className, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      <input className={`input ${className ?? ''}`} aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

export function Select({ label, hint, error, children, className, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      <select className={`select ${className ?? ''}`} {...rest}>
        {children}
      </select>
    </Field>
  );
}

export function Textarea({ label, hint, error, className, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      <textarea className={`textarea ${className ?? ''}`} {...rest} />
    </Field>
  );
}

export function Form({ onSubmit, children, className }: { onSubmit: () => void; children: ReactNode; className?: string }) {
  return (
    <form
      className={className ?? 'stack'}
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

/* --------------------------------- Fenêtre modale --------------------------------- */

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const id = useId();
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal__box ${wide ? 'modal__box--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} ref={box}>
        <div className="row row--between" style={{ marginBottom: 16 }}>
          <h2 className="h2" id={id}>
            {title}
          </h2>
          <button className="iconbtn" onClick={onClose} aria-label={t('Fermer')}>
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ----------------------------------- Messages ----------------------------------- */

interface Toast {
  id: number;
  text: string;
  error?: boolean;
}
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, error?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, text, error }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), error ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.error ? 'toast--error' : ''}`} role={x.error ? 'alert' : 'status'}>
            {x.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Les quatre coins de l'image sont-ils blancs ? (image réduite à 24 × 24 points ; faux si elle n'est pas lisible) */
function hasWhiteCorners(img: HTMLImageElement): boolean {
  try {
    const n = 24;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = n;
    const ctx = canvas.getContext('2d');
    if (!ctx || !img.naturalWidth) return false;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, n, n);
    ctx.drawImage(img, 0, 0, n, n);
    return [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]].every(([x, y]) => {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      return r >= 248 && g >= 248 && b >= 248;
    });
  } catch {
    return false;
  }
}

/**
 * Image d'un produit dans un cadre de proportions fixes (liste, bannière, fiche, commande).
 * Une photo sur fond blanc y est montrée entière, sur blanc : un produit haut (chemise, panneau solaire)
 * n'est donc jamais rogné. Les autres images remplissent le cadre, comme avant.
 */
export function ProductImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const [whole, setWhole] = useState(false);
  return <img {...props} className={whole ? 'is-whole' : undefined} onLoad={(e) => setWhole(hasWhiteCorners(e.currentTarget))} />;
}

/** Commande « Précédent » : revient à la page d'où l'on vient. Absente de la page d'accueil. */
export function BackButton({ className = '' }: { className?: string }) {
  const t = useT();
  const { path } = useLocation();
  if (path === '/') return null;
  return (
    <button type="button" className={`back ${className}`.trim()} onClick={() => goBack()}>
      <Icon name="back" size={18} />
      {t('Précédent')}
    </button>
  );
}

/** Change la langue de l'interface, et prévient quand la langue choisie n'a pas encore de traductions. */
export function useChooseLanguage(): (code: string) => void {
  const { languages, lang, setLang } = useI18n();
  const toast = useToast();
  const t = useT();
  return (code: string) => {
    const language = languages.find((l) => l.code === code);
    setLang(code);
    if (language && code !== lang && code !== 'fr' && !language.translated) {
      toast(t('{language} n’est pas encore traduit : les textes restent en français.', { language: language.nativeName.split(' — ')[0] }));
    }
  };
}

/* ---------------------------------- Divers ---------------------------------- */

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" className="tab" aria-selected={it.value === value} onClick={() => onChange(it.value)}>
          {it.label}
          {it.count ? <span className="count num">{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Money({ value }: { value: { formatted: string } | null | undefined }) {
  return <span className="num">{value?.formatted ?? '—'}</span>;
}
