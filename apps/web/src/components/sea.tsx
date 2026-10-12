/**
 * Fond animé de la bannière d'accueil : la mer, un port et des porte-conteneurs, en transparence sur le bleu marine.
 * Purement décoratif (aria-hidden). Tout est dessiné ici en SVG : aucune image à charger.
 * Les mouvements sont lents et n'utilisent que des translations ; ils s'arrêtent si le visiteur a demandé
 * moins d'animations dans les réglages de son appareil (prefers-reduced-motion).
 */
import { useEffect, useState } from 'react';

/** Couleurs des conteneurs : celles de la marque, un peu adoucies par la transparence de la scène. */
const BOX = ['#FF4F79', '#20C45A', '#F2B33D', '#E9EEF8', '#5B7BD5', '#FF8FA8', '#20C45A', '#F2B33D', '#E9EEF8', '#FF4F79', '#5B7BD5', '#F2B33D'];

/** Vague périodique sur 2 880 unités (deux fois la largeur affichée) : la décaler de moitié la fait boucler sans raccord. */
function wave(base: number, amp: number, length: number, closed: boolean): string {
  let d = `M0 ${base}`;
  for (let x = 0; x < 2880; x += length) d += ` q ${length / 4} ${-amp} ${length / 2} 0 t ${length / 2} 0`;
  return closed ? `${d} V 160 H 0 Z` : d;
}

function useCalm(): boolean {
  const query = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;
  const [calm, setCalm] = useState(!!query?.matches);
  useEffect(() => {
    if (!query) return;
    const on = () => setCalm(query.matches);
    query.addEventListener?.('change', on);
    return () => query.removeEventListener?.('change', on);
  }, []);
  return calm;
}

/** Porte-conteneurs vu de profil, proue à droite. */
function Ship({ tiers = 3, seed = 0 }: { tiers?: number; seed?: number }) {
  const boxes = [];
  for (let tier = 0; tier < tiers; tier++) {
    for (let col = 0; col < 10; col++) {
      if (tier === tiers - 1 && (col + seed) % 4 === 3) continue; // une pile incomplète, comme sur un vrai navire
      boxes.push(<rect key={`${tier}-${col}`} x={80 + col * 24} y={54 - tier * 13} width="22" height="11.5" rx="1" fill={BOX[(col * 5 + tier * 3 + seed) % BOX.length]} />);
    }
  }
  return (
    <svg viewBox="0 0 360 112" width="360" height="112">
      {/* Sillage derrière la poupe */}
      <g className="sea__wake" fill="none" stroke="#fff" strokeLinecap="round">
        <path d="M2 92 H26" strokeWidth="2" opacity=".5" />
        <path d="M-18 98 H18" strokeWidth="1.5" opacity=".35" />
        <path d="M-40 103 H8" strokeWidth="1.2" opacity=".2" />
      </g>
      {/* Château et cheminée, à l'arrière */}
      <rect x="34" y="20" width="36" height="46" rx="2" fill="#E9EEF8" />
      <rect x="38" y="26" width="28" height="4" rx="1" fill="#0D1B45" opacity=".75" />
      <rect x="38" y="35" width="28" height="4" rx="1" fill="#0D1B45" opacity=".75" />
      <rect x="47" y="6" width="12" height="15" rx="1" fill="#FF4F79" />
      <rect x="47" y="6" width="12" height="3" fill="#0D1B45" opacity=".6" />
      {boxes}
      {/* Mât avant */}
      <rect x="330" y="38" width="2.5" height="28" fill="#E9EEF8" />
      {/* Coque, ligne de flottaison rose */}
      <path d="M10 66 H334 L356 58 L340 98 H28 Z" fill="#081233" />
      <path d="M22 88 H346 L342 96 H27 Z" fill="#FF4F79" opacity=".85" />
      <text x="300" y="80" fontSize="9" fontWeight="700" fill="#E9EEF8" opacity=".7" fontFamily="inherit" letterSpacing=".5">GD</text>
    </svg>
  );
}

/** Port : deux portiques à conteneurs et des piles sur le quai. */
function Port() {
  const stack = (x: number, rows: number, seed: number) =>
    Array.from({ length: rows * 3 }, (_, i) => (
      <rect key={i} x={x + (i % 3) * 23} y={128 - Math.floor(i / 3) * 12} width="21" height="10.5" rx="1" fill={BOX[(i * 7 + seed) % BOX.length]} opacity=".75" />
    ));
  const crane = (x: number) => (
    <g fill="none" stroke="#3A54A8" strokeWidth="4" strokeLinejoin="round">
      <path d={`M${x} 140 V40 M${x + 46} 140 V40 M${x} 76 H${x + 46} M${x} 40 H${x + 46}`} />
      <path d={`M${x - 40} 34 H${x + 120}`} strokeWidth="6" />
      <path d={`M${x + 23} 34 L${x + 23} 10 L${x + 120} 34 M${x + 23} 10 L${x - 40} 34`} strokeWidth="2.5" />
      <g className="sea__trolley">
        <rect x={x + 70} y="36" width="14" height="8" fill="#3A54A8" stroke="none" />
        <path d={`M${x + 77} 44 V70`} strokeWidth="1.5" />
        <rect x={x + 66} y="70" width="22" height="10" rx="1" fill="#F2B33D" stroke="none" />
      </g>
    </g>
  );
  return (
    <svg viewBox="0 0 420 150" width="420" height="150">
      <rect x="0" y="140" width="420" height="10" fill="#26397C" />
      {crane(40)}
      {crane(220)}
      {stack(120, 3, 1)}
      {stack(300, 2, 4)}
    </svg>
  );
}

export function HeroSea() {
  const calm = useCalm();
  return (
    <div className="sea" aria-hidden="true">
      {/* Route maritime : un trait pointillé qui défile entre deux ports, et un conteneur qui la parcourt. */}
      <svg className="sea__route" viewBox="0 0 1440 400" preserveAspectRatio="none">
        <path id="sea-route" d="M60 330 C 420 40, 1020 30, 1400 250" fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="2 12" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="sea__dash" />
        <circle cx="60" cy="330" r="4" fill="#FF4F79" />
        <circle cx="1400" cy="250" r="4" fill="#20C45A" />
        {!calm && (
          <circle r="3.5" fill="#F2B33D">
            <animateMotion dur="14s" repeatCount="indefinite" rotate="auto">
              <mpath href="#sea-route" />
            </animateMotion>
          </circle>
        )}
      </svg>

      <div className="sea__port"><Port /></div>

      <div className="sea__water">
        <svg className="sea__wave sea__wave--back" viewBox="0 0 2880 160" preserveAspectRatio="none">
          <path d={wave(40, 10, 360, true)} fill="#1E3170" />
          <path d={wave(40, 10, 360, false)} fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="sea__ship sea__ship--far"><div className="sea__bob"><Ship tiers={2} seed={3} /></div></div>
        <svg className="sea__wave sea__wave--mid" viewBox="0 0 2880 160" preserveAspectRatio="none">
          <path d={wave(72, 12, 240, true)} fill="#22377E" />
          <path d={wave(72, 12, 240, false)} fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="sea__ship sea__ship--near"><div className="sea__bob"><Ship /></div></div>
        <svg className="sea__wave sea__wave--front" viewBox="0 0 2880 160" preserveAspectRatio="none">
          <path d={wave(104, 9, 180, true)} fill="#2A418E" />
          <path d={wave(104, 9, 180, false)} fill="none" stroke="#fff" strokeOpacity=".2" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </div>
  );
}
