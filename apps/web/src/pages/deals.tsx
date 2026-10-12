import { useEffect, useMemo, useRef, useState } from 'react';
import { Countdown, Deal, DealGrid, FavoriteButton, Gauge, MoneyDto, unitLabel } from '../components/deal';
import { Empty, ErrorNote, Form, Icon, Loading, ProductImage, Select, Tabs, useAction, useApi, useToast } from '../components/ui';
import { ApiError, downloadQuoteProforma, get, newIdempotencyKey, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DEMO } from '../lib/env';
import { saveMessage } from '../lib/files';
import { N_, formatNumber, useI18n, useT } from '../lib/i18n';
import { Link, navigate, useLocation, leaveTo } from '../lib/router';
import type { Category } from './home';

/* -------------------------------------------------------------------------- */
/* Liste des offres                                                            */
/* -------------------------------------------------------------------------- */

interface DealList {
  items: Deal[];
  total: number;
  page: number;
  pageSize: number;
}

export function DealsPage() {
  const t = useT();
  const { search } = useLocation();
  const { country } = useAuth();
  const status = (search.get('status') ?? 'active') as 'active' | 'upcoming' | 'ended';
  const category = search.get('category') ?? '';
  const q = search.get('q') ?? '';
  const sort = search.get('sort') ?? 'featured';
  const [pageSize, setPageSize] = useState(12);
  useEffect(() => setPageSize(12), [status, category, q, sort]);

  const cats = useApi<{ categories: Category[] }>(`/categories?c=${country}`);
  const list = useApi<DealList>(`/group-deals${qs({ status, category, q, sort, pageSize, c: country })}`);
  const go = (patch: Record<string, string>) => {
    const next = { status, category, q, sort, ...patch };
    navigate(`/deals${qs({ status: next.status === 'active' ? '' : next.status, category: next.category, q: next.q, sort: next.sort === 'featured' ? '' : next.sort })}`, { keepScroll: true });
  };
  const current = cats.data?.categories.find((c) => c.slug === category);

  return (
    <div className="wrap page">
      <h1 className="h1">{q ? t('Résultats pour « {q} »', { q }) : (current?.name ?? t('Toutes les offres'))}</h1>
      {current?.description && <p className="muted" style={{ marginTop: 6 }}>{current.description}</p>}

      <div className="chips" style={{ marginTop: 20 }} aria-label={t('Catégories')}>
        <button className="chip" aria-pressed={!category} onClick={() => go({ category: '' })}>
          {t('Toutes')}
        </button>
        {cats.data?.categories.map((c) => (
          <button key={c.id} className="chip" aria-pressed={c.slug === category} onClick={() => go({ category: c.slug })}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="row row--between row--wrap" style={{ marginTop: 16, alignItems: 'flex-end' }}>
        <Tabs
          value={status}
          onChange={(v) => go({ status: v })}
          items={[
            { value: 'active', label: t('En cours') },
            { value: 'upcoming', label: t('À venir') },
            { value: 'ended', label: t('Terminées') },
          ]}
        />
        <label className="row small">
          <span className="muted">{t('Trier par')}</span>
          <select className="select select--s" style={{ width: 'auto' }} value={sort} onChange={(e) => go({ sort: e.target.value })}>
            <option value="featured">{t('À la une')}</option>
            <option value="ending">{t('Fin la plus proche')}</option>
            <option value="popular">{t('Les plus avancées')}</option>
            <option value="recent">{t('Les plus récentes')}</option>
          </select>
        </label>
      </div>

      <div style={{ marginTop: 24 }}>
        {list.loading && !list.data && <Loading />}
        <ErrorNote error={list.error} onRetry={list.reload} />
        {list.data && list.data.items.length === 0 && (
          <Empty
            title={q ? t('Aucune offre ne correspond à votre recherche') : t('Aucune offre ici pour le moment')}
            action={
              <Link to="/matching" className="btn btn--navy">
                {t('Publier une demande')}
              </Link>
            }
          >
            {t('Dites ce que vous recherchez dans Matching : les demandes les plus suivies deviennent des commandes groupées.')}
          </Empty>
        )}
        {list.data && list.data.items.length > 0 && (
          <>
            <DealGrid deals={list.data.items} />
            {list.data.total > list.data.items.length && (
              <div style={{ marginTop: 32, textAlign: 'center' }}>
                <button className="btn btn--ghost" onClick={() => setPageSize((n) => Math.min(50, n + 12))} disabled={list.loading}>
                  {t('Afficher plus d’offres')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Fiche produit et participation                                              */
/* -------------------------------------------------------------------------- */

interface DealDetail extends Deal {
  cancelReason: string | null;
  product: Deal['product'] & {
    features: string[];
    specifications: { label: string; value: string }[];
    origin: string | null;
    leadTimeDays: { min: number; max: number } | null;
    media: { kind: 'IMAGE' | 'VIDEO'; url: string; thumbnailUrl: string | null; alt: string }[];
    variants: { id: string; label: string; attributes: Record<string, string>; price: MoneyDto | null }[];
  };
  officePayment: { enabled: boolean; threshold: MoneyDto | null };
}

export interface Quote {
  lines: { variantId: string | null; variantLabel: string | null; quantity: number; unitPrice: MoneyDto; lineTotal: MoneyDto }[];
  totalQuantity: number;
  total: MoneyDto;
  canOrder: boolean;
  problem: { code: string; message: string; details: any } | null;
  paymentMethods: { online: boolean; office: boolean; officeThreshold: MoneyDto | null };
  emailVerificationRequired: boolean;
}

function Stepper({ value, onChange, min = 0, max, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number | null; label: string }) {
  const t = useT();
  const clamp = (n: number) => Math.max(min, Math.min(max ?? 1_000_000, Number.isFinite(n) ? Math.floor(n) : min));
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label={t('Diminuer la quantité')}>
        −
      </button>
      <input type="number" inputMode="numeric" value={value} min={min} aria-label={label} onChange={(e) => onChange(clamp(parseInt(e.target.value || '0', 10)))} />
      <button type="button" onClick={() => onChange(clamp(value + 1))} disabled={max != null && value >= max} aria-label={t('Augmenter la quantité')}>
        +
      </button>
    </div>
  );
}

/**
 * Carrousel du produit : jusqu'à dix photos et une vidéo (PRODUCT_MEDIA_LIMITS).
 * On passe d'une vue à l'autre en glissant du doigt, avec les flèches (écran ou clavier) ou par les
 * vignettes. Le défilement est celui du navigateur : il fonctionne sans script et respecte le sens de lecture.
 */
function Gallery({ media, name }: { media: DealDetail['product']['media']; name: string }) {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const thumbs = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = media.length;
  const photos = media.filter((m) => m.kind === 'IMAGE');
  const videoAt = media.findIndex((m) => m.kind === 'VIDEO');

  // La vue affichée suit le défilement, quel que soit le geste qui l'a provoqué.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setIndex(Math.max(0, Math.min(count - 1, Math.round(Math.abs(el.scrollLeft) / (el.clientWidth || 1))))));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [count]);

  // En quittant la vidéo, on la met en pause ; la vignette de la vue affichée reste visible dans sa rangée.
  useEffect(() => {
    track.current?.querySelectorAll('video').forEach((v) => {
      if (v.closest('.carousel__slide')?.getAttribute('data-index') !== String(index)) v.pause();
    });
    const strip = thumbs.current;
    const thumb = strip?.children[index] as HTMLElement | undefined;
    if (strip && thumb) strip.scrollTo({ left: thumb.offsetLeft - strip.clientWidth / 2 + thumb.clientWidth / 2, behavior: 'smooth' });
  }, [index]);

  const go = (i: number) => {
    const el = track.current;
    if (!el || i < 0 || i >= count) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: (rtl ? -1 : 1) * i * el.clientWidth, behavior: calm ? 'auto' : 'smooth' });
  };

  if (!count) return <div className="gallery__main" />;
  const label = (m: (typeof media)[number], i: number) => (m.kind === 'VIDEO' ? t('Vidéo du produit') : t('Photo {n} sur {total}', { n: photos.indexOf(m) + 1, total: photos.length }));
  return (
    <div className="carousel" role="region" aria-roledescription={t('carrousel')} aria-label={t('Photos et vidéo du produit')}>
      <div className="carousel__stage">
        <div
          className="carousel__track"
          ref={track}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const forward = (e.key === 'ArrowRight') !== (getComputedStyle(e.currentTarget).direction === 'rtl');
            go(index + (forward ? 1 : -1));
          }}
        >
          {media.map((m, i) => (
            <div className="carousel__slide" key={m.url} data-index={i} role="group" aria-roledescription={t('vue')} aria-label={label(m, i)}>
              {m.kind === 'VIDEO' ? (
                // La vidéo n'est jamais chargée d'avance : seulement son image d'aperçu, puis le fichier à la lecture.
                <video src={m.url} poster={m.thumbnailUrl ?? photos[0]?.url} controls preload="none" playsInline aria-label={m.alt || t('Vidéo du produit')} />
              ) : (
                <ProductImage src={m.url} alt={m.alt || name} width="900" height="900" loading={i === 0 ? undefined : 'lazy'} />
              )}
            </div>
          ))}
        </div>
        {count > 1 && (
          <>
            <button type="button" className="carousel__nav carousel__nav--prev" onClick={() => go(index - 1)} disabled={index === 0} aria-label={t('Vue précédente')}>
              <Icon name="back" />
            </button>
            <button type="button" className="carousel__nav carousel__nav--next" onClick={() => go(index + 1)} disabled={index === count - 1} aria-label={t('Vue suivante')}>
              <Icon name="chevron" />
            </button>
            <span className="carousel__count num" aria-hidden="true">{index + 1} / {count}</span>
          </>
        )}
      </div>
      {count > 1 && (
        <>
          <div className="gallery__thumbs" ref={thumbs}>
            {media.map((m, i) => (
              <button type="button" key={m.url} aria-pressed={i === index} onClick={() => go(i)} aria-label={label(m, i)}>
                {m.thumbnailUrl || m.kind === 'IMAGE' || photos[0] ? <img src={m.thumbnailUrl ?? (m.kind === 'IMAGE' ? m.url : photos[0].thumbnailUrl ?? photos[0].url)} alt="" loading="lazy" /> : null}
                {m.kind === 'VIDEO' && <span className="gallery__play" aria-hidden="true">▶</span>}
              </button>
            ))}
          </div>
          <div className="carousel__info small muted">
            <span>{photos.length > 1 ? t('{n} photos', { n: photos.length }) : t('1 photo')}{videoAt >= 0 ? ` · ${t('1 vidéo')}` : ''}</span>
            {videoAt >= 0 && index !== videoAt && (
              <button type="button" className="link" onClick={() => go(videoAt)}>▶ {t('Voir la vidéo')}</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function DealPage({ slug }: { slug: string }) {
  const t = useT();
  const { lang } = useI18n();
  const { user, country } = useAuth();
  const { data, error, loading, reload } = useApi<{ deal: DealDetail }>(`/group-deals/${slug}?c=${country}`);
  const deal = data?.deal;
  const [qty, setQty] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<ApiError | null>(null);
  const [quoting, setQuoting] = useState(false);
  const viewed = useRef('');

  const hasVariants = (deal?.product.variants.length ?? 0) > 0;
  // Quantité de départ : le minimum de commande.
  useEffect(() => {
    if (!deal) return;
    setQty(hasVariants ? Object.fromEntries(deal.product.variants.map((v, i) => [v.id, i === 0 ? deal.minQuantity : 0])) : { '': deal.minQuantity });
    if (viewed.current !== deal.id) {
      viewed.current = deal.id;
      post('/analytics/events', { type: 'deal_view', entityType: 'deal', entityId: deal.id }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.id]);

  const items = useMemo(() => Object.entries(qty).filter(([, n]) => n > 0).map(([variantId, quantity]) => ({ variantId: variantId || null, quantity })), [qty]);
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);

  // Le total vient toujours du serveur : le navigateur ne calcule aucun prix.
  useEffect(() => {
    if (!deal || !deal.price || items.length === 0) {
      setQuote(null);
      setQuoting(false);
      return;
    }
    let cancelled = false;
    // Tant que le nouveau total n'est pas revenu du serveur, on ne laisse pas commander sur l'ancien.
    setQuoting(true);
    const timer = setTimeout(() => {
      post<Quote>(`/group-deals/${deal.id}/quote`, { items })
        .then((q) => !cancelled && (setQuote(q), setQuoteError(null), setQuoting(false)))
        .catch((e) => !cancelled && (setQuote(null), setQuoteError(e), setQuoting(false)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deal?.id, deal?.price?.amount, items]);

  if (loading && !deal) return <div className="wrap page"><Loading /></div>;
  if (error || !deal) return <div className="wrap page"><ErrorNote error={error ?? new ApiError(404, 'NOT_FOUND', 'Élément introuvable.')} onRetry={reload} /></div>;

  const p = deal.product;
  const participate = () => {
    post('/analytics/events', { type: 'participate_click', entityType: 'deal', entityId: deal.id }).catch(() => undefined);
    const target = `/checkout/${deal.slug}?items=${encodeURIComponent(items.map((i) => `${i.variantId ?? ''}:${i.quantity}`).join(','))}`;
    navigate(user ? target : `/login?next=${encodeURIComponent(target)}`);
  };
  const moqProblem = totalQty < deal.minQuantity;
  const canGo = deal.open && !quoting && !moqProblem && !!quote?.canOrder;

  const buyBox = (
    <div className="stack">
      {hasVariants ? (
        <div>
          <p className="strong">{t('Choisissez vos quantités')}</p>
          {p.variants.map((v) => (
            <div className="variant" key={v.id}>
              <div>
                <div className="strong">{v.label}</div>
                {v.price && <div className="small muted num">{v.price.formatted}</div>}
              </div>
              <Stepper value={qty[v.id] ?? 0} onChange={(n) => setQty((s) => ({ ...s, [v.id]: n }))} label={t('Quantité pour {label}', { label: v.label })} />
            </div>
          ))}
        </div>
      ) : (
        <div className="row row--between row--wrap">
          <div>
            <p className="strong">{t('Quantité')}</p>
            <p className="small muted">{unitLabel(p.saleUnit, 2, t)}</p>
          </div>
          <Stepper value={qty[''] ?? 0} min={1} max={deal.maxPerOrder} onChange={(n) => setQty({ '': n })} label={t('Quantité')} />
        </div>
      )}

      {moqProblem && deal.open && (
        <div className="notice notice--warn">
          <Icon name="info" />
          <span>{t('Commande minimum : {n} {unit}. Il vous en manque {missing}.', { n: deal.minQuantity, unit: unitLabel(p.saleUnit, deal.minQuantity, t), missing: deal.minQuantity - totalQty })}</span>
        </div>
      )}
      {!moqProblem && quote?.problem && <div className="notice notice--warn"><Icon name="info" /><span>{t(quote.problem.message)}</span></div>}
      {quoteError && <ErrorNote error={quoteError} />}

      <div className="row row--between" style={{ alignItems: 'baseline' }}>
        <span className="muted">{t('Total pour {n} {unit}', { n: totalQty, unit: unitLabel(p.saleUnit, totalQty, t) })}</span>
        <span className="price" style={{ fontSize: '1.5rem', opacity: quoting ? 0.45 : 1 }}>{quote ? quote.total.formatted : '—'}</span>
      </div>
      <button className="btn btn--primary btn--block" onClick={participate} disabled={!canGo}>
        {t('Participer au GroupDeals')}
      </button>
      {!deal.open && <p className="small muted">{closedReason(deal, t)}</p>}
      {deal.open && deal.officePayment.enabled && deal.officePayment.threshold && (
        <p className="small muted">
          {quote?.paymentMethods.office
            ? t('Paiement en ligne ou au bureau local.')
            : t('Paiement en ligne. Le paiement au bureau local est proposé à partir de {amount}.', { amount: deal.officePayment.threshold.formatted })}
        </p>
      )}
    </div>
  );

  return (
    <div className="wrap page">
      <nav className="small muted" aria-label={t('Fil d’Ariane')} style={{ marginBottom: 16 }}>
        <Link to="/deals" className="link">{t('Offres')}</Link> / <Link to={`/deals?category=${p.category.slug}`} className="link">{p.category.name}</Link>
      </nav>

      <div className="split split--shots">
        <div className="shots">
          <Gallery key={p.id} media={p.media} name={p.name} />
          <FavoriteButton deal={deal} />
        </div>

        <div className="stack">
          <div>
            <h1 className="h1">{deal.title}</h1>
            <p className="muted" style={{ marginTop: 8, maxWidth: '60ch' }}>{p.description}</p>
          </div>

          <div className="pricebox">
            <p className="small muted">{t('Prix GROUPDEALS, livraison vers votre pays comprise')}</p>
            <div className="row row--wrap" style={{ alignItems: 'baseline', marginTop: 4 }}>
              {deal.price ? <span className="price price--xl">{deal.price.formatted}</span> : <span className="strong">{t(unavailableText(deal.availability))}</span>}
              {deal.compareAtPrice && <span className="price-old">{deal.compareAtPrice.formatted}</span>}
              {deal.discountPercent ? <span className="badge badge--deal num">−{deal.discountPercent} %</span> : null}
            </div>
            <p className="small muted" style={{ marginTop: 4 }}>{t('par {unit}', { unit: unitLabel(p.saleUnit, 1, t) })}{p.piecesPerSaleUnit > 1 ? ` (${t('{n} pièces', { n: p.piecesPerSaleUnit })})` : ''}</p>
          </div>

          <div>
            <div className="gauge-head">
              <span className="strong">{t('Remplissage du conteneur')}</span>
              <b className="num">{deal.progress.percent} %</b>
            </div>
            <Gauge percent={deal.progress.percent} large label={t('Progression de la commande groupée')} />
            <div className="gauge-legend">
              <span className="num">
                <b>{formatNumber(deal.progress.ordered, lang)}</b> {t('commandés sur un objectif de')} <b>{formatNumber(deal.progress.target, lang)}</b>
              </span>
            </div>
            <div className="row row--between row--wrap" style={{ marginTop: 10 }}>
              <Countdown deal={deal} />
              <span className="small muted num">{t('{n} participants', { n: deal.progress.participants })}</span>
            </div>
          </div>

          {deal.status === 'CANCELLED' && deal.cancelReason && <div className="notice notice--warn"><Icon name="info" /><span>{deal.cancelReason}</span></div>}

          <div className="panel sticky">{buyBox}</div>
        </div>
      </div>

      <div className="split section">
        <div className="stack-l">
          {p.features.length > 0 && (
            <section>
              <h2 className="h2" style={{ marginBottom: 12 }}>{t('Caractéristiques')}</h2>
              <ul className="bullets">{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
            </section>
          )}
          {p.specifications.length > 0 && (
            <section>
              <h2 className="h2" style={{ marginBottom: 4 }}>{t('Spécifications')}</h2>
              <table className="specs">
                <tbody>{p.specifications.map((s) => <tr key={s.label}><th scope="row">{s.label}</th><td>{s.value}</td></tr>)}</tbody>
              </table>
            </section>
          )}
        </div>
        <section>
          <h2 className="h2" style={{ marginBottom: 12 }}>{t('Bon à savoir')}</h2>
          <dl className="facts">
            <div><dt>{t('Commande minimum')}</dt><dd className="num">{deal.minQuantity} {unitLabel(p.saleUnit, deal.minQuantity, t)}</dd></div>
            <div><dt>{t('Unité de vente')}</dt><dd>{unitLabel(p.saleUnit, 1, t)}{p.piecesPerSaleUnit > 1 ? ` (${t('{n} pièces', { n: p.piecesPerSaleUnit })})` : ''}</dd></div>
            <div><dt>{t('Origine')}</dt><dd>{p.origin ?? '—'}</dd></div>
            <div><dt>{t('Délai estimé après la fin de la campagne')}</dt><dd className="num">{p.leadTimeDays ? t('{min} à {max} jours', { min: p.leadTimeDays.min, max: p.leadTimeDays.max }) : '—'}</dd></div>
          </dl>
          <p className="small muted" style={{ marginTop: 12 }}>{t('Vous retirez votre commande dans un bureau GROUPDEALS de votre pays. Chaque étape du transport vous est notifiée.')}</p>
        </section>
      </div>

      {deal.open && (
        <div className="buybar">
          <div className="grow">
            <div className="tiny muted">{t('Total')}</div>
            <div className="price" style={{ fontSize: '1.125rem' }}>{quote ? quote.total.formatted : (deal.price?.formatted ?? '—')}</div>
          </div>
          <button className="btn btn--primary" onClick={participate} disabled={!canGo}>{t('Participer')}</button>
        </div>
      )}
    </div>
  );
}

function unavailableText(code: string): string {
  if (code === 'COUNTRY_NOT_COVERED') return N_('Ce produit n’est pas proposé dans votre pays.');
  if (code === 'SHIPPING_RATE_MISSING') return N_('Ce produit n’est pas encore disponible dans votre pays.');
  return N_('Le prix est en cours de mise à jour.');
}

function closedReason(deal: Deal, t: (s: string) => string): string {
  if (deal.status === 'UPCOMING') return t('Cette offre n’est pas encore ouverte.');
  if (deal.status === 'CANCELLED') return t('Cette campagne a été annulée.');
  if (!deal.price) return t(unavailableText(deal.availability));
  if (deal.remainingQuantity === 0) return t('Toutes les quantités de cette offre sont réservées.');
  return t('Cette campagne est terminée.');
}

/* -------------------------------------------------------------------------- */
/* Validation de la commande                                                   */
/* -------------------------------------------------------------------------- */

interface Office {
  id: string;
  name: string;
  city: string;
  address: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  openingHours: Record<string, [string, string][]>;
  latitude: number | null;
  longitude: number | null;
  acceptsPayments?: boolean;
  isPickupPoint?: boolean;
}

export function OfficeCard({ office, compact }: { office: Office; compact?: boolean }) {
  const t = useT();
  const days: [string, string][] = [['mon', t('Lun')], ['tue', t('Mar')], ['wed', t('Mer')], ['thu', t('Jeu')], ['fri', t('Ven')], ['sat', t('Sam')], ['sun', t('Dim')]];
  const hours = days.filter(([k]) => office.openingHours?.[k]?.length).map(([k, label]) => `${label} ${office.openingHours[k].map((h) => h.join('–')).join(', ')}`);
  const map = office.latitude !== null && office.longitude !== null ? `https://www.openstreetmap.org/?mlat=${office.latitude}&mlon=${office.longitude}#map=17/${office.latitude}/${office.longitude}` : null;
  return (
    <div className="stack-s">
      <div className="strong">{office.name}</div>
      <div className="small" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}><span style={{ flex: 'none', marginTop: 3 }}><Icon name="pin" size={15} /></span><span>{office.address}, {office.city}</span></div>
      {!compact && hours.length > 0 && <div className="small muted">{hours.join(', ')}</div>}
      <div className="row row--wrap small">
        {office.phone && <a className="link" href={`tel:${office.phone}`}>{office.phone}</a>}
        {office.whatsapp && <a className="link" href={`https://wa.me/${office.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
        {map && <a className="link" href={map} target="_blank" rel="noopener noreferrer">{t('Voir sur la carte')}</a>}
      </div>
    </div>
  );
}

export function OfficeMap({ office }: { office: Office }) {
  // La démonstration ne peut pas intégrer de carte externe.
  if (DEMO || office.latitude === null || office.longitude === null) return null;
  const d = 0.006;
  const bbox = [office.longitude - d, office.latitude - d, office.longitude + d, office.latitude + d].join(',');
  return (
    <iframe
      title={office.name}
      loading="lazy"
      style={{ width: '100%', height: 220, border: 0, borderRadius: 16, background: 'var(--mist)' }}
      src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${office.latitude},${office.longitude}`}
    />
  );
}

export function CheckoutPage({ slug }: { slug: string }) {
  const t = useT();
  const { user, setUser } = useAuth();
  const { search } = useLocation();
  const toast = useToast();
  const itemsParam = search.get('items') ?? '';
  const items = useMemo(
    () =>
      itemsParam
        .split(',')
        .map((x) => x.split(':'))
        .filter((x) => x.length === 2 && Number(x[1]) > 0)
        .map(([variantId, n]) => ({ variantId: variantId || null, quantity: Number(n) })),
    [itemsParam],
  );
  const deal = useApi<{ deal: DealDetail }>(`/group-deals/${slug}`);
  const offices = useApi<{ offices: Office[]; cities: string[] }>(user ? '/local-offices' : null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<ApiError | null>(null);
  const [method, setMethod] = useState<'ONLINE' | 'OFFICE'>('ONLINE');
  const [city, setCity] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [pickupId, setPickupId] = useState('');
  const key = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!deal.data || !items.length) return;
    post<Quote>(`/group-deals/${deal.data.deal.id}/quote`, { items }).then(setQuote).catch(setQuoteError);
  }, [deal.data?.deal.id, items]);

  const cashOffices = (offices.data?.offices ?? []).filter((o) => o.acceptsPayments);
  const payOffices = cashOffices.filter((o) => !city || o.city === city);
  // Le paiement au bureau n'est proposé que si le serveur l'autorise pour ce total ET qu'un bureau du pays encaisse.
  const officeOffered = !!quote?.paymentMethods.office && (!offices.data || cashOffices.length > 0);
  // Si le bureau n'est pas (ou plus) proposé par le serveur, on revient au paiement en ligne.
  useEffect(() => {
    if (quote && !officeOffered && method === 'OFFICE') setMethod('ONLINE');
  }, [quote, method, officeOffered]);

  const pickupOffices = (offices.data?.offices ?? []).filter((o) => o.isPickupPoint);
  useEffect(() => {
    if (pickupOffices.length === 1 && !pickupId) setPickupId(pickupOffices[0].id);
  }, [pickupOffices.length]);
  // Paiement au bureau : un bureau est proposé d'emblée (le premier de la liste, ou de la ville choisie), pour que
  // « Réserver et payer au bureau » soit utilisable tout de suite. Le client peut en choisir un autre.
  useEffect(() => {
    if (method !== 'OFFICE' || payOffices.some((o) => o.id === officeId)) return;
    setOfficeId(payOffices[0]?.id ?? '');
  }, [method, city, payOffices.length, officeId]);

  const submit = useAction(async () => {
    if (!deal.data || !quote) return;
    const res = await post<{ order: any }>(
      `/group-deals/${deal.data.deal.id}/participate`,
      { items, paymentMethod: method, officeId: method === 'OFFICE' ? officeId : null, pickupOfficeId: method === 'OFFICE' ? null : pickupId || null, expectedTotal: quote.total.amount },
      { 'Idempotency-Key': key.current },
    );
    if (method === 'ONLINE') {
      try {
        const pay = await post<{ checkoutUrl: string }>('/payments', { orderId: res.order.id });
        leaveTo(pay.checkoutUrl);
        return;
      } catch (e) {
        // La commande existe : le client pourra relancer le paiement depuis sa commande.
        toast(t((e as ApiError).message), true);
      }
    }
    navigate(`/orders/${res.order.id}`, { replace: true });
  });

  const proforma = useAction(async () => {
    if (!deal.data) return;
    const saved = await downloadQuoteProforma({ dealId: deal.data.deal.id, dealSlug: slug, items, paymentMethod: method, officeId: method === 'OFFICE' && officeId ? officeId : null });
    const message = saveMessage(saved, N_('Proforma téléchargée'));
    if (message) toast(t(message));
  });

  // Adresse email non vérifiée : le client relance la vérification sans quitter la page. En production, le lien part par
  // email. Hors production et en démonstration, aucun email n'est envoyé : l'API remet le lien, qui est ouvert aussitôt.
  const [linkSent, setLinkSent] = useState(false);
  const verify = useAction(async () => {
    if (!deal.data) return;
    const r = await post<{ debug?: { verifyToken?: string } }>('/auth/resend-verification');
    if (!r.debug?.verifyToken) {
      setLinkSent(true);
      return;
    }
    await post('/auth/verify-email', { token: r.debug.verifyToken });
    setUser((await get<{ user: any }>('/me')).user);
    setQuote(await post<Quote>(`/group-deals/${deal.data.deal.id}/quote`, { items }));
    toast(t('Adresse vérifiée. Vous pouvez commander.'));
  });

  // Le client a ouvert le lien reçu par email (autre onglet, messagerie) puis revient ici : le bouton se débloque tout seul.
  useEffect(() => {
    if (!quote?.emailVerificationRequired || !deal.data) return;
    const dealId = deal.data.deal.id;
    const recheck = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const me = (await get<{ user: any }>('/me')).user;
        if (!me?.emailVerified) return;
        setUser(me);
        setQuote(await post<Quote>(`/group-deals/${dealId}/quote`, { items }));
      } catch {
        // Hors ligne ou session expirée : le client peut toujours utiliser le bouton de vérification.
      }
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [quote?.emailVerificationRequired, deal.data?.deal.id, items]);

  // Prix modifié depuis l'affichage : on recharge le devis et on demande une nouvelle confirmation.
  useEffect(() => {
    if (submit.error?.code === 'PRICE_CHANGED' && deal.data) {
      key.current = newIdempotencyKey();
      post<Quote>(`/group-deals/${deal.data.deal.id}/quote`, { items }).then(setQuote).catch(() => undefined);
    }
  }, [submit.error]);

  if (deal.loading || (!quote && !quoteError && items.length > 0)) return <div className="wrap page"><Loading /></div>;
  if (deal.error || !deal.data) return <div className="wrap page"><ErrorNote error={deal.error} onRetry={deal.reload} /></div>;
  const d = deal.data.deal;
  if (!items.length) return <div className="wrap page"><Empty title={t('Aucune quantité choisie')} action={<Link to={`/deals/${slug}`} className="btn btn--navy">{t('Revenir à l’offre')}</Link>} /></div>;

  const needOffice = method === 'OFFICE' && !officeId;
  const needPickup = method === 'ONLINE' && pickupOffices.length > 0 && !pickupId;
  const blocked = !quote?.canOrder || needOffice || needPickup || quote.emailVerificationRequired;

  return (
    <div className="wrap wrap--narrow page">
      <Link to={`/deals/${slug}`} className="link small">{t('Revenir à l’offre')}</Link>
      <h1 className="h1" style={{ marginTop: 8 }}>{t('Votre commande')}</h1>

      <div className="stack-l" style={{ marginTop: 24 }}>
        {quoteError && <ErrorNote error={quoteError} />}
        {quote && (
          <section className="panel">
            {/* Récapitulatif du §16 : produit, prix unitaire, quantité, total. Aucune ligne de livraison. */}
            <table className="recap">
              <thead>
                <tr><th>{t('Produit')}</th><th className="r">{t('Prix unitaire')}</th><th className="r">{t('Quantité')}</th><th className="r">{t('Total')}</th></tr>
              </thead>
              <tbody>
                {quote.lines.map((l) => (
                  <tr key={l.variantId ?? 'x'}>
                    <td><div className="strong">{d.product.name}</div>{l.variantLabel && <div className="small muted">{l.variantLabel}</div>}</td>
                    <td className="r num">{l.unitPrice.formatted}</td>
                    <td className="r num">{l.quantity}</td>
                    <td className="r num strong">{l.lineTotal.formatted}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3}>{t('Total à payer')}</td><td className="r"><span className="price" style={{ fontSize: '1.375rem' }}>{quote.total.formatted}</span></td></tr>
              </tfoot>
            </table>
            <p className="small muted" style={{ marginTop: 8 }}>{t('Ce prix est final : la livraison vers votre pays est comprise.')}</p>
            {quote.problem && <div className="notice notice--warn" style={{ marginTop: 12 }}><Icon name="info" /><span>{t(quote.problem.message)}</span></div>}
            {/* Proforma du devis affiché : téléchargeable avant de confirmer, quel que soit le mode de paiement. */}
            {quote.canOrder && (
              <div className="proforma">
                <button type="button" className="btn btn--navy" onClick={() => proforma.run()} disabled={proforma.busy}>
                  <Icon name="download" /> {t('Téléchargez votre proforma')}
                </button>
                <p className="small muted">{t('Votre facture proforma en PDF : produits, quantités et total à payer. Elle ne réserve pas encore vos quantités.')}</p>
                {proforma.error && <ErrorNote error={proforma.error} />}
              </div>
            )}
          </section>
        )}

        {quote && (
          <Form onSubmit={() => submit.run()} className="stack-l">
            <fieldset style={{ border: 0, padding: 0, marginInline: 0, marginBottom: 0 }} className="stack">
              <legend className="h2" style={{ marginBottom: 12 }}>{t('Mode de paiement')}</legend>
              <label className="choice">
                <input type="radio" name="method" checked={method === 'ONLINE'} onChange={() => setMethod('ONLINE')} />
                <div>
                  <div className="strong row"><Icon name="card" /> {t('Payer en ligne')}</div>
                  <p className="small muted">{t('Mobile Money, carte bancaire et autres moyens disponibles dans votre pays.')}</p>
                </div>
              </label>
              {/* Le bureau local n'apparaît que si le serveur l'autorise pour ce total (règle des 500 000 FCFA). */}
              {officeOffered && (
                <label className="choice">
                  <input type="radio" name="method" checked={method === 'OFFICE'} onChange={() => setMethod('OFFICE')} />
                  <div>
                    <div className="strong row"><Icon name="store" /> {t('Payer au bureau local')}</div>
                    <p className="small muted">{t('Réservez maintenant, puis réglez dans un bureau GROUPDEALS de votre pays avant la date limite de la réservation.')}</p>
                  </div>
                </label>
              )}
              {quote.paymentMethods.office && !officeOffered && <p className="small muted">{t('Aucun bureau GROUPDEALS ne reçoit encore de paiement dans votre pays : le paiement se fait en ligne.')}</p>}
              {!quote.paymentMethods.office && quote.paymentMethods.officeThreshold && (
                <p className="small muted">{t('Le paiement au bureau local est proposé à partir de {amount}.', { amount: quote.paymentMethods.officeThreshold.formatted })}</p>
              )}
            </fieldset>

            {method === 'OFFICE' && (
              <fieldset style={{ border: 0, padding: 0, marginInline: 0, marginBottom: 0 }} className="stack">
                <legend className="h2" style={{ marginBottom: 12 }}>{t('Choisissez votre bureau')}</legend>
                {payOffices.length > 1 && <p className="small muted">{t('Un bureau est déjà sélectionné. Vous pouvez en choisir un autre.')}</p>}
                {(offices.data?.cities.length ?? 0) > 1 && (
                  <div className="chips">
                    <button type="button" className="chip" aria-pressed={!city} onClick={() => setCity('')}>{t('Toutes les villes')}</button>
                    {offices.data!.cities.map((c) => <button type="button" key={c} className="chip" aria-pressed={c === city} onClick={() => setCity(c)}>{c}</button>)}
                  </div>
                )}
                {payOffices.length === 0 && <Empty title={t('Aucun bureau dans votre pays pour le moment')}>{t('Choisissez le paiement en ligne.')}</Empty>}
                {payOffices.map((o) => (
                  <label className="choice" key={o.id}>
                    <input type="radio" name="office" checked={officeId === o.id} onChange={() => setOfficeId(o.id)} />
                    <div className="grow"><OfficeCard office={o} /></div>
                  </label>
                ))}
                {officeId && <OfficeMap office={payOffices.find((o) => o.id === officeId) ?? payOffices[0]} />}
              </fieldset>
            )}

            {method === 'ONLINE' && pickupOffices.length > 0 && (
              <Select label={t('Bureau de retrait de votre colis')} value={pickupId} onChange={(e) => setPickupId(e.target.value)} hint={t('Vous retirerez votre commande dans ce bureau à son arrivée.')}>
                <option value="">{t('Choisir un bureau')}</option>
                {pickupOffices.map((o) => <option key={o.id} value={o.id}>{o.city} — {o.name}</option>)}
              </Select>
            )}

            {submit.error && submit.error.code !== 'PRICE_CHANGED' && <ErrorNote error={submit.error} />}
            {submit.error?.code === 'PRICE_CHANGED' && (
              <div className="notice notice--warn" role="alert"><Icon name="alert" /><span>{t('Le prix a changé. Vérifiez le nouveau total ci-dessus, puis confirmez à nouveau.')}</span></div>
            )}

            <button className="btn btn--primary btn--block" disabled={blocked || submit.busy}>
              {submit.busy ? t('Enregistrement…') : method === 'ONLINE' ? t('Payer {amount}', { amount: quote.total.formatted }) : t('Réserver et payer au bureau')}
            </button>
            {/* Bouton grisé : la raison est écrite juste dessous, avec le geste qui le débloque. */}
            {quote.emailVerificationRequired ? (
              <div className="notice notice--warn" role="status">
                <Icon name="info" />
                <div className="stack-s grow">
                  <p className="strong">{t('Vérifiez votre adresse email pour commander.')}</p>
                  {linkSent ? (
                    <p className="small">{t('Lien envoyé à {email}. Ouvrez-le, puis revenez sur cette page : le bouton sera débloqué.', { email: user?.email ?? t('votre adresse') })}</p>
                  ) : (
                    <p className="small">{t('Le bouton ci-dessus se débloque dès que votre adresse est vérifiée.')}</p>
                  )}
                  <button type="button" className="btn btn--navy" onClick={() => verify.run()} disabled={verify.busy}>{linkSent ? t('Renvoyer le lien') : t('Vérifier mon adresse email')}</button>
                  {verify.error && <ErrorNote error={verify.error} />}
                </div>
              </div>
            ) : !quote.canOrder ? (
              quote.problem && <p className="small muted" style={{ textAlign: 'center' }}>{t(quote.problem.message)}</p>
            ) : needOffice ? (
              <p className="small muted" style={{ textAlign: 'center' }}>{t('Choisissez un bureau dans la liste pour continuer.')}</p>
            ) : needPickup ? (
              <p className="small muted" style={{ textAlign: 'center' }}>{t('Choisissez votre bureau de retrait pour continuer.')}</p>
            ) : null}
          </Form>
        )}
      </div>
    </div>
  );
}
