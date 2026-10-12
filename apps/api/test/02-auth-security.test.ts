import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { decrypt, hashPassword, signJwt, totpCode, verifyJwt, verifyPassword, verifyTotp } from '../src/lib/crypto';
import { PASSWORD, TestEnv, createUser, startEnv } from './helpers';
import { AFRICAN_COUNTRIES } from '@groupdeals/core';

describe('Primitives de sécurité', () => {
  it('TOTP conforme au vecteur de test de la RFC 6238', () => {
    // Secret ASCII "12345678901234567890" en base32 ; T = 59 s -> 94287082 (8 chiffres), soit 287082 sur 6.
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    assert.equal(totpCode(secret, 59_000), '287082');
    assert.equal(totpCode(secret, 1_111_111_109_000), '081804');
    assert.equal(verifyTotp(secret, '287082', 59_000), true);
    assert.equal(verifyTotp(secret, '287082', 59_000 + 120_000), false);
  });

  it('mot de passe : haché avec un sel, vérifiable, jamais stocké en clair', async () => {
    const a = await hashPassword('Secret123');
    const b = await hashPassword('Secret123');
    assert.notEqual(a, b);
    assert.ok(!a.includes('Secret123'));
    assert.equal(await verifyPassword('Secret123', a), true);
    assert.equal(await verifyPassword('Secret124', a), false);
  });

  it('JWT : signature, expiration, et refus de tout autre algorithme', () => {
    const t = signJwt({ sub: 'u1', sid: 's1', mfa: false }, 'secret-a', 60, 1_000_000);
    assert.equal(verifyJwt(t, 'secret-a', 1_000_000)?.sub, 'u1');
    assert.equal(verifyJwt(t, 'secret-b', 1_000_000), null);
    assert.equal(verifyJwt(t, 'secret-a', 1_000_000 + 61_000), null);
    const [, payload] = t.split('.');
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    assert.equal(verifyJwt(`${none}.${payload}.`, 'secret-a', 1_000_000), null);
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', sid: 's1', mfa: true, iat: 1000, exp: 9_999_999_999 })).toString('base64url');
    assert.equal(verifyJwt(`${t.split('.')[0]}.${forged}.${t.split('.')[2]}`, 'secret-a', 1_000_000), null);
  });
});

describe('Authentification (§8, §42)', () => {
  let env: TestEnv;
  before(async () => {
    env = await startEnv();
  });
  after(async () => env.close());
  beforeEach(() => env.app.rateLimiter.reset());

  const valid = { firstName: 'Awa', lastName: 'Ndiaye', countryCode: 'SN', email: 'awa@test.local', whatsapp: '+221 77 000 00 12', password: 'Motdepasse2026' };

  it('inscription : champs obligatoires contrôlés', async () => {
    const res = await env.api('POST', '/auth/register', { body: { ...valid, email: 'pas-un-email', password: 'court', whatsapp: '0612' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
    const paths = res.body.error.details.fields.map((f: any) => f.path).sort();
    assert.deepEqual([...new Set(paths)], ['email', 'password', 'whatsapp']);
    const missing = await env.api('POST', '/auth/register', { body: { email: valid.email, password: valid.password } });
    assert.equal(missing.status, 400);
  });

  it('inscription avec un seul champ « Nom » : le nom de famille peut être vide, pas le prénom', async () => {
    const { lastName: _omit, ...single } = valid;
    const res = await env.api('POST', '/auth/register', { body: { ...single, firstName: 'Moussa', email: 'moussa@test.local', whatsapp: '+221 77 000 00 55' } });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.firstName, 'Moussa');
    assert.equal(res.body.user.lastName, '');
    const empty = await env.api('POST', '/auth/register', { body: { ...single, firstName: '  ', email: 'vide@test.local' } });
    assert.equal(empty.status, 400);
    assert.deepEqual(empty.body.error.details.fields.map((f: any) => f.path), ['firstName']);
  });

  it('inscription : les 54 pays d’Afrique sont proposés, chacun avec sa monnaie et son indicatif', async () => {
    const list = await env.api('GET', '/countries');
    assert.equal(list.status, 200);
    const codes = list.body.countries.map((c: any) => c.code).sort();
    assert.deepEqual(codes, AFRICAN_COUNTRIES.map((c) => c.code).sort());
    for (const c of list.body.countries) assert.ok(c.currency && /^\+\d{2,3}$/.test(c.phonePrefix), c.code);
    const bw = await env.api('POST', '/auth/register', { body: { ...valid, countryCode: 'BW', email: 'kagiso@test.local', whatsapp: '+267 71 234 567' } });
    assert.equal(bw.status, 201);
    assert.equal(bw.body.user.country.code, 'BW');
  });

  it('inscription : pays inconnu ou inactif refusé', async () => {
    const res = await env.api('POST', '/auth/register', { body: { ...valid, countryCode: 'FR' } });
    assert.equal(res.body.error.code, 'COUNTRY_NOT_COVERED');
  });

  it('inscription réussie : session ouverte, devise et langue du pays, email à vérifier', async () => {
    const res = await env.api('POST', '/auth/register', { body: valid });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.country.currency, 'XOF');
    assert.equal(res.body.user.whatsapp, '+221770000012');
    assert.equal(res.body.user.emailVerified, false);
    assert.deepEqual(res.body.user.roles, ['CUSTOMER']);
    assert.ok(res.body.accessToken);
    assert.equal(res.body.refreshToken, undefined, 'le jeton de rafraîchissement ne va pas dans le corps pour le web');
    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /gd_refresh=.+HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const stored = await env.app.db.one(`SELECT password_hash FROM users WHERE email = $1`, [valid.email]);
    assert.match(stored!.password_hash, /^scrypt\$/);

    const verify = await env.api('POST', '/auth/verify-email', { body: { token: res.body.debug.verifyToken } });
    assert.equal(verify.status, 200);
    const again = await env.api('POST', '/auth/verify-email', { body: { token: res.body.debug.verifyToken } });
    assert.equal(again.body.error.code, 'AUTH_TOKEN_INVALID', 'un jeton ne sert qu’une fois');
  });

  it('email déjà utilisé, même avec une autre casse', async () => {
    const res = await env.api('POST', '/auth/register', { body: { ...valid, email: 'AWA@Test.Local' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'AUTH_EMAIL_TAKEN');
  });

  it('connexion, puis accès au profil ; sans jeton : 401', async () => {
    const login = await env.api('POST', '/auth/login', { body: { email: valid.email, password: valid.password } });
    assert.equal(login.status, 200);
    const me = await env.api('GET', '/me', { token: login.body.accessToken });
    assert.equal(me.body.user.email, valid.email);
    assert.equal((await env.api('GET', '/me')).status, 401);
    assert.equal((await env.api('GET', '/me', { token: 'n.importe.quoi' })).body.error.code, 'AUTH_TOKEN_INVALID');
  });

  it('même message pour un email inconnu et un mauvais mot de passe', async () => {
    const a = await env.api('POST', '/auth/login', { body: { email: 'inconnu@test.local', password: 'x' } });
    const b = await env.api('POST', '/auth/login', { body: { email: valid.email, password: 'mauvais' } });
    assert.equal(a.status, 401);
    assert.deepEqual(a.body.error.code, b.body.error.code);
    await env.app.db.query(`UPDATE users SET failed_login_count = 0`);
  });

  it('force brute : compte verrouillé après 5 échecs, même avec le bon mot de passe ensuite', async () => {
    const u = await createUser(env);
    for (let i = 0; i < 5; i++) {
      const r = await env.api('POST', '/auth/login', { body: { email: u.email, password: 'mauvais' } });
      assert.equal(r.body.error.code, 'AUTH_INVALID_CREDENTIALS');
    }
    const locked = await env.api('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, 'AUTH_LOCKED');
    // 16 minutes plus tard, le verrou est levé.
    env.app.clock.offsetMs = 16 * 60_000;
    const ok = await env.api('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } });
    env.app.clock.offsetMs = 0;
    assert.equal(ok.status, 200);
  });

  it('limitation de débit : la 11e tentative de connexion en une minute est refusée', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await env.api('POST', '/auth/login', { body: { email: `x${i}@test.local`, password: 'x' } })).status;
    assert.equal(last, 429);
  });

  it('rafraîchissement : rotation, et la réutilisation d’un ancien jeton ferme la session', async () => {
    const u = await createUser(env);
    const login = await env.api('POST', '/auth/login', { body: { email: u.email, password: PASSWORD, client: 'mobile' } });
    const first = login.body.refreshToken;
    assert.ok(first);
    const r1 = await env.api('POST', '/auth/refresh', { body: { refreshToken: first } });
    assert.equal(r1.status, 200);
    assert.notEqual(r1.body.refreshToken, first);

    // Rejouer l'ancien jeton plus de 10 s après : vol présumé, toute la session est révoquée.
    env.app.clock.offsetMs = 11_000;
    const replay = await env.api('POST', '/auth/refresh', { body: { refreshToken: first } });
    assert.equal(replay.body.error.code, 'AUTH_TOKEN_INVALID');
    const legit = await env.api('POST', '/auth/refresh', { body: { refreshToken: r1.body.refreshToken } });
    env.app.clock.offsetMs = 0;
    assert.equal(legit.body.error.code, 'AUTH_TOKEN_INVALID');
    assert.equal((await env.api('GET', '/me', { token: r1.body.accessToken })).status, 401, 'le jeton d’accès de la session révoquée ne passe plus');
  });

  it('rafraîchissement par cookie : en-tête anti-CSRF obligatoire', async () => {
    const res = await fetch(`${env.base}/api/v1/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 403);
  });

  it('déconnexion : le jeton d’accès cesse aussitôt de fonctionner', async () => {
    const u = await createUser(env);
    assert.equal((await env.api('GET', '/me', { token: u.token })).status, 200);
    await env.api('POST', '/auth/logout', { token: u.token });
    assert.equal((await env.api('GET', '/me', { token: u.token })).status, 401);
  });

  it('gestion des sessions : lister et fermer un autre appareil', async () => {
    const u = await createUser(env);
    const other = await env.api('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } });
    const list = await env.api('GET', '/auth/sessions', { token: u.token });
    assert.equal(list.body.sessions.length, 2);
    const target = list.body.sessions.find((s: any) => !s.current);
    await env.api('DELETE', `/auth/sessions/${target.id}`, { token: u.token });
    assert.equal((await env.api('GET', '/me', { token: other.body.accessToken })).status, 401);
    assert.equal((await env.api('GET', '/me', { token: u.token })).status, 200);
  });

  it('mot de passe oublié : réponse identique que le compte existe ou non, puis réinitialisation', async () => {
    const u = await createUser(env);
    const unknown = await env.api('POST', '/auth/forgot-password', { body: { email: 'personne@test.local' } });
    const known = await env.api('POST', '/auth/forgot-password', { body: { email: u.email } });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.sent, known.body.sent);
    const reset = await env.api('POST', '/auth/reset-password', { body: { token: known.body.debug.resetToken, password: 'NouveauPasse2026' } });
    assert.equal(reset.status, 200);
    assert.equal((await env.api('GET', '/me', { token: u.token })).status, 401, 'les sessions ouvertes sont fermées');
    assert.equal((await env.api('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } })).status, 401);
    assert.equal((await env.api('POST', '/auth/login', { body: { email: u.email, password: 'NouveauPasse2026' } })).status, 200);
    const reuse = await env.api('POST', '/auth/reset-password', { body: { token: known.body.debug.resetToken, password: 'EncoreUnAutre2026' } });
    assert.equal(reuse.body.error.code, 'AUTH_TOKEN_INVALID');
  });

  it('changement de mot de passe : l’ancien est exigé', async () => {
    const u = await createUser(env);
    const bad = await env.api('POST', '/auth/change-password', { token: u.token, body: { currentPassword: 'faux', newPassword: 'NouveauPasse2026' } });
    assert.equal(bad.status, 401);
    const ok = await env.api('POST', '/auth/change-password', { token: u.token, body: { currentPassword: PASSWORD, newPassword: 'NouveauPasse2026' } });
    assert.equal(ok.status, 200);
  });

  it('double authentification : mise en place, puis code exigé à la connexion', async () => {
    const u = await createUser(env);
    const setup = await env.api('POST', '/auth/2fa/setup', { token: u.token });
    assert.match(setup.body.otpauthUrl, /^otpauth:\/\/totp\/GROUPDEALS/);
    assert.match(setup.body.qrSvg, /^<svg/);
    const stored = await env.app.db.one(`SELECT totp_secret_enc FROM users WHERE id = $1`, [u.id]);
    assert.ok(!stored!.totp_secret_enc.includes(setup.body.secret), 'le secret est chiffré en base');
    assert.equal(decrypt(stored!.totp_secret_enc, env.app.config.encryptionKey), setup.body.secret);

    const wrong = await env.api('POST', '/auth/2fa/enable', { token: u.token, body: { code: '000000' } });
    assert.equal(wrong.body.error.code, 'AUTH_2FA_INVALID');
    const enable = await env.api('POST', '/auth/2fa/enable', { token: u.token, body: { code: totpCode(setup.body.secret) } });
    assert.equal(enable.body.enabled, true);

    const noCode = await env.api('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } });
    assert.equal(noCode.body.error.code, 'AUTH_2FA_REQUIRED');
    assert.equal(noCode.body.accessToken, undefined);
    const badCode = await env.api('POST', '/auth/login', { body: { email: u.email, password: PASSWORD, totp: '123456' } });
    assert.equal(badCode.body.error.code, 'AUTH_2FA_INVALID');
    const good = await env.api('POST', '/auth/login', { body: { email: u.email, password: PASSWORD, totp: totpCode(setup.body.secret) } });
    assert.equal(good.status, 200);
  });

  it('en-têtes de sécurité présents sur les réponses', async () => {
    const res = await env.api('GET', '/countries');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.ok(res.headers.get('x-request-id'));
  });

  it('CORS : une origine non autorisée ne reçoit aucun en-tête d’accès', async () => {
    const res = await env.api('GET', '/countries', { headers: { Origin: 'https://site-pirate.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('corps trop volumineux ou JSON invalide : 400, pas d’erreur serveur', async () => {
    const big = await env.api('POST', '/auth/login', { rawBody: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(400_000) }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(big.status, 400);
    const broken = await env.api('POST', '/auth/login', { rawBody: '{"email":', headers: { 'Content-Type': 'application/json' } });
    assert.equal(broken.status, 400);
    assert.equal(broken.body.error.details.reason, 'invalid_json');
  });

  it('route inconnue : 404 ; mauvaise méthode : 405', async () => {
    assert.equal((await env.api('GET', '/nexiste-pas')).status, 404);
    assert.equal((await env.api('DELETE', '/countries')).status, 405);
  });
});

describe('Double authentification obligatoire pour le personnel (§42)', () => {
  let env: TestEnv;
  before(async () => {
    env = await startEnv({ REQUIRE_STAFF_2FA: 'true' });
  });
  after(async () => env.close());

  it('sans 2FA, un administrateur ne peut rien faire au back-office, sauf activer sa 2FA', async () => {
    const admin = await createUser(env, { roles: ['ADMIN'] });
    const blocked = await env.api('GET', '/admin/dashboard', { token: admin.token });
    assert.equal(blocked.status, 401);
    assert.equal(blocked.body.error.code, 'AUTH_2FA_REQUIRED');
    assert.equal(blocked.body.error.details.setupRequired, true);

    const setup = await env.api('POST', '/auth/2fa/setup', { token: admin.token });
    const enable = await env.api('POST', '/auth/2fa/enable', { token: admin.token, body: { code: totpCode(setup.body.secret) } });
    assert.equal(enable.status, 200);
    const ok = await env.api('GET', '/admin/dashboard', { token: enable.body.accessToken });
    assert.equal(ok.status, 200);
    // L'ancien jeton, émis avant la validation de la 2FA, reste refusé.
    assert.equal((await env.api('GET', '/admin/dashboard', { token: admin.token })).status, 401);

    const disable = await env.api('POST', '/auth/2fa/disable', { token: enable.body.accessToken, body: { password: PASSWORD, code: totpCode(setup.body.secret) } });
    assert.equal(disable.status, 403, 'le personnel ne peut pas désactiver sa 2FA');
  });
});
