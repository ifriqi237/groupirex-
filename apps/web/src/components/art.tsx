/**
 * Décor de l'univers GROUPDEALS, repris de la page d'inscription : carte du monde en pointillés,
 * avion, porte-conteneurs, camion et bulles « G ». Purement décoratif (masqué aux lecteurs d'écran).
 */

import type { CSSProperties } from 'react';
import { asset } from '../lib/env';

/** Bulles : position en % du cadre, diamètre en pixels, lettre G ou non. */
const BUBBLES: [x: number, y: number, size: number, letter: boolean][] = [
  [7, 18, 54, true], [44, 70, 30, false], [66, 12, 70, true], [93, 46, 40, false], [24, 9, 22, false], [56, 88, 46, true],
];

export function Art({ ship = true, truck = true, plane = true, bubbles = true }: { ship?: boolean; truck?: boolean; plane?: boolean; bubbles?: boolean }) {
  return (
    <div className="art" aria-hidden="true">
      <img className="art__map" src={asset('/welcome/map.svg')} alt="" />
      {plane && <img className="art__plane" src={asset('/welcome/plane.svg')} alt="" />}
      {ship && <img className="art__ship" src={asset('/welcome/ship.svg')} alt="" />}
      {truck && <img className="art__truck" src={asset('/welcome/truck.svg')} alt="" />}
      {bubbles &&
        BUBBLES.map(([x, y, size, letter], i) => (
          <span key={i} className="bubble" style={{ left: `${x}%`, top: `${y}%`, width: `clamp(${Math.round(size * 0.6)}px, ${(size / 12).toFixed(1)}vw, ${size}px)`, animationDelay: `${-(i * 1.9) % 9}s` } as CSSProperties}>
            {letter && <span>G</span>}
          </span>
        ))}
    </div>
  );
}
