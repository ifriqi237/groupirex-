import { useEffect, useState } from 'react';
import { Gauge, flagOf } from '../components/deal';
import { ErrorNote, Form, Icon, Input, Loading, Modal, Select, Tabs, useAction, useApi, useToast } from '../components/ui';
import { del, post, put, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { N_, formatDate, formatNumber, useI18n, useT } from '../lib/i18n';
import { Link, navigate, useLocation } from '../lib/router';
import { Confirm, DataTable, IconButton, MoneyField, Page, Pill, RowActions, fromLocalInput, fromMinor, toLocalInput, toMinor, useCurrencies } from './kit';
import { GeoScope, GoalScope, OrderedCountry, SCOPE_LABEL, ZoneCountries, ZoneCountry, ZoneField, ZoneValue, zonePayload, zoneProblem, zoneTotal } from './zone';

interface AdminDeal {
  id: string;
  slug: string;
  title: string;
  rawTitle: string | null;
  productId: string;
  productName: string;
  storedStatus: 'DRAFT' | 'PUBLISHED' | 'COMPLETED' | 'CANCELLED';
  status: string;
  needsDecision: boolean;
  basePrice: { amount: number; currency: string };
  compareAtAmount: number | null;
  targetQuantity: number;
  minQuantity: number;
  maxPerOrder: number | null;
  maxQuantity: number | null;
  paidQuantity: number;
  heldQuantity: number;
  percent: number;
  participants: number;
  paidOrders: number;
  pendingOrders: number;
  startsAt: string;
  endsAt: string;
  isFeatured: boolean;
  isBanner: boolean;
  cancelReason: string | null;
  geographicScope: GeoScope;
  goalScope: GoalScope;
  countries: { code: string; name: string; targetQuantity: number | null }[];
}

interface ZoneRow {
  country: { code: string; name: string };
  targetQuantity: number | null;
  paidQuantity: number;
  heldQuantity: number;
  participants: number;
  percent: number | null;
}

const SCOPE_TONE: Record<GeoScope, 'navy' | 'pink' | undefined> = { NATIONAL: 'pink', MULTI_COUNTRY: 'navy', INTERNATIONAL: undefined };

export const DEAL_STATUS: Record<string, [string, 'green' | 'amber' | 'red' | 'navy' | 'pink' | undefined]> = {
  DRAFT: [N_('Brouillon'), undefined],
  UPCOMING: [N_('À venir'), 'navy'],
  ACTIVE: [N_('En cours'), 'green'],
  TARGET_REACHED: [N_('Objectif atteint'), 'green'],
  EXPIRED: [N_('Terminée, objectif non atteint'), 'amber'],
  COMPLETED: [N_('Confirmée'), 'navy'],
  CANCELLED: [N_('Annulée'), 'red'],
};

function DealForm({ deal, onDone, onClose }: { deal: AdminDeal | null; onDone: () => void; onClose: () => void }) {
  const t = useT();
  const cur = useCurrencies();
  const products = useApi<{ items: { id: string; name: string; moq: number; basePrice: { amount: number; currency: string } }[] }>('/admin/products?pageSize=100');
  const [f, setF] = useState({
    productId: deal?.productId ?? '',
    title: deal?.rawTitle ?? '',
    baseAmount: '', baseCurrency: deal?.basePrice.currency ?? 'USD',
    compareAt: '',
    target: String(deal?.targetQuantity ?? ''),
    min: String(deal?.minQuantity ?? ''),
    maxPerOrder: deal?.maxPerOrder?.toString() ?? '',
    maxQuantity: deal?.maxQuantity?.toString() ?? '',
    startsAt: toLocalInput(deal?.startsAt ?? new Date().toISOString()),
    endsAt: toLocalInput(deal?.endsAt ?? new Date(Date.now() + 14 * 86_400_000).toISOString()),
    isFeatured: deal?.isFeatured ?? false,
    isBanner: deal?.isBanner ?? false,
  });
  const [zone, setZone] = useState<ZoneValue>({
    scope: deal?.geographicScope ?? 'INTERNATIONAL',
    goal: deal?.goalScope ?? 'GLOBAL',
    picked: (deal?.countries ?? []).map((c) => ({ code: c.code, target: c.targetQuantity ? String(c.targetQuantity) : '' })),
  });
  // En modification : les pays d'où des clients ont déjà commandé, pour prévenir avant un retrait.
  const detail = useApi<{ byCountry: { country: { code: string; name: string }; orders: number }[]; zone: ZoneRow[] }>(deal ? `/admin/deals/${deal.id}` : null);
  const ordered: OrderedCountry[] = (() => {
    const m = new Map<string, OrderedCountry>();
    for (const x of detail.data?.byCountry ?? []) m.set(x.country.code, { code: x.country.code, name: x.country.name, orders: x.orders });
    for (const z of detail.data?.zone ?? []) if (z.paidQuantity + z.heldQuantity > 0 && !m.has(z.country.code)) m.set(z.country.code, { code: z.country.code, name: z.country.name, orders: 1 });
    return [...m.values()];
  })();
  const perCountry = zone.scope === 'MULTI_COUNTRY' && zone.goal === 'PER_COUNTRY';
  const dec = cur.decimals(f.baseCurrency);
  useEffect(() => {
    if (!deal || !cur.list.length) return;
    setF((s) => ({ ...s, baseAmount: fromMinor(deal.basePrice.amount, cur.decimals(deal.basePrice.currency)), compareAt: fromMinor(deal.compareAtAmount, cur.decimals(deal.basePrice.currency)) }));
  }, [deal, cur.list.length]);
  // À la création, le prix et le minimum du produit sont proposés par défaut.
  const pickProduct = (id: string) => {
    const p = products.data?.items.find((x) => x.id === id);
    setF((s) => ({ ...s, productId: id, ...(p && !deal ? { baseAmount: fromMinor(p.basePrice.amount, cur.decimals(p.basePrice.currency)), baseCurrency: p.basePrice.currency, min: String(p.moq) } : {}) }));
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const [problem, setProblem] = useState('');
  const save = useAction(async () => {
    setProblem('');
    const base = toMinor(f.baseAmount, dec);
    if (!f.productId) return setProblem(t('Choisissez un produit.'));
    if (base === null) return setProblem(t('Le prix de base est invalide.'));
    const zp = zoneProblem(zone, t);
    if (zp) return setProblem(zp);
    const target = perCountry ? zoneTotal(zone) : Number(f.target);
    if (!target) return setProblem(t('Indiquez l’objectif collectif.'));
    const body = {
      productId: f.productId, title: f.title.trim() || null, basePrice: { amount: base, currency: f.baseCurrency },
      compareAtAmount: f.compareAt.trim() ? toMinor(f.compareAt, dec) : null,
      targetQuantity: target, minQuantity: Number(f.min) || undefined,
      maxPerOrder: f.maxPerOrder ? Number(f.maxPerOrder) : null, maxQuantity: f.maxQuantity ? Number(f.maxQuantity) : null,
      startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt), isFeatured: f.isFeatured, isBanner: f.isBanner,
      ...zonePayload(zone),
    };
    await (deal ? put(`/admin/deals/${deal.id}`, body) : post('/admin/deals', body));
    onDone();
    onClose();
  });
  const locked = !!deal && deal.paidOrders + deal.pendingOrders > 0;
  return (
    <Modal title={deal ? t('Modifier la campagne') : t('Nouvelle campagne')} onClose={onClose} wide>
      <Form onSubmit={() => save.run()}>
        {locked && <div className="notice"><Icon name="info" /><span>{t('Des commandes existent déjà : le produit, le prix et le minimum de commande ne peuvent plus changer.')}</span></div>}
        <div className="form-grid form-grid--2">
          <Select label={t('Produit')} value={f.productId} onChange={(e) => pickProduct(e.target.value)} disabled={locked}>
            <option value="">{t('Choisir un produit')}</option>
            {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Input label={t('Titre de la campagne (facultatif)')} value={f.title} onChange={set('title')} hint={t('Par défaut : le nom du produit.')} />
          <MoneyField label={t('Prix de base de la campagne')} amount={f.baseAmount} currency={f.baseCurrency} currencies={cur.list} onChange={(a, c) => !locked && setF({ ...f, baseAmount: a, baseCurrency: c })} hint={t('La livraison du pays s’y ajoute automatiquement.')} />
          <MoneyField label={t('Ancien prix barré (facultatif)')} amount={f.compareAt} currency={f.baseCurrency} currencies={cur.list} fixedCurrency allowEmpty onChange={(a) => setF({ ...f, compareAt: a })} />
          {perCountry
            ? <Input label={t('Objectif collectif')} type="number" value={String(zoneTotal(zone))} disabled hint={t('Somme des objectifs par pays, plus bas.')} />
            : <Input label={t('Objectif collectif')} type="number" min={1} value={f.target} onChange={set('target')} hint={zone.scope === 'NATIONAL' ? t('Quantité visée dans le pays de la campagne.') : t('Quantité totale visée, en unités de vente.')} />}
          <Input label={t('Minimum par commande (MOQ)')} type="number" min={1} value={f.min} onChange={set('min')} disabled={locked} />
          <Input label={t('Maximum par commande')} type="number" min={1} value={f.maxPerOrder} onChange={set('maxPerOrder')} hint={t('Vide : pas de limite.')} />
          <Input label={t('Plafond de la campagne')} type="number" min={1} value={f.maxQuantity} onChange={set('maxQuantity')} hint={t('Vide : pas de plafond. Sinon, aucune vente au-delà.')} />
          <Input label={t('Début')} type="datetime-local" value={f.startsAt} onChange={set('startsAt')} />
          <Input label={t('Fin')} type="datetime-local" value={f.endsAt} onChange={set('endsAt')} />
        </div>
        <ZoneField productId={f.productId} value={zone} onChange={setZone} ordered={ordered} goalLocked={locked} />
        <label className="check"><input type="checkbox" checked={f.isFeatured} onChange={(e) => setF({ ...f, isFeatured: e.target.checked })} /><span>{t('Mettre à la une sur l’accueil')}</span></label>
        <label className="check"><input type="checkbox" checked={f.isBanner} onChange={(e) => setF({ ...f, isBanner: e.target.checked, isFeatured: e.target.checked || f.isFeatured })} /><span>{t('Afficher dans la bannière de l’accueil')}<br /><span className="tiny muted">{t('La grande carte en haut de l’accueil montre cette campagne. Une seule campagne à la fois : celle qui y était est remplacée.')}</span></span></label>
        {problem && <div className="notice notice--error" role="alert"><Icon name="alert" /><span>{problem}</span></div>}
        <ErrorNote error={save.error} />
        <button className="btn btn--primary" disabled={save.busy || !!zoneProblem(zone, t)}>{deal ? t('Enregistrer la campagne') : t('Créer le brouillon')}</button>
      </Form>
    </Modal>
  );
}

/** Fin de campagne : prolonger, confirmer malgré tout, ou annuler et rembourser (§51, point 4). */
function DecideModal({ deal, onDone, onClose }: { deal: AdminDeal; onDone: () => void; onClose: () => void }) {
  const t = useT();
  const { lang } = useI18n();
  const [type, setType] = useState<'EXTEND' | 'CONFIRM' | 'CANCEL'>(deal.percent >= 100 ? 'CONFIRM' : 'EXTEND');
  const [newEndsAt, setNewEndsAt] = useState(toLocalInput(new Date(Date.now() + 7 * 86_400_000).toISOString()));
  const [reason, setReason] = useState('');
  const decide = useAction(async () => {
    await post(`/admin/deals/${deal.id}/decide`, type === 'EXTEND' ? { type, newEndsAt: fromLocalInput(newEndsAt) } : type === 'CANCEL' ? { type, reason } : { type });
    onDone();
    onClose();
  });
  return (
    <Modal title={t('Décision sur la campagne')} onClose={onClose}>
      <div className="stack">
        <div>
          <div className="strong">{deal.title}</div>
          <Gauge percent={deal.percent} label={t('Progression')} />
          <p className="small num" style={{ marginTop: 6 }}>{t('{paid} payés sur un objectif de {target} ({percent} %), {orders} commandes payées, {pending} en attente.', { paid: formatNumber(deal.paidQuantity, lang), target: formatNumber(deal.targetQuantity, lang), percent: deal.percent, orders: deal.paidOrders, pending: deal.pendingOrders })}</p>
        </div>
        <label className="choice">
          <input type="radio" name="decision" checked={type === 'EXTEND'} onChange={() => setType('EXTEND')} />
          <div className="grow"><div className="strong">{t('Prolonger')}</div><p className="small muted">{t('La campagne rouvre jusqu’à la nouvelle date. Rien ne change pour les commandes payées.')}</p>
            {type === 'EXTEND' && <input className="input" style={{ marginTop: 8 }} type="datetime-local" value={newEndsAt} onChange={(e) => setNewEndsAt(e.target.value)} aria-label={t('Nouvelle date de fin')} />}
          </div>
        </label>
        <label className="choice">
          <input type="radio" name="decision" checked={type === 'CONFIRM'} onChange={() => setType('CONFIRM')} />
          <div><div className="strong">{t('Confirmer la commande groupée')}</div><p className="small muted">{t('La campagne est close et une expédition est ouverte pour chaque pays. Les commandes payées partent en production.')}</p></div>
        </label>
        <label className="choice">
          <input type="radio" name="decision" checked={type === 'CANCEL'} onChange={() => setType('CANCEL')} />
          <div className="grow"><div className="strong">{t('Annuler et rembourser')}</div><p className="small muted">{t('Les {n} commandes payées passent en remboursement, à traiter par la finance. Les commandes impayées sont annulées.', { n: deal.paidOrders })}</p>
            {type === 'CANCEL' && <textarea className="textarea" style={{ marginTop: 8, minHeight: 70 }} placeholder={t('Motif, communiqué aux clients')} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </div>
        </label>
        <ErrorNote error={decide.error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn--ghost" onClick={onClose}>{t('Plus tard')}</button>
          <button className={`btn ${type === 'CANCEL' ? 'btn--danger' : 'btn--primary'}`} disabled={decide.busy || (type === 'CANCEL' && reason.trim().length < 3)} onClick={() => decide.run()}>
            {type === 'EXTEND' ? t('Prolonger la campagne') : type === 'CONFIRM' ? t('Confirmer la commande groupée') : t('Annuler la campagne')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function DealsAdminPage() {
  const t = useT();
  const { lang } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { search } = useLocation();
  const status = search.get('status') ?? '';
  const scope = search.get('scope') ?? '';
  const country = search.get('country') ?? '';
  const { data, error, reload } = useApi<{ items: AdminDeal[] }>(`/admin/deals${qs({ status, scope, country, pageSize: 100 })}`);
  const zoneCountries = useApi<{ countries: ZoneCountry[] }>('/admin/deal-zone-countries');
  const go = (next: Record<string, string>) => navigate(`/admin/deals${qs({ status, scope, country, ...next })}`);
  const [editing, setEditing] = useState<AdminDeal | null | 'new'>(null);
  const [deciding, setDeciding] = useState<AdminDeal | null>(null);
  const [deleting, setDeleting] = useState<AdminDeal | null>(null);
  const publish = useAction(async (d: AdminDeal) => {
    await post(`/admin/deals/${d.id}/publish`);
    toast(t('Campagne publiée'));
    reload();
  });
  const manage = can('deals.manage');

  return (
    <Page title={t('Campagnes')} actions={manage && <button className="btn btn--primary" onClick={() => setEditing('new')}><Icon name="plus" /> {t('Nouvelle campagne')}</button>}>
      <div style={{ marginBottom: 12 }}>
        <Tabs value={status} onChange={(v) => go({ status: v })}
          items={[{ value: '', label: t('Toutes') }, { value: 'NEEDS_DECISION', label: t('Décision à prendre') }, { value: 'ACTIVE', label: t('Actives') }, { value: 'ENDED', label: t('Terminées') }, { value: 'PUBLISHED', label: t('Publiées') }, { value: 'DRAFT', label: t('Brouillons') }, { value: 'COMPLETED', label: t('Confirmées') }, { value: 'CANCELLED', label: t('Annulées') }]} />
      </div>
      <div className="toolbar">
        <select className="select select--s" value={scope} onChange={(e) => go({ scope: e.target.value })} aria-label={t('Type de campagne')}>
          <option value="">{t('Toutes les campagnes')}</option>
          <option value="NATIONAL">{t('Campagnes nationales')}</option>
          <option value="MULTI_COUNTRY">{t('Campagnes multipays')}</option>
          <option value="INTERNATIONAL">{t('Campagnes internationales')}</option>
        </select>
        <select className="select select--s" value={country} onChange={(e) => go({ country: e.target.value })} aria-label={t('Filtrer par pays')}>
          <option value="">{t('Tous les pays')}</option>
          {zoneCountries.data?.countries.map((c) => <option key={c.code} value={c.code}>{flagOf(c.code)} {c.name}</option>)}
        </select>
      </div>
      <ErrorNote error={error ?? publish.error} onRetry={reload} />
      <DataTable
        rows={data?.items}
        rowKey={(d) => d.id}
        empty={t('Aucune campagne dans cette vue.')}
        columns={[
          { head: t('Campagne'), cell: (d) => <><Link to={`/admin/deals/${d.id}`}>{d.title}</Link>{d.isBanner && <> <Pill tone="pink">{t('Bannière')}</Pill></>}<br /><span className="tiny muted">{formatDate(d.startsAt, lang)} – {formatDate(d.endsAt, lang, true)}</span></> },
          { head: t('Type'), cell: (d) => <Pill tone={SCOPE_TONE[d.geographicScope ?? 'INTERNATIONAL']}>{t(SCOPE_LABEL[d.geographicScope ?? 'INTERNATIONAL'])}</Pill> },
          { head: t('Pays autorisés'), cell: (d) => <span className="small"><ZoneCountries scope={d.geographicScope ?? 'INTERNATIONAL'} countries={d.countries ?? []} /></span> },
          { head: t('Participants'), right: true, cell: (d) => formatNumber(d.participants, lang) },
          { head: t('État'), cell: (d) => <Pill tone={DEAL_STATUS[d.status]?.[1]}>{t(DEAL_STATUS[d.status]?.[0] ?? d.status)}</Pill> },
          { head: t('Progression'), width: 190, cell: (d) => <><Gauge percent={d.percent} label={t('Progression')} /><span className="tiny num">{formatNumber(d.paidQuantity, lang)} / {formatNumber(d.targetQuantity, lang)} ({d.percent} %)</span></> },
          { head: t('Payées'), right: true, cell: (d) => d.paidOrders },
          { head: t('En attente'), right: true, cell: (d) => d.pendingOrders },
          { head: '', cell: (d) => (
            <RowActions>
              {d.needsDecision && can('deals.decide') && <button className="btn btn--primary btn--s" onClick={() => setDeciding(d)}>{t('Décider')}</button>}
              {!d.needsDecision && d.storedStatus === 'PUBLISHED' && can('deals.decide') && <button className="btn btn--ghost btn--s" onClick={() => setDeciding(d)}>{t('Clore ou prolonger')}</button>}
              {d.storedStatus === 'DRAFT' && manage && <button className="btn btn--navy btn--s" onClick={() => publish.run(d)} disabled={publish.busy}>{t('Publier')}</button>}
              {manage && ['DRAFT', 'PUBLISHED'].includes(d.storedStatus) && <IconButton icon="edit" label={t('Modifier')} onClick={() => setEditing(d)} />}
              {manage && d.storedStatus === 'DRAFT' && <IconButton icon="trash" label={t('Supprimer')} onClick={() => setDeleting(d)} />}
            </RowActions>
          ) },
        ]}
      />
      {editing && <DealForm deal={editing === 'new' ? null : editing} onDone={reload} onClose={() => setEditing(null)} />}
      {deciding && <DecideModal deal={deciding} onDone={() => { toast(t('Décision enregistrée')); reload(); }} onClose={() => setDeciding(null)} />}
      {deleting && <Confirm title={t('Supprimer ce brouillon ?')} confirmLabel={t('Supprimer')} danger onClose={() => setDeleting(null)} onConfirm={async () => { await del(`/admin/deals/${deleting.id}`); reload(); }} />}
    </Page>
  );
}

export function DealAdminPage({ id }: { id: string }) {
  const t = useT();
  const { lang } = useI18n();
  const cur = useCurrencies();
  const { data, error, reload } = useApi<{ deal: AdminDeal; byCountry: any[]; zone: ZoneRow[] }>(`/admin/deals/${id}`);
  if (!data) return error ? <ErrorNote error={error} onRetry={reload} /> : <Loading />;
  const d = data.deal;
  return (
    <Page title={d.title} actions={<Link to={`/deals/${d.slug}`} className="btn btn--ghost btn--s">{t('Voir sur le site')}</Link>}>
      <Link to="/admin/deals" className="link small">{t('Toutes les campagnes')}</Link>
      <div className="stack" style={{ marginTop: 12 }}>
        <div className="card stack">
          <div className="row row--between row--wrap"><Pill tone={DEAL_STATUS[d.status]?.[1]}>{t(DEAL_STATUS[d.status]?.[0] ?? d.status)}</Pill><span className="small muted">{formatDate(d.startsAt, lang, true)} – {formatDate(d.endsAt, lang, true)}</span></div>
          <Gauge percent={d.percent} large label={t('Progression')} />
          <dl className="kv">
            <dt>{t('Payé / objectif')}</dt><dd className="num">{formatNumber(d.paidQuantity, lang)} / {formatNumber(d.targetQuantity, lang)} ({d.percent} %)</dd>
            <dt>{t('Retenu par des commandes en attente')}</dt><dd className="num">{formatNumber(d.heldQuantity, lang)}</dd>
            <dt>{t('Plafond')}</dt><dd className="num">{d.maxQuantity ? formatNumber(d.maxQuantity, lang) : t('Aucun')}</dd>
            <dt>{t('Prix de base')}</dt><dd className="num">{fromMinor(d.basePrice.amount, cur.decimals(d.basePrice.currency))} {d.basePrice.currency}</dd>
            <dt>{t('Minimum par commande')}</dt><dd className="num">{d.minQuantity}</dd>
            <dt>{t('Participants')}</dt><dd className="num">{d.participants}</dd>
            <dt>{t('Zone')}</dt><dd><Pill tone={SCOPE_TONE[d.geographicScope ?? 'INTERNATIONAL']}>{t(SCOPE_LABEL[d.geographicScope ?? 'INTERNATIONAL'])}</Pill></dd>
            <dt>{t('Pays autorisés')}</dt><dd><ZoneCountries scope={d.geographicScope ?? 'INTERNATIONAL'} countries={d.countries ?? []} max={20} /></dd>
            <dt>{t('Objectif')}</dt><dd>{d.goalScope === 'PER_COUNTRY' ? t('Un objectif par pays') : t('Objectif commun')}</dd>
            {d.cancelReason && (<><dt>{t('Motif d’annulation')}</dt><dd>{d.cancelReason}</dd></>)}
          </dl>
          <div className="row row--wrap">
            <Link to={`/admin/orders?dealId=${d.id}`} className="btn btn--ghost btn--s">{t('Voir les commandes')}</Link>
            <Link to={`/admin/products/${d.productId}?tab=pricing`} className="btn btn--ghost btn--s">{t('Prix par pays')}</Link>
          </div>
        </div>
        {(data.zone?.length ?? 0) > 0 && (
          <>
            <h2 className="h3">{t('Avancement par pays autorisé')}</h2>
            <DataTable rows={data.zone} rowKey={(x) => x.country.code} empty={t('Aucun pays.')}
              columns={[
                { head: t('Pays'), cell: (x) => <ZoneCountries scope="NATIONAL" countries={[x.country]} /> },
                ...(d.goalScope === 'PER_COUNTRY' ? [{ head: t('Objectif'), right: true, cell: (x: ZoneRow) => formatNumber(x.targetQuantity ?? 0, lang) }] : []),
                { head: t('Payé'), right: true, cell: (x) => formatNumber(x.paidQuantity, lang) },
                { head: t('En attente'), right: true, cell: (x) => formatNumber(x.heldQuantity, lang) },
                { head: t('Participants'), right: true, cell: (x) => x.participants },
                ...(d.goalScope === 'PER_COUNTRY' ? [{ head: t('Progression'), width: 170, cell: (x: ZoneRow) => <><Gauge percent={x.percent ?? 0} label={t('Progression')} /><span className="tiny num">{x.percent ?? 0} %</span></> }] : []),
              ]} />
          </>
        )}
        <h2 className="h3">{t('Ventes par pays')}</h2>
        <DataTable rows={data.byCountry} rowKey={(x: any) => x.country.code} empty={t('Aucune commande payée pour le moment.')}
          columns={[{ head: t('Pays'), cell: (x: any) => x.country.name }, { head: t('Commandes'), right: true, cell: (x: any) => x.orders }, { head: t('Quantité'), right: true, cell: (x: any) => formatNumber(x.units, lang) }, { head: t('Chiffre d’affaires'), right: true, cell: (x: any) => x.revenue.formatted }]} />
      </div>
    </Page>
  );
}
