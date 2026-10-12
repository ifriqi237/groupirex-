import { useEffect, useMemo, useState } from 'react';
import { ErrorNote, Form, Input, Loading, Select, Tabs, useAction, useApi, useToast } from '../components/ui';
import { patch, post, put, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { N_, formatDate, useI18n, useT } from '../lib/i18n';
import { navigate, useLocation } from '../lib/router';
import { DataTable, MoneyField, Page, Pill, fromMinor, toMinor, useCurrencies } from './kit';

/* -------------------------------------------------------------------------- */
/* Devises, taux de change, pays                                               */
/* -------------------------------------------------------------------------- */

export function CurrenciesPage() {
  const t = useT();
  const { lang } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { search } = useLocation();
  const tab = (search.get('tab') ?? 'rates') as 'rates' | 'countries';
  const { data, error, reload } = useApi<any>('/admin/currencies');
  const countries = useApi<{ countries: any[] }>(tab === 'countries' ? '/admin/countries' : null);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [source, setSource] = useState('');
  const canEdit = can('currencies.manage');

  const save = useAction(async () => {
    const list = Object.entries(rates).filter(([, v]) => v.trim() !== '').map(([currency, rate]) => ({ currency, rate: rate.trim().replace(',', '.'), source: source.trim() }));
    await post('/admin/exchange-rates', { rates: list });
    setRates({});
    toast(t('{n} taux enregistrés. Les prix sont recalculés.', { n: list.length }));
    reload();
  });
  const toggleCountry = useAction(async (code: string, body: object) => {
    await patch(`/admin/countries/${code}`, body);
    countries.reload();
  });
  const step = useAction(async (code: string, roundingStep: number) => {
    await patch(`/admin/currencies/${code}`, { roundingStep });
    reload();
  });
  const pending = Object.values(rates).filter((v) => v.trim() !== '').length;

  return (
    <Page title={t('Devises et pays')}>
      <div style={{ marginBottom: 12 }}>
        <Tabs value={tab} onChange={(v) => navigate(`/admin/currencies?tab=${v}`)} items={[{ value: 'rates', label: t('Taux de change') }, { value: 'countries', label: t('Pays') }]} />
      </div>
      <ErrorNote error={error ?? countries.error ?? toggleCountry.error ?? step.error} onRetry={reload} />

      {tab === 'rates' && !data && !error && <Loading />}
      {tab === 'rates' && data && (
        <div className="stack">
          <div className="card small">
            <p>{t('Devise de référence : {ref}. Saisissez combien d’unités de chaque devise valent 1 {ref}. Chaque taux est conservé avec sa date et sa source ; les commandes déjà passées gardent le taux du jour de la commande.', { ref: data.referenceCurrency })}</p>
            <p className="muted" style={{ marginTop: 4 }}>{t('Marge de sécurité de change : {pct} %.', { pct: (data.fxBufferBps / 100).toString() })}{' '}
              {data.maxRateAgeHours > 0
                ? t('Un taux de plus de {h} heures bloque l’affichage des prix concernés.', { h: data.maxRateAgeHours })
                : t('L’âge des taux n’est pas contrôlé (réglage à 0).')}</p>
          </div>
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>{t('Devise')}</th><th className="r">{t('Taux actuel')}</th><th>{t('Date et source')}</th>{canEdit && <th>{t('Nouveau taux')}</th>}<th className="r">{t('Pas d’arrondi du prix')}</th></tr></thead>
              <tbody>
                {data.currencies.filter((c: any) => c.code !== data.referenceCurrency).map((c: any) => (
                  <tr key={c.code}>
                    <td><span className="strong">{c.code}</span> <span className="muted small">{c.name}</span></td>
                    <td className="r num">{c.rate ? c.rate.rate : <Pill tone="amber">{t('À saisir')}</Pill>}</td>
                    <td className="small">{c.rate ? <>{formatDate(c.rate.asOf, lang, true)}<br /><span className="muted">{c.rate.source}</span>{c.stale && <> <Pill tone="red">{t('Périmé')}</Pill></>}</> : '—'}</td>
                    {canEdit && <td><input className="input input--s num" style={{ width: 130 }} inputMode="decimal" value={rates[c.code] ?? ''} onChange={(e) => setRates({ ...rates, [c.code]: e.target.value })} aria-label={t('Nouveau taux pour {code}', { code: c.code })} /></td>}
                    <td className="r num">
                      {canEdit ? (
                        <input className="input input--s num" style={{ width: 96 }} inputMode="decimal" defaultValue={fromMinor(c.roundingStep, c.decimals)} aria-label={t('Pas d’arrondi pour {code}', { code: c.code })}
                          onBlur={(e) => { const v = toMinor(e.target.value, c.decimals); if (v && v !== c.roundingStep) step.run(c.code, v); }} />
                      ) : fromMinor(c.roundingStep, c.decimals)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <Form onSubmit={() => save.run()} className="card stack">
              <Input label={t('Source de ces taux')} value={source} onChange={(e) => setSource(e.target.value)} placeholder={t('Ex. : BEAC, cours du 4 octobre')} hint={t('Obligatoire : elle est conservée avec chaque taux pour l’audit.')} />
              <ErrorNote error={save.error} />
              <div><button className="btn btn--primary" disabled={save.busy || pending === 0 || source.trim().length < 2}>{t('Enregistrer {n} taux', { n: pending })}</button></div>
            </Form>
          )}
          <details>
            <summary className="link small">{t('Historique des taux saisis')}</summary>
            <div style={{ marginTop: 8 }}>
              <DataTable rows={data.history} rowKey={(h: any) => `${h.currency}-${h.asOf}`} empty={t('Aucun taux saisi.')}
                columns={[{ head: t('Devise'), cell: (h: any) => h.currency }, { head: t('Taux'), right: true, cell: (h: any) => h.rate }, { head: t('Date'), cell: (h: any) => formatDate(h.asOf, lang, true) }, { head: t('Source'), cell: (h: any) => h.source }, { head: t('Saisi par'), cell: (h: any) => h.author ?? '—' }]} />
            </div>
          </details>
        </div>
      )}

      {tab === 'countries' && (
        <DataTable rows={countries.data?.countries} rowKey={(c) => c.code} empty=""
          columns={[
            { head: t('Pays'), cell: (c) => <><span className="strong">{c.name}</span> <span className="muted small">{c.code}</span></> },
            { head: t('Devise'), cell: (c) => c.currency },
            { head: t('Utilisateurs'), right: true, cell: (c) => c.users },
            { head: t('Bureaux'), right: true, cell: (c) => c.offices },
            { head: t('Marge de change propre'), cell: (c) => (can('settings.manage') ? (
              <input className="input input--s num" style={{ width: 90 }} placeholder={t('globale')} defaultValue={c.fxBufferBps === null ? '' : String(c.fxBufferBps / 100)} aria-label={t('Marge de change pour {name}', { name: c.name })}
                onBlur={(e) => { const v = e.target.value.trim(); const bps = v === '' ? null : Math.round(Number(v.replace(',', '.')) * 100); if (bps !== c.fxBufferBps && (bps === null || !Number.isNaN(bps))) toggleCountry.run(c.code, { fxBufferBps: bps }); }} />
            ) : c.fxBufferBps === null ? t('globale') : `${c.fxBufferBps / 100} %`) },
            { head: t('Ouvert aux inscriptions'), cell: (c) => (can('settings.manage') ? <input type="checkbox" checked={c.isActive} onChange={(e) => toggleCountry.run(c.code, { isActive: e.target.checked })} style={{ width: 20, height: 20 }} aria-label={t('Ouvert aux inscriptions')} /> : c.isActive ? t('Oui') : t('Non')) },
          ]} />
      )}
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Langues et traductions                                                      */
/* -------------------------------------------------------------------------- */

export function LanguagesPage() {
  const t = useT();
  const { can } = useAuth();
  const toast = useToast();
  const { search } = useLocation();
  const editing = search.get('lang');
  const langs = useApi<{ languages: any[] }>('/admin/languages');
  const entries = useApi<{ entries: { key: string; source: string; value: string | null }[] }>(editing ? `/admin/translations/${editing}` : null);
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'missing' | 'all'>('missing');
  const [q, setQ] = useState('');
  useEffect(() => setChanges({}), [editing]);

  const toggle = useAction(async (code: string, isActive: boolean) => {
    await patch(`/admin/languages/${code}`, { isActive });
    langs.reload();
  });
  const save = useAction(async () => {
    await put(`/admin/translations/${editing}`, { entries: changes });
    toast(t('{n} textes enregistrés', { n: Object.keys(changes).length }));
    setChanges({});
    entries.reload();
    langs.reload();
  });
  const visible = useMemo(() => {
    const list = entries.data?.entries ?? [];
    const needle = q.trim().toLowerCase();
    return list.filter((e) => (filter === 'all' || !e.value || e.key in changes) && (!needle || e.source.toLowerCase().includes(needle) || (e.value ?? '').toLowerCase().includes(needle))).slice(0, 200);
  }, [entries.data, filter, q, changes]);

  if (editing) {
    const language = langs.data?.languages.find((l) => l.code === editing);
    return (
      <Page title={t('Textes : {name}', { name: language?.name ?? editing })} intro={t('Le texte français sert de référence. Un texte laissé vide s’affiche en français sur le site.')}
        actions={<button className="btn btn--ghost btn--s" onClick={() => navigate('/admin/languages')}>{t('Toutes les langues')}</button>}>
        <div className="toolbar">
          <input className="input input--s" placeholder={t('Rechercher un texte')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
          <select className="select select--s" value={filter} onChange={(e) => setFilter(e.target.value as 'missing' | 'all')} aria-label={t('Filtre')}>
            <option value="missing">{t('À traduire')}</option>
            <option value="all">{t('Tous les textes')}</option>
          </select>
          {can('content.manage') && <button className="btn btn--primary btn--s" disabled={save.busy || Object.keys(changes).length === 0} onClick={() => save.run()}>{t('Enregistrer {n} textes', { n: Object.keys(changes).length })}</button>}
        </div>
        <ErrorNote error={entries.error ?? save.error} />
        {!entries.data ? <Loading /> : visible.length === 0 ? <div className="card muted">{filter === 'missing' ? t('Tout est traduit.') : t('Aucun texte ne correspond.')}</div> : (
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th style={{ width: '45%' }}>{t('Français')}</th><th>{language?.nativeName ?? editing}</th></tr></thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={e.key}>
                    <td className="small">{e.source}</td>
                    <td><textarea className="textarea" dir={language?.isRtl ? 'rtl' : undefined} style={{ minHeight: 44, padding: '8px 10px' }} rows={1} value={changes[e.key] ?? e.value ?? ''} disabled={!can('content.manage')} onChange={(ev) => setChanges({ ...changes, [e.key]: ev.target.value })} aria-label={e.source} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Page>
    );
  }

  return (
    <Page title={t('Langues')} intro={t('Activer une langue la propose aux utilisateurs. Aucune modification du code n’est nécessaire : il suffit de saisir ses textes.')}>
      <ErrorNote error={langs.error ?? toggle.error} onRetry={langs.reload} />
      <DataTable rows={langs.data?.languages} rowKey={(l) => l.code} empty=""
        columns={[
          { head: t('Langue'), cell: (l) => <><span className="strong">{l.name}</span> <span className="muted">{l.nativeName}</span>{l.isRtl && <> <Pill>{t('Écriture de droite à gauche')}</Pill></>}</> },
          { head: t('Textes traduits'), cell: (l) => { const pct = l.total ? Math.round((l.translated / l.total) * 100) : 0; return <span className="num">{l.translated} / {l.total} ({pct} %)</span>; } },
          { head: t('Proposée aux utilisateurs'), cell: (l) => (can('settings.manage') ? <input type="checkbox" checked={l.isActive} disabled={l.code === 'fr' || toggle.busy} onChange={(e) => toggle.run(l.code, e.target.checked)} style={{ width: 20, height: 20 }} aria-label={t('Proposée aux utilisateurs')} /> : l.isActive ? t('Oui') : t('Non')) },
          { head: '', cell: (l) => <button className="btn btn--ghost btn--s" onClick={() => navigate(`/admin/languages?lang=${l.code}`)}>{l.code === 'fr' ? t('Modifier les textes') : t('Traduire')}</button> },
        ]} />
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Réglages                                                                    */
/* -------------------------------------------------------------------------- */

const COMPANY_FIELDS: [string, string][] = [
  ['company.legal_name', N_('Raison sociale')],
  ['company.legal_form', N_('Forme juridique')],
  ['company.capital', N_('Capital social')],
  ['company.address', N_('Adresse du siège social')],
  ['company.rccm', N_('Numéro RCCM')],
  ['company.tax_id', N_('Numéro d’identifiant unique (NIU)')],
  ['company.phone', N_('Téléphone de contact')],
  ['company.email', N_('Email de contact')],
  ['company.publication_director', N_('Directeur de la publication')],
  ['company.host', N_('Hébergeur du site (nom, adresse, téléphone)')],
];

const SUPPORT_FIELDS: [string, string][] = [
  ['support.email', N_('Email du support')],
  ['support.phone', N_('Téléphone du support')],
  ['support.whatsapp', N_('Numéro WhatsApp du support')],
];

export function SettingsPage() {
  const t = useT();
  const cur = useCurrencies();
  const toast = useToast();
  const { data, error, reload } = useApi<{ settings: Record<string, any>; officePayment: { isActive: boolean; minTotalAmount: number | null; minTotalCurrency: string | null } }>('/admin/settings');
  const [s, setS] = useState<Record<string, any>>({});
  const [office, setOffice] = useState({ isActive: true, amount: '', currency: 'XAF' });
  useEffect(() => {
    if (!data || !cur.list.length) return;
    setS(data.settings);
    const c = data.officePayment.minTotalCurrency ?? 'XAF';
    setOffice({ isActive: data.officePayment.isActive, amount: fromMinor(data.officePayment.minTotalAmount, cur.decimals(c)), currency: c });
  }, [data, cur.list.length]);
  const num = (k: string) => ({ value: s[k] ?? '', onChange: (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value === '' ? '' : Number(e.target.value) }) });

  const save = useAction(async () => {
    const settings = Object.fromEntries(Object.entries(s).filter(([k, v]) => (v !== '' || typeof data!.settings[k] === 'string') && v !== null && JSON.stringify(v) !== JSON.stringify(data!.settings[k])));
    if (Object.keys(settings).length) await put('/admin/settings', { settings });
    const amount = office.amount.trim() === '' ? null : toMinor(office.amount, cur.decimals(office.currency));
    await put('/admin/settings/office-payment', { isActive: office.isActive, minTotalAmount: amount, minTotalCurrency: amount === null ? null : office.currency });
    toast(t('Réglages enregistrés'));
    reload();
  });

  if (!data) return error ? <ErrorNote error={error} onRetry={reload} /> : <Loading />;
  return (
    <Page title={t('Réglages')}>
      <Form onSubmit={() => save.run()}>
        <div className="card stack">
          <h2 className="h3">{t('Paiement au bureau local')}</h2>
          <label className="check"><input type="checkbox" checked={office.isActive} onChange={(e) => setOffice({ ...office, isActive: e.target.checked })} /><span>{t('Proposer le paiement au bureau local')}</span></label>
          <div style={{ maxWidth: 360 }}>
            <MoneyField label={t('Proposé à partir d’un total de')} amount={office.amount} currency={office.currency} currencies={cur.list} allowEmpty onChange={(amount, currency) => setOffice({ ...office, amount, currency })}
              hint={t('Le total de la commande est converti dans cette devise avant d’être comparé au seuil. Vide : pas de seuil.')} />
          </div>
        </div>
        <div className="card stack">
          <h2 className="h3">{t('Prix')}</h2>
          <div className="form-grid form-grid--3">
            <Select label={t('Devise de référence des taux')} value={s['pricing.reference_currency'] ?? 'USD'} onChange={(e) => setS({ ...s, 'pricing.reference_currency': e.target.value })}>{cur.list.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</Select>
            <Input label={t('Marge de sécurité de change (points de base)')} type="number" min={0} max={5000} {...num('pricing.fx_buffer_bps')} hint={t('200 = 2 %. Ne s’applique qu’à la part du prix convertie d’une devise à une autre.')} />
            <Input label={t('Âge maximal d’un taux (heures)')} type="number" min={0} {...num('pricing.max_rate_age_hours')} hint={t('Au-delà, les prix concernés ne sont plus affichés. 0 : pas de contrôle.')} />
            <Select label={t('Devise des tableaux de bord')} value={s['reporting.currency'] ?? 'XAF'} onChange={(e) => setS({ ...s, 'reporting.currency': e.target.value })}>{cur.list.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</Select>
          </div>
        </div>
        <div className="card stack">
          <h2 className="h3">{t('Commandes')}</h2>
          <div className="form-grid form-grid--3">
            <Input label={t('Délai de paiement en ligne (minutes)')} type="number" min={5} {...num('orders.online_hold_minutes')} hint={t('Durée pendant laquelle une commande impayée retient ses quantités.')} />
            <Input label={t('Délai de paiement au bureau (heures)')} type="number" min={1} {...num('orders.office_hold_hours')} />
            <Input label={t('« Bientôt terminée » : préavis (heures)')} type="number" min={1} {...num('deals.ending_soon_hours')} />
            <Input label={t('Seuil d’alerte Matching (intérêts)')} type="number" min={1} {...num('matching.alert_threshold')} />
          </div>
          <label className="check"><input type="checkbox" checked={s['orders.require_verified_email'] ?? true} onChange={(e) => setS({ ...s, 'orders.require_verified_email': e.target.checked })} /><span>{t('Exiger une adresse email vérifiée pour commander')}</span></label>
        </div>
        <div className="card stack">
          <h2 className="h3">{t('Identité de l’entreprise')}</h2>
          <p className="small muted">{t('Imprimée sur les factures, proformas et reçus, et reprise dans les mentions légales et les conditions générales du site.')}</p>
          <div className="form-grid form-grid--2">
            {COMPANY_FIELDS.map(([key, label]) => (
              <Input key={key} label={t(label)} value={s[key] ?? ''} onChange={(e) => setS({ ...s, [key]: e.target.value })} />
            ))}
          </div>
        </div>
        <div className="card stack">
          <h2 className="h3">{t('Support client')}</h2>
          <p className="small muted">{t('Affiché sur la page Support du site. Laissez un champ vide pour masquer ce moyen de contact.')}</p>
          <div className="form-grid form-grid--2">
            {SUPPORT_FIELDS.map(([key, label]) => (
              <Input key={key} label={t(label)} value={s[key] ?? ''} onChange={(e) => setS({ ...s, [key]: e.target.value })} />
            ))}
          </div>
        </div>
        <ErrorNote error={save.error} />
        <div><button className="btn btn--primary" disabled={save.busy}>{t('Enregistrer les réglages')}</button></div>
      </Form>
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Journal d'audit et boîte d'envoi                                            */
/* -------------------------------------------------------------------------- */

export function AuditPage() {
  const t = useT();
  const { lang } = useI18n();
  const { search } = useLocation();
  const tab = (search.get('tab') ?? 'audit') as 'audit' | 'outbox';
  const [action, setAction] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const audit = useApi<{ items: any[] }>(tab === 'audit' ? `/admin/audit-logs${qs({ action, pageSize: 100 })}` : null);
  const outbox = useApi<{ items: any[] }>(tab === 'outbox' ? '/admin/outbox' : null);
  const groups = ['', 'office_payment', 'cash', 'logistics', 'shipping_rate', 'exchange_rate', 'deal', 'product', 'order', 'refund', 'user', 'role', 'setting', 'auth', 'matching', 'payment'];
  return (
    <Page title={t('Journal d’audit')} intro={t('Chaque action du personnel est enregistrée ici. Le journal ne peut être ni modifié ni effacé.')}>
      <div style={{ marginBottom: 12 }}>
        <Tabs value={tab} onChange={(v) => navigate(`/admin/audit?tab=${v}`)} items={[{ value: 'audit', label: t('Actions') }, { value: 'outbox', label: t('Messages envoyés') }]} />
      </div>
      {tab === 'audit' && (
        <>
          <div className="toolbar">
            <select className="select select--s" value={action} onChange={(e) => setAction(e.target.value)} aria-label={t('Type d’action')}>
              {groups.map((g) => <option key={g} value={g}>{g || t('Toutes les actions')}</option>)}
            </select>
          </div>
          <ErrorNote error={audit.error} onRetry={audit.reload} />
          <DataTable rows={audit.data?.items} rowKey={(a) => a.id} empty={t('Aucune action enregistrée.')}
            columns={[
              { head: t('Date'), cell: (a) => <span className="num small">{formatDate(a.createdAt, lang, true)}</span> },
              { head: t('Auteur'), cell: (a) => (a.actor ? <>{a.actor.name}<br /><span className="tiny muted">{a.actor.roles.filter((r: string) => r !== 'CUSTOMER').join(', ')}</span></> : <span className="muted">{t('Système')}</span>) },
              { head: t('Action'), cell: (a) => <><span className="strong">{a.action}</span>{a.reason && <><br /><span className="small">{a.reason}</span></>}</> },
              { head: t('Objet'), cell: (a) => <span className="small">{a.entityType} <span className="muted num">{String(a.entityId ?? '').slice(0, 13)}</span></span> },
              { head: t('Détail'), cell: (a) => (a.before || a.after ? <button className="link small" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? t('Masquer') : t('Voir')}</button> : null) },
            ]} />
          {open !== null && audit.data && (() => {
            const a = audit.data.items.find((x) => x.id === open);
            return a ? (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="strong">{a.action}</div>
                <div className="grid grid--2" style={{ marginTop: 8 }}>
                  <div><div className="tiny muted">{t('Avant')}</div><pre className="pre">{JSON.stringify(a.before, null, 2) ?? '—'}</pre></div>
                  <div><div className="tiny muted">{t('Après')}</div><pre className="pre">{JSON.stringify(a.after, null, 2) ?? '—'}</pre></div>
                </div>
                <p className="tiny muted" style={{ marginTop: 6 }}>{a.ip ?? ''}</p>
              </div>
            ) : null;
          })()}
        </>
      )}
      {tab === 'outbox' && (
        <>
          <p className="small muted" style={{ marginBottom: 8 }}>{t('Messages émis par la plateforme, par canal. Tant qu’aucun fournisseur d’email, de push ou de WhatsApp n’est branché, ils sont seulement consignés ici.')}</p>
          <ErrorNote error={outbox.error} onRetry={outbox.reload} />
          <DataTable rows={outbox.data?.items} rowKey={(m) => `${m.createdAt}-${m.channel}-${m.to}-${m.type}`} empty={t('Aucun message.')}
            columns={[
              { head: t('Date'), cell: (m) => <span className="num small">{formatDate(m.createdAt, lang, true)}</span> },
              { head: t('Canal'), cell: (m) => m.channel },
              { head: t('Destinataire'), cell: (m) => m.to },
              { head: t('Message'), cell: (m) => <><span className="strong">{m.type}</span>{m.link && <><br /><span className="tiny muted" style={{ overflowWrap: 'anywhere' }}>{m.link}</span></>}</> },
              { head: t('État'), cell: (m) => <Pill tone={m.status === 'SENT' ? 'green' : m.status === 'FAILED' ? 'red' : undefined}>{m.status}</Pill> },
            ]} />
        </>
      )}
    </Page>
  );
}

