import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { forwardedIp } from '../src/http/server';
import { TestEnv, startEnv } from './helpers';

describe('Adresse du visiteur derrière le mandataire de l’hébergeur', () => {
  it('prend l’adresse ajoutée par le mandataire, pas celle écrite par le client', () => {
    assert.equal(forwardedIp('6.6.6.6, 41.202.1.9', '10.0.0.2'), '41.202.1.9');
    assert.equal(forwardedIp('41.202.1.9', '10.0.0.2'), '41.202.1.9');
    assert.equal(forwardedIp('1.1.1.1, 2.2.2.2, 41.202.1.9, 10.0.0.5', '10.0.0.2', 2), '41.202.1.9');
    assert.equal(forwardedIp(undefined, '::ffff:41.202.1.9'), '41.202.1.9');
    assert.equal(forwardedIp('', '10.0.0.2'), '10.0.0.2');
  });

  describe('limite de tentatives de connexion', () => {
    let env: TestEnv;
    before(async () => { env = await startEnv({ TRUST_PROXY: 'true' }); });
    after(async () => env.close());

    it('changer la première adresse de X-Forwarded-For ne contourne plus la limite', async () => {
      let last = 0;
      for (let i = 0; i < 12; i++) {
        const res = await env.api('POST', '/auth/login', {
          body: { email: `inconnu${i}@exemple.test`, password: 'mauvais-mot-de-passe' },
          headers: { 'X-Forwarded-For': `203.0.113.${i}, 41.202.1.9` },
        });
        last = res.status;
      }
      assert.equal(last, 429);
    });
  });
});
