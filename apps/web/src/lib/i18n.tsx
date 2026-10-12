/**
 * Traductions.
 *
 * Le texte français du code sert de clé : t('Participer au GroupDeals').
 * Les traductions viennent de l'API (table `translations`) : ajouter une langue,
 * c'est l'activer dans le back-office et saisir ses textes — aucun code à modifier.
 * Une clé non traduite s'affiche en français. Une langue sans aucune traduction se choisit quand même :
 * tout reste en français (textes, nombres, dates, sens de lecture) jusqu'à ce qu'elle soit traduite.
 * Quand un même mot français demande deux traductions, la clé porte une précision après « § »
 * (t('Nom§nom complet')) : elle guide le traducteur et n'est jamais affichée.
 */

import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, prefs } from './api';

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  isRtl: boolean;
  /** Nombre de textes traduits ; à zéro, l'interface reste en français. */
  translated?: number;
}

/** Langues dont les nombres et les dates s'écrivent à la française : celles qui n'ont pas encore de traductions. */
const untranslated = new Set<string>();
const noteCoverage = (l: Language) => (l.code !== 'fr' && !l.translated ? untranslated.add(l.code) : untranslated.delete(l.code));

/** Langue passée à Intl : celle de l'interface si elle est traduite et connue du navigateur, sinon le français. */
function formatLocale(lang: string): string {
  if (untranslated.has(lang)) return 'fr';
  try {
    return Intl.NumberFormat.supportedLocalesOf([lang]).length ? lang : 'fr';
  } catch {
    return 'fr';
  }
}

type Vars = Record<string, string | number>;

interface I18n {
  lang: string;
  languages: Language[];
  t(source: string, vars?: Vars): string;
  setLang(code: string): void;
  /** Nombre de chargements : sert à relancer les requêtes quand la langue change. */
  version: number;
}

const Ctx = createContext<I18n>({ lang: 'fr', languages: [], t: (s) => s, setLang: () => undefined, version: 0 });

function interpolate(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(prefs.lang);
  // À la première visite, la langue vient du navigateur : on ne la garde que si elle est réellement traduite.
  const [chosen] = useState(prefs.langChosen);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [languages, setLanguages] = useState<Language[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    get<{ languages: Language[] }>('/languages')
      .then((r) => {
        r.languages.forEach(noteCoverage);
        setLanguages(r.languages);
        const current = r.languages.find((l) => l.code === lang);
        if (!current || (!chosen && lang !== 'fr' && !current.translated)) setLangState('fr');
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    prefs.lang = lang;
    get<{ language: Language; messages: Record<string, string> }>(`/i18n/${lang}`)
      .then((r) => {
        if (cancelled) return;
        noteCoverage(r.language);
        setMessages(r.messages);
        document.documentElement.lang = r.language.code;
        // Le sens de lecture ne bascule que si la langue est traduite : du français affiché de droite à gauche serait illisible.
        document.documentElement.dir = r.language.isRtl && r.language.translated ? 'rtl' : 'ltr';
        setVersion((v) => v + 1);
      })
      .catch(() => {
        if (!cancelled) setMessages({});
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const t = useCallback((source: string, vars?: Vars) => interpolate((messages[source] || source).replace(/§.*$/, ''), vars), [messages]);
  const value = useMemo(() => ({ lang, languages, t, setLang: setLangState, version }), [lang, languages, t, version]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
/** Marque un texte à traduire plus tard par t(variable) : le script d'extraction le relève. */
export const N_ = (source: string): string => source;
export const useT = () => useContext(Ctx).t;

/* ------------------------------ Formats ------------------------------ */

export function formatDate(value: string | Date | null | undefined, lang: string, withTime = false): string {
  if (!value) return '—';
  const d = new Date(value);
  return new Intl.DateTimeFormat(formatLocale(lang), withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(d);
}

export function formatNumber(n: number, lang: string): string {
  return new Intl.NumberFormat(formatLocale(lang)).format(n);
}
