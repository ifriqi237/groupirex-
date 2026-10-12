/**
 * Client de l'API. Le jeton d'accès ne vit qu'en mémoire ; la session est
 * prolongée par un cookie HttpOnly que le JavaScript ne peut pas lire.
 */

import { demoFetch } from '../demo/backend';
import { DEMO, store } from './env';
import { saveFile, type SaveOutcome } from './files';

declare const __DEMO__: boolean;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly action: string = 'NONE',
    readonly details: any = null,
  ) {
    super(message);
  }
  /** Erreurs de champ renvoyées par la validation du serveur. */
  get fields(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of this.details?.fields ?? []) out[f.path] = f.message;
    return out;
  }
}

/** Marque un texte à traduire (relevé par scripts/i18n.mjs). */
const N_ = (source: string): string => source;

const BASE = '/api/v1';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSession: ((data: any | null) => void) | null = null;

export const session = {
  set(token: string | null) {
    accessToken = token;
  },
  get token() {
    return accessToken;
  },
  /** Appelé quand la session change (rafraîchie ou perdue). */
  listen(fn: (data: any | null) => void) {
    onSession = fn;
  },
};

export const prefs = {
  get country(): string | null {
    return store.get('gd_country');
  },
  set country(v: string | null) {
    if (v) store.set('gd_country', v);
    else store.remove('gd_country');
  },
  get lang(): string {
    return store.get('gd_lang') || (navigator.language || 'fr').split('-')[0].toLowerCase();
  },
  /** Vrai quand la langue a été choisie ici, et non déduite du navigateur. */
  get langChosen(): boolean {
    return !!store.get('gd_lang');
  },
  set lang(v: string) {
    store.set('gd_lang', v);
  },
};

/** En démonstration, les requêtes sont servies dans le navigateur au lieu de partir vers le serveur. */
const transport = (url: string, init: RequestInit): Promise<Response> => (DEMO ? demoFetch(url.slice(BASE.length), init) : fetch(url, init));

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = { 'X-Requested-With': 'groupdeals', 'Accept-Language': prefs.lang };
  if (json) h['Content-Type'] = 'application/json';
  if (accessToken) h.Authorization = `Bearer ${accessToken}`;
  else if (prefs.country) h['X-Country'] = prefs.country;
  return h;
}

/** Tente de prolonger la session grâce au cookie. Une seule tentative à la fois. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await transport(`${BASE}/auth/refresh`, { method: 'POST', headers: headers(true), body: '{}', credentials: 'same-origin' });
      if (!res.ok) {
        accessToken = null;
        onSession?.(null);
        return false;
      }
      const data = await res.json();
      accessToken = data.accessToken;
      onSession?.(data);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

async function raw(method: string, path: string, body?: unknown, extra: Record<string, string> = {}, retried = false): Promise<Response> {
  const isRaw = body instanceof Blob || body instanceof ArrayBuffer;
  let res: Response;
  try {
    res = await transport(BASE + path, {
      method,
      headers: { ...headers(body !== undefined && !isRaw), ...extra },
      body: body === undefined ? undefined : isRaw ? (body as Blob) : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Connexion perdue. Vérifiez votre réseau, puis réessayez.', 'RETRY');
  }
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    const hadToken = accessToken !== null;
    if (hadToken && (await refreshSession())) return raw(method, path, body, extra, true);
  }
  if (!res.ok) {
    let err: any = null;
    try {
      err = (await res.json()).error;
    } catch {
      /* réponse sans corps JSON */
    }
    throw new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? 'Une erreur est survenue. Réessayez plus tard.', err?.action, err?.details);
  }
  return res;
}

export async function api<T = any>(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<T> {
  const res = await raw(method, path, body, extra);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body: unknown = {}, extra?: Record<string, string>) => api<T>('POST', path, body, extra);
export const put = <T = any>(path: string, body: unknown = {}) => api<T>('PUT', path, body);
export const patch = <T = any>(path: string, body: unknown = {}) => api<T>('PATCH', path, body);
export const del = <T = any>(path: string) => api<T>('DELETE', path);

/**
 * Télécharge un document de commande (facture proforma, facture, reçu) au format PDF.
 * Le résultat dit si le fichier est parti, a été refusé, ou si la démonstration n'a pas pu s'en assurer.
 */
export async function downloadDocument(url: string): Promise<SaveOutcome> {
  // __DEMO__ est testé tel quel : le site de production n'embarque ainsi ni ce module ni la bibliothèque PDF.
  if (__DEMO__) {
    // Sans serveur, le PDF est produit dans le navigateur, avec le même rendu que l'API.
    const { demoDocument } = await import('../demo/documents');
    const file = await demoDocument(url, prefs.lang);
    return saveFile(file.filename, new Blob([file.bytes], { type: 'application/pdf' }));
  }
  const res = await raw('GET', url.replace(/^\/api\/v1/, ''));
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'document.pdf';
  return saveFile(name, await res.blob());
}

export function qs(params: Record<string, string | number | undefined | null | false>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== false && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export interface ProformaRequest {
  dealId: string;
  dealSlug: string;
  items: { variantId: string | null; quantity: number }[];
  paymentMethod: 'ONLINE' | 'OFFICE';
  officeId: string | null;
}

/**
 * Télécharge la proforma de la page « Votre commande » : le devis du moment, avant toute commande.
 */
export async function downloadQuoteProforma(req: ProformaRequest): Promise<SaveOutcome> {
  if (__DEMO__) {
    const { demoQuoteProforma } = await import('../demo/documents');
    const file = await demoQuoteProforma(req, prefs.lang);
    return saveFile(file.filename, new Blob([file.bytes], { type: 'application/pdf' }));
  }
  const res = await raw('POST', `/group-deals/${req.dealId}/proforma`, { items: req.items, paymentMethod: req.paymentMethod, officeId: req.officeId });
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'proforma.pdf';
  return saveFile(name, await res.blob());
}
