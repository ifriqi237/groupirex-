// Construit la démonstration autonome dans demo-dist/ : le site complet, sans serveur.
// Les réponses de l'API viennent de demo/fixtures (produites par scripts/record-demo.mjs).
//   node build-demo.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'demo-dist');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

fs.rmSync(dist, { recursive: true, force: true });
copyDir(path.join(root, 'public'), dist);
copyDir(path.join(root, 'demo/fixtures'), path.join(dist, 'fixtures'));
for (const f of ['manifest.webmanifest', 'robots.txt']) fs.rmSync(path.join(dist, f), { force: true });

await build({
  entryPoints: { app: path.join(root, 'src/main.tsx') },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  minify: true,
  external: ['/fonts/*', '/demo/*'],
  alias: { '@groupdeals/core': path.join(root, '../../packages/core/src/index.ts') },
  define: { 'process.env.NODE_ENV': '"production"', __DEMO__: 'true' },
  logLevel: 'info',
});

// Tous les fichiers sont servis à côté de la page : les adresses deviennent relatives.
const cssPath = path.join(dist, 'app.css');
fs.writeFileSync(cssPath, fs.readFileSync(cssPath, 'utf8').replace(/url\((["']?)\/(fonts|demo|welcome)\//g, 'url($1$2/'));

// Contenu de la page tel que l'attend un hébergement de page unique (sans <html> ni <body>),
// et une version complète pour l'ouvrir avec n'importe quel serveur de fichiers statiques.
const page = `<title>GROUPDEALS Démonstration</title>
<link rel="stylesheet" href="app.css">
<div id="root"></div>
<script src="app.js"></script>
`;
fs.writeFileSync(path.join(dist, 'page.html'), page);
fs.writeFileSync(path.join(dist, 'index.html'), `<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<link rel="icon" href="favicon.svg" type="image/svg+xml">\n</head>\n<body>\n${page}</body>\n</html>\n`);
console.log('Démonstration construite dans', dist);
