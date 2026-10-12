// Construit le site (client + back-office + agent) dans dist/.
//   node build.mjs           build de production
//   node build.mjs --watch   reconstruit à chaque modification
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: { app: path.join(root, 'src/main.tsx') },
  outdir: path.join(dist, 'assets'),
  entryNames: '[name].[hash]',
  assetNames: '[name].[hash]',
  bundle: true,
  format: 'esm',
  target: 'es2020',
  splitting: true,
  chunkNames: 'chunk.[hash]',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  metafile: true,
  loader: { '.json': 'json' },
  external: ['/fonts/*', '/demo/*'],
  alias: { '@groupdeals/core': path.join(root, '../../packages/core/src/index.ts') },
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'), __DEMO__: 'false' },
  logLevel: 'info',
};

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

function writeHtml(metafile) {
  const outputs = Object.keys(metafile.outputs).map((f) => path.basename(f));
  const js = outputs.find((f) => /^app\.[A-Z0-9]+\.js$/i.test(f));
  const css = outputs.find((f) => /^app\.[A-Z0-9]+\.css$/i.test(f));
  const html = fs
    .readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace('<!--CSS-->', `<link rel="stylesheet" href="/assets/${css}">`)
    .replace('<!--JS-->', `<script type="module" src="/assets/${js}"></script>`);
  fs.writeFileSync(path.join(dist, 'index.html'), html);
}

fs.rmSync(dist, { recursive: true, force: true });
copyDir(path.join(root, 'public'), dist);

if (watch) {
  const ctx = await context({
    ...options,
    plugins: [{ name: 'html', setup: (b) => b.onEnd((r) => r.metafile && writeHtml(r.metafile)) }],
  });
  await ctx.watch();
} else {
  const result = await build(options);
  writeHtml(result.metafile);
  const size = (f) => (fs.statSync(path.join(dist, 'assets', f)).size / 1024).toFixed(0) + ' ko';
  for (const f of fs.readdirSync(path.join(dist, 'assets'))) console.log(`  ${f}  ${size(f)}`);
}
