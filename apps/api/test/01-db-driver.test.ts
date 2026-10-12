import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Pool, createPool, uniqueViolation } from '../src/db/pool';
import { parseArray, serializeParam } from '../src/db/wire';

const base = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? '',
  database: process.env.PGDATABASE_WIRE ?? 'gd_wire_test',
};

/**
 * Les deux tests d'authentification demandent des rôles et des règles pg_hba.conf dédiés :
 *   CREATE ROLE gd_scram LOGIN PASSWORD 'S3cret-Çà!';   -- avec password_encryption = scram-sha-256
 *   CREATE ROLE gd_md5 LOGIN PASSWORD 'md5pass';        -- avec password_encryption = md5
 *   host all gd_scram 127.0.0.1/32 scram-sha-256
 *   host all gd_md5   127.0.0.1/32 md5
 * Ils ne tournent que si PG_AUTH_TESTS=1.
 */
const authTests = process.env.PG_AUTH_TESTS === '1';

describe('Pilote PostgreSQL intégré', () => {
  let pool: Pool;

  before(async () => {
    // La base de test est créée si elle n'existe pas encore.
    const admin = await createPool({ ...base, database: 'postgres', max: 1 });
    if (!(await admin.one('SELECT 1 FROM pg_database WHERE datname = $1', [base.database]))) await admin.script(`CREATE DATABASE ${base.database}`);
    await admin.close();
    pool = await createPool({ ...base, max: 4 });
    await pool.script(`
      DROP TABLE IF EXISTS t_wire;
      CREATE TABLE t_wire (
        id SERIAL PRIMARY KEY, name TEXT UNIQUE, amount BIGINT, rate NUMERIC(20,8), ok BOOLEAN,
        data JSONB, tags TEXT[], at TIMESTAMPTZ, day DATE, uid UUID, n INT CHECK (n >= 0)
      );`);
  });
  after(async () => pool.close());

  it('convertit les types dans les deux sens', async () => {
    const at = new Date('2026-10-04T12:34:56.789Z');
    const r = await pool.one(
      `INSERT INTO t_wire (name, amount, rate, ok, data, tags, at, day, uid, n)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      ['Awa', 230_000_000_000, '655.95700000', true, { a: [1, 2], b: 'é"\\' }, ['x', 'y, z', 'q"r'], at, '2026-10-04',
       '00000000-0000-0000-0000-0000000000a1', 5],
    );
    assert.equal(r!.name, 'Awa');
    assert.equal(r!.amount, 230_000_000_000);
    assert.equal(typeof r!.amount, 'number');
    assert.equal(r!.rate, '655.95700000');
    assert.equal(r!.ok, true);
    assert.deepEqual(r!.data, { a: [1, 2], b: 'é"\\' });
    assert.deepEqual(r!.tags, ['x', 'y, z', 'q"r']);
    assert.equal(r!.at.toISOString(), at.toISOString());
    assert.equal(r!.day, '2026-10-04');
    assert.equal(r!.n, 5);
  });

  it('gère NULL, les chaînes vides et l’UTF-8', async () => {
    const r = await pool.one(`SELECT $1::text AS a, $2::text AS b, $3::text AS c, $4::int AS d`, [null, '', 'Sénégal — ₦ 日本', undefined]);
    assert.deepEqual(r, { a: null, b: '', c: 'Sénégal — ₦ 日本', d: null });
  });

  it('une tentative d’injection reste une simple valeur', async () => {
    const evil = "x'); DROP TABLE t_wire; --";
    const r = await pool.one(`SELECT $1::text AS v`, [evil]);
    assert.equal(r!.v, evil);
    assert.equal((await pool.one(`SELECT count(*)::int AS c FROM t_wire`))!.c, 1);
  });

  it('remonte les erreurs avec leur code et leur contrainte, sans casser la connexion', async () => {
    await assert.rejects(pool.query(`INSERT INTO t_wire (name) VALUES ('Awa')`), (e: any) => {
      assert.equal(e.code, '23505');
      assert.equal(uniqueViolation(e), 't_wire_name_key');
      return true;
    });
    await assert.rejects(pool.query(`INSERT INTO t_wire (name, n) VALUES ('B', -1)`), (e: any) => e.code === '23514');
    await assert.rejects(pool.query(`SELEC 1`), (e: any) => e.code === '42601');
    assert.equal((await pool.one(`SELECT 1 AS x`))!.x, 1);
  });

  it('valide une transaction, annule en cas d’erreur', async () => {
    await pool.tx(async (tx) => {
      await tx.query(`INSERT INTO t_wire (name) VALUES ('commit')`);
    });
    await assert.rejects(
      pool.tx(async (tx) => {
        await tx.query(`INSERT INTO t_wire (name) VALUES ('rollback')`);
        throw new Error('stop');
      }),
      /stop/,
    );
    const names = (await pool.all(`SELECT name FROM t_wire ORDER BY id`)).map((r) => r.name);
    assert.deepEqual(names, ['Awa', 'commit']);
  });

  it('transaction imbriquée : point de sauvegarde', async () => {
    await pool.tx(async (tx) => {
      await tx.query(`INSERT INTO t_wire (name) VALUES ('outer')`);
      await assert.rejects(
        tx.tx(async (inner) => {
          await inner.query(`INSERT INTO t_wire (name) VALUES ('inner')`);
          await inner.query(`INSERT INTO t_wire (name) VALUES ('outer')`); // doublon
        }),
      );
      await tx.query(`INSERT INTO t_wire (name) VALUES ('after')`);
    });
    const names = (await pool.all(`SELECT name FROM t_wire ORDER BY id`)).map((r) => r.name);
    assert.deepEqual(names, ['Awa', 'commit', 'outer', 'after']);
  });

  it('200 requêtes concurrentes sur 4 connexions, résultats non mélangés', async () => {
    const out = await Promise.all(
      Array.from({ length: 200 }, (_, i) => pool.one(`SELECT $1::int AS i, pg_sleep(0.001)`, [i])),
    );
    out.forEach((r, i) => assert.equal(r!.i, i));
  });

  it('verrou de ligne : 50 incréments concurrents donnent exactement 50', async () => {
    await pool.query(`INSERT INTO t_wire (name, n) VALUES ('counter', 0)`);
    await Promise.all(
      Array.from({ length: 50 }, () =>
        pool.tx(async (tx) => {
          const row = await tx.one(`SELECT n FROM t_wire WHERE name = 'counter' FOR UPDATE`);
          await tx.query(`UPDATE t_wire SET n = $1 WHERE name = 'counter'`, [row!.n + 1]);
        }),
      ),
    );
    assert.equal((await pool.one(`SELECT n FROM t_wire WHERE name = 'counter'`))!.n, 50);
  });

  it('gros résultat découpé en plusieurs paquets réseau', async () => {
    const r = await pool.all(`SELECT g AS i, repeat('é', 500) AS pad FROM generate_series(1, 5000) g`);
    assert.equal(r.length, 5000);
    assert.equal(r[4999].i, 5000);
    assert.equal(r[4999].pad.length, 500);
  });

  it('authentification SCRAM-SHA-256', { skip: !authTests }, async () => {
    const p = await createPool({ ...base, user: 'gd_scram', password: 'S3cret-Çà!', max: 1 });
    assert.equal((await p.one(`SELECT current_user AS u`))!.u, 'gd_scram');
    await p.close();
    await assert.rejects(createPool({ ...base, user: 'gd_scram', password: 'faux', max: 1 }), (e: any) => e.code === '28P01');
  });

  it('authentification MD5', { skip: !authTests }, async () => {
    const p = await createPool({ ...base, user: 'gd_md5', password: 'md5pass', max: 1 });
    assert.equal((await p.one(`SELECT current_user AS u`))!.u, 'gd_md5');
    await p.close();
  });

  it('sérialisation des paramètres', () => {
    assert.equal(serializeParam(null), null);
    assert.equal(serializeParam(true), 'true');
    assert.equal(serializeParam(['a', 'b"c']), '{"a","b\\"c"}');
    assert.equal(serializeParam({ a: 1 }), '{"a":1}');
    assert.throws(() => serializeParam(Number.NaN));
    assert.deepEqual(parseArray('{a,NULL,"b c"}', (v) => v), ['a', null, 'b c']);
  });
});
