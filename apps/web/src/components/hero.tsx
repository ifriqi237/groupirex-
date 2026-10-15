/**
 * Bannière d'accueil : images de fond en carrousel (fondu enchaîné et lent zoom),
 * slogan, appels à l'action, chiffres animés et carte de la campagne en vedette.
 * Le carrousel s'arrête au survol, au clavier, quand l'onglet est caché et quand
 * l'appareil demande moins d'animations ; on peut aussi le mettre en pause.
 */

import { ReactNode, useEffect, useRef, useState } from 'react';
import { asset } from '../lib/env';
import { N_, formatNumber, useI18n, useT } from '../lib/i18n';
import { Link } from '../lib/router';
import { Icon } from './ui';

interface Slide {
  key: string;
  label: string;
  caption: string;
  to: string;
  /** Image de fond (ordinateur, puis téléphone) ; absente pour la diapositive « importation », dessinée. */
  image?: [wide: string, tall: string];
}

const SLIDES: Slide[] = [
  { key: 'import', label: N_('Importation'), caption: N_('De l’usine jusqu’à votre ville, en un seul conteneur'), to: '/deals' },
  { key: 'mode', label: N_('Mode'), caption: N_('Wax et prêt-à-porter, commandés directement aux ateliers'), to: '/deals?category=mode-homme', image: ['/hero/mode.webp', '/hero/mode-m.webp'] },
  { key: 'solaire', label: N_('Énergie solaire'), caption: N_('Panneaux et kits solaires au prix usine'), to: '/deals?category=energie-solaire', image: ['/hero/solaire.webp', '/hero/solaire-m.webp'] },
  { key: 'cuir', label: N_('Cuir'), caption: N_('Sandales et sacs en cuir, du fabricant à vos pieds'), to: '/deals?category=mode-femme', image: ['/hero/chaussures.webp', '/hero/chaussures-m.webp'] },
];

const DURATION = 6500;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** Compte de 0 jusqu'à la valeur, une seule fois, à l'arrivée sur la page. */
function CountUp({ value }: { value: number }) {
  const { lang } = useI18n();
  const reduced = useReducedMotion();
  const [n, setN] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) return setN(value);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1400);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <>{formatNumber(n, lang)}</>;
}

export function HeroCarousel({ badge, title, lead, actions, stats, aside }: {
  badge?: ReactNode;
  title: string;
  lead: string;
  actions?: ReactNode;
  stats?: { value: number; label: string }[];
  aside?: ReactNode;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [hidden, setHidden] = useState(false);
  const touch = useRef<number | null>(null);
  const running = !paused && !held && !hidden && !reduced;

  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), DURATION);
    return () => clearTimeout(timer);
  }, [index, running]);

  const go = (i: number) => setIndex((i + SLIDES.length) % SLIDES.length);
  const current = SLIDES[index];

  return (
    <section
      className={`hx ${running ? 'is-running' : ''}`}
      aria-roledescription={t('carrousel')}
      aria-label={t('Bannière')}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setHeld(false)}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
      }}
    >
      <div className="hx__slides" aria-hidden="true">
        {SLIDES.map((s, i) => (
          <div key={s.key} className={`hx__slide hx__slide--${s.key} ${i === index ? 'is-on' : ''}`}>
            {s.image ? (
              <picture>
                <source media="(max-width: 700px)" srcSet={asset(s.image[1])} />
                <img src={asset(s.image[0])} alt="" loading={i === 0 ? 'eager' : 'lazy'} decoding="async" />
              </picture>
            ) : (
              <div className="hx__drawn">
                <img className="hx__map" src={asset('/welcome/map.svg')} alt="" />
                <img className="hx__ship" src={asset('/welcome/ship.svg')} alt="" />
                <img className="hx__plane" src={asset('/welcome/plane.svg')} alt="" />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="hx__shade" aria-hidden="true" />

      <div className="wrap hx__in">
        <div className="hx__text">
          {badge}
          <h1 className="h-display hx__title">{title}</h1>
          <p className="hx__lead">{lead}</p>
          {actions && <div className="row row--wrap hx__ctas">{actions}</div>}
          {stats && stats.length > 0 && (
            <dl className="hx__stats">
              {stats.map((s) => (
                <div key={s.label}><dt>{s.label}</dt><dd className="num"><CountUp value={s.value} /></dd></div>
              ))}
            </dl>
          )}
        </div>
        {aside && <div className="hx__aside">{aside}</div>}
      </div>

      <div className="wrap hx__bar">
        <Link to={current.to} className="hx__caption" key={current.key}>
          <span>{t(current.caption)}</span>
          <Icon name="chevron" size={16} />
        </Link>
        <div className="hx__nav">
          <button type="button" className="hx__arrow" onClick={() => go(index - 1)} aria-label={t('Image précédente')}><Icon name="back" size={18} /></button>
          <div className="hx__dots" role="tablist" aria-label={t('Choisir une image')}>
            {SLIDES.map((s, i) => (
              <button key={s.key} type="button" role="tab" aria-selected={i === index} className={`hx__dot ${i === index ? 'is-on' : ''}`} onClick={() => go(i)}>
                <span className="hx__dotlabel">{t(s.label)}</span>
                <span className="hx__track"><span className="hx__fill" style={{ animationDuration: `${DURATION}ms` }} /></span>
              </button>
            ))}
          </div>
          <button type="button" className="hx__arrow" onClick={() => go(index + 1)} aria-label={t('Image suivante')}><Icon name="chevron" size={18} /></button>
          {!reduced && (
            <button type="button" className="hx__arrow" onClick={() => setPaused(!paused)} aria-label={paused ? t('Reprendre le défilement') : t('Mettre en pause le défilement')} aria-pressed={paused}>
              <Icon name={paused ? 'play' : 'pause'} size={16} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
