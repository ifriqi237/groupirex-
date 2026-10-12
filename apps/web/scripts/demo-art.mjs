// Génère les illustrations du jeu de démonstration (public/demo/*.svg).
// Ce sont des visuels provisoires : en production, l'administration envoie de vraies photos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/demo');
fs.mkdirSync(out, { recursive: true });

const NAVY = '#0D1B45';
const PINK = '#FF4F79';
const GREEN = '#20C45A';
const TAN = '#D79B5B';
const TAN_D = '#B5773A';
const WHITE = '#FFFFFF';
const BG = { mist: '#E3E8F5', pink: '#FFE0E8', green: '#DDF5E5', sand: '#FBEBD3', navy: '#16275C' };

// Chaque dessin tient dans un carré de 400 × 400 centré sur (0, 0).
const art = {
  sandales: `
    <g transform="rotate(-14) translate(-78 6)">
      <rect x="-58" y="-150" width="116" height="300" rx="58" fill="${TAN_D}"/>
      <rect x="-50" y="-142" width="100" height="284" rx="50" fill="${TAN}"/>
      <path d="M-50-60 50-104v36L-50-24z" fill="${NAVY}"/><path d="M-50-104 50-60v36L-50-68z" fill="${NAVY}" opacity=".82"/>
      <rect x="-50" y="52" width="100" height="26" fill="${NAVY}"/><circle cx="34" cy="65" r="7" fill="${PINK}"/>
    </g>
    <g transform="rotate(12) translate(84 14)">
      <rect x="-58" y="-150" width="116" height="300" rx="58" fill="${TAN_D}"/>
      <rect x="-50" y="-142" width="100" height="284" rx="50" fill="${TAN}"/>
      <path d="M-50-60 50-104v36L-50-24z" fill="${NAVY}"/><path d="M-50-104 50-60v36L-50-68z" fill="${NAVY}" opacity=".82"/>
      <rect x="-50" y="52" width="100" height="26" fill="${NAVY}"/><circle cx="-34" cy="65" r="7" fill="${PINK}"/>
    </g>`,
  chemise: `
    <path d="M-70-150-170-96l34 76 46-22v188H90V-42l46 22 34-76-100-54-32 34h-76z" fill="${PINK}"/>
    <g fill="${NAVY}"><circle cx="-50" cy="-40" r="20"/><circle cx="48" cy="-58" r="14"/><circle cx="40" cy="26" r="24"/><circle cx="-44" cy="60" r="16"/><circle cx="-126" cy="-76" r="12"/><circle cx="126" cy="-80" r="12"/><circle cx="52" cy="104" r="13"/></g>
    <g fill="${GREEN}"><circle cx="-50" cy="-40" r="8"/><circle cx="40" cy="26" r="10"/><circle cx="-44" cy="60" r="6"/></g>
    <path d="M-38-150 0-112 38-150 22-162h-44z" fill="${WHITE}"/><path d="M0-112v258" stroke="${NAVY}" stroke-width="5"/>
    <g fill="${WHITE}"><circle cx="0" cy="-72" r="5"/><circle cx="0" cy="-22" r="5"/><circle cx="0" cy="28" r="5"/><circle cx="0" cy="78" r="5"/></g>`,
  enfant: `
    <path d="M-150-128-206-90l22 50 30-14v116h116V-54l30 14 22-50-56-38-22 20h-48z" fill="${GREEN}"/>
    <circle cx="-94" cy="-22" r="26" fill="${WHITE}"/><path d="M-106-22l8 9 16-18" stroke="${NAVY}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M28 6h156l-10 150h-56L106 70 94 156H38z" fill="${NAVY}"/><rect x="28" y="6" width="156" height="22" fill="${PINK}"/>
    <path d="M40-66a62 62 0 0 1 124 0v8H40z" fill="${PINK}"/><path d="M118-58h80a14 14 0 0 1-14 16h-66z" fill="${NAVY}"/><circle cx="102" cy="-124" r="8" fill="${NAVY}"/>`,
  papier: `
    <g transform="translate(0 20)">
      <path d="M-150 40 0 100 150 40V-70L0-10-150-70z" fill="${TAN_D}"/><path d="M-150-70 0-130 150-70 0-10z" fill="${TAN}"/><path d="M0-10V100" stroke="${NAVY}" stroke-width="4"/>
      <path d="M-46-112 104-52v40L-46-72z" fill="${WHITE}" opacity=".9"/>
      <g transform="translate(-70 44)"><rect x="-56" y="-72" width="112" height="144" rx="6" fill="${WHITE}" stroke="${NAVY}" stroke-width="5" transform="skewY(22)"/><path d="M-34-28h68M-34 0h68M-34 28h44" stroke="${NAVY}" stroke-width="6" stroke-linecap="round" transform="skewY(22)"/></g>
      <rect x="40" y="6" width="74" height="40" rx="6" fill="${PINK}" transform="skewY(-22) translate(0 52)"/>
    </g>`,
  panneau: `
    <g transform="translate(0 -6)">
      <path d="M-140 96-96-124h192l44 220z" fill="${NAVY}"/>
      <g stroke="#5E79D6" stroke-width="5"><path d="M-125 22h250M-111-50h222M-32-124-47 96M32-124 47 96"/></g>
      <path d="M-140 96-96-124h192l44 220z" fill="none" stroke="${WHITE}" stroke-width="8" stroke-linejoin="round"/>
      <path d="M-70 96v54M70 96v54M-110 150h220" stroke="${NAVY}" stroke-width="10" stroke-linecap="round"/>
      <circle cx="142" cy="-136" r="34" fill="${PINK}"/><g stroke="${PINK}" stroke-width="8" stroke-linecap="round"><path d="M142-192v-14M190-136h14M176-170l10-10M108-170l-10-10"/></g>
    </g>`,
  kit: `
    <rect x="-176" y="-130" width="170" height="250" rx="16" fill="${WHITE}" stroke="${NAVY}" stroke-width="8"/>
    <rect x="-150" y="-104" width="118" height="70" rx="8" fill="${NAVY}"/><path d="M-134-58l22-22 18 14 26-26" stroke="${GREEN}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="-126" cy="0" r="10" fill="${GREEN}"/><circle cx="-92" cy="0" r="10" fill="${PINK}"/><circle cx="-58" cy="0" r="10" fill="${NAVY}"/>
    <g stroke="${NAVY}" stroke-width="6" stroke-linecap="round"><path d="M-146 50h110M-146 72h110M-146 94h110"/></g>
    <rect x="30" y="-76" width="150" height="196" rx="16" fill="${NAVY}"/><rect x="62" y="-100" width="30" height="24" rx="4" fill="${NAVY}"/><rect x="118" y="-100" width="30" height="24" rx="4" fill="${NAVY}"/>
    <rect x="52" y="56" width="106" height="42" rx="6" fill="${GREEN}"/><rect x="52" y="4" width="106" height="42" rx="6" fill="${GREEN}"/><rect x="52" y="-48" width="106" height="42" rx="6" fill="${GREEN}" opacity=".45"/>
    <path d="M-6-40h36" stroke="${PINK}" stroke-width="9" stroke-linecap="round"/>`,
  ecouteurs: `
    <rect x="-150" y="-10" width="300" height="150" rx="56" fill="${WHITE}" stroke="${NAVY}" stroke-width="8"/>
    <path d="M-150 44h300" stroke="${NAVY}" stroke-width="6"/><circle cx="0" cy="92" r="9" fill="${GREEN}"/>
    <g transform="translate(-74 -76) rotate(-16)"><circle r="42" fill="${NAVY}"/><rect x="-13" y="20" width="26" height="96" rx="13" fill="${NAVY}"/><circle r="17" fill="${PINK}"/></g>
    <g transform="translate(78 -86) rotate(18)"><circle r="42" fill="${NAVY}"/><rect x="-13" y="20" width="26" height="96" rx="13" fill="${NAVY}"/><circle r="17" fill="${PINK}"/></g>`,
  lampe: `
    <g stroke="${PINK}" stroke-width="9" stroke-linecap="round"><path d="M-150-10h-34M150-10h34M-128-98l-24-22M128-98l24-22"/></g>
    <path d="M-52-150a52 40 0 0 1 104 0" fill="none" stroke="${NAVY}" stroke-width="10"/>
    <rect x="-78" y="-126" width="156" height="34" rx="10" fill="${NAVY}"/>
    <rect x="-66" y="-92" width="132" height="176" rx="14" fill="#FFE27A" stroke="${NAVY}" stroke-width="8"/>
    <path d="M-22-92v176M22-92v176" stroke="${NAVY}" stroke-width="5" opacity=".35"/>
    <rect x="-86" y="84" width="172" height="58" rx="12" fill="${NAVY}"/><rect x="-24" y="104" width="48" height="18" rx="5" fill="${GREEN}"/>`,
  sac: `
    <path d="M-66-40c0-120 132-120 132 0" fill="none" stroke="${NAVY}" stroke-width="16" stroke-linecap="round"/>
    <path d="M-150-40h300l-22 186a18 18 0 0 1-18 16h-220a18 18 0 0 1-18-16z" fill="${PINK}"/>
    <path d="M-150-40h300l-8 66h-284z" fill="${NAVY}"/>
    <rect x="-24" y="2" width="48" height="52" rx="10" fill="${WHITE}"/><circle cx="0" cy="28" r="8" fill="${NAVY}"/>
    <circle cx="-66" cy="-40" r="12" fill="${TAN}"/><circle cx="66" cy="-40" r="12" fill="${TAN}"/>`,
  powerbank: `
    <g transform="rotate(-10)">
      <rect x="-92" y="-158" width="184" height="316" rx="30" fill="${NAVY}"/>
      <rect x="-64" y="-124" width="128" height="76" rx="12" fill="#22347A"/>
      <text x="0" y="-70" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="46" fill="${GREEN}">87%</text>
      <g fill="${GREEN}"><circle cx="-42" cy="-6" r="9"/><circle cx="-14" cy="-6" r="9"/><circle cx="14" cy="-6" r="9"/></g><circle cx="42" cy="-6" r="9" fill="#3B4D8F"/>
      <path d="M-22 60 6 20v30h22L-2 92V62z" fill="${PINK}"/>
    </g>
    <path d="M118 150c60-10 70-90 20-110" fill="none" stroke="${NAVY}" stroke-width="10" stroke-linecap="round"/><rect x="118" y="20" width="34" height="26" rx="6" fill="${PINK}" transform="rotate(20 135 33)"/>`,
  // Illustrations des catégories ajoutées ensuite (pas encore de produit de démonstration).
  canape: `
    <rect x="-150" y="-116" width="300" height="150" rx="34" fill="${PINK}"/>
    <rect x="-176" y="-6" width="352" height="110" rx="26" fill="${PINK}"/>
    <rect x="-136" y="6" width="130" height="58" rx="16" fill="${WHITE}" opacity=".92"/><rect x="6" y="6" width="130" height="58" rx="16" fill="${WHITE}" opacity=".92"/>
    <rect x="-196" y="-56" width="62" height="162" rx="28" fill="${NAVY}"/><rect x="134" y="-56" width="62" height="162" rx="28" fill="${NAVY}"/>
    <rect x="-150" y="104" width="20" height="44" rx="7" fill="${TAN_D}"/><rect x="130" y="104" width="20" height="44" rx="7" fill="${TAN_D}"/>
    <rect x="-88" y="-92" width="76" height="76" rx="16" fill="${GREEN}" transform="rotate(-12 -50 -54)"/>`,
  voiture: `
    <path d="M-190 70q0-52 54-58l46-74q10-18 32-18h104q22 0 34 16l54 76q56 8 56 58v34h-380z" fill="${PINK}"/>
    <path d="M-82 6l34-56q4-8 14-8h34v64z" fill="${WHITE}"/><path d="M22-58h48q10 0 16 8l40 56H22z" fill="${WHITE}"/>
    <rect x="-196" y="78" width="392" height="22" rx="11" fill="${NAVY}"/>
    <rect x="150" y="34" width="34" height="18" rx="9" fill="#FFE27A"/><rect x="-186" y="34" width="24" height="18" rx="9" fill="${NAVY}"/>
    <circle cx="-104" cy="100" r="50" fill="${NAVY}"/><circle cx="-104" cy="100" r="21" fill="${WHITE}"/>
    <circle cx="110" cy="100" r="50" fill="${NAVY}"/><circle cx="110" cy="100" r="21" fill="${WHITE}"/>
    <rect x="-8" y="26" width="30" height="8" rx="4" fill="${NAVY}"/>`,
  telephone: `
    <g transform="rotate(-8)">
      <rect x="-96" y="-172" width="192" height="344" rx="32" fill="${NAVY}"/>
      <rect x="-80" y="-150" width="160" height="292" rx="16" fill="${WHITE}"/>
      <rect x="-26" y="-164" width="52" height="8" rx="4" fill="#5E79D6"/>
      <rect x="-62" y="-128" width="124" height="70" rx="12" fill="${PINK}"/>
      <g><rect x="-62" y="-40" width="54" height="54" rx="14" fill="${GREEN}"/><rect x="8" y="-40" width="54" height="54" rx="14" fill="#FFE27A"/>
      <rect x="-62" y="30" width="54" height="54" rx="14" fill="#5E79D6"/><rect x="8" y="30" width="54" height="54" rx="14" fill="${NAVY}"/></g>
      <rect x="-34" y="110" width="68" height="10" rx="5" fill="${NAVY}" opacity=".35"/>
    </g>`,
  extensions: `
    <path d="M-124-40q0-128 124-128t124 128v150q0 46-34 74-22-44-22-96V-30H-68V88q0 52-22 96-34-28-34-74z" fill="${NAVY}"/>
    <rect x="-24" y="34" width="48" height="56" fill="${TAN_D}"/>
    <ellipse cx="0" cy="-34" rx="66" ry="82" fill="${TAN}"/>
    <path d="M-70-58q16-74 70-74t70 74q-34-34-70-34t-70 34z" fill="${NAVY}"/>
    <path d="M-124 150q0-66 124-66t124 66v28h-248z" fill="${PINK}"/>
    <g fill="none" stroke="#5E79D6" stroke-width="6" stroke-linecap="round"><path d="M-102-10q-10 60 4 120M102-10q10 60-4 120M-86 20q-6 40 4 80M86 20q6 40-4 80"/></g>
    <circle cx="74" cy="-104" r="16" fill="${PINK}"/><path d="M74-104l26-18v36z" fill="${PINK}"/><path d="M74-104l-26-18v36z" fill="${PINK}"/>`,
  menage: `
    <path d="M-150-34q84-150 184 0" fill="none" stroke="${NAVY}" stroke-width="12" stroke-linecap="round"/>
    <path d="M-162-24h208l-26 176h-156z" fill="${PINK}"/>
    <rect x="-174" y="-42" width="232" height="30" rx="12" fill="${NAVY}"/>
    <path d="M-126 30h136" stroke="${WHITE}" stroke-width="10" stroke-linecap="round" opacity=".7"/>
    <rect x="84" y="-14" width="96" height="166" rx="20" fill="${GREEN}"/><rect x="100" y="42" width="64" height="62" rx="10" fill="${WHITE}"/>
    <rect x="110" y="-62" width="44" height="52" fill="${NAVY}"/><path d="M96-96h76a10 10 0 0 1 10 10v24H96z" fill="${NAVY}"/><path d="M96-90H58v18h38z" fill="${NAVY}"/><path d="M124-62v34h-22z" fill="${PINK}"/>
    <g fill="${WHITE}" stroke="${NAVY}" stroke-width="5"><circle cx="-84" cy="-100" r="20"/><circle cx="-36" cy="-134" r="13"/><circle cx="-124" cy="-146" r="10"/></g>`,
  lavelinge: `
    <rect x="-134" y="-170" width="268" height="336" rx="24" fill="${WHITE}" stroke="${NAVY}" stroke-width="8"/>
    <path d="M-134-146a24 24 0 0 1 24-24h220a24 24 0 0 1 24 24v48h-268z" fill="${NAVY}"/>
    <rect x="-106" y="-146" width="96" height="24" rx="7" fill="#5E79D6"/><circle cx="52" cy="-134" r="13" fill="${GREEN}"/><circle cx="96" cy="-134" r="15" fill="${PINK}"/>
    <circle cx="0" cy="40" r="100" fill="${NAVY}"/><circle cx="0" cy="40" r="76" fill="#9FB4F0"/>
    <path d="M-74 52q24-22 50 0t50 0 46-10a76 76 0 0 1-146 10z" fill="${WHITE}" opacity=".85"/>
    <circle cx="0" cy="40" r="76" fill="none" stroke="${WHITE}" stroke-width="7"/>
    <rect x="-112" y="166" width="34" height="16" rx="5" fill="${NAVY}"/><rect x="78" y="166" width="34" height="16" rx="5" fill="${NAVY}"/>`,
};

function ribs(w, h, color, opacity) {
  let d = '';
  for (let x = 24; x < w; x += 28) d += `M${x} 0V${h}`;
  return `<path d="${d}" stroke="${color}" stroke-width="2" opacity="${opacity}"/>`;
}

function scene(name, { w = 800, h = 600, bg = BG.mist, scale = 1.05, dx = 0, dy = 0, rotate = 0, dark = false }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img">` +
    `<rect width="${w}" height="${h}" fill="${bg}"/>` +
    ribs(w, h, dark ? WHITE : NAVY, dark ? 0.06 : 0.05) +
    `<ellipse cx="${w / 2 + dx}" cy="${h / 2 + dy + 185 * scale}" rx="${190 * scale}" ry="${20 * scale}" fill="${NAVY}" opacity="${dark ? 0.35 : 0.1}"/>` +
    `<g transform="translate(${w / 2 + dx} ${h / 2 + dy}) scale(${scale}) rotate(${rotate})">${art[name]}</g>` +
    `</svg>`
  );
}

const products = {
  sandales: BG.sand, chemise: BG.mist, enfant: BG.pink, papier: BG.mist, panneau: BG.green,
  kit: BG.sand, ecouteurs: BG.pink, lampe: BG.mist, sac: BG.sand, powerbank: BG.green,
};
for (const [name, bg] of Object.entries(products)) {
  fs.writeFileSync(path.join(out, `${name}.svg`), scene(name, { bg }));
  // Seconde vue : plan rapproché sur fond sombre.
  fs.writeFileSync(path.join(out, `${name}-2.svg`), scene(name, { bg: BG.navy, scale: 1.55, dy: 40, rotate: 8, dark: true }));
}

const categories = {
  'mode-homme': ['chemise', BG.mist], 'mode-femme': ['sac', BG.pink], 'mode-enfant': ['enfant', BG.green], papier: ['papier', BG.sand], 'energie-solaire': ['panneau', BG.mist], gadgets: ['ecouteurs', BG.sand],
  meubles: ['canape', BG.mist], 'auto-motos': ['voiture', BG.green], electronique: ['telephone', BG.pink], extensions: ['extensions', BG.sand], menage: ['menage', BG.mist], electromenager: ['lavelinge', BG.green],
};
for (const [slug, [name, bg]] of Object.entries(categories)) {
  fs.writeFileSync(path.join(out, `cat-${slug}.svg`), scene(name, { w: 500, h: 400, bg, scale: 0.62, dy: -44 }));
}
console.log(`${fs.readdirSync(out).length} illustrations écrites dans public/demo`);
