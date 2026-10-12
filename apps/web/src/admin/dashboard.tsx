import { useState } from 'react';
import { ErrorNote, Loading, useApi } from '../components/ui';
import { formatDate, formatNumber, useI18n, useT } from '../lib/i18n';
import { Link } from '../lib/router';
import { STATUS_LABEL, StatusBadge } from '../pages/orders';
import { DataTable, Page } from './kit';

interface Money {
  amount: number;
  currency: string;
  decimals: number;
  formatted: string;
}

/**
 * Barres verticales d'une seule série (chiffre d'affaires par jour).
 * Une série : pas de légende, le titre la nomme. Survol et focus donnent la valeur ;
 * un tableau équivalent est disponible juste dessous.
 */
function DailyBars({ series, currency, title }: { series: { day: string; orders: number; amount: number }[]; currency: Money; title: string }) {
  const t = useT();
  const { lang } = useI18n();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((s) => s.amount));
  const fmt = (amount: number) => `${formatNumber(Math.round(amount / 10 ** currency.decimals), lang)} ${currency.currency}`;
  const current = active === null ? null : series[active];
  return (
    <figure>
      <figcaption className="row row--between row--wrap" style={{ marginBottom: 12, minHeight: 44 }}>
        <span className="strong">{title}</span>
        <span className="small num" aria-live="polite">
          {current ? (
            <>
              <b>{fmt(current.amount)}</b>, {t('{n} commandes', { n: current.orders })}, {formatDate(current.day, lang)}
            </>
          ) : (
            <span className="muted">{t('Survolez une barre pour le détail du jour')}</span>
          )}
        </span>
      </figcaption>
      <div className="bars" role="img" aria-label={title} onMouseLeave={() => setActive(null)}>
        {series.map((s, i) => (
          <button
            key={s.day}
            type="button"
            className="bars__col"
            aria-label={`${formatDate(s.day, lang)} : ${fmt(s.amount)}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            <span className="bars__bar" data-empty={s.amount === 0} data-active={active === i} style={{ height: s.amount === 0 ? 2 : `${Math.max(3, (s.amount / max) * 100)}%` }} />
          </button>
        ))}
      </div>
      <div className="row row--between tiny muted num" style={{ marginTop: 6 }}>
        <span>{formatDate(series[0]?.day, lang)}</span>
        <span>{formatDate(series[series.length - 1]?.day, lang)}</span>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary className="link small">{t('Voir les chiffres en tableau')}</summary>
        <div className="tablewrap" style={{ marginTop: 8, maxHeight: 260, overflowY: 'auto' }}>
          <table className="table">
            <thead><tr><th>{t('Jour')}</th><th className="r">{t('Commandes payées')}</th><th className="r">{t('Chiffre d’affaires')}</th></tr></thead>
            <tbody>
              {series.filter((s) => s.orders > 0).map((s) => (
                <tr key={s.day}><td>{formatDate(s.day, lang)}</td><td className="r num">{s.orders}</td><td className="r num">{fmt(s.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Barres horizontales : comparaison de grandeurs, valeur écrite à droite de chaque barre. */
export function HBars({ rows }: { rows: { label: string; value: number; display: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => (
        <div className="hbar" key={r.label}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
          <span className="hbar__track"><span className="hbar__fill" style={{ display: 'block', width: `${(r.value / max) * 100}%` }} /></span>
          <span className="num strong">{r.display}</span>
        </div>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const t = useT();
  const { lang } = useI18n();
  const { data, error, loading, reload } = useApi<any>('/admin/dashboard');
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote error={error} onRetry={reload} />;
  const c = data.counts;
  const alerts: [number, string, string][] = [
    [c.dealsToDecide, c.dealsToDecide > 1 ? t('campagnes terminées attendent votre décision') : t('campagne terminée attend votre décision'), '/admin/deals?status=NEEDS_DECISION'],
    [c.refundsPending, c.refundsPending > 1 ? t('remboursements à traiter') : t('remboursement à traiter'), '/admin/payments?tab=refunds'],
    [c.matchingToReview, c.matchingToReview > 1 ? t('demandes Matching à vérifier') : t('demande Matching à vérifier'), '/admin/matching?status=PENDING_REVIEW'],
    [c.matchingHot, c.matchingHot > 1 ? t('demandes Matching ont atteint le seuil d’intérêt') : t('demande Matching a atteint le seuil d’intérêt'), '/admin/matching?status=PUBLISHED'],
  ];
  const statusRows = Object.entries(data.ordersByStatus as Record<string, number>)
    .sort((a, b) => b[1] - a[1])
    .map(([status, n]) => ({ label: t(STATUS_LABEL[status] ?? status), value: n, display: String(n) }));

  return (
    <Page title={t('Tableau de bord')}>
      <div className="stack">
        {alerts.some(([n]) => n > 0) && (
          <div className="card stack-s" style={{ borderColor: 'var(--pink)', boxShadow: 'inset 4px 0 0 var(--pink)' }}>
            <div className="strong">{t('À traiter')}</div>
            {alerts.filter(([n]) => n > 0).map(([n, label, to]) => (
              <div key={to}><Link to={to} className="link"><span className="num">{n}</span> {label}</Link></div>
            ))}
          </div>
        )}

        <dl className="kpis">
          <div className="kpi"><dt>{t('Chiffre d’affaires')}</dt><dd>{data.revenue.total.formatted}</dd></div>
          <div className="kpi"><dt>{t('Sur 30 jours')}</dt><dd>{data.revenue.last30Days.formatted}</dd></div>
          <div className="kpi"><dt>{t('Commandes payées')}</dt><dd>{formatNumber(c.paidOrders, lang)}</dd></div>
          <div className="kpi"><dt>{t('Commandes en attente de paiement')}</dt><dd>{formatNumber(c.pendingOrders, lang)}</dd></div>
          <div className="kpi"><dt>{t('Utilisateurs')}</dt><dd>{formatNumber(c.users, lang)}</dd></div>
          <div className="kpi"><dt>{t('Participants')}</dt><dd>{formatNumber(c.participants, lang)}</dd></div>
          <div className="kpi"><dt>{t('Pays actifs')}</dt><dd>{formatNumber(c.countries, lang)}</dd></div>
          <div className="kpi"><dt>{t('Produits')}</dt><dd>{formatNumber(c.products, lang)}</dd></div>
          <div className="kpi"><dt>{t('Offres actives')}</dt><dd>{formatNumber(c.activeDeals, lang)}</dd></div>
          <div className="kpi"><dt>{t('Paiements reçus')}</dt><dd>{formatNumber(c.payments, lang)}</dd></div>
          <div className="kpi"><dt>{t('Paiements en bureau')}</dt><dd>{formatNumber(c.officePayments, lang)}</dd></div>
          <div className="kpi"><dt>{t('Réservations bureau en attente')}</dt><dd>{formatNumber(c.officePending, lang)}</dd></div>
          <div className="kpi"><dt>{t('Expéditions en cours')}</dt><dd>{formatNumber(c.shipmentsInProgress, lang)}</dd></div>
        </dl>
        {data.revenue.unconverted.length > 0 && (
          <p className="small muted">{t('Le total exclut les devises sans taux de change : {list}.', { list: data.revenue.unconverted.join(', ') })}</p>
        )}

        <div className="card">
          <DailyBars series={data.series} currency={data.revenue.total} title={t('Chiffre d’affaires par jour, 30 derniers jours ({currency})', { currency: data.reportingCurrency })} />
        </div>

        <div className="grid grid--2">
          <div className="card">
            <div className="strong" style={{ marginBottom: 8 }}>{t('Commandes payées par pays')}</div>
            <HBars rows={data.byCountry.map((x: any) => ({ label: x.country.name, value: x.orders, display: `${x.orders} (${x.revenue.formatted})` }))} />
          </div>
          <div className="card">
            <div className="strong" style={{ marginBottom: 8 }}>{t('Commandes par état')}</div>
            <HBars rows={statusRows} />
          </div>
        </div>

        <div>
          <div className="row row--between" style={{ marginBottom: 8 }}>
            <h2 className="h3">{t('Dernières commandes')}</h2>
            <Link to="/admin/orders" className="link small">{t('Toutes les commandes')}</Link>
          </div>
          <DataTable
            rows={data.recentOrders}
            rowKey={(o: any) => o.id}
            empty={t('Aucune commande pour le moment.')}
            columns={[
              { head: t('Commande'), cell: (o: any) => <Link to={`/admin/orders/${o.id}`} className="num">{o.number}</Link> },
              { head: t('Produit'), cell: (o: any) => o.productName },
              { head: t('Pays'), cell: (o: any) => o.country },
              { head: t('État'), cell: (o: any) => <StatusBadge status={o.status} /> },
              { head: t('Date'), cell: (o: any) => formatDate(o.createdAt, lang, true) },
              { head: t('Total'), right: true, cell: (o: any) => o.total.formatted },
            ]}
          />
        </div>
      </div>
    </Page>
  );
}

export function AnalyticsPage() {
  const t = useT();
  const { lang } = useI18n();
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useApi<any>(`/admin/analytics?days=${days}`);
  return (
    <Page
      title={t('Statistiques')}
      actions={
        <select className="select select--s" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t('Période')}>
          <option value={7}>{t('7 derniers jours')}</option>
          <option value={30}>{t('30 derniers jours')}</option>
          <option value={90}>{t('90 derniers jours')}</option>
          <option value={365}>{t('12 derniers mois')}</option>
        </select>
      }
    >
      {loading && !data && <Loading />}
      <ErrorNote error={error} onRetry={reload} />
      {data && (
        <div className="stack">
          <dl className="kpis">
            <div className="kpi"><dt>{t('Inscriptions')}</dt><dd>{formatNumber(data.signups, lang)}</dd></div>
            <div className="kpi"><dt>{t('Utilisateurs actifs')}</dt><dd>{formatNumber(data.activeUsers, lang)}</dd></div>
            <div className="kpi"><dt>{t('Commandes payées')}</dt><dd>{formatNumber(data.paidOrders, lang)}</dd></div>
            <div className="kpi"><dt>{t('Chiffre d’affaires')}</dt><dd>{data.revenue.formatted}</dd></div>
            <div className="kpi"><dt>{t('Panier moyen')}</dt><dd>{data.averageBasket.formatted}</dd></div>
            <div className="kpi"><dt>{t('Commandes créées puis payées')}</dt><dd>{data.funnel.orderToPaidPercent} %</dd></div>
            <div className="kpi"><dt>{t('Vues d’offre aboutissant à un paiement')}</dt><dd>{data.funnel.viewToPaidPercent} %</dd></div>
          </dl>
          <div className="grid grid--2">
            <div className="card">
              <div className="strong" style={{ marginBottom: 8 }}>{t('Du premier regard au paiement')}</div>
              <HBars
                rows={[
                  { label: t('Offres consultées'), value: data.funnel.dealViews, display: formatNumber(data.funnel.dealViews, lang) },
                  { label: t('Clics sur « Participer »'), value: data.funnel.participateClicks, display: formatNumber(data.funnel.participateClicks, lang) },
                  { label: t('Commandes créées'), value: data.funnel.ordersCreated, display: formatNumber(data.funnel.ordersCreated, lang) },
                  { label: t('Paiements lancés'), value: data.funnel.checkoutStarts, display: formatNumber(data.funnel.checkoutStarts, lang) },
                  { label: t('Commandes payées'), value: data.funnel.ordersPaid, display: formatNumber(data.funnel.ordersPaid, lang) },
                ]}
              />
            </div>
            <div className="card">
              <div className="strong" style={{ marginBottom: 8 }}>{t('Chiffre d’affaires par catégorie')}</div>
              {data.byCategory.length ? <HBars rows={data.byCategory.map((x: any) => ({ label: x.name, value: x.revenue.amount, display: x.revenue.formatted }))} /> : <p className="muted small">{t('Aucune vente sur la période.')}</p>}
            </div>
            <div className="card">
              <div className="strong" style={{ marginBottom: 8 }}>{t('Produits les plus consultés')}</div>
              {data.topViewed.length ? <HBars rows={data.topViewed.map((x: any) => ({ label: x.name, value: x.views, display: formatNumber(x.views, lang) }))} /> : <p className="muted small">{t('Aucune consultation sur la période.')}</p>}
            </div>
            <div className="card">
              <div className="strong" style={{ marginBottom: 8 }}>{t('Produits les plus ajoutés aux favoris')}</div>
              {data.topFavorites.length ? <HBars rows={data.topFavorites.map((x: any) => ({ label: x.name, value: x.favorites, display: String(x.favorites) }))} /> : <p className="muted small">{t('Aucun favori.')}</p>}
            </div>
            <div className="card">
              <div className="strong" style={{ marginBottom: 8 }}>{t('Utilisateurs par pays')}</div>
              <HBars rows={data.usersByCountry.map((x: any) => ({ label: x.country.name, value: x.users, display: String(x.users) }))} />
            </div>
            <div className="card stack-s">
              <div className="strong">{t('Paiements et Matching')}</div>
              <HBars rows={data.paymentMethods.map((x: any) => ({ label: x.provider === 'OFFICE' ? t('Bureau local') : t('En ligne'), value: x.count, display: String(x.count) }))} />
              <dl className="kv small" style={{ marginTop: 12 }}>
                <dt>{t('Demandes Matching')}</dt><dd className="num">{data.matching.requests}</dd>
                <dt>{t('Intérêts exprimés')}</dt><dd className="num">{data.matching.interests}</dd>
                <dt>{t('Demandes devenues des offres')}</dt><dd className="num">{data.matching.converted}</dd>
              </dl>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
