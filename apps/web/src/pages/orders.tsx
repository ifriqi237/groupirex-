import { useEffect, useState } from 'react';
import { LOGISTICS_STEPS } from '@groupdeals/core';
import { MoneyDto, formatDuration, unitLabel, useCountdown } from '../components/deal';
import { Empty, ErrorNote, Icon, Loading, Modal, ProductImage, Tabs, useAction, useApi, useToast } from '../components/ui';
import { ApiError, downloadDocument, get, post, qs } from '../lib/api';
import { saveMessage } from '../lib/files';
import { N_, formatDate, useI18n, useT } from '../lib/i18n';
import { Link, navigate, useLocation, leaveTo } from '../lib/router';
import { OfficeCard, OfficeMap } from './deals';

/* Libellés des statuts et des étapes (traduits à l'affichage). */
export const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: N_('En attente de paiement'),
  PAID: N_('Payée'),
  IN_PRODUCTION: N_('En production'),
  SHIPPED: N_('Expédiée'),
  READY_FOR_PICKUP: N_('Disponible au retrait'),
  COMPLETED: N_('Terminée'),
  EXPIRED: N_('Expirée'),
  CANCELLED: N_('Annulée'),
  REFUND_PENDING: N_('Remboursement en cours'),
  REFUNDED: N_('Remboursée'),
};
const STATUS_TONE: Record<string, string> = {
  PENDING_PAYMENT: 'badge--amber',
  PAID: 'badge--green',
  IN_PRODUCTION: 'badge--navy',
  SHIPPED: 'badge--navy',
  READY_FOR_PICKUP: 'badge--pink',
  COMPLETED: 'badge--green',
  EXPIRED: '',
  CANCELLED: '',
  REFUND_PENDING: 'badge--amber',
  REFUNDED: '',
};
export const STEP_LABEL: Record<string, string> = {
  ORDER_PLACED: N_('Commande actionnée'),
  PRODUCTION_DONE: N_('Production terminée'),
  HANDED_TO_FORWARDER: N_('Colis transmis au transitaire'),
  DEPARTED_ORIGIN: N_('Colis ayant quitté le pays d’origine'),
  VESSEL_IN_TRANSIT: N_('Position du bateau'),
  ARRIVED_PORT: N_('Colis au port de destination'),
  CUSTOMS_CLEARED: N_('Colis dédouanés'),
  READY_FOR_PICKUP: N_('Colis disponible au retrait'),
  PICKED_UP: N_('Retrait colis confirmé'),
};
const DOC_LABEL: Record<string, string> = { PROFORMA: N_('Facture proforma'), INVOICE: N_('Facture'), RECEIPT: N_('Reçu de paiement') };

export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  return <span className={`badge ${STATUS_TONE[status] ?? ''}`}>{t(STATUS_LABEL[status] ?? status)}</span>;
}

/* -------------------------------------------------------------------------- */
/* Mes commandes                                                               */
/* -------------------------------------------------------------------------- */

interface OrderSummary {
  id: string;
  number: string;
  status: string;
  paymentMethod: 'ONLINE' | 'OFFICE';
  total: MoneyDto;
  totalQuantity: number;
  createdAt: string;
  expiresAt: string;
  logisticsStep: number;
  deal: { slug: string; title: string };
  product: { name: string; slug: string; cover: { url: string; thumbnailUrl: string | null; alt: string } | null };
}

const BUCKETS = ['', 'PENDING_PAYMENT', 'PAID', 'IN_PRODUCTION', 'SHIPPED', 'READY_FOR_PICKUP', 'COMPLETED'] as const;

export function OrdersPage() {
  const t = useT();
  const { lang } = useI18n();
  const { search } = useLocation();
  const status = search.get('status') ?? '';
  const { data, error, loading, reload } = useApi<{ items: OrderSummary[]; total: number; counts: Record<string, number> }>(`/orders${qs({ status, pageSize: 50 })}`);
  const all = data ? Object.values(data.counts).reduce((s, n) => s + n, 0) : 0;

  return (
    <div className="wrap wrap--narrow page">
      <h1 className="h1">{t('Mes commandes')}</h1>
      <div style={{ marginTop: 16 }}>
        <Tabs
          value={status}
          onChange={(v) => navigate(`/orders${qs({ status: v })}`, { keepScroll: true })}
          items={BUCKETS.map((b) => ({ value: b, label: b ? t(STATUS_LABEL[b]) : t('Toutes'), count: b ? data?.counts[b] : all }))}
        />
      </div>
      <div className="stack" style={{ marginTop: 20 }}>
        {loading && !data && <Loading />}
        <ErrorNote error={error} onRetry={reload} />
        {data && data.items.length === 0 && (
          <Empty title={status ? t('Aucune commande dans cet état') : t('Vous n’avez pas encore de commande')} action={<Link to="/deals" className="btn btn--primary">{t('Voir les offres en cours')}</Link>}>
            {t('Choisissez une offre, indiquez votre quantité et participez à la commande groupée.')}
          </Empty>
        )}
        {data?.items.map((o) => (
          <Link key={o.id} to={`/orders/${o.id}`} className="orderrow">
            {o.product.cover ? <ProductImage src={o.product.cover.thumbnailUrl ?? o.product.cover.url} alt="" loading="lazy" /> : <div className="skeleton" style={{ width: 72, height: 72 }} />}
            <div className="stack-s">
              <div className="row row--between row--wrap">
                <span className="strong">{o.product.name}</span>
                <StatusBadge status={o.status} />
              </div>
              <div className="small muted num">{o.number}, {formatDate(o.createdAt, lang)}</div>
              <div className="row row--between">
                <span className="small num">{t('Quantité : {n}', { n: o.totalQuantity })}</span>
                <span className="strong num">{o.total.formatted}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Détail et suivi d'une commande                                              */
/* -------------------------------------------------------------------------- */

interface OrderDetail extends OrderSummary {
  paymentStatus: string;
  paidAt: string | null;
  serverTime: string;
  canPayOnline: boolean;
  canCancel: boolean;
  items: { productName: string; variantLabel: string | null; saleUnit: string; quantity: number; unitPrice: MoneyDto; lineTotal: MoneyDto }[];
  documents: { kind: string; number: string; issuedAt: string; url: string }[];
  reservation: null | { id: string; number: string; status: string; expiresAt: string; paidAt: string | null; amount: MoneyDto; qrSvg: string; office: any };
  logistics: {
    currentStep: number;
    steps: { step: number; code: string; state: 'done' | 'skipped' | 'next' | 'pending'; at: string | null; note: string | null }[];
    shipmentReference: string | null;
    vessel: null | { name: string | null; departurePort: string | null; arrivalPort: string | null; eta: string | null; position: null | { latitude: number; longitude: number; progressPercent: number; updatedAt: string } };
    pickup: { office: any | null; code: string | null; pickedUpAt: string | null };
  };
  cancelReason: string | null;
}

function Deadline({ expiresAt, serverNow }: { expiresAt: string; serverNow: number }) {
  const t = useT();
  const left = useCountdown(Math.max(0, Math.floor((new Date(expiresAt).getTime() - serverNow) / 1000)));
  return <span className="countdown">{left > 0 ? formatDuration(left, t) : t('délai dépassé')}</span>;
}

function Voyage({ vessel }: { vessel: NonNullable<OrderDetail['logistics']['vessel']> }) {
  const t = useT();
  const { lang } = useI18n();
  const pct = Math.max(0, Math.min(100, vessel.position?.progressPercent ?? 0));
  return (
    <div className="voyage">
      {vessel.name && <div className="small strong">{vessel.name}</div>}
      {vessel.position && (
        <>
          <div className="voyage__track" role="img" aria-label={t('Trajet effectué à {n} %', { n: Math.round(pct) })}>
            <div className="voyage__fill" style={{ width: `${pct}%` }} />
            <div className="voyage__ship" style={{ insetInlineStart: `${pct}%` }}><Icon name="ship" size={22} /></div>
          </div>
          <div className="row row--between small">
            <span>{vessel.departurePort ?? '—'}</span>
            <span className="num strong">{Math.round(pct)} %</span>
            <span>{vessel.arrivalPort ?? '—'}</span>
          </div>
        </>
      )}
      <dl className="kv small" style={{ marginTop: 8 }}>
        {vessel.eta && (<><dt>{t('Arrivée estimée')}</dt><dd>{formatDate(vessel.eta, lang)}</dd></>)}
        {vessel.position && (
          <>
            <dt>{t('Position')}</dt>
            <dd>
              <a className="link num" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${vessel.position.latitude}&mlon=${vessel.position.longitude}#map=4/${vessel.position.latitude}/${vessel.position.longitude}`}>
                {vessel.position.latitude.toFixed(2)}, {vessel.position.longitude.toFixed(2)}
              </a>
              <span className="muted"> ({t('mise à jour le {date}', { date: formatDate(vessel.position.updatedAt, lang) })})</span>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function OrderPage({ id }: { id: string }) {
  const t = useT();
  const { lang } = useI18n();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ order: OrderDetail }>(`/orders/${id}`);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const pay = useAction(async () => {
    const res = await post<{ checkoutUrl: string }>('/payments', { orderId: id });
    leaveTo(res.checkoutUrl);
  });
  const cancel = useAction(async () => {
    await post(`/orders/${id}/cancel`, {});
    setConfirmCancel(false);
    toast(t('Commande annulée'));
    reload();
  });
  const doc = useAction(async (url: string) => {
    const message = saveMessage(await downloadDocument(url), N_('Document téléchargé'));
    if (message) toast(t(message));
  });

  if (loading && !data) return <div className="wrap page"><Loading /></div>;
  if (error || !data) return <div className="wrap page"><ErrorNote error={error} onRetry={reload} /></div>;
  const o = data.order;
  const pending = o.status === 'PENDING_PAYMENT';
  const paid = !['PENDING_PAYMENT', 'EXPIRED', 'CANCELLED'].includes(o.status);
  const proforma = o.documents.find((d) => d.kind === 'PROFORMA');

  return (
    <div className="wrap wrap--narrow page">
      <Link to="/orders" className="link small">{t('Mes commandes')}</Link>
      <div className="row row--between row--wrap" style={{ marginTop: 8 }}>
        <h1 className="h1 num">{o.number}</h1>
        <StatusBadge status={o.status} />
      </div>
      <p className="muted small" style={{ marginTop: 4 }}>{t('Passée le {date}', { date: formatDate(o.createdAt, lang, true) })}</p>

      <div className="stack-l" style={{ marginTop: 24 }}>
        <ErrorNote error={pay.error ?? cancel.error ?? doc.error} />

        {/* Paiement en ligne en attente */}
        {pending && o.paymentMethod === 'ONLINE' && (
          <section className="panel panel--mist stack">
            <h2 className="h3">{t('Il reste à payer {amount}', { amount: o.total.formatted })}</h2>
            <p>{t('Votre quantité est réservée encore')} <Deadline expiresAt={o.expiresAt} serverNow={new Date(o.serverTime).getTime()} />. {t('Passé ce délai, la commande est annulée et les quantités sont remises à disposition.')}</p>
            {o.paymentStatus === 'FAILED' && <div className="notice notice--error"><Icon name="alert" /><span>{t('Le dernier paiement n’a pas abouti. Vous pouvez réessayer.')}</span></div>}
            <div className="row row--wrap">
              {o.canPayOnline && <button className="btn btn--primary" onClick={() => pay.run()} disabled={pay.busy}>{t('Payer maintenant')}</button>}
              {o.canCancel && <button className="btn btn--ghost" onClick={() => setConfirmCancel(true)}>{t('Annuler la commande')}</button>}
            </div>
          </section>
        )}

        {/* Réservation de paiement en bureau */}
        {o.reservation && (
          <section className="panel stack">
            <div className="row row--between row--wrap">
              <h2 className="h2">{t('Paiement au bureau local')}</h2>
              <span className={`badge ${o.reservation.status === 'PAID' ? 'badge--green' : pending ? 'badge--amber' : ''}`}>
                {t({ PENDING_PAYMENT: N_('À régler'), CONFIRMED: N_('Confirmée'), PAID: N_('Payée'), EXPIRED: N_('Expirée'), CANCELLED: N_('Annulée') }[o.reservation.status] ?? o.reservation.status)}
              </span>
            </div>
            {pending && (
              <div className="row row--top row--wrap" style={{ gap: 24 }}>
                <div className="qr" dangerouslySetInnerHTML={{ __html: o.reservation.qrSvg }} aria-label={t('QR Code de la réservation')} role="img" />
                <div className="stack grow" style={{ minWidth: 220 }}>
                  <p>{t('Votre facture proforma est prête. Téléchargez-la et présentez-la au bureau pour régler votre commande. L’agent lit son QR Code ou saisit le numéro de réservation.')}</p>
                  <dl className="kv">
                    <dt>{t('Réservation')}</dt><dd className="num">{o.reservation.number}</dd>
                    <dt>{t('Montant')}</dt><dd className="num">{o.reservation.amount.formatted}</dd>
                    <dt>{t('À régler avant le')}</dt><dd>{formatDate(o.reservation.expiresAt, lang, true)}</dd>
                  </dl>
                  {proforma && (
                    <div>
                      <button className="btn btn--primary" onClick={() => doc.run(proforma.url)} disabled={doc.busy}>
                        <Icon name="download" /> {t('Téléchargez votre proforma')}
                      </button>
                      <div className="tiny muted num" style={{ marginTop: 6 }}>{t('Facture proforma')} {proforma.number} · PDF</div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <OfficeCard office={o.reservation.office} />
            {pending && <OfficeMap office={o.reservation.office} />}
            {pending && o.canCancel && <div><button className="btn btn--ghost btn--s" onClick={() => setConfirmCancel(true)}>{t('Annuler la réservation')}</button></div>}
          </section>
        )}

        {o.status === 'EXPIRED' && <div className="notice"><Icon name="info" /><span>{t('Le délai de paiement est dépassé : cette commande n’a pas été confirmée. Vous pouvez participer à nouveau tant que l’offre est ouverte.')} <Link className="link" to={`/deals/${o.deal.slug}`}>{t('Revoir l’offre')}</Link></span></div>}
        {o.status === 'CANCELLED' && <div className="notice"><Icon name="info" /><span>{o.cancelReason ?? t('Cette commande a été annulée.')}</span></div>}
        {o.status === 'REFUND_PENDING' && <div className="notice notice--warn"><Icon name="info" /><span>{t('La campagne a été annulée. Votre remboursement de {amount} est en cours de traitement.', { amount: o.total.formatted })}</span></div>}
        {o.status === 'REFUNDED' && <div className="notice notice--ok"><Icon name="check" /><span>{t('Votre commande a été remboursée.')}</span></div>}

        {/* Retrait */}
        {o.logistics.pickup.code && o.status === 'READY_FOR_PICKUP' && (
          <section className="panel panel--navy stack">
            <h2 className="h2">{t('Votre colis vous attend')}</h2>
            <p style={{ color: '#C9D2EE' }}>{t('Donnez ce code à l’agent du bureau pour retirer votre commande.')}</p>
            <div className="code">{o.logistics.pickup.code}</div>
          </section>
        )}

        {/* Suivi logistique en 9 étapes */}
        {paid && !['REFUND_PENDING', 'REFUNDED'].includes(o.status) && (
          <section>
            <h2 className="h2" style={{ marginBottom: 16 }}>{t('Suivi de votre commande')}</h2>
            {o.logistics.currentStep === 0 && <p className="muted" style={{ marginBottom: 16 }}>{t('Paiement reçu. La commande groupée sera lancée auprès du fabricant à la clôture de la campagne.')}</p>}
            <ol className="steps">
              {LOGISTICS_STEPS.map((def) => {
                const s = o.logistics.steps.find((x) => x.step === def.step)!;
                return (
                  <li key={def.step} data-state={s.state}>
                    <div>
                      <div className="steps__label">{t(STEP_LABEL[def.code])}</div>
                      {s.state === 'done' && s.at && <div className="steps__meta">{formatDate(s.at, lang, true)}</div>}
                      {s.state === 'skipped' && <div className="steps__meta">{t('Étape non applicable à cet envoi')}</div>}
                      {s.note && <div className="steps__meta">{s.note}</div>}
                      {def.step === 5 && o.logistics.vessel && o.logistics.currentStep >= 4 && o.logistics.currentStep < 7 && <Voyage vessel={o.logistics.vessel} />}
                      {def.step === 8 && o.logistics.pickup.office && <div style={{ marginTop: 6 }}><OfficeCard office={o.logistics.pickup.office} compact={s.state === 'pending'} /></div>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {/* Récapitulatif : prix final, sans ligne de livraison */}
        <section>
          <h2 className="h2" style={{ marginBottom: 12 }}>{t('Récapitulatif')}</h2>
          <div className="panel">
            <table className="recap">
              <thead><tr><th>{t('Produit')}</th><th className="r">{t('Prix unitaire')}</th><th className="r">{t('Quantité')}</th><th className="r">{t('Total')}</th></tr></thead>
              <tbody>
                {o.items.map((i, n) => (
                  <tr key={n}>
                    <td><div className="strong">{i.productName}</div>{i.variantLabel && <div className="small muted">{i.variantLabel}</div>}</td>
                    <td className="r num">{i.unitPrice.formatted}</td>
                    <td className="r num">{i.quantity} <span className="muted small">{unitLabel(i.saleUnit, i.quantity, t)}</span></td>
                    <td className="r num strong">{i.lineTotal.formatted}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>{t('Total')}</td><td className="r num">{o.total.formatted}</td></tr></tfoot>
            </table>
            <dl className="kv small" style={{ marginTop: 12 }}>
              <dt>{t('Paiement')}</dt><dd>{o.paymentMethod === 'ONLINE' ? t('Paiement en ligne') : t('Paiement au bureau local')}</dd>
              {o.paidAt && (<><dt>{t('Payée le')}</dt><dd>{formatDate(o.paidAt, lang, true)}</dd></>)}
            </dl>
          </div>
        </section>

        {o.documents.length > 0 && (
          <section>
            <h2 className="h2" style={{ marginBottom: 12 }}>{t('Documents')}</h2>
            <div className="stack-s">
              {o.documents.map((d) => (
                <button key={d.kind} className="btn btn--ghost" onClick={() => doc.run(d.url)} disabled={doc.busy} style={{ justifyContent: 'flex-start', width: '100%' }}>
                  <Icon name="file" /> {t(DOC_LABEL[d.kind] ?? d.kind)} <span className="muted num small">{d.number}</span>
                  <span className="docs__get"><Icon name="download" size={18} /><span>{t('Télécharger')}</span></span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {confirmCancel && (
        <Modal title={t('Annuler cette commande ?')} onClose={() => setConfirmCancel(false)}>
          <p>{t('Les quantités réservées seront remises à disposition des autres membres. Cette action est définitive.')}</p>
          <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost" onClick={() => setConfirmCancel(false)}>{t('Garder la commande')}</button>
            <button className="btn btn--danger" onClick={() => cancel.run()} disabled={cancel.busy}>{t('Annuler la commande')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Retour de paiement                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Le client revient de la page de paiement. Les paramètres de l'adresse ne prouvent
 * rien : on demande au serveur, qui interroge le prestataire.
 */
export function PaymentReturnPage() {
  const t = useT();
  const { search } = useLocation();
  const orderId = search.get('order') ?? '';
  const transactionId = search.get('transaction_id') ?? undefined;
  const [state, setState] = useState<{ status: 'checking' | 'PAID' | 'FAILED' | 'PENDING' | 'error'; error?: ApiError }>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const check = async () => {
      try {
        const res = await post<{ outcome: string; paymentStatus: string }>('/payments/verify', { orderId, transactionId });
        if (cancelled) return;
        if (res.paymentStatus === 'PAID') return setState({ status: 'PAID' });
        if (res.paymentStatus === 'FAILED') return setState({ status: 'FAILED' });
        // Paiement encore en cours chez le prestataire : on revérifie quelques fois.
        if (++tries < 6) setTimeout(check, 3000);
        else setState({ status: 'PENDING' });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', error: e as ApiError });
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, [orderId, transactionId]);

  return (
    <div className="wrap wrap--form page">
      {state.status === 'checking' && (<><Loading /><p style={{ textAlign: 'center' }}>{t('Vérification de votre paiement…')}</p></>)}
      {state.status === 'PAID' && (
        <div className="stack">
          <div className="notice notice--ok"><Icon name="check" /><span className="strong">{t('Paiement confirmé')}</span></div>
          <h1 className="h1">{t('Vous faites partie de la commande groupée.')}</h1>
          <p className="muted">{t('Votre facture est disponible dans votre commande. Nous vous préviendrons à chaque étape.')}</p>
          <Link to={`/orders/${orderId}`} className="btn btn--primary btn--block">{t('Voir ma commande')}</Link>
        </div>
      )}
      {state.status === 'FAILED' && (
        <div className="stack">
          <h1 className="h1">{t('Le paiement n’a pas abouti')}</h1>
          <p className="muted">{t('Aucun montant n’a été confirmé. Votre quantité reste réservée jusqu’à la fin du délai : vous pouvez réessayer.')}</p>
          <Link to={`/orders/${orderId}`} className="btn btn--primary btn--block">{t('Réessayer le paiement')}</Link>
        </div>
      )}
      {state.status === 'PENDING' && (
        <div className="stack">
          <h1 className="h1">{t('Paiement en cours de confirmation')}</h1>
          <p className="muted">{t('Votre opérateur n’a pas encore confirmé le paiement. La commande se mettra à jour toute seule dès sa confirmation ; ne payez pas une seconde fois.')}</p>
          <Link to={`/orders/${orderId}`} className="btn btn--navy btn--block">{t('Voir ma commande')}</Link>
        </div>
      )}
      {state.status === 'error' && <ErrorNote error={state.error} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page de paiement de test (bac à sable)                                      */
/* -------------------------------------------------------------------------- */

export function SandboxPayPage() {
  const t = useT();
  const { search } = useLocation();
  const txRef = search.get('tx_ref') ?? '';
  const [info, setInfo] = useState<{ description: string; amount: MoneyDto } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    get(`/sandbox/checkout/${encodeURIComponent(txRef)}`).then(setInfo).catch(setError);
  }, [txRef]);
  const pay = useAction(async (outcome: 'successful' | 'failed') => {
    const res = await post<{ redirectUrl: string }>('/sandbox/pay', { txRef, outcome });
    const url = new URL(res.redirectUrl);
    navigate(url.pathname + url.search, { replace: true });
  });
  return (
    <div className="wrap wrap--form page">
      <div className="notice notice--warn" style={{ marginBottom: 20 }}><Icon name="info" /><span>{t('Page de paiement de test. Aucun argent n’est débité. En production, cette page est celle de Flutterwave.')}</span></div>
      <ErrorNote error={error ?? pay.error} />
      {info && (
        <div className="panel stack">
          <p className="muted small">{info.description}</p>
          <div className="price price--xl">{info.amount.formatted}</div>
          <button className="btn btn--primary btn--block" onClick={() => pay.run('successful')} disabled={pay.busy}>{t('Simuler un paiement réussi')}</button>
          <button className="btn btn--ghost btn--block" onClick={() => pay.run('failed')} disabled={pay.busy}>{t('Simuler un paiement refusé')}</button>
        </div>
      )}
    </div>
  );
}
