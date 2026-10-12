/**
 * Migrations : fichiers SQL numérotés de db/migrations, appliqués une seule fois,
 * dans l'ordre, chacun dans sa transaction. Un verrou consultatif empêche deux
 * instances de migrer en même temps.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from './pool';

export function migrationsDir(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(__dirname, '../../db/migrations'),
    path.resolve(__dirname, '../db/migrations'),
    path.resolve(process.cwd(), 'db/migrations'),
    path.resolve(process.cwd(), 'apps/api/db/migrations'),
  ].filter(Boolean) as string[];
  const found = candidates.find((d) => fs.existsSync(d));
  if (!found) throw new Error('Dossier des migrations introuvable');
  return found;
}

export async function migrate(
  db: Pool,
  log: { info(msg: string, data?: Record<string, unknown>): void },
): Promise<string[]> {
  const dir = migrationsDir();
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];

  await db.script(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  await db.tx(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727274001)');
    const done = new Map((await tx.all('SELECT name, checksum FROM schema_migrations')).map((r) => [r.name, r.checksum]));
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      if (done.has(file)) {
        if (done.get(file) !== checksum) {
          throw new Error(`La migration ${file} a été modifiée après avoir été appliquée. Créez une nouvelle migration.`);
        }
        continue;
      }
      // Le script entier passe dans la transaction ouverte : tout ou rien.
      await runScript(tx, sql);
      await tx.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
      applied.push(file);
      log.info('migration', { file });
    }
  });
  return applied;
}

/**
 * Exécute un script à plusieurs instructions dans la transaction courante.
 * Le protocole étendu n'accepte qu'une instruction par requête : on découpe
 * donc le script, en respectant chaînes, commentaires et blocs $$…$$.
 */
async function runScript(tx: { query(sql: string): Promise<unknown> }, sql: string): Promise<void> {
  for (const stmt of splitStatements(sql)) await tx.query(stmt);
}

export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        cur += sql.slice(i, stop);
        i = stop;
      } else {
        cur += ch;
        i++;
      }
    } else if (ch === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
