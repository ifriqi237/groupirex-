/**
 * Illustrations de l'écran d'accueil (public/welcome/*.svg) : carte du monde en points,
 * avion, porte-conteneurs, camion et piles de conteneurs. Dessins vectoriels en camaïeu
 * de rose, à remplacer par vos visuels définitifs en gardant les mêmes noms de fichiers.
 *
 *   node scripts/welcome-art.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/welcome');
fs.mkdirSync(out, { recursive: true });

const C = { base: '#EBAEB9', light: '#F6CFD6', pale: '#FADDE2', dark: '#DC93A1', deep: '#CF7F90', coral: '#F05766' };
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>\n`;

/** Un conteneur vu de côté, avec ses nervures. */
function container(x, y, w, h, fill, rib = C.dark) {
  let ribs = '';
  for (let i = x + 5; i < x + w - 3; i += 5) ribs += `<path d="M${i} ${y + 3}V${y + h - 3}" stroke="${rib}" stroke-width="1" opacity=".55"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="${fill}"/>${ribs}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="none" stroke="${rib}" stroke-width="1" opacity=".7"/>`;
}

/* ------------------------------ Carte du monde ------------------------------ */
// Terres par bandes de latitude (tous les 6°), en intervalles de longitude.
const LAND = {
  72: [[-120, -78], [-54, -22], [54, 60], [80, 114]],
  66: [[-165, -142], [-135, -62], [-52, -26], [-23, -15], [12, 180]],
  60: [[-162, -140], [-135, -94], [-78, -62], [-48, -43], [5, 165]],
  54: [[-130, -58], [-9, 1], [8, 140], [155, 162]],
  48: [[-125, -55], [-4, 40], [45, 140]],
  42: [[-124, -70], [-9, 3], [8, 45], [48, 132], [140, 145]],
  36: [[-122, -76], [-6, 11], [27, 122], [126, 129], [133, 140]],
  30: [[-116, -81], [-10, 33], [35, 60], [62, 121]],
  24: [[-110, -97], [-82, -80], [-16, 36], [37, 57], [67, 119]],
  18: [[-104, -88], [-78, -70], [-16, 38], [42, 54], [73, 85], [95, 108], [120, 122]],
  12: [[-90, -83], [-16, 50], [75, 80], [99, 109], [122, 125]],
  6: [[-77, -52], [-10, 48], [80, 81], [100, 103], [115, 118]],
  0: [[-80, -50], [9, 43], [99, 104], [109, 117], [120, 123], [131, 140]],
  '-6': [[-80, -35], [12, 40], [105, 112], [138, 150]],
  '-12': [[-77, -37], [13, 40], [48, 50], [130, 137], [142, 144]],
  '-18': [[-72, -39], [12, 38], [44, 50], [122, 146]],
  '-24': [[-70, -42], [14, 35], [44, 47], [114, 152]],
  '-30': [[-71, -50], [17, 31], [115, 153]],
  '-36': [[-73, -57], [137, 150], [174, 177]],
  '-42': [[-73, -63], [145, 148], [171, 174]],
  '-48': [[-75, -66]],
  '-54': [[-72, -65]],
};
{
  const W = 720, H = 300, step = 6;
  const px = (lon) => ((lon + 180) / 360) * W;
  const py = (lat) => ((78 - lat) / 138) * H;
  let dots = '';
  for (const [lat, spans] of Object.entries(LAND)) {
    for (let lon = -177; lon <= 177; lon += step) {
      if (spans.some(([a, b]) => lon >= a - 1 && lon <= b + 1)) dots += `<circle cx="${px(lon).toFixed(1)}" cy="${py(Number(lat)).toFixed(1)}" r="3.2"/>`;
    }
  }
  // Routes d'importation : de la Chine vers l'Afrique de l'Ouest, centrale et de l'Est.
  const hubs = { ningbo: [121, 30], douala: [10, 4], dakar: [-17, 15], lagos: [3, 6], mombasa: [40, -4], dubai: [55, 25], abidjan: [-4, 5] };
  const arc = (a, b, lift) => {
    const [x1, y1] = [px(a[0]), py(a[1])];
    const [x2, y2] = [px(b[0]), py(b[1])];
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} Q${((x1 + x2) / 2).toFixed(1)} ${(Math.min(y1, y2) - lift).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}"/>`;
  };
  const routes = [arc(hubs.ningbo, hubs.douala, 70), arc(hubs.ningbo, hubs.dakar, 110), arc(hubs.ningbo, hubs.mombasa, 40), arc(hubs.dubai, hubs.lagos, 46), arc(hubs.ningbo, hubs.dubai, 30), arc(hubs.dubai, hubs.abidjan, 80)].join('');
  const nodes = Object.values(hubs).map(([lon, lat]) => `<circle cx="${px(lon).toFixed(1)}" cy="${py(lat).toFixed(1)}" r="9" fill="#fff" opacity=".55"/><circle cx="${px(lon).toFixed(1)}" cy="${py(lat).toFixed(1)}" r="3.6" fill="${C.coral}" opacity=".75"/>`).join('');
  fs.writeFileSync(path.join(out, 'map.svg'), svg(W, H, `<g fill="${C.base}" opacity=".5">${dots}</g><g fill="none" stroke="${C.dark}" stroke-width="1.6" stroke-dasharray="2 6" stroke-linecap="round" opacity=".8">${routes}</g>${nodes}`));
}

/* ---------------------------------- Avion ---------------------------------- */
{
  let windows = '';
  for (let x = 74; x <= 186; x += 8) windows += `<circle cx="${x}" cy="${(46.6 - (x - 74) * 0.028).toFixed(1)}" r="1.5"/>`;
  fs.writeFileSync(
    path.join(out, 'plane.svg'),
    svg(
      244,
      104,
      `<path d="M120 42 96 12h12l44 28z" fill="${C.light}"/>
<path d="M30 45 17 13h17l30 29z" fill="${C.dark}"/>
<path d="M36 52 13 60l9 3 31-7z" fill="${C.dark}"/>
<path d="M20 52q4-8 24-10l146-4q24 0 36 10-12 10-36 10l-146 2q-18 0-24-8z" fill="${C.base}"/>
<path d="M20 52q6 8 24 8l146-2q24 0 36-10-14 7-36 7L44 57q-16 0-24-5z" fill="${C.dark}" opacity=".6"/>
<path d="M203 42.5l12 4-17 .4z" fill="#fff" opacity=".85"/>
<g fill="#fff" opacity=".8">${windows}</g>
<path d="M112 52 70 94h19l64-40z" fill="${C.dark}"/>
<rect x="100" y="66" width="27" height="11" rx="5.5" fill="${C.deep}"/>
<rect x="121" y="67.5" width="6" height="8" rx="3" fill="${C.light}"/>`,
    ),
  );
}

/* ----------------------------- Porte-conteneurs ----------------------------- */
{
  const tones = [C.base, C.light, C.dark, C.pale, C.base, C.dark, C.light, C.base];
  let stack = '';
  // Piles de hauteur variable sur le pont, de la poupe (gauche) vers la proue.
  const heights = [4, 5, 5, 4, 5, 3, 4, 2];
  heights.forEach((n, col) => {
    for (let row = 0; row < n; row++) stack += container(52 + col * 27, 148 - (row + 1) * 17, 25, 15, tones[(col * 3 + row * 5) % tones.length]);
  });
  let bridgeWindows = '';
  for (let y = 74; y <= 110; y += 12) bridgeWindows += `<rect x="12" y="${y}" width="30" height="5" rx="1" fill="#fff" opacity=".8"/>`;
  fs.writeFileSync(
    path.join(out, 'ship.svg'),
    svg(
      320,
      236,
      `<rect x="22" y="44" width="5" height="24" fill="${C.dark}"/><rect x="14" y="52" width="21" height="3" fill="${C.dark}"/>
<rect x="6" y="66" width="42" height="84" rx="2" fill="${C.light}"/><rect x="6" y="66" width="42" height="6" fill="${C.dark}"/>${bridgeWindows}
<rect x="30" y="52" width="10" height="16" fill="${C.deep}"/>
${stack}
<path d="M0 148h286l30-6-34 62q-4 8-14 8H0z" fill="${C.dark}"/>
<path d="M0 148h286l30-6-5 9-27 5H0z" fill="${C.deep}"/>
<path d="M0 186h290l-8 18q-4 8-14 8H0z" fill="${C.coral}" opacity=".45"/>
<path d="M286 160h10M282 168h8" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/>
<path d="M0 214q14-7 28 0t28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0v22H0z" fill="${C.pale}"/>
<path d="M0 224q14-6 28 0t28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0 28 0v12H0z" fill="#fff" opacity=".7"/>`,
    ),
  );
}

/* --------------------------- Camion et conteneurs --------------------------- */
{
  let yard = '';
  // Pile de conteneurs à l'arrière-plan, à droite.
  const rows = [[150, 4, 3], [118, 30, 4], [118, 56, 4], [86, 82, 5]];
  rows.forEach(([x, y, n], r) => {
    for (let i = 0; i < n; i++) yard += container(x + i * 56, y, 54, 24, [C.light, C.base, C.pale, C.dark, C.base][(i + r * 2) % 5]);
  });
  const wheel = (cx) => `<circle cx="${cx}" cy="212" r="15" fill="${C.deep}"/><circle cx="${cx}" cy="212" r="7" fill="${C.pale}"/>`;
  fs.writeFileSync(
    path.join(out, 'truck.svg'),
    svg(
      340,
      236,
      `<g opacity=".8">${yard}</g>
${container(96, 124, 244, 62, C.base)}
<rect x="96" y="124" width="244" height="6" fill="${C.dark}" opacity=".6"/>
<rect x="88" y="186" width="252" height="9" rx="2" fill="${C.deep}"/>
<path d="M28 150q0-12 12-12h44v60H16v-22q0-8 6-12z" fill="${C.light}"/>
<path d="M28 150q0-12 12-12h44v8H44q-10 0-16 4z" fill="${C.dark}"/>
<path d="M38 150h34v22H26q0-12 12-22z" fill="#fff" opacity=".85"/>
<rect x="76" y="150" width="4" height="46" fill="${C.dark}"/>
<rect x="12" y="186" width="76" height="12" rx="3" fill="${C.deep}"/>
<rect x="14" y="176" width="9" height="6" rx="2" fill="#fff" opacity=".9"/>
<rect x="60" y="126" width="5" height="14" fill="${C.dark}"/>
${wheel(44)}${wheel(132)}${wheel(264)}${wheel(300)}
<ellipse cx="176" cy="229" rx="168" ry="5" fill="${C.dark}" opacity=".25"/>`,
    ),
  );
}

/* ---------------------------------- Logo ---------------------------------- */
// Le « G » de la marque : sert aussi d'icône du site.
const mark = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FA6076"/><stop offset="1" stop-color="#EE4F64"/></linearGradient></defs>
<rect width="88" height="88" rx="24" fill="url(#g)"/>
<path d="M58.6 32.4A19 19 0 1 0 63 45.5H45" fill="none" stroke="#fff" stroke-width="11.5"/>`;
fs.writeFileSync(path.join(out, 'mark.svg'), svg(88, 88, mark));
fs.writeFileSync(path.resolve(out, '../favicon.svg'), svg(88, 88, mark));

console.log('Illustrations écrites dans', out);
