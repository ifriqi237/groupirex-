import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Catalog, TestEnv, createCatalog, createUser, participate, payOnline, setRates, startEnv } from './helpers';

/** Ciblage géographique : campagnes nationales, multipays et internationales. */
describe('Zone géographique des campagnes', () => {
  let env: TestEnv;
  let admin: { token: string };
  let cm: { id: string; token: string };
  let sn: { id: string; token: string };
  let ga: { id: string; token: string };
  let cg: { id: string; token: string };
  const shipping = [
    { countryCode: 'CM', amount: 1_500, currency: 'XAF' },
    { countryCode: 'SN', amount: 2_500, currency: 'XOF' },
    { countryCode: 'GA', amount: 2_000, currency: 'XAF' },
    { countryCode: 'CG', amount: 2_000, currency: 'XAF' },
  ];
  let national: Catalog;
  let multi: Catalog;
  let world: Catalog;

  const listed = async (token: string, dealId: string, q?: string) =>
    (await env.api('GET', `/group-deals${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token })).body.items.some((d: any) => d.id === dealId);

  before(async () => {
    env = await startEnv();
    admin = await createUser(env, { roles: ['SUPER_ADMIN'] });
    await setRates(env, admin.token);
    cm = await createUser(env, { country: 'CM' });
    sn = await createUser(env, { country: 'SN' });
    ga = await createUser(env, { country: 'GA' });
    cg = await createUser(env, { country: 'CG' });
    national = await createCatalog(env, admin.token, { name: 'Panneaux solaires', shipping, target: 500, zone: { geographicScope: 'NATIONAL', countries: [{ countryCode: 'CM' }] } });
    multi = await createCatalog(env, admin.token, {
      name: 'Smartphones', shipping, target: 1_000,
      zone: { geographicScope: 'MULTI_COUNTRY', countries: [{ countryCode: 'CM' }, { countryCode: 'GA' }, { countryCode: 'CG' }] },
    });
    world = await createCatalog(env, admin.token, { name: 'Ordinateurs', shipping, target: 1_000 });
  });
  after(async () => env.close());
  beforeEach(() => env.app.rateLimiter.reset());

  it('test 1 : campagne nationale — visible et ouverte au Cameroun seulement', async () => {
    assert.ok(await listed(cm.token, national.dealId), 'visible au Cameroun');
    assert.ok(await listed(cm.token, national.dealId, 'Panneaux'), 'trouvée par la recherche au Cameroun');
    assert.equal(await listed(sn.token, national.dealId), false, 'absente du catalogue au Sénégal');
    assert.equal(await listed(sn.token, national.dealId, 'Panneaux'), false, 'absente de la recherche au Sénégal');
    const home = await env.api('GET', '/home', { token: sn.token });
    assert.equal(home.body.featured.some((d: any) => d.id === national.dealId), false, 'absente de l’accueil au Sénégal');

    const detail = await env.api('GET', `/group-deals/${national.dealSlug}`, { token: cm.token });
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.deal.geography, { scope: 'NATIONAL', countries: ['CM'] });

    // Lien direct depuis le Sénégal : refusé, avec le message prévu.
    const direct = await env.api('GET', `/group-deals/${national.dealSlug}`, { token: sn.token });
    assert.equal(direct.status, 403);
    assert.equal(direct.body.error.code, 'DEAL_NOT_IN_COUNTRY');
    assert.match(direct.body.error.message, /n'est pas disponible dans votre pays/);
    const anon = await env.api('GET', `/group-deals/${national.dealSlug}`, { headers: { 'X-Country': 'SN' } });
    assert.equal(anon.body.error.code, 'DEAL_NOT_IN_COUNTRY', 'visiteur non connecté consultant depuis le Sénégal');

    const ok = await participate(env, cm.token, national.dealId, 10);
    assert.equal(ok.status, 201);
    const no = await participate(env, sn.token, national.dealId, 10);
    assert.equal(no.body.error.code, 'DEAL_NOT_IN_COUNTRY');
  });

  it('test 2 : campagne multipays — Cameroun, Gabon, Congo participent ; Sénégal non', async () => {
    for (const u of [cm, ga, cg]) {
      assert.ok(await listed(u.token, multi.dealId));
      assert.equal((await participate(env, u.token, multi.dealId, 10)).status, 201);
    }
    assert.equal(await listed(sn.token, multi.dealId), false);
    assert.equal((await participate(env, sn.token, multi.dealId, 10)).body.error.code, 'DEAL_NOT_IN_COUNTRY');
    // Chaque pays voit le prix de sa devise, livraison comprise.
    const gaDetail = await env.api('GET', `/group-deals/${multi.dealId}`, { token: ga.token });
    assert.equal(gaDetail.body.deal.price.currency, 'XAF');
  });

  it('test 3 : campagne internationale — tous les pays où le produit est livré', async () => {
    for (const u of [cm, sn, ga, cg]) assert.ok(await listed(u.token, world.dealId));
    const ke = await createUser(env, { country: 'KE' });
    assert.equal(await listed(ke.token, world.dealId), false, 'pas de livraison au Kenya : pas de campagne');
    const detail = await env.api('GET', `/group-deals/${world.dealId}`, { token: sn.token });
    assert.deepEqual(detail.body.deal.geography, { scope: 'INTERNATIONAL', countries: null });
  });

  it('test 4 : ajouter un pays à une campagne active l’ouvre immédiatement', async () => {
    const d = (await env.api('GET', `/admin/deals/${multi.dealId}`, { token: admin.token })).body.deal;
    const body = {
      productId: d.productId, targetQuantity: d.targetQuantity, startsAt: d.startsAt, endsAt: d.endsAt,
      geographicScope: 'MULTI_COUNTRY', countries: ['CM', 'GA', 'CG', 'SN'].map((countryCode) => ({ countryCode })),
    };
    const put = await env.api('PUT', `/admin/deals/${multi.dealId}`, { token: admin.token, body });
    assert.equal(put.status, 200);
    assert.ok(await listed(sn.token, multi.dealId));
    const order = await participate(env, sn.token, multi.dealId, 10);
    assert.equal(order.status, 201);

    // Retrait du Sénégal : la commande existe toujours, mais ne peut plus être payée ; plus de nouvelle participation.
    const back = await env.api('PUT', `/admin/deals/${multi.dealId}`, { token: admin.token, body: { ...body, countries: body.countries.filter((c) => c.countryCode !== 'SN') } });
    assert.equal(back.status, 200);
    assert.equal(await listed(sn.token, multi.dealId), false);
    const kept = await env.app.db.one(`SELECT payment_status FROM orders WHERE id = $1`, [order.body.order.id]);
    assert.equal(kept!.payment_status, 'PENDING', 'commande conservée, pas annulée automatiquement');
    // Test 6 : aucune nouvelle transaction pour un pays devenu non éligible.
    const pay = await env.api('POST', '/payments', { token: sn.token, body: { orderId: order.body.order.id } });
    assert.equal(pay.body.error.code, 'DEAL_NOT_IN_COUNTRY');
    // L'historique garde la zone avant et après.
    const log = await env.app.db.one(`SELECT before, after FROM audit_logs WHERE action = 'deal.update' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [multi.dealId]);
    assert.equal(log!.before.countries.length, 4);
    assert.equal(log!.after.countries.length, 3);
  });

  it('test 5 : sécurité — l’en-tête de pays et le formulaire ne permettent pas de contourner la zone', async () => {
    const res = await env.api('GET', `/group-deals/${national.dealId}`, { token: sn.token, headers: { 'X-Country': 'CM' } });
    assert.equal(res.body.error.code, 'DEAL_NOT_IN_COUNTRY', 'le pays du compte prime sur celui du navigateur');
    const quote = await env.api('POST', `/group-deals/${national.dealId}/quote`, { token: sn.token, headers: { 'X-Country': 'CM' }, body: { items: [{ quantity: 10 }] } });
    assert.equal(quote.body.error.code, 'DEAL_NOT_IN_COUNTRY');
    const fake = await participate(env, sn.token, national.dealId, 10, { countryCode: 'CM' });
    assert.notEqual(fake.status, 201);
    // Un client ne peut pas modifier une campagne.
    assert.equal((await env.api('PUT', `/admin/deals/${national.dealId}`, { token: sn.token, body: {} })).status, 403);
  });

  it('formulaire : refus d’une campagne nationale ou multipays sans pays valable', async () => {
    const d = (await env.api('GET', `/admin/deals/${world.dealId}`, { token: admin.token })).body.deal;
    const base = { productId: d.productId, targetQuantity: 100, startsAt: d.startsAt, endsAt: d.endsAt };
    const cases: [unknown, RegExp][] = [
      [{ geographicScope: 'NATIONAL', countries: [] }, /un seul/],
      [{ geographicScope: 'NATIONAL', countries: [{ countryCode: 'CM' }, { countryCode: 'SN' }] }, /un seul/],
      [{ geographicScope: 'MULTI_COUNTRY', countries: [{ countryCode: 'CM' }] }, /au moins deux/],
      [{ geographicScope: 'MULTI_COUNTRY', countries: [{ countryCode: 'CM' }, { countryCode: 'KE' }] }, /pas livré/],
      [{ geographicScope: 'MULTI_COUNTRY', goalScope: 'PER_COUNTRY', countries: [{ countryCode: 'CM', targetQuantity: 5 }, { countryCode: 'GA' }] }, /objectif pour chaque pays/],
    ];
    for (const [zone, msg] of cases) {
      const res = await env.api('POST', '/admin/deals', { token: admin.token, body: { ...base, ...(zone as object) } });
      assert.equal(res.status, 400, JSON.stringify(zone));
      assert.match(res.body.error.details.fields[0].message, msg);
    }
  });

  it('objectif par pays : chaque pays suit son propre objectif', async () => {
    const perCountry = await createCatalog(env, admin.token, {
      name: 'Climatiseurs', shipping, target: 1,
      zone: { geographicScope: 'MULTI_COUNTRY', goalScope: 'PER_COUNTRY', countries: [{ countryCode: 'CM', targetQuantity: 300 }, { countryCode: 'GA', targetQuantity: 200 }] },
    });
    const adm = (await env.api('GET', `/admin/deals/${perCountry.dealId}`, { token: admin.token })).body;
    assert.equal(adm.deal.targetQuantity, 500, 'objectif total = somme des pays');
    const order = await participate(env, cm.token, perCountry.dealId, 30);
    await payOnline(env, cm.token, order.body.order.id);
    const forCm = (await env.api('GET', `/group-deals/${perCountry.dealId}`, { token: cm.token })).body.deal.progress;
    assert.equal(forCm.target, 300);
    assert.equal(forCm.ordered, 30);
    assert.equal(forCm.percent, 10);
    assert.equal(forCm.scope, 'COUNTRY');
    const forGa = (await env.api('GET', `/group-deals/${perCountry.dealId}`, { token: ga.token })).body.deal.progress;
    assert.equal(forGa.target, 200);
    assert.equal(forGa.ordered, 0);
    const zone = (await env.api('GET', `/admin/deals/${perCountry.dealId}`, { token: admin.token })).body.zone;
    assert.deepEqual(zone.map((z: any) => [z.country.code, z.targetQuantity, z.paidQuantity, z.percent]), [['CM', 300, 30, 10], ['GA', 200, 0, 0]]);
  });

  it('tableau de bord : filtres par type, par pays et par statut', async () => {
    const ids = async (q: string) => (await env.api('GET', `/admin/deals?${q}`, { token: admin.token })).body.items.map((d: any) => d.id);
    assert.ok((await ids('scope=NATIONAL')).includes(national.dealId));
    assert.equal((await ids('scope=NATIONAL')).includes(world.dealId), false);
    assert.ok((await ids('scope=INTERNATIONAL')).includes(world.dealId));
    const forSn = await ids('country=SN');
    assert.ok(forSn.includes(world.dealId));
    assert.equal(forSn.includes(national.dealId), false);
    assert.ok((await ids('status=ACTIVE')).includes(national.dealId));
    const item = (await env.api('GET', `/admin/deals?scope=NATIONAL`, { token: admin.token })).body.items.find((d: any) => d.id === national.dealId);
    assert.equal(item.geographicScope, 'NATIONAL');
    assert.deepEqual(item.countries.map((c: any) => c.code), ['CM']);
    const countries = (await env.api('GET', `/admin/deal-zone-countries?productId=${national.productId}`, { token: admin.token })).body.countries;
    assert.ok(countries.length >= 4);
    assert.equal(countries.find((c: any) => c.code === 'CM').delivered, true);
    assert.equal(countries.find((c: any) => c.code === 'KE').delivered, false);
  });

  it('pays du compte : pas de changement avec une commande en attente, puis un changement par mois', async () => {
    const u = await createUser(env, { country: 'CM' });
    const o = await participate(env, u.token, national.dealId, 10);
    assert.equal((await env.api('PATCH', '/me', { token: u.token, body: { countryCode: 'SN' } })).body.error.code, 'COUNTRY_CHANGE_PENDING_ORDERS');
    await env.api('POST', `/orders/${o.body.order.id}/cancel`, { token: u.token, body: {} });
    assert.equal((await env.api('PATCH', '/me', { token: u.token, body: { countryCode: 'SN' } })).status, 200);
    assert.equal((await env.api('PATCH', '/me', { token: u.token, body: { countryCode: 'CM' } })).body.error.code, 'COUNTRY_CHANGE_TOO_SOON');
  });

  it('test 7 : les anciennes campagnes, sans zone, restent internationales', async () => {
    const legacy = await env.app.db.one(`SELECT geographic_scope, goal_scope FROM group_deals WHERE id = $1`, [world.dealId]);
    assert.deepEqual({ ...legacy }, { geographic_scope: 'INTERNATIONAL', goal_scope: 'GLOBAL' });
  });
});
