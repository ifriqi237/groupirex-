/**
 * Éléments d'une offre : jauge collective, compte à rebours, carte.
 */

import { useEffect, useState } from 'react';
import { ApiError, del, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatNumber, useI18n, useT } from '../lib/i18n';
import { Link, navigate, currentPath } from '../lib/router';
import { Icon, ProductImage, useToast } from './ui';

export interface MoneyDto {
  amount: number;
  currency: string;
  decimals: number;
  formatted: string;
}

export interface Deal {
  id: string;
  slug: string;
  title: string;
  status: 'UPCOMING' | 'ACTIVE' | 'TARGET_REACHED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'DRAFT';
  open: boolean;
  isFeatured: boolean;
  isFavorite?: boolean;
  product: {
    id: string;
    slug: string;
    name: string;
    description: string;
    saleUnit: 'UNIT' | 'LOT' | 'CARTON' | 'PALLET';
    piecesPerSaleUnit: number;
    cover: { kind: string; url: string; thumbnailUrl: string | null; alt: string } | null;
    category: { id: string; slug: string; name: string };
  };
  price: MoneyDto | null;
  compareAtPrice: MoneyDto | null;
  discountPercent: number | null;
  availability: string;
  minQuantity: number;
  maxPerOrder: number | null;
  remainingQuantity: number | null;
  progress: { ordered: number; target: number; percent: number; participants: number };
  startsAt: string;
  endsAt: string;
  secondsRemaining: number;
  secondsUntilStart: number;
  serverTime: string;
}

/**
 * La jauge collective, dessinée comme un conteneur qui se remplit.
 * Elle ne compte que les quantités payées.
 */
export function Gauge({ percent, large, onNavy, label }: { percent: number; large?: boolean; onNavy?: boolean; label: string }) {
  const width = Math.max(percent > 0 ? 2 : 0, Math.min(100, percent));
  return (
    <div
      className={`gauge ${large ? 'gauge--l' : ''} ${onNavy ? 'gauge--on-navy' : ''} ${percent >= 100 ? 'gauge--reached' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, percent)}
      aria-label={label}
    >
      <div className="gauge__fill" style={{ width: `${width}%` }} />
    </div>
  );
}

/**
 * Compte à rebours. Le serveur donne le nombre de secondes restantes ; le client
 * ne fait que le décompter, sans se fier à l'heure de l'appareil.
 */
export function useCountdown(seconds: number): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const start = performance.now();
    setLeft(seconds);
    if (seconds <= 0) return;
    const timer = setInterval(() => {
      const next = Math.max(0, seconds - Math.floor((performance.now() - start) / 1000));
      setLeft(next);
      if (next === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds]);
  return left;
}

export function formatDuration(total: number, t: (s: string, v?: Record<string, string | number>) => string): string {
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return t('{d} j {h} h {m} min', { d, h: pad(h), m: pad(m) });
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function Countdown({ deal }: { deal: Deal }) {
  const t = useT();
  const upcoming = deal.status === 'UPCOMING';
  const left = useCountdown(upcoming ? deal.secondsUntilStart : deal.secondsRemaining);
  if (deal.status === 'COMPLETED') return <span className="small muted">{t('Campagne confirmée')}</span>;
  if (deal.status === 'CANCELLED') return <span className="small muted">{t('Campagne annulée')}</span>;
  if (!upcoming && left <= 0) return <span className="small muted">{t('Campagne terminée')}</span>;
  return (
    <span className="small row" style={{ gap: 6 }}>
      <Icon name="clock" size={16} />
      <span className="muted">{upcoming ? t('Ouvre dans') : t('Se termine dans')}</span>
      <span className={`countdown ${!upcoming && left < 86_400 ? 'countdown--urgent' : ''}`}>{formatDuration(left, t)}</span>
    </span>
  );
}

/** Compte à rebours en trois cases (jours, heures, minutes ; heures, minutes, secondes le dernier jour). */
export function CountdownTiles({ deal }: { deal: Deal }) {
  const t = useT();
  const upcoming = deal.status === 'UPCOMING';
  const left = useCountdown(upcoming ? deal.secondsUntilStart : deal.secondsRemaining);
  if (deal.status === 'COMPLETED' || deal.status === 'CANCELLED' || (!upcoming && left <= 0)) return <Countdown deal={deal} />;
  const d = Math.floor(left / 86_400);
  const h = Math.floor((left % 86_400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const sec = left % 60;
  const cells: [number, string][] = d > 0 ? [[d, t('jours')], [h, t('heures')], [m, t('minutes')]] : [[h, t('heures')], [m, t('minutes')], [sec, t('secondes')]];
  return (
    <div className="tiles" role="timer" aria-label={`${upcoming ? t('Ouvre dans') : t('Se termine dans')} ${formatDuration(left, t)}`}>
      <div className="tiles__label small">{upcoming ? t('La commande groupée ouvre dans') : t('La commande groupée se termine dans')}</div>
      <div className={`tiles__row ${!upcoming && left < 86_400 ? 'tiles__row--urgent' : ''}`} aria-hidden="true">
        {cells.map(([n, label]) => (
          <div className="tiles__cell" key={label}><b className="num">{String(n).padStart(2, '0')}</b><span>{label}</span></div>
        ))}
      </div>
    </div>
  );
}

export function unitLabel(unit: string, n: number, t: (s: string) => string): string {
  const one: Record<string, string> = { UNIT: t('unité'), LOT: t('lot'), CARTON: t('carton'), PALLET: t('palette') };
  const many: Record<string, string> = { UNIT: t('unités'), LOT: t('lots'), CARTON: t('cartons'), PALLET: t('palettes') };
  return (n > 1 ? many : one)[unit] ?? '';
}

export function FavoriteButton({ deal, onChange }: { deal: Deal; onChange?: (fav: boolean) => void }) {
  const t = useT();
  const { user } = useAuth();
  const toast = useToast();
  const [fav, setFav] = useState(!!deal.isFavorite);
  useEffect(() => setFav(!!deal.isFavorite), [deal.isFavorite]);
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(currentPath())}`);
      return;
    }
    const next = !fav;
    setFav(next);
    try {
      await (next ? put(`/me/favorites/${deal.product.id}`) : del(`/me/favorites/${deal.product.id}`));
      onChange?.(next);
    } catch (err) {
      setFav(!next);
      toast(t((err as ApiError).message), true);
    }
  };
  return (
    <button className="deal__fav" aria-pressed={fav} aria-label={fav ? t('Retirer des favoris') : t('Ajouter aux favoris')} onClick={toggle}>
      <Icon name="heart" fill={fav} />
    </button>
  );
}

/** Carte d'une offre (§12) : image, nom, ancien prix, prix final, jauge, compte à rebours. */
export function DealCard({ deal }: { deal: Deal }) {
  const t = useT();
  const { lang } = useI18n();
  const reached = deal.progress.percent >= 100;
  return (
    <article className="deal">
      <Link to={`/deals/${deal.slug}`} className="deal" aria-label={deal.title}>
        <div className="deal__media">
          {deal.product.cover && <ProductImage src={deal.product.cover.thumbnailUrl ?? deal.product.cover.url} alt={deal.product.cover.alt} loading="lazy" width="480" height="360" />}
          <div className="deal__tags">
            {deal.discountPercent ? <span className="badge badge--deal num">−{deal.discountPercent} %</span> : null}
            {deal.status === 'UPCOMING' && <span className="badge badge--navy">{t('Bientôt')}</span>}
            {reached && deal.status !== 'UPCOMING' && <span className="badge badge--green">{t('Objectif atteint')}</span>}
          </div>
        </div>
        <div className="deal__body">
          <span className="deal__cat">{deal.product.category.name}</span>
          <h3 className="deal__name">{deal.title}</h3>
          <div className="deal__prices">
            {deal.price ? <span className="price price--card">{deal.price.formatted}</span> : <span className="small muted">{t('Prix indisponible pour votre pays')}</span>}
            {deal.compareAtPrice && <span className="price-old">{deal.compareAtPrice.formatted}</span>}
          </div>
          <div className="deal__foot">
            <Gauge percent={deal.progress.percent} label={t('Progression de la commande groupée')} />
            <div className="gauge-legend">
              <span className="num">
                <b>{formatNumber(deal.progress.ordered, lang)}</b> / {formatNumber(deal.progress.target, lang)} {unitLabel(deal.product.saleUnit, deal.progress.target, t)}
              </span>
              <span className="num strong">{deal.progress.percent} %</span>
            </div>
            <div style={{ marginTop: 8 }}>
              <Countdown deal={deal} />
            </div>
            {/* Toute la carte mène à l'offre ; le bouton rend l'action visible. */}
            {deal.open && (
              <span className="btn btn--primary btn--s btn--block deal__cta">
                {t('Participer au GroupDeals')}
              </span>
            )}
          </div>
        </div>
      </Link>
      <FavoriteButton deal={deal} />
    </article>
  );
}

export function DealGrid({ deals }: { deals: Deal[] }) {
  return (
    <div className="grid grid--deals">
      {deals.map((d) => (
        <DealCard key={d.id} deal={d} />
      ))}
    </div>
  );
}
