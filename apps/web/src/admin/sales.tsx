import { useState } from 'react';
import { LOGISTICS_STEPS } from '@groupdeals/core';
import { ErrorNote, Icon, Input, Loading, Modal, Tabs, useAction, useApi, useToast } from '../components/ui';
import { downloadDocument, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { N_, formatDate, useI18n, useT } from '../lib/i18n';
import { Link, navigate, useLocation } from '../lib/router';
import { STATUS_LABEL, STEP_LABEL, StatusBadge } from '../pages/orders';
import { Confirm, DataTable, Page, Pill, fromMinor, useCurrencies } from './kit';

const BUCKETS = ['PENDING_PAYMENT', 'PAID', 'IN_PRODUCTION', 'SHIPPED', 'READY_FOR_PICKUP', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'];

export function OrdersAdminPage() {
  const t = useT();
  const { lang } = useI18n();
  const { search } = useLocation();
  const [q, setQ] = useState('');
  const status = search.get('status') ?? '';
  const dealId = search.get('dealId') ?? '';
  const method = search.get('method') ?? '';
  const { data, error, reload } = useApi<{ items: any[]; total: number }>(`/admin/orders${qs({ q, status, dealId, method, pageSize: 100 })}`);
  const go = (patch: Record<string, string>) => navigate(`/admin/orders${qs({ status, dealId, method, ...patch })}`);
  return (
    <Page title={t('Commandes')} intro={data ? t('{n} commandes dans cette vue', { n: data.total }) : undefined}>
      <div className="toolbar">
        <input className="input input--s" placeholder={t('Numéro, nom ou email')} aria-label={t('Numéro, nom ou email')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <select className="select select--s" value={status} onChange={(e) => go({ status: e.target.value })} aria-label={t('État')}>
          <option value="">{t('Tous les états')}</option>
          {BUCKETS.map((b) => <option key={b} value={b}>{t(STATUS_LABEL[b])}</option>)}
        </select>
        <select className="select select--s" value={method} onChange={(e) => go({ method: e.target.value })} aria-label={t('Paiement')}>
          <option value="">{t('Tous les paiements')}</option>
          <option value="ONLINE">{t('En ligne')}</option>
          <option value="OFFICE">{t('Bureau local')}</option>
        </select>
        {dealId && <button className="chip" aria-pressed="true" onClick={() => go({ dealId: '' })}>{t('Une seule campagne')} ×</button>}
      </div>
      <ErrorNote error={error} onRetry={reload} />
      <DataTable
        rows={data?.items}
        rowKey={(o) => o.id}
        empty={t('Aucune commande ne correspond.')}
        columns={[
          { head: t('Commande'), cell: (o) => <><Link to={`/admin/orders/${o.id}`} className="num">{o.number}</Link><br /><span className="tiny muted">{formatDate(o.createdAt, lang, true)}</span></> },
          { head: t('Client'), cell: (o) => <>{o.customer.name}<br /><span className="tiny muted">{o.customer.email}</span></> },
          { head: t('Produit'), cell: (o) => o.productName },
          { head: t('Pays'), cell: (o) => o.country },
          { head: t('Paiement'), cell: (o) => (o.paymentMethod === 'OFFICE' ? t('Bureau') : t('En ligne')) },
          { head: t('État'), cell: (o) => <StatusBadge status={o.status} /> },
          { head: t('Quantité'), right: true, cell: (o) => o.quantity },
          { head: t('Total'), right: true, cell: (o) => o.total.formatted },
        ]}
      />
    </Page>
  );
}

const PAYMENT_STATUS: Record<string, [string, 'green' | 'amber' | 'red' | undefined]> = {
  SUCCESSFUL: [N_('Réussi'), 'green'],
  FAILED: [N_('Échoué'), 'red'],
  REJECTED: [N_('Rejeté'), 'red'],
  REFUND_REQUIRED: [N_('À rembourser'), 'amber'],
  REFUNDED: [N_('Remboursé'), undefined],
  INITIATED: [N_('Commencé'), undefined],
};

/** Détail interne : le seul écran où les composants du prix sont visibles (§17). */
export function OrderAdminPage({ id }: { id: string }) {
  const t = useT();
  const { lang } = useI18n();
  const { can } = useAuth();
  const cur = useCurrencies();
  const toast = useToast();
  const { data, error, reload } = useApi<any>(`/admin/orders/${id}`);
  const [cancelling, setCancelling] = useState(false);
  const doc = useAction((url: string) => downloadDocument(url));
  if (!data) return error ? <ErrorNote error={error} onRetry={reload} /> : <Loading />;
  const o = data.order;
  const src = (m: { amount: number; currency: string }) => `${fromMinor(m.amount, cur.decimals(m.currency))} ${m.currency}`;
  return (
    <Page title={o.number} actions={<StatusBadge status={o.status} />}>
      <Link to="/admin/orders" className="link small">{t('Toutes les commandes')}</Link>
      <div className="stack" style={{ marginTop: 12 }}>
        <div className="grid grid--2">
          <div className="card">
            <h2 className="h3" style={{ marginBottom: 8 }}>{t('Client')}</h2>
            <dl className="kv">
              <dt>{t('Nom')}</dt><dd>{o.customer.name}</dd>
              <dt>{t('Email')}</dt><dd>{o.customer.email}</dd>
              <dt>WhatsApp</dt><dd className="num">{o.customer.whatsapp}</dd>
              <dt>{t('Pays de la commande')}</dt><dd>{o.country} ({o.currency})</dd>
            </dl>
          </div>
          <div className="card">
            <h2 className="h3" style={{ marginBottom: 8 }}>{t('Commande')}</h2>
            <dl className="kv">
              <dt>{t('Campagne')}</dt><dd><Link to={`/admin/deals/${o.deal.id}`} className="link">{o.deal.title}</Link></dd>
              <dt>{t('Créée le')}</dt><dd>{formatDate(o.createdAt, lang, true)}</dd>
              <dt>{t('Paiement')}</dt><dd>{o.paymentMethod === 'OFFICE' ? t('Bureau local') : t('En ligne')}</dd>
              <dt>{o.paidAt ? t('Payée le') : t('À payer avant le')}</dt><dd>{formatDate(o.paidAt ?? o.expiresAt, lang, true)}</dd>
              <dt>{t('Référence de paiement')}</dt><dd className="num">{o.txRef}</dd>
              {o.cancelReason && (<><dt>{t('Motif')}</dt><dd>{o.cancelReason}</dd></>)}
            </dl>
          </div>
        </div>

        <div>
          <h2 className="h3" style={{ marginBottom: 8 }}>{t('Lignes et composants du prix')}</h2>
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>{t('Article')}</th><th className="r">{t('Quantité')}</th><th className="r">{t('Prix de base')}</th><th className="r">{t('Livraison')}</th><th className="r">{t('Arrondi')}</th><th className="r">{t('Prix final unitaire')}</th><th className="r">{t('Total')}</th><th className="r">{t('Marge unitaire estimée')}</th></tr></thead>
              <tbody>
                {data.items.map((i: any, n: number) => (
                  <tr key={n}>
                    <td><span className="strong">{i.productName}</span>{i.variantLabel && <><br /><span className="tiny muted">{i.variantLabel}</span></>}</td>
                    <td className="r num">{i.quantity}</td>
                    <td className="r num">{i.priceBreakdown.baseConverted.formatted}<br /><span className="tiny muted">{src(i.priceBreakdown.baseSource)}</span></td>
                    <td className="r num">{i.priceBreakdown.shippingConverted.formatted}<br /><span className="tiny muted">{src(i.priceBreakdown.shippingSource)}</span></td>
                    <td className="r num">{i.priceBreakdown.roundingAdjustment.formatted}</td>
                    <td className="r num strong">{i.unitFinal.formatted}</td>
                    <td className="r num strong">{i.lineTotal.formatted}</td>
                    <td className="r num">{i.priceBreakdown.estimatedUnitMargin ? `${i.priceBreakdown.estimatedUnitMargin.negative ? '−' : ''}${i.priceBreakdown.estimatedUnitMargin.formatted}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.items[0] && (
            <p className="tiny muted" style={{ marginTop: 6 }}>
              {t('Calcul figé le {date}. Marge de change : {bps} points de base.', { date: formatDate(data.items[0].priceBreakdown.computedAt, lang, true), bps: data.items[0].priceBreakdown.fxBufferBps })}{' '}
              {Object.entries(data.items[0].priceBreakdown.ratesUsed as Record<string, any>).map(([code, r]) => `1 ${data.items[0].priceBreakdown.referenceCurrency} = ${r.rate} ${code} (${r.source}, ${formatDate(r.asOf, lang)})`).join(' ; ')}
            </p>
          )}
        </div>

        <div className="grid grid--2">
          <div className="card">
            <h2 className="h3" style={{ marginBottom: 8 }}>{t('Paiements')}</h2>
            {data.payments.length === 0 && <p className="muted small">{t('Aucun paiement enregistré.')}</p>}
            {data.payments.map((p: any) => (
              <div key={p.id} className="row row--between" style={{ paddingBlock: 6, borderBottom: '1px solid var(--line)' }}>
                <span><Pill tone={PAYMENT_STATUS[p.status]?.[1]}>{t(PAYMENT_STATUS[p.status]?.[0] ?? p.status)}</Pill> <span className="small">{p.provider}{p.channel ? `, ${p.channel}` : ''}</span><br /><span className="tiny muted num">{p.providerTxId ?? ''} {formatDate(p.createdAt, lang, true)}{p.rejectReason ? `, ${p.rejectReason}` : ''}</span></span>
                <span className="num strong">{p.amount.formatted}</span>
              </div>
            ))}
            {data.refunds.map((x: any) => (
              <div key={x.id} className="row row--between" style={{ paddingBlock: 6 }}>
                <span><Pill tone={x.status === 'PENDING' ? 'amber' : undefined}>{x.status === 'PENDING' ? t('Remboursement à faire') : t('Remboursé')}</Pill> <span className="tiny muted">{x.reason}{x.providerRef ? `, ${x.providerRef}` : ''}</span></span>
                <span className="num">{x.amount.formatted}</span>
              </div>
            ))}
            {data.reservation && <p className="small" style={{ marginTop: 8 }}>{t('Réservation bureau')} <span className="num">{data.reservation.number}</span>, {data.reservation.office}</p>}
            <div className="row row--wrap" style={{ marginTop: 10 }}>
              {data.documents.map((d: any) => <button key={d.kind} className="btn btn--ghost btn--s" onClick={() => doc.run(d.url)}><Icon name="file" size={16} /> {d.number}</button>)}
            </div>
          </div>
          <div className="card">
            <h2 className="h3" style={{ marginBottom: 8 }}>{t('Logistique')}</h2>
            <dl className="kv">
              <dt>{t('Étape')}</dt><dd>{o.logisticsStep === 0 ? t('Pas encore lancée') : `${o.logisticsStep}. ${t(STEP_LABEL[LOGISTICS_STEPS[o.logisticsStep - 1].code])}`}</dd>
              <dt>{t('Expédition')}</dt><dd>{o.shipment ? <Link className="link num" to={`/admin/logistics/${o.shipment.id}`}>{o.shipment.reference}</Link> : '—'}</dd>
              <dt>{t('Bureau de retrait')}</dt><dd>{o.pickupOffice ? `${o.pickupOffice.name}, ${o.pickupOffice.city}` : t('Non défini')}</dd>
              {o.pickedUpAt && (<><dt>{t('Retirée le')}</dt><dd>{formatDate(o.pickedUpAt, lang, true)}</dd></>)}
            </dl>
          </div>
        </div>

        {data.audit.length > 0 && (
          <div className="card">
            <h2 className="h3" style={{ marginBottom: 8 }}>{t('Historique des interventions')}</h2>
            {data.audit.map((a: any, n: number) => <p key={n} className="small"><span className="num muted">{formatDate(a.createdAt, lang, true)}</span> {a.action} {a.actor ? `(${a.actor})` : ''} {a.reason ?? ''}</p>)}
          </div>
        )}
        <ErrorNote error={doc.error} />
        {can('orders.manage') && o.status === 'PENDING_PAYMENT' && <div><button className="btn btn--danger btn--s" onClick={() => setCancelling(true)}>{t('Annuler cette commande')}</button></div>}
      </div>
      {cancelling && (
        <Confirm title={t('Annuler la commande {number} ?', { number: o.number })} confirmLabel={t('Annuler la commande')} danger reason={t('Motif (communiqué au client)')} onClose={() => setCancelling(false)}
          onConfirm={async (reason) => { await post(`/admin/orders/${id}/cancel`, { reason }); toast(t('Commande annulée')); reload(); }} />
      )}
    </Page>
  );
}

export function PaymentsAdminPage() {
  const t = useT();
  const { lang } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { search } = useLocation();
  const tab = (search.get('tab') ?? 'payments') as 'payments' | 'refunds';
  const [status, setStatus] = useState('');
  const payments = useApi<{ items: any[]; counts: Record<string, number> }>(tab === 'payments' ? `/admin/payments${qs({ status, pageSize: 100 })}` : null);
  const refunds = useApi<{ items: any[] }>(tab === 'refunds' ? '/admin/refunds' : null);
  const [completing, setCompleting] = useState<any | null>(null);
  const [ref, setRef] = useState('');
  const complete = useAction(async () => {
    await post(`/admin/refunds/${completing.id}/complete`, { providerRef: ref });
    setCompleting(null);
    setRef('');
    toast(t('Remboursement enregistré'));
    refunds.reload();
  });
  return (
    <Page title={t('Paiements')}>
      <div style={{ marginBottom: 12 }}>
        <Tabs value={tab} onChange={(v) => navigate(`/admin/payments?tab=${v}`)} items={[{ value: 'payments', label: t('Paiements reçus') }, { value: 'refunds', label: t('Remboursements') }]} />
      </div>
      {tab === 'payments' && (
        <>
          <div className="toolbar">
            <select className="select select--s" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('État')}>
              <option value="">{t('Tous les états')}</option>
              {Object.entries(PAYMENT_STATUS).map(([k, [label]]) => <option key={k} value={k}>{t(label)}{payments.data?.counts[k] ? ` (${payments.data.counts[k]})` : ''}</option>)}
            </select>
          </div>
          <ErrorNote error={payments.error} onRetry={payments.reload} />
          <DataTable rows={payments.data?.items} rowKey={(p) => p.id} empty={t('Aucun paiement.')}
            columns={[
              { head: t('Date'), cell: (p) => formatDate(p.createdAt, lang, true) },
              { head: t('Commande'), cell: (p) => <Link to={`/admin/orders/${p.orderId}`} className="num">{p.orderNumber}</Link> },
              { head: t('Client'), cell: (p) => p.customer },
              { head: t('Origine'), cell: (p) => (p.provider === 'OFFICE' ? `${t('Bureau')}${p.office ? ` (${p.office})` : ''}${p.channel ? `, ${p.channel}` : ''}` : p.provider) },
              { head: t('Référence prestataire'), cell: (p) => <span className="num small">{p.providerTxId ?? '—'}</span> },
              { head: t('État'), cell: (p) => <><Pill tone={PAYMENT_STATUS[p.status]?.[1]}>{t(PAYMENT_STATUS[p.status]?.[0] ?? p.status)}</Pill>{p.rejectReason && <span className="tiny muted"> {p.rejectReason}</span>}</> },
              { head: t('Montant'), right: true, cell: (p) => p.amount.formatted },
            ]} />
        </>
      )}
      {tab === 'refunds' && (
        <>
          <ErrorNote error={refunds.error} onRetry={refunds.reload} />
          <DataTable rows={refunds.data?.items} rowKey={(x) => x.id} empty={t('Aucun remboursement à traiter.')}
            columns={[
              { head: t('Demandé le'), cell: (x) => formatDate(x.createdAt, lang, true) },
              { head: t('Commande'), cell: (x) => <Link to={`/admin/orders/${x.orderId}`} className="num">{x.orderNumber}</Link> },
              { head: t('Client'), cell: (x) => <>{x.customer}<br /><span className="tiny muted num">{x.whatsapp}</span></> },
              { head: t('Motif'), cell: (x) => t({ DEAL_CANCELLED: N_('Campagne annulée'), DUPLICATE_PAYMENT: N_('Double paiement'), ORDER_CLOSED: N_('Paiement reçu après expiration') }[x.reason as string] ?? x.reason) },
              { head: t('Paiement d’origine'), cell: (x) => <span className="small">{x.provider ?? '—'} <span className="num">{x.providerTxId ?? ''}</span></span> },
              { head: t('Montant'), right: true, cell: (x) => x.amount.formatted },
              { head: '', cell: (x) => (x.status === 'PENDING' ? (can('refunds.manage') ? <button className="btn btn--primary btn--s" onClick={() => setCompleting(x)}>{t('Marquer remboursé')}</button> : <Pill tone="amber">{t('À faire')}</Pill>) : <span className="small"><Pill tone="green">{t('Remboursé')}</Pill> <span className="num muted">{x.providerRef}</span></span>) },
            ]} />
        </>
      )}
      {completing && (
        <Modal title={t('Confirmer le remboursement')} onClose={() => setCompleting(null)}>
          <div className="stack">
            <p>{t('Vous confirmez avoir remboursé {amount} à {customer} pour la commande {number}.', { amount: completing.amount.formatted, customer: completing.customer, number: completing.orderNumber })}</p>
            <Input label={t('Référence de l’opération')} hint={t('Numéro du virement, de l’opération Mobile Money ou du remboursement chez le prestataire.')} value={ref} onChange={(e) => setRef(e.target.value)} />
            <ErrorNote error={complete.error} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => setCompleting(null)}>{t('Annuler')}</button>
              <button className="btn btn--primary" disabled={complete.busy || ref.trim().length < 2} onClick={() => complete.run()}>{t('Marquer remboursé')}</button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
