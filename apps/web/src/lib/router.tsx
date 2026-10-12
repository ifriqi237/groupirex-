/**
 * Routeur minimal bâti sur l'API History du navigateur.
 */

import { AnchorHTMLAttributes, MouseEvent, ReactNode, useMemo, useSyncExternalStore } from 'react';
import { DEMO } from './env';

const EVENT = 'gd:navigate';

function subscribe(cb: () => void): () => void {
  window.addEventListener('popstate', cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(EVENT, cb);
  };
}

// En démonstration, la page n'a qu'une adresse : l'itinéraire vit en mémoire, et l'historique
// du navigateur ne garde que l'itinéraire de chaque étape (pour le bouton Retour).
let memory = '/';
if (DEMO) {
  window.addEventListener('popstate', (e) => {
    memory = (e.state as { gd?: string } | null)?.gd ?? '/';
  });
}
const snapshot = () => (DEMO ? memory : window.location.pathname + window.location.search);

/* ----------------------------- Commande « Précédent » ----------------------------- */

// Pages visitées depuis l'ouverture du site, dans l'ordre. Tant qu'il y en a une avant la page
// affichée, « Précédent » y revient ; sinon (page ouverte directement) il remonte d'un niveau.
let trail: string[] = [snapshot()];
window.addEventListener('popstate', () => {
  // Retour ou avance du navigateur : la liste suit.
  const at = snapshot();
  if (trail.length > 1 && trail[trail.length - 2] === at) trail.pop();
  else if (trail[trail.length - 1] !== at) trail.push(at);
});

/** Oublie les pages visitées (changement de compte en démonstration). */
export function resetTrail(): void {
  trail = [snapshot()];
}

const SECTIONS = ['/deals', '/orders', '/matching', '/partners', '/admin', '/agent'];
/** Page de niveau supérieur : « /orders/42 » → « /orders », « /orders » → « / ». */
export function parentOf(path: string): string {
  return SECTIONS.find((s) => path.startsWith(s + '/')) ?? '/';
}

/** Revient à la page précédente. */
export function goBack(): void {
  if (trail.length < 2) return navigate(parentOf(currentPath()), { replace: true });
  if (!DEMO) return window.history.back();
  // En démonstration, l'itinéraire vit en mémoire : on y revient sans dépendre de l'historique du navigateur.
  trail.pop();
  memory = trail[trail.length - 1];
  try {
    window.history.replaceState({ gd: memory }, '');
  } catch {
    /* historique indisponible */
  }
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo(0, 0);
}

/** Chemin de la page affichée, sans ses paramètres. */
export const currentPath = (): string => snapshot().split('?')[0];

export function navigate(to: string, opts: { replace?: boolean; keepScroll?: boolean } = {}): void {
  if (to === snapshot()) return;
  if (DEMO) {
    memory = to;
    try {
      if (opts.replace) window.history.replaceState({ gd: to }, '');
      else window.history.pushState({ gd: to }, '');
    } catch {
      /* historique indisponible : la navigation fonctionne quand même */
    }
  } else if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  if (opts.replace) trail[trail.length - 1] = to;
  else trail.push(to);
  window.dispatchEvent(new Event(EVENT));
  if (!opts.keepScroll) window.scrollTo(0, 0);
}

/** Quitte la page vers une adresse fournie par le serveur (page de paiement, retour de paiement). */
export function leaveTo(url: string): void {
  if (!DEMO) return window.location.assign(url);
  const u = new URL(url, 'http://demo.local');
  navigate(u.pathname + u.search);
}

export function useLocation(): { path: string; search: URLSearchParams; full: string } {
  const full = useSyncExternalStore(subscribe, snapshot);
  // L'objet renvoyé ne change que si l'adresse change : il peut servir de dépendance à un effet.
  return useMemo(() => {
    const [path, query = ''] = full.split('?');
    return { path: path.replace(/\/+$/, '') || '/', search: new URLSearchParams(query), full };
  }, [full]);
}

export interface RouteDef {
  pattern: string;
  render(params: Record<string, string>): ReactNode;
}

export function matchRoute(routes: RouteDef[], path: string): ReactNode | null {
  for (const route of routes) {
    const keys: string[] = [];
    const regex = new RegExp(
      '^' +
        route.pattern.replace(/:([a-zA-Z]+)/g, (_m, k) => {
          keys.push(k);
          return '([^/]+)';
        }).replace(/\/\*$/, '(?:/.*)?') +
        '$',
    );
    const m = regex.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return route.render(params);
  }
  return null;
}

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
  /** Marque le lien comme page courante quand l'adresse commence par `to` (ou lui est égale si exact). */
  nav?: boolean;
  exact?: boolean;
}

export function Link({ to, nav, exact, onClick, children, ...rest }: LinkProps) {
  const { path } = useLocation();
  const target = to.split('?')[0];
  const current = nav && (exact || target === '/' ? path === target : path === target || path.startsWith(target + '/'));
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || (!DEMO && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey))) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={DEMO ? '#' : to} onClick={handle} aria-current={current ? 'page' : undefined} {...rest}>
      {children}
    </a>
  );
}
