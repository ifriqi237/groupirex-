import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { sellerLines } from '../src/services/pdf';
import { Catalog, TestEnv, createCatalog, createOffice, createUser, participate, setRates, startEnv } from './helpers';

describe('Identité de l’entreprise : réglages, mentions légales, factures', () => {
  let env: TestEnv;
  let admin: { token: string };
  let cat: Catalog;
  let office: string;
  before(async () => {
    env = await startEnv();
    admin = await createUser(env, { roles: ['SUPER_ADMIN'] });
    await setRates(env, admin.token);
    office = await createOffice(env, admin.token, 'CM', 'Douala');
    cat = await createCatalog(env, admin.token, { target: 10_000 });
  });
  after(async () => env.close());
  beforeEach(() => env.app.rateLimiter.reset());

  it('les champs vides sont omis du pied de page', () => {
    const lines = sellerLines({ legalName: 'GROUPIREX', legalForm: 'SARL', capital: '', address: 'Douala', rccm: 'RC/DLA/2026/B/1234', taxId: '', phone: '', email: 'contact@groupdeals.test' }, 'fr');
    assert.deepEqual(lines, ['GROUPIREX — SARL — Douala', 'RCCM RC/DLA/2026/B/1234 — contact@groupdeals.test']);
  });

  it('le back-office les règle ; le site les reçoit ; les documents émis les portent', async () => {
    const before = await env.api('GET', '/config');
    assert.equal(before.body.company.legalName, 'GROUPIREX');
    assert.equal(before.body.company.rccm, '');
    const saved = await env.api('PUT', '/admin/settings', { token: admin.token, body: { settings: { 'company.legal_form': 'SARL', 'company.address': 'Bonanjo, Douala', 'company.rccm': 'RC/DLA/2026/B/1234', 'company.tax_id': 'M012600012345X' } } });
    assert.equal(saved.status, 200);
    const cfg = await env.api('GET', '/config');
    assert.equal(cfg.body.company.rccm, 'RC/DLA/2026/B/1234');
    assert.equal(cfg.body.company.address, 'Bonanjo, Douala');

    const customer = await createUser(env);
    const order = (await participate(env, customer.token, cat.dealId, 50, { paymentMethod: 'OFFICE', officeId: office })).body.order;
    const doc = await env.app.db.one(`SELECT data FROM invoices WHERE order_id = $1 AND kind = 'PROFORMA'`, [order.id]);
    assert.deepEqual(doc!.data.seller, ['GROUPIREX — SARL — Bonanjo, Douala', 'RCCM RC/DLA/2026/B/1234 — NIU M012600012345X']);
    const pdf = await env.api('GET', `/orders/${order.id}/documents/proforma`, { token: customer.token });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.raw.subarray(0, 5).toString(), '%PDF-');
  });

  it('un client ne peut pas modifier ces réglages', async () => {
    const customer = await createUser(env);
    const res = await env.api('PUT', '/admin/settings', { token: customer.token, body: { settings: { 'company.rccm': 'X' } } });
    assert.equal(res.status, 403);
  });
});
