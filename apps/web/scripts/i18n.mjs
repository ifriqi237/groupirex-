/**
 * Textes d'interface : extraction et contrôle.
 *
 *   node scripts/i18n.mjs            relève les textes du code et met à jour apps/api/db/i18n/fr.json
 *   node scripts/i18n.mjs --check    échoue si fr.json n'est pas à jour ou si une langue livrée est incomplète
 *
 * Le texte français du code est la clé. Sont relevés :
 *   - t('…') et N_('…') dans apps/web/src ;
 *   - les messages du catalogue d'erreurs et les libellés des étapes logistiques (packages/core) ;
 *   - les messages de validation renvoyés par l'API (message: '…').
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const i18nDir = path.join(root, 'apps/api/db/i18n');
const check = process.argv.includes('--check');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Lit un littéral de chaîne JavaScript à partir de sa position ; null si ce n'en est pas un (ou s'il contient ${…}). */
function readLiteral(src, i) {
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let out = '';
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      const n = src[++j];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
    } else if (c === q) return { value: out, end: j + 1 };
    else if (q === '`' && c === '$' && src[j + 1] === '{') return null;
    else out += c;
  }
  return null;
}

const keys = new Map(); // texte -> premier fichier où il apparaît
const add = (text, file) => {
  if (text && !keys.has(text)) keys.set(text, path.relative(root, file));
};
const dynamic = [];

function scan(file, opener) {
  const src = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = opener.exec(src))) {
    const lit = readLiteral(src, opener.lastIndex);
    if (lit) add(lit.value, file);
    else if (opener.source.includes('N_') && /['"`]/.test(src[opener.lastIndex])) dynamic.push(`${path.relative(root, file)} : ${src.slice(m.index, m.index + 60).split('\n')[0]}`);
  }
}

for (const f of walk(path.join(root, 'apps/web/src'))) scan(f, /(?<![\w.$])(?:t|N_)\(\s*/g);
scan(path.join(root, 'packages/core/src/errors.ts'), /def\('[A-Z0-9_]+',\s*\d+,\s*/g);
scan(path.join(root, 'packages/core/src/logistics-engine.ts'), /\blabel:\s*/g);
for (const f of walk(path.join(root, 'apps/api/src'))) scan(f, /\bmessage:\s*/g);

const sorted = [...keys.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
const fr = Object.fromEntries(sorted.map((k) => [k, k]));
const frPath = path.join(i18nDir, 'fr.json');
const frText = JSON.stringify(fr, null, 2) + '\n';

let failed = false;
if (dynamic.length) {
  console.error('Textes construits par gabarit (non extractibles) — utilisez des variables {nom} :');
  for (const d of dynamic) console.error('  ' + d);
  failed = true;
}

if (check) {
  if (!fs.existsSync(frPath) || fs.readFileSync(frPath, 'utf8') !== frText) {
    console.error('fr.json n’est pas à jour : lancez « node scripts/i18n.mjs ».');
    failed = true;
  }
} else {
  fs.writeFileSync(frPath, frText);
  console.log(`${sorted.length} textes relevés -> ${path.relative(root, frPath)}`);
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const file of fs.readdirSync(i18nDir).filter((f) => f.endsWith('.json') && f !== 'fr.json')) {
  const lang = path.basename(file, '.json');
  const tr = JSON.parse(fs.readFileSync(path.join(i18nDir, file), 'utf8'));
  const missing = sorted.filter((k) => !tr[k]);
  const stale = Object.keys(tr).filter((k) => !keys.has(k));
  const badVars = sorted.filter((k) => tr[k] && placeholders(k) !== placeholders(tr[k]));
  console.log(`${lang} : ${sorted.length - missing.length}/${sorted.length} traduits, ${stale.length} obsolètes, ${badVars.length} avec variables différentes`);
  if (missing.length) {
    fs.writeFileSync(path.join(here, `missing-${lang}.json`), JSON.stringify(Object.fromEntries(missing.map((k) => [k, ''])), null, 2) + '\n');
    console.log(`  textes à traduire listés dans scripts/missing-${lang}.json`);
  } else fs.rmSync(path.join(here, `missing-${lang}.json`), { force: true });
  for (const k of badVars) console.error(`  variables différentes : ${k}`);
  if (process.argv.includes('--prune') && stale.length) {
    for (const k of stale) delete tr[k];
    fs.writeFileSync(path.join(i18nDir, file), JSON.stringify(Object.fromEntries(Object.entries(tr).sort(([a], [b]) => a.localeCompare(b, 'fr'))), null, 2) + '\n');
  }
  if (check && (missing.length || badVars.length)) failed = true;
}
process.exit(failed ? 1 : 0);
