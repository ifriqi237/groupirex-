/**
 * Zone géographique d'une campagne : qui la voit et qui peut y participer.
 * La liste des pays vient de la base (pays actifs de GROUPIREX), jamais d'une liste écrite en dur.
 */

import { useMemo, useState } from 'react';
import { flagOf } from '../components/deal';
import { Icon, useApi } from '../components/ui';
import { qs } from '../lib/api';
import { N_, formatNumber, useI18n, useT } from '../lib/i18n';

export type GeoScope = 'NATIONAL' | 'MULTI_COUNTRY' | 'INTERNATIONAL';
export type GoalScope = 'GLOBAL' | 'PER_COUNTRY';

export interface ZoneValue {
  scope: GeoScope;
  goal: GoalScope;
  /** Pays cochés, dans l'ordre du clic, avec l'objectif du pays (texte saisi). */
  picked: { code: string; target: string }[];
}

export interface ZoneCountry {
  code: string;
  name: string;
  currency: string;
  delivered: boolean;
}

/** Commandes déjà passées depuis un pays : pour prévenir avant de le retirer. */
export interface OrderedCountry {
  code: string;
  name: string;
  orders: number;
}

export const SCOPE_LABEL: Record<GeoScope, string> = {
  NATIONAL: N_('Nationale'),
  MULTI_COUNTRY: N_('Multipays'),
  INTERNATIONAL: N_('Internationale'),
};

/** Ce qui manque pour enregistrer, ou null. */
export function zoneProblem(z: ZoneValue, t: (s: string) => string): string | null {
  if (z.scope === 'NATIONAL' && z.picked.length !== 1) return t('Choisissez le pays de la campagne nationale.');
  if (z.scope === 'MULTI_COUNTRY' && z.picked.length < 2) return t('Cochez au moins deux pays pour une campagne multipays.');
  if (z.scope === 'MULTI_COUNTRY' && z.goal === 'PER_COUNTRY' && z.picked.some((p) => !(Number(p.target) > 0))) return t('Indiquez l’objectif de chaque pays coché.');
  return null;
}

export function zonePayload(z: ZoneValue) {
  const perCountry = z.scope === 'MULTI_COUNTRY' && z.goal === 'PER_COUNTRY';
  return {
    geographicScope: z.scope,
    goalScope: perCountry ? 'PER_COUNTRY' : 'GLOBAL',
    countries: z.scope === 'INTERNATIONAL' ? [] : z.picked.map((p) => ({ countryCode: p.code, targetQuantity: perCountry ? Number(p.target) : null })),
  };
}

export function zoneTotal(z: ZoneValue): number {
  return z.picked.reduce((s, p) => s + (Number(p.target) || 0), 0);
}

export function ZoneField({ productId, value, onChange, ordered = [], goalLocked }: {
  productId: string;
  value: ZoneValue;
  onChange: (z: ZoneValue) => void;
  ordered?: OrderedCountry[];
  goalLocked?: boolean;
}) {
  const t = useT();
  const { lang } = useI18n();
  const { data } = useApi<{ countries: ZoneCountry[] }>(`/admin/deal-zone-countries${qs({ productId: productId || undefined })}`);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const all = data?.countries ?? [];
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const picked = new Set(value.picked.map((p) => p.code));
  // Pays livrés d'abord ; ceux où le produit n'est pas livré restent repliés (sauf recherche).
  const matching = useMemo(() => all.filter((c) => !q.trim() || norm(c.name).includes(norm(q.trim())) || c.code.toLowerCase() === q.trim().toLowerCase()), [all, q]);
  const hiddenCount = matching.filter((c) => !c.delivered && !picked.has(c.code)).length;
  const shown = [...matching.filter((c) => c.delivered || picked.has(c.code)), ...(showAll || q.trim() ? matching.filter((c) => !c.delivered && !picked.has(c.code)) : [])];
  const delivered = all.filter((c) => c.delivered);
  const perCountry = value.scope === 'MULTI_COUNTRY' && value.goal === 'PER_COUNTRY';

  const setScope = (scope: GeoScope) => {
    // Passer en « un seul pays » ne garde que le premier pays coché.
    const keep = scope === 'NATIONAL' ? value.picked.slice(0, 1) : scope === 'INTERNATIONAL' ? value.picked : value.picked;
    onChange({ ...value, scope, picked: keep, goal: scope === 'MULTI_COUNTRY' ? value.goal : 'GLOBAL' });
  };
  const toggle = (c: ZoneCountry) => {
    if (!c.delivered && !picked.has(c.code)) return;
    if (value.scope === 'NATIONAL') return onChange({ ...value, picked: picked.has(c.code) ? [] : [{ code: c.code, target: '' }] });
    onChange({ ...value, picked: picked.has(c.code) ? value.picked.filter((p) => p.code !== c.code) : [...value.picked, { code: c.code, target: '' }] });
  };
  const selectAll = () => {
    const add = shown.filter((c) => c.delivered && !picked.has(c.code)).map((c) => ({ code: c.code, target: '' }));
    onChange({ ...value, picked: [...value.picked, ...add] });
  };
  const clearAll = () => {
    const hide = new Set(shown.map((c) => c.code));
    onChange({ ...value, picked: q.trim() ? value.picked.filter((p) => !hide.has(p.code)) : [] });
  };
  const setTarget = (code: string, target: string) => onChange({ ...value, picked: value.picked.map((p) => (p.code === code ? { ...p, target } : p)) });

  // Pays retirés alors que des clients y ont déjà commandé.
  const removed = value.scope === 'INTERNATIONAL' ? [] : ordered.filter((o) => !picked.has(o.code));

  const scopes: [GeoScope, string, string][] = [
    ['NATIONAL', t('Un seul pays'), t('Campagne nationale : seuls les clients de ce pays la voient et y participent.')],
    ['MULTI_COUNTRY', t('Plusieurs pays sélectionnés'), t('Campagne multipays : seuls les pays cochés la voient.')],
    ['INTERNATIONAL', t('Tous les pays actifs'), t('Campagne internationale : tous les pays où le produit est livré, y compris ceux ajoutés plus tard.')],
  ];

  return (
    <fieldset className="zone">
      <legend className="zone__title"><Icon name="globe" size={20} /> {t('Zone géographique de la campagne')}</legend>
      <p className="zone__q">{t('Qui peut voir et participer à cette campagne ?')}</p>
      <div className="zone__scopes" role="radiogroup">
        {scopes.map(([s, label, help]) => (
          <label key={s} className="choice zone__scope">
            <input type="radio" name="geo-scope" checked={value.scope === s} onChange={() => setScope(s)} />
            <div><div className="strong">{label}</div><p className="tiny muted">{help}</p></div>
          </label>
        ))}
      </div>

      {value.scope === 'INTERNATIONAL' ? (
        <p className="small zone__summary">
          {productId
            ? t('{n} pays actifs sur GROUPDEALS, dont {d} où ce produit est livré : la campagne y sera visible.', { n: all.length, d: delivered.length })
            : t('{n} pays actifs sur GROUPDEALS. La campagne sera visible dans ceux où le produit est livré.', { n: all.length })}
        </p>
      ) : (
        <>
          {value.scope === 'MULTI_COUNTRY' && (
            <div className="zone__goal" role="radiogroup" aria-label={t('Objectif de la campagne')}>
              <label className="check"><input type="radio" name="goal-scope" checked={value.goal === 'GLOBAL'} disabled={goalLocked} onChange={() => onChange({ ...value, goal: 'GLOBAL' })} /><span><b>{t('Objectif commun')}</b> <span className="muted">{t('tous les pays remplissent le même conteneur')}</span></span></label>
              <label className="check"><input type="radio" name="goal-scope" checked={value.goal === 'PER_COUNTRY'} disabled={goalLocked} onChange={() => onChange({ ...value, goal: 'PER_COUNTRY' })} /><span><b>{t('Un objectif par pays')}</b> <span className="muted">{t('chaque pays suit son propre objectif')}</span></span></label>
              {goalLocked && <p className="tiny muted">{t('Des commandes existent : le type d’objectif ne peut plus changer.')}</p>}
            </div>
          )}

          <div className="zone__bar">
            <label className="zone__search">
              <Icon name="search" size={18} />
              <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Rechercher un pays…')} aria-label={t('Rechercher un pays')} />
            </label>
            {value.scope === 'MULTI_COUNTRY' && (
              <div className="row zone__bulk">
                <button type="button" className="btn btn--ghost btn--s" onClick={selectAll}>{t('Tout sélectionner')}</button>
                <button type="button" className="btn btn--ghost btn--s" onClick={clearAll} disabled={!value.picked.length}>{t('Tout désélectionner')}</button>
              </div>
            )}
          </div>
          {!productId && <p className="tiny muted">{t('Choisissez d’abord le produit : seuls les pays où il est livré peuvent être cochés.')}</p>}

          <div className={`zone__list ${perCountry ? 'zone__list--goals' : ''}`} role="group" aria-label={t('Pays participants')}>
            {shown.map((c) => {
              const on = picked.has(c.code);
              const entry = value.picked.find((p) => p.code === c.code);
              return (
                <div key={c.code} className={`zone__country ${on ? 'is-on' : ''} ${!c.delivered ? 'is-off' : ''}`}>
                  <label className="zone__pick">
                    <input type="checkbox" checked={on} disabled={!c.delivered && !on} onChange={() => toggle(c)} />
                    <span className="zone__flag" aria-hidden="true">{flagOf(c.code)}</span>
                    <span className="zone__name">
                      {c.name}
                      <span className="tiny muted">{c.delivered ? c.currency : t('Produit non livré')}</span>
                    </span>
                  </label>
                  {perCountry && on && (
                    <input className="input zone__target num" type="number" min={1} inputMode="numeric" value={entry?.target ?? ''} onChange={(e) => setTarget(c.code, e.target.value)}
                      placeholder={t('Objectif')} aria-label={t('Objectif pour {pays}', { pays: c.name })} />
                  )}
                </div>
              );
            })}
            {data && !matching.length && <p className="small muted">{t('Aucun pays ne correspond à « {q} ».', { q })}</p>}
          </div>
          {productId && hiddenCount > 0 && !q.trim() && (
            <button type="button" className="link small zone__more" onClick={() => setShowAll(!showAll)}>
              {showAll ? t('Masquer les pays où le produit n’est pas livré') : t('Voir aussi les {n} pays où le produit n’est pas livré', { n: hiddenCount })}
            </button>
          )}

          <div className="zone__count small" aria-live="polite">
            <span>{t('Nombre de pays sélectionnés : {n}', { n: value.picked.length })}</span>
            {perCountry && <span className="num">{t('Objectif total : {n}', { n: formatNumber(zoneTotal(value), lang) })}</span>}
          </div>
        </>
      )}

      {removed.length > 0 && (
        <div className="notice notice--warn">
          <Icon name="info" />
          <span>{t('Des clients de {pays} ont déjà commandé. Leurs commandes et paiements sont conservés, mais ce pays ne pourra plus commander ni payer de nouvelle commande.', { pays: removed.map((r) => r.name).join(', ') })}</span>
        </div>
      )}
    </fieldset>
  );
}

/** Liste courte des pays d'une campagne, avec drapeaux : « 🇨🇲 Cameroun, 🇬🇦 Gabon +2 ». */
export function ZoneCountries({ scope, countries, max = 3 }: { scope: GeoScope; countries: { code: string; name: string }[]; max?: number }) {
  const t = useT();
  if (scope === 'INTERNATIONAL') return <span className="muted">{t('Tous les pays actifs')}</span>;
  const head = countries.slice(0, max);
  return (
    <span className="zone-flags" title={countries.map((c) => c.name).join(', ')}>
      {head.map((c) => <span key={c.code}><span aria-hidden="true">{flagOf(c.code)}</span> {c.name}</span>)}
      {countries.length > max && <span className="muted"> +{countries.length - max}</span>}
    </span>
  );
}
