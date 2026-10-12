import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { Catalog, TestEnv, createCatalog, createOffice, createUser, findKeys, findValues, participate, payOnline, setRates, startEnv } from './helpers';

/** Aucune réponse destinée au client ne doit laisser voir les composants du prix. */
const FORBIDDEN_KEYS = /shipping|livraison|freight|customs|supplier|margin|baseConverted|basePrice|breakdown|rounding|fxBuffer|ratesUsed/i;

describe('Prix final par pays (§15, §16, §47)', () => {
  let env: TestEnv;
  let admin: { token: string };
  let cm: { id: string; token: string };
  let sn: { id: string; token: string };
  let cat: Catalog;

  before(async () => {
    env = await startEnv();
    admin = await createUser(env, { roles: ['SUPER_ADMIN'] });
    await setRates(env, admin.token);
    cat = await createCatalog(env, admin.token, { name: 'Sandales', supplierCost: { amount: 950, currency: 'USD' } });
    cm = await createUser(env, { country: 'CM' });
    sn = await createUser(env, { country: 'SN' });
  });
  after(async () => env.close());
  beforeEach(() => env.app.rateLimiter.reset());

  it('Cameroun : 10 000 + 1 500 = le client voit 11 500 FCFA', async () => {
    const res = await env.api('GET', `/group-deals/${cat.dealId}`, { token: cm.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.deal.price.amount, 11_500);
    assert.equal(res.body.deal.price.currency, 'XAF');
    assert.match(res.body.deal.price.formatted, /^11.500 FCFA$/);
  });

  it('aucune ligne de livraison, aucun composant interne dans les réponses client', async () => {
    const urls = [`/group-deals/${cat.dealId}`, '/group-deals', '/home', `/products/${cat.productId}`, '/products'];
    for (const url of urls) {
      const res = await env.api('GET', url, { token: cm.token });
      assert.equal(res.status, 200, url);
      assert.deepEqual(findKeys(res.body, FORBIDDEN_KEYS), [], `fuite dans ${url}`);
      assert.deepEqual(findValues(res.body, (v) => v === 1_500 || v === 10_000), [], `${url} ne doit contenir ni le prix de base ni la livraison`);
    }
    const quote = await env.api('POST', `/group-deals/${cat.dealId}/quote`, { token: cm.token, body: { items: [{ quantity: 20 }] } });
    assert.deepEqual(findKeys(quote.body, FORBIDDEN_KEYS), []);
  });

  it('proforma de la page « Votre commande » : un PDF du devis, sans rien enregistrer ni réserver', async () => {
    const state = () =>
      env.app.db.one(
        `SELECT (SELECT count(*)::int FROM orders) AS orders, (SELECT count(*)::int FROM invoices) AS invoices,
                (SELECT held_quantity FROM group_deals WHERE id = $1) AS held`,
        [cat.dealId],
      );
    const before = await state();
    const url = `/group-deals/${cat.dealId}/proforma`;
    const pdf = await env.api('POST', url, { token: cm.token, body: { items: [{ quantity: 20 }], paymentMethod: 'ONLINE' } });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(pdf.headers.get('content-disposition') ?? '', /filename="PF-\d{8}-\d{6}\.pdf"/, 'référence datée, hors de la série des factures');
    assert.equal(pdf.raw.subarray(0, 5).toString(), '%PDF-');
    assert.deepEqual(await state(), before, 'ni commande, ni facture enregistrée, ni quantité retenue');
    // Réservée aux membres connectés, et aux mêmes conditions qu'une commande.
    assert.equal((await env.api('POST', url, { body: { items: [{ quantity: 20 }] } })).status, 401);
    const quote = await env.api('POST', `/group-deals/${cat.dealId}/quote`, { token: cm.token, body: { items: [{ quantity: 1 }] } });
    if (quote.body.problem) {
      const refused = await env.api('POST', url, { token: cm.token, body: { items: [{ quantity: 1 }] } });
      assert.equal(refused.body.error.code, quote.body.problem.code, 'sous le minimum de commande : pas de proforma');
    }
    // Un bureau demandé alors que le total n'ouvre pas droit au paiement au bureau est simplement ignoré.
    const ignored = await env.api('POST', url, { token: cm.token, body: { items: [{ quantity: 20 }], paymentMethod: 'OFFICE', officeId: '00000000-0000-4000-8000-000000000000' } });
    assert.equal(ignored.status, 200);
  });

  it('documents : image du produit et QR Code', async () => {
    // Une photo du produit, envoyée comme le ferait le back-office (dossier des médias).
    const sharp = (await import('sharp')).default;
    fs.mkdirSync(env.app.config.uploadsDir, { recursive: true });
    await sharp({ create: { width: 300, height: 200, channels: 3, background: '#2f6f4f' } }).webp().toFile(path.join(env.app.config.uploadsDir, 'doc-test.webp'));
    await env.app.db.query(`INSERT INTO product_media (product_id, kind, url, thumbnail_url, alt, sort_order) VALUES ($1, 'IMAGE', '/media/doc-test.webp', NULL, 'photo', 0)`, [cat.productId]);

    // Proforma de « Votre commande » : l'image est incrustée dans le PDF.
    const images = async (raw: Buffer) => {
      const xobjects = (await PDFDocument.load(raw)).getPage(0).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
      return xobjects ? xobjects.keys().length : 0;
    };
    const quote = await env.api('POST', `/group-deals/${cat.dealId}/proforma`, { token: cm.token, body: { items: [{ quantity: 20 }] } });
    assert.equal(quote.status, 200);
    assert.equal(await images(quote.raw), 1, 'une image de produit dans la proforma');

    // Facture d'une commande payée : image et QR Code sont figés dans le document à son émission.
    const order = await participate(env, cm.token, cat.dealId, 20);
    assert.equal(order.status, 201);
    const id = order.body.order.id;
    assert.equal((await payOnline(env, cm.token, id)).status, 200);
    const invoice = await env.app.db.one(`SELECT data FROM invoices WHERE order_id = $1 AND kind = 'INVOICE'`, [id]);
    assert.ok(invoice, 'facture émise au paiement');
    assert.deepEqual(invoice!.data.qr, { content: `${env.app.config.publicUrl}/orders/${id}`, target: 'ORDER' });
    assert.ok(invoice!.data.lines[0].image.length > 200, 'vignette du produit conservée dans la facture');
    const pdf = await env.api('GET', `/orders/${id}/documents/invoice`, { token: cm.token });
    assert.equal(await images(pdf.raw), 1);

    // Une image introuvable ne bloque pas l'émission : la ligne s'en passe.
    await env.app.db.query(`UPDATE product_media SET url = '/media/absente.webp' WHERE product_id = $1`, [cat.productId]);
    const without = await env.api('POST', `/group-deals/${cat.dealId}/proforma`, { token: cm.token, body: { items: [{ quantity: 20 }] } });
    assert.equal(without.status, 200);
    assert.equal(await images(without.raw), 0);
    await env.app.db.query(`DELETE FROM product_media WHERE product_id = $1`, [cat.productId]);
  });

  it('Sénégal : même produit, prix recalculé avec le tarif du pays (12 500 FCFA)', async () => {
    const res = await env.api('GET', `/group-deals/${cat.dealId}`, { token: sn.token });
    assert.equal(res.body.deal.price.amount, 12_500);
    assert.equal(res.body.deal.price.currency, 'XOF');
  });

  it('si l’utilisateur change de pays, le prix final est recalculé', async () => {
    const u = await createUser(env, { country: 'CM' });
    assert.equal((await env.api('GET', `/group-deals/${cat.dealId}`, { token: u.token })).body.deal.price.amount, 11_500);
    const patch = await env.api('PATCH', '/me', { token: u.token, body: { countryCode: 'SN' } });
    assert.equal(patch.body.user.country.currency, 'XOF');
    assert.equal((await env.api('GET', `/group-deals/${cat.dealId}`, { token: u.token })).body.deal.price.amount, 12_500);
  });

  it('visiteur non connecté : pays choisi par l’en-tête X-Country, sinon pays par défaut', async () => {
    assert.equal((await env.api('GET', `/group-deals/${cat.dealId}`)).body.deal.price.amount, 11_500);
    assert.equal((await env.api('GET', `/group-deals/${cat.dealId}`, { headers: { 'X-Country': 'SN' } })).body.deal.price.amount, 12_500);
  });

  it('un utilisateur connecté ne peut pas obtenir le prix d’un autre pays par l’en-tête', async () => {
    const res = await env.api('GET', `/group-deals/${cat.dealId}`, { token: cm.token, headers: { 'X-Country': 'SN' } });
    assert.equal(res.body.deal.price.amount, 11_500);
  });

  it('pays sans tarif de livraison : offre absente de la liste, participation refusée', async () => {
    const ke = await createUser(env, { country: 'KE' });
    const list = await env.api('GET', '/group-deals', { token: ke.token });
    assert.equal(list.body.items.length, 0);
    const detail = await env.api('GET', `/group-deals/${cat.dealId}`, { token: ke.token });
    assert.equal(detail.body.deal.price, null);
    assert.equal(detail.body.deal.availability, 'COUNTRY_NOT_COVERED');
    const res = await participate(env, ke.token, cat.dealId, 10);
    assert.equal(res.body.error.code, 'COUNTRY_NOT_COVERED');
  });

  it('pays ouvert mais tarif non paramétré : erreur « livraison non paramétrée »', async () => {
    const c = await createCatalog(env, admin.token, { shipping: [{ countryCode: 'CM', amount: 1_500 }, { countryCode: 'KE', amount: null }] });
    const ke = await createUser(env, { country: 'KE' });
    const res = await participate(env, ke.token, c.dealId, 10);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'SHIPPING_RATE_MISSING');
    assert.equal(res.body.error.action, 'CONTACT_SUPPORT');
  });

  it('devise étrangère : conversion, marge de change sur la part convertie, arrondi au pas de la devise', async () => {
    // 10,00 USD -> 6 000 XAF + 2 % = 6 120 ; + livraison 1 501 XAF = 7 621 -> arrondi à 7 625 (pas de 5)
    const c = await createCatalog(env, admin.token, { base: { amount: 1_000, currency: 'USD' }, shipping: [{ countryCode: 'CM', amount: 1_501, currency: 'XAF' }] });
    const res = await env.api('GET', `/group-deals/${c.dealId}`, { token: cm.token });
    assert.equal(res.body.deal.price.amount, 7_625);
  });

  it('taux de change manquant : pas de prix affiché plutôt qu’un prix faux', async () => {
    const c = await createCatalog(env, admin.token, { base: { amount: 1_000, currency: 'CNY' }, shipping: [{ countryCode: 'CM', amount: 1_500, currency: 'XAF' }] });
    const res = await env.api('GET', `/group-deals/${c.dealId}`, { token: cm.token });
    assert.equal(res.body.deal.price, null);
    assert.equal(res.body.deal.availability, 'FX_RATE_MISSING');
    assert.equal(res.body.deal.open, false);
    assert.equal((await participate(env, cm.token, c.dealId, 10)).body.error.code, 'FX_RATE_MISSING');
  });

  it('back-office : les composants et la marge sont conservés et visibles des rôles autorisés (§17)', async () => {
    const res = await env.api('GET', `/admin/products/${cat.productId}/pricing`, { token: admin.token });
    const row = res.body.countries.find((c: any) => c.country.code === 'CM');
    assert.equal(row.finalPrice.amount, 11_500);
    assert.equal(row.components.base.amount, 10_000);
    assert.equal(row.components.shipping.amount, 1_500);
    // Marge = 11 500 − coût fournisseur 9,50 USD (5 700 XAF) = 5 800
    assert.equal(row.margin.amount.amount, 5_800);

    const moderator = await createUser(env, { roles: ['MODERATOR'] });
    const limited = await env.api('GET', `/admin/products/${cat.productId}/pricing`, { token: moderator.token });
    assert.equal(limited.status, 200);
    assert.equal(limited.body.countries.find((c: any) => c.country.code === 'CM').margin, null, 'un modérateur ne voit pas la marge');
  });

  it('un tarif de livraison modifié est historisé, et les commandes existantes gardent leur prix', async () => {
    const c = await createCatalog(env, admin.token);
    const u = await createUser(env, { country: 'CM' });
    const order = await participate(env, u.token, c.dealId, 10);
    assert.equal(order.body.order.total.amount, 115_000);

    await env.api('PUT', `/admin/products/${c.productId}/shipping-rates`, { token: admin.token, body: { rates: [{ countryCode: 'CM', enabled: true, amount: 2_000, currency: 'XAF' }] } });
    assert.equal((await env.api('GET', `/group-deals/${c.dealId}`, { token: u.token })).body.deal.price.amount, 12_000);
    const history = await env.app.db.all(`SELECT amount, is_current FROM shipping_rates WHERE product_id = $1 AND country_code = 'CM' ORDER BY created_at`, [c.productId]);
    assert.deepEqual(history.map((h) => [h.amount, h.is_current]), [[1_500, false], [2_000, true]]);

    const same = await env.api('GET', `/orders/${order.body.order.id}`, { token: u.token });
    assert.equal(same.body.order.total.amount, 115_000);
    assert.equal(same.body.order.items[0].unitPrice.amount, 11_500);
    const internal = await env.api('GET', `/admin/orders/${order.body.order.id}`, { token: admin.token });
    assert.equal(internal.body.items[0].priceBreakdown.shippingConverted.amount, 1_500);
    assert.equal(internal.body.items[0].priceBreakdown.baseConverted.amount, 10_000);
  });

  it('le prix a changé entre l’affichage et le clic : commande refusée avec le nouveau total', async () => {
    const c = await createCatalog(env, admin.token);
    const res = await participate(env, cm.token, c.dealId, 10, { expectedTotal: 110_000 });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PRICE_CHANGED');
    assert.equal(res.body.error.details.total, 115_000);
  });
});

describe('Commandes : MOQ, quantités, idempotence (§14, §20, §21, §47)', () => {
  let env: TestEnv;
  let admin: { token: string };
  let user: { id: string; token: string };

  before(async () => {
    env = await startEnv();
    admin = await createUser(env, { roles: ['SUPER_ADMIN'] });
    await setRates(env, admin.token);
    user = await createUser(env);
  });
  after(async () => env.close());
  beforeEach(() => env.app.rateLimiter.reset());

  it('MOQ = 10, quantité = 9 : commande refusée ; quantité = 10 : acceptée', async () => {
    const c = await createCatalog(env, admin.token, { moq: 10 });
    const refused = await participate(env, user.token, c.dealId, 9);
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error.code, 'QUANTITY_BELOW_MOQ');
    assert.equal(refused.body.error.details.moq, 10);
    assert.equal(refused.body.error.action, 'ADJUST_QUANTITY');
    const ok = await participate(env, user.token, c.dealId, 10);
    assert.equal(ok.status, 201);
    assert.match(ok.body.order.number, /^GD-\d{4}-\d{8}$/);
    assert.equal(ok.body.order.total.amount, 115_000);
    assert.equal(ok.body.order.status, 'PENDING_PAYMENT');
  });

  it('récapitulatif : prix unitaire × quantité = total, sans autre frais', async () => {
    const c = await createCatalog(env, admin.token);
    const res = await participate(env, user.token, c.dealId, 20);
    const o = res.body.order;
    assert.equal(o.items.length, 1);
    assert.equal(o.items[0].unitPrice.amount, 11_500);
    assert.equal(o.items[0].quantity, 20);
    assert.equal(o.total.amount, 230_000);
    assert.deepEqual(findKeys(o, FORBIDDEN_KEYS), []);
  });

  it('non connecté : 401 ; quantité invalide : 400 ; en-tête d’idempotence manquant : 400', async () => {
    const c = await createCatalog(env, admin.token);
    const anon = await env.api('POST', `/group-deals/${c.dealId}/participate`, { headers: { 'Idempotency-Key': 'abcdefgh' }, body: { items: [{ quantity: 10 }], paymentMethod: 'ONLINE' } });
    assert.equal(anon.status, 401);
    for (const quantity of [0, -3, 1.5, '10']) {
      assert.equal((await participate(env, user.token, c.dealId, quantity as number)).status, 400, String(quantity));
    }
    const noKey = await env.api('POST', `/group-deals/${c.dealId}/participate`, { token: user.token, body: { items: [{ quantity: 10 }], paymentMethod: 'ONLINE' } });
    assert.equal(noKey.status, 400);
  });

  it('email non vérifié : commande refusée', async () => {
    const c = await createCatalog(env, admin.token);
    const u = await createUser(env, { verified: false });
    assert.equal((await participate(env, u.token, c.dealId, 10)).body.error.code, 'AUTH_EMAIL_NOT_VERIFIED');
  });

  it('double clic : la même clé d’idempotence ne crée qu’une commande et ne retient les quantités qu’une fois', async () => {
    const c = await createCatalog(env, admin.token);
    const key = 'clic-unique-0001';
    const [a, b] = await Promise.all([participate(env, user.token, c.dealId, 10, {}, key), participate(env, user.token, c.dealId, 10, {}, key)]);
    assert.equal(a.body.order.id, b.body.order.id);
    assert.deepEqual([a.status, b.status].sort(), [200, 201]);
    const deal = await env.app.db.one(`SELECT held_quantity FROM group_deals WHERE id = $1`, [c.dealId]);
    assert.equal(deal!.held_quantity, 10);
  });

  it('campagne à venir, brouillon ou terminée : participation refusée', async () => {
    const upcoming = await createCatalog(env, admin.token, { startsInMs: 3_600_000 });
    assert.equal((await participate(env, user.token, upcoming.dealId, 10)).body.error.code, 'DEAL_NOT_ACTIVE');
    const draft = await createCatalog(env, admin.token, { publish: false });
    assert.equal((await participate(env, user.token, draft.dealId, 10)).status, 404);
    const short = await createCatalog(env, admin.token, { endsInMs: 60_000 });
    env.app.clock.offsetMs = 120_000;
    const res = await participate(env, user.token, short.dealId, 10);
    env.app.clock.offsetMs = 0;
    assert.equal(res.body.error.code, 'DEAL_EXPIRED');
  });

  it('pas de survente : 10 commandes simultanées de 20 unités pour 100 places, exactement 5 passent', async () => {
    const c = await createCatalog(env, admin.token, { target: 100, maxQuantity: 100 });
    const buyers = await Promise.all(Array.from({ length: 10 }, () => createUser(env)));
    env.app.rateLimiter.reset();
    const results = await Promise.all(buyers.map((b) => participate(env, b.token, c.dealId, 20)));
    const ok = results.filter((r) => r.status === 201).length;
    const refused = results.filter((r) => r.status === 409).map((r) => r.body.error.code);
    assert.equal(ok, 5);
    assert.equal(refused.length, 5);
    assert.ok(refused.every((code) => code === 'QUANTITY_NOT_AVAILABLE' || code === 'DEAL_SOLD_OUT'), refused.join(','));
    const deal = await env.app.db.one(`SELECT held_quantity, paid_quantity FROM group_deals WHERE id = $1`, [c.dealId]);
    assert.deepEqual([deal!.held_quantity, deal!.paid_quantity], [100, 0]);
  });

  it('variantes : obligatoires quand le produit en a, et le MOQ s’applique au total', async () => {
    const c = await createCatalog(env, admin.token, { moq: 10 });
    await env.api('PUT', `/admin/products/${c.productId}/variants`, {
      token: admin.token,
      body: { variants: [{ sku: 'S-38', label: 'Noir / 38' }, { sku: 'S-40', label: 'Noir / 40', priceDeltaAmount: 500 }] },
    });
    const detail = await env.api('GET', `/group-deals/${c.dealId}`, { token: user.token });
    const [v38, v40] = detail.body.deal.product.variants;
    assert.deepEqual([v38.price.amount, v40.price.amount], [11_500, 12_000]);

    const none = await participate(env, user.token, c.dealId, 10);
    assert.equal(none.body.error.code, 'VARIANT_REQUIRED');
    const mixed = await env.api('POST', `/group-deals/${c.dealId}/participate`, {
      token: user.token,
      headers: { 'Idempotency-Key': 'variantes-0001' },
      body: { items: [{ variantId: v38.id, quantity: 6 }, { variantId: v40.id, quantity: 4 }], paymentMethod: 'ONLINE' },
    });
    assert.equal(mixed.status, 201);
    assert.equal(mixed.body.order.total.amount, 6 * 11_500 + 4 * 12_000);
    const tooFew = await env.api('POST', `/group-deals/${c.dealId}/participate`, {
      token: user.token,
      headers: { 'Idempotency-Key': 'variantes-0002' },
      body: { items: [{ variantId: v38.id, quantity: 5 }, { variantId: v40.id, quantity: 4 }], paymentMethod: 'ONLINE' },
    });
    assert.equal(tooFew.body.error.code, 'QUANTITY_BELOW_MOQ');
  });

  it('une commande impayée expire, libère ses quantités, et la jauge ne compte que le payé', async () => {
    const c = await createCatalog(env, admin.token, { maxQuantity: 100 });
    const res = await participate(env, user.token, c.dealId, 40);
    const before = await env.api('GET', `/group-deals/${c.dealId}`, { token: user.token });
    assert.equal(before.body.deal.progress.ordered, 0, 'une commande non payée ne fait pas avancer la jauge');
    assert.equal(before.body.deal.remainingQuantity, 60);

    env.app.clock.offsetMs = 31 * 60_000;
    assert.equal(await env.app.jobs.runOnce('expire-orders'), true);
    const expired = await env.api('GET', `/orders/${res.body.order.id}`, { token: user.token });
    const after = await env.api('GET', `/group-deals/${c.dealId}`, { token: user.token });
    env.app.clock.offsetMs = 0;
    assert.equal(expired.body.order.status, 'EXPIRED');
    assert.equal(after.body.deal.remainingQuantity, 100);
  });

  it('le client peut annuler sa commande tant qu’elle n’est pas payée', async () => {
    const c = await createCatalog(env, admin.token);
    const res = await participate(env, user.token, c.dealId, 10);
    const other = await createUser(env);
    assert.equal((await env.api('POST', `/orders/${res.body.order.id}/cancel`, { token: other.token, body: {} })).status, 404, 'pas la commande d’un autre');
    assert.equal((await env.api('POST', `/orders/${res.body.order.id}/cancel`, { token: user.token, body: {} })).status, 200);
    assert.equal((await env.app.db.one(`SELECT held_quantity FROM group_deals WHERE id = $1`, [c.dealId]))!.held_quantity, 0);
    assert.equal((await env.api('GET', `/orders/${res.body.order.id}`, { token: other.token })).status, 404);
  });
});

describe('Paiement en bureau : seuil de 500 000 FCFA (§22, §47)', () => {
  let env: TestEnv;
  let admin: { token: string };
  let user: { id: string; token: string };
  let office: string;

  before(async () => {
    env = await startEnv();
    admin = await createUser(env, { roles: ['SUPER_ADMIN'] });
    await setRates(env, admin.token);
    // Pas d'arrondi au franc près, pour tester le seuil à l'unité.
    await env.api('PATCH', '/admin/currencies/XAF', { token: admin.token, body: { roundingStep: 1 } });
    office = await createOffice(env, admin.token);
    user = await createUser(env);
  });
  after(async () => env.close());
  beforeEach(() => env.app.rateLimiter.reset());

  const product = (base: number) => createCatalog(env, admin.token, { moq: 1, base: { amount: base, currency: 'XAF' }, shipping: [{ countryCode: 'CM', amount: 1, currency: 'XAF' }] });

  it('total = 499 999 FCFA : bureau local indisponible, y compris en forçant la requête', async () => {
    const c = await product(499_998);
    const quote = await env.api('POST', `/group-deals/${c.dealId}/quote`, { token: user.token, body: { items: [{ quantity: 1 }] } });
    assert.equal(quote.body.total.amount, 499_999);
    assert.equal(quote.body.paymentMethods.office, false);
    assert.equal(quote.body.paymentMethods.online, true);

    const forced = await participate(env, user.token, c.dealId, 1, { paymentMethod: 'OFFICE', officeId: office });
    assert.equal(forced.status, 422);
    assert.equal(forced.body.error.code, 'OFFICE_PAYMENT_NOT_ELIGIBLE');
    assert.equal(forced.body.error.action, 'CHOOSE_ONLINE_PAYMENT');

    // Autre voie d'entrée : commande en ligne puis demande de bascule vers le bureau.
    const online = await participate(env, user.token, c.dealId, 1);
    const sw = await env.api('POST', '/office-payments', { token: user.token, body: { orderId: online.body.order.id, officeId: office } });
    assert.equal(sw.body.error.code, 'OFFICE_PAYMENT_NOT_ELIGIBLE');
  });

  it('total = 500 000 FCFA : bureau local disponible', async () => {
    const c = await product(499_999);
    const quote = await env.api('POST', `/group-deals/${c.dealId}/quote`, { token: user.token, body: { items: [{ quantity: 1 }] } });
    assert.equal(quote.body.total.amount, 500_000);
    assert.equal(quote.body.paymentMethods.office, true);
    const res = await participate(env, user.token, c.dealId, 1, { paymentMethod: 'OFFICE', officeId: office });
    assert.equal(res.status, 201);
    assert.equal(res.body.order.paymentMethod, 'OFFICE');
    assert.match(res.body.order.reservation.number, /^RB-\d{4}-\d{8}$/);
    assert.equal(res.body.order.reservation.status, 'PENDING_PAYMENT');
    assert.match(res.body.order.reservation.qrSvg, /^<svg/);
    assert.equal(res.body.order.documents[0].kind, 'PROFORMA');
  });

  it('autre devise : le total est converti en FCFA avant d’être comparé au seuil', async () => {
    const ke = await createUser(env, { country: 'KE' });
    const nairobi = await createOffice(env, admin.token, 'KE', 'Nairobi');
    // 108 400 KES ≈ 500 308 XAF (éligible) ; 108 200 KES ≈ 499 385 XAF (non éligible)
    const yes = await createCatalog(env, admin.token, { moq: 1, base: { amount: 10_830_000, currency: 'KES' }, shipping: [{ countryCode: 'KE', amount: 10_000, currency: 'KES' }] });
    const no = await createCatalog(env, admin.token, { moq: 1, base: { amount: 10_810_000, currency: 'KES' }, shipping: [{ countryCode: 'KE', amount: 10_000, currency: 'KES' }] });
    assert.equal((await env.api('POST', `/group-deals/${yes.dealId}/quote`, { token: ke.token, body: { items: [{ quantity: 1 }] } })).body.paymentMethods.office, true);
    assert.equal((await env.api('POST', `/group-deals/${no.dealId}/quote`, { token: ke.token, body: { items: [{ quantity: 1 }] } })).body.paymentMethods.office, false);
    assert.equal((await participate(env, ke.token, no.dealId, 1, { paymentMethod: 'OFFICE', officeId: nairobi })).body.error.code, 'OFFICE_PAYMENT_NOT_ELIGIBLE');
  });

  it('bureau d’un autre pays ou bureau fermé : refusé', async () => {
    const c = await product(600_000);
    const dakar = await createOffice(env, admin.token, 'SN', 'Dakar');
    assert.equal((await participate(env, user.token, c.dealId, 1, { paymentMethod: 'OFFICE', officeId: dakar })).body.error.code, 'OFFICE_NOT_AVAILABLE');
    const closed = await createOffice(env, admin.token);
    await env.app.db.query(`UPDATE local_offices SET is_active = false WHERE id = $1`, [closed]);
    assert.equal((await participate(env, user.token, c.dealId, 1, { paymentMethod: 'OFFICE', officeId: closed })).body.error.code, 'OFFICE_CLOSED');
    assert.equal((await participate(env, user.token, c.dealId, 1, { paymentMethod: 'OFFICE' })).status, 400, 'bureau obligatoire');
  });

  it('liste des bureaux : ceux du pays de l’utilisateur uniquement', async () => {
    const res = await env.api('GET', '/local-offices', { token: user.token });
    assert.equal(res.body.country, 'CM');
    assert.ok(res.body.offices.length >= 1);
    assert.deepEqual(res.body.cities, ['Douala']);
    assert.ok(res.body.offices.every((o: any) => o.latitude !== null));
  });

  it('partenaires locaux : annuaire public, consultable pays par pays sans compte', async () => {
    const list = await env.api('GET', '/local-partners/countries');
    assert.equal(list.status, 200);
    const active = await env.app.db.all(`SELECT country_code, count(*)::int AS n FROM local_offices WHERE is_active GROUP BY country_code`);
    for (const row of active) assert.equal(list.body.countries.find((c: any) => c.code === row.country_code).partners, row.n);
    assert.ok(list.body.countries.some((c: any) => c.partners === 0), 'les pays sans partenaire restent proposés');
    // Toute l'Afrique est proposée, que le pays soit desservi ou non.
    assert.equal(list.body.countries.length, 54);
    assert.deepEqual(list.body.countries.map((c: any) => c.name), [...list.body.countries.map((c: any) => c.name)].sort((a: string, b: string) => a.localeCompare(b, 'fr')));
    assert.equal(list.body.countries.find((c: any) => c.code === 'CM').served, true);
    // Depuis la migration 0018, les 54 pays sont ouverts ; un pays sans bureau a une liste vide.
    assert.ok(list.body.countries.every((c: any) => c.served === true));
    const botswana = list.body.countries.find((c: any) => c.code === 'BW');
    assert.deepEqual(botswana, { code: 'BW', name: 'Botswana', served: true, partners: 0 });
    const bw = await env.api('GET', '/local-partners/bw', { headers: { 'Accept-Language': 'en' } });
    assert.equal(bw.status, 200);
    assert.deepEqual(bw.body, { country: { code: 'BW', name: 'Botswana', served: true }, cities: [], partners: [] });
    // Un pays fermé depuis le back-office reste dans l'annuaire, marqué « non desservi ».
    await env.app.db.query(`UPDATE countries SET is_active = false WHERE code = 'BW'`);
    env.app.reference.invalidate();
    const closed = await env.api('GET', '/local-partners/BW');
    assert.deepEqual(closed.body.country, { code: 'BW', name: 'Botswana', served: false });
    await env.app.db.query(`UPDATE countries SET is_active = true WHERE code = 'BW'`);
    env.app.reference.invalidate();
    assert.equal((await env.api('GET', '/local-partners/MU', { headers: { 'Accept-Language': 'en' } })).body.country.name, 'Mauritius');

    // Un pays autre que celui du visiteur, en minuscules : la page reste consultable.
    const cm = await env.api('GET', '/local-partners/cm', { headers: { 'X-Country': 'SN' } });
    assert.equal(cm.body.country.code, 'CM');
    assert.equal(cm.body.partners.length, active.find((r) => r.country_code === 'CM')!.n);
    assert.ok(cm.body.partners.every((p: any) => p.name && p.city && typeof p.acceptsPayments === 'boolean'));

    // Un bureau désactivé disparaît de l'annuaire.
    const first = cm.body.partners[0];
    await env.app.db.query(`UPDATE local_offices SET is_active = false WHERE id = $1`, [first.id]);
    const after = await env.api('GET', '/local-partners/CM');
    assert.ok(!after.body.partners.some((p: any) => p.id === first.id));
    await env.app.db.query(`UPDATE local_offices SET is_active = true WHERE id = $1`, [first.id]);

    assert.equal((await env.api('GET', '/local-partners/ZZ')).status, 404);
    assert.equal((await env.api('GET', '/local-partners/FR')).status, 404, 'pays hors d’Afrique');
  });
});

describe('Intégrité des paiements en ligne (§43, §47)', () => {
  let env: TestEnv;
  let admin: { token: string };
  let user: { id: string; token: string };
  let cat: Catalog;

  before(async () => {
    env = await startEnv();
    admin = await createUser(env, { roles: ['SUPER_ADMIN'] });
    await setRates(env, admin.token);
    cat = await createCatalog(env, admin.token, { target: 100_000 });
    user = await createUser(env);
  });
  after(async () => env.close());
  beforeEach(() => env.app.rateLimiter.reset());

  const newOrder = async (qty = 20) => (await participate(env, user.token, cat.dealId, qty)).body.order;
  const status = async (id: string) => (await env.app.db.one(`SELECT payment_status FROM orders WHERE id = $1`, [id]))!.payment_status;
  const sendWebhook = (data: object, signature?: string) => {
    const body = JSON.stringify({ event: 'charge.completed', data });
    return env.api('POST', '/payments/webhook', { rawBody: body, headers: { 'Content-Type': 'application/json', 'x-sandbox-signature': signature ?? env.sandbox.signWebhook(body) } });
  };

  it('parcours complet : commande, paiement, webhook vérifié, commande payée, facture PDF', async () => {
    const o = await newOrder();
    const paid0 = (await env.app.db.one(`SELECT paid_quantity FROM group_deals WHERE id = $1`, [cat.dealId]))!.paid_quantity;
    const pay = await payOnline(env, user.token, o.id);
    assert.equal(pay.status, 200);
    const detail = await env.api('GET', `/orders/${o.id}`, { token: user.token });
    assert.equal(detail.body.order.status, 'PAID');
    assert.equal(detail.body.order.documents[0].kind, 'INVOICE');
    const deal = await env.app.db.one(`SELECT paid_quantity, held_quantity, participants_count FROM group_deals WHERE id = $1`, [cat.dealId]);
    assert.equal(deal!.paid_quantity, paid0 + 20);
    assert.equal(deal!.participants_count, 1);

    const pdf = await env.api('GET', `/orders/${o.id}/documents/invoice`, { token: user.token });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(pdf.raw.subarray(0, 5).toString(), '%PDF-');
    const stranger = await createUser(env);
    assert.equal((await env.api('GET', `/orders/${o.id}/documents/invoice`, { token: stranger.token })).status, 404);
  });

  it('le navigateur ne décide jamais : sans transaction réelle, « vérifier » laisse la commande impayée', async () => {
    const o = await newOrder();
    await env.api('POST', '/payments', { token: user.token, body: { orderId: o.id } });
    const forged = await env.api('POST', '/payments/verify', { token: user.token, body: { orderId: o.id, transactionId: '999999' } });
    assert.equal(forged.status, 200);
    assert.notEqual(forged.body.paymentStatus, 'PAID');
    assert.equal(await status(o.id), 'PENDING');
    // Il n'existe aucune route permettant au client de déclarer sa commande payée.
    assert.equal((await env.api('PATCH', `/orders/${o.id}`, { token: user.token, body: { paymentStatus: 'PAID' } })).status, 405);
  });

  it('webhook sans signature valide : refusé (401) et sans effet', async () => {
    const o = await newOrder();
    const row = await env.app.db.one(`SELECT tx_ref FROM orders WHERE id = $1`, [o.id]);
    const tx = env.sandbox.simulate(row!.tx_ref, 'successful', { amountMajor: 230_000, currency: 'XAF' });
    const res = await sendWebhook({ id: Number(tx.providerId), tx_ref: row!.tx_ref, status: 'successful' }, 'signature-fausse');
    assert.equal(res.status, 401);
    assert.equal(await status(o.id), 'PENDING');
    const logged = await env.app.db.one(`SELECT count(*)::int AS n FROM webhook_events WHERE signature_valid = false`);
    assert.ok(logged!.n >= 1, 'la tentative est conservée');
  });

  it('webhook signé mais mensonger : c’est la réponse du prestataire qui compte, pas le contenu du message', async () => {
    const o = await newOrder();
    const row = await env.app.db.one(`SELECT tx_ref FROM orders WHERE id = $1`, [o.id]);
    const tx = env.sandbox.simulate(row!.tx_ref, 'failed', { amountMajor: 230_000, currency: 'XAF' });
    const res = await sendWebhook({ id: Number(tx.providerId), tx_ref: row!.tx_ref, status: 'successful', amount: 230_000 });
    assert.equal(res.status, 200);
    assert.equal(res.body.outcome, 'FAILED');
    assert.equal(await status(o.id), 'FAILED');
    // Le client peut retenter : un nouveau paiement réussi confirme la commande.
    await payOnline(env, user.token, o.id);
    assert.equal(await status(o.id), 'PAID');
  });

  it('montant inférieur au total : rejeté ; mauvaise devise : rejeté', async () => {
    const o1 = await newOrder();
    const r1 = await env.app.db.one(`SELECT tx_ref FROM orders WHERE id = $1`, [o1.id]);
    const low = env.sandbox.simulate(r1!.tx_ref, 'successful', { amountMajor: 229_999, currency: 'XAF' });
    assert.equal((await sendWebhook({ id: Number(low.providerId), tx_ref: r1!.tx_ref, status: 'successful' })).body.outcome, 'REJECTED');
    assert.equal(await status(o1.id), 'PENDING');

    const o2 = await newOrder();
    const r2 = await env.app.db.one(`SELECT tx_ref FROM orders WHERE id = $1`, [o2.id]);
    const wrong = env.sandbox.simulate(r2!.tx_ref, 'successful', { amountMajor: 230_000, currency: 'NGN' });
    assert.equal((await sendWebhook({ id: Number(wrong.providerId), tx_ref: r2!.tx_ref, status: 'successful' })).body.outcome, 'REJECTED');
    assert.equal(await status(o2.id), 'PENDING');
    const rejected = await env.app.db.all(`SELECT reject_reason FROM payments WHERE status = 'REJECTED' ORDER BY created_at`);
    assert.deepEqual(rejected.map((p) => p.reject_reason), ['PAYMENT_AMOUNT_MISMATCH', 'PAYMENT_CURRENCY_MISMATCH']);
  });

  it('transaction d’une autre commande présentée pour celle-ci : sans effet', async () => {
    const a = await newOrder();
    const b = await newOrder();
    await payOnline(env, user.token, a.id);
    const paidTx = await env.app.db.one(`SELECT provider_tx_id FROM payments WHERE order_id = $1 AND status = 'SUCCESSFUL'`, [a.id]);
    const res = await env.api('POST', '/payments/verify', { token: user.token, body: { orderId: b.id, transactionId: paidTx!.provider_tx_id } });
    assert.notEqual(res.body.paymentStatus, 'PAID');
    assert.equal(await status(b.id), 'PENDING');
  });

  it('même webhook reçu trois fois : un seul paiement, une seule fois dans la jauge', async () => {
    const o = await newOrder();
    const row = await env.app.db.one(`SELECT tx_ref FROM orders WHERE id = $1`, [o.id]);
    await env.api('POST', '/payments', { token: user.token, body: { orderId: o.id } });
    const before = (await env.app.db.one(`SELECT paid_quantity FROM group_deals WHERE id = $1`, [cat.dealId]))!.paid_quantity;
    const tx = env.sandbox.simulate(row!.tx_ref, 'successful');
    const data = { id: Number(tx.providerId), tx_ref: row!.tx_ref, status: 'successful' };
    const results = await Promise.all([sendWebhook(data), sendWebhook(data), sendWebhook(data)]);
    assert.ok(results.every((r) => r.status === 200));
    await sendWebhook(data);
    const payments = await env.app.db.one(`SELECT count(*)::int AS n FROM payments WHERE order_id = $1 AND status = 'SUCCESSFUL'`, [o.id]);
    assert.equal(payments!.n, 1);
    assert.equal((await env.app.db.one(`SELECT paid_quantity FROM group_deals WHERE id = $1`, [cat.dealId]))!.paid_quantity, before + 20);
    assert.equal((await env.app.db.one(`SELECT count(*)::int AS n FROM invoices WHERE order_id = $1`, [o.id]))!.n, 1);
  });

  it('double paiement réel de la même commande : le second est mis en remboursement', async () => {
    const o = await newOrder();
    const row = await env.app.db.one(`SELECT tx_ref FROM orders WHERE id = $1`, [o.id]);
    await payOnline(env, user.token, o.id);
    const second = env.sandbox.simulate(row!.tx_ref, 'successful');
    const res = await sendWebhook({ id: Number(second.providerId), tx_ref: row!.tx_ref, status: 'successful' });
    assert.equal(res.body.outcome, 'REFUND_REQUIRED');
    const refunds = await env.api('GET', '/admin/refunds?status=PENDING', { token: admin.token });
    const mine = refunds.body.items.filter((x: any) => x.orderId === o.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].amount.amount, 230_000);
    assert.equal(mine[0].reason, 'DUPLICATE_PAYMENT');
    assert.equal(await status(o.id), 'PAID');
  });

  it('paiement arrivé après expiration : honoré s’il reste de la place, sinon remboursé', async () => {
    const small = await createCatalog(env, admin.token, { maxQuantity: 30, target: 30 });
    const late = (await participate(env, user.token, small.dealId, 20)).body.order;
    const lateRow = await env.app.db.one(`SELECT tx_ref FROM orders WHERE id = $1`, [late.id]);
    await env.api('POST', '/payments', { token: user.token, body: { orderId: late.id } });
    env.app.clock.offsetMs = 31 * 60_000;
    await env.app.jobs.runOnce('expire-orders');
    assert.equal(await status(late.id), 'EXPIRED');

    // Il reste 30 places : le paiement tardif ranime la commande.
    const tx = env.sandbox.simulate(lateRow!.tx_ref, 'successful');
    assert.equal((await sendWebhook({ id: Number(tx.providerId), tx_ref: lateRow!.tx_ref, status: 'successful' })).body.outcome, 'PAID');
    assert.equal(await status(late.id), 'PAID');

    // Second cas : entre-temps un autre acheteur a pris les places restantes.
    const other = await createUser(env);
    const loser = (await participate(env, user.token, small.dealId, 10)).body.order;
    const loserRow = await env.app.db.one(`SELECT tx_ref FROM orders WHERE id = $1`, [loser.id]);
    await env.api('POST', '/payments', { token: user.token, body: { orderId: loser.id } });
    env.app.clock.offsetMs = 62 * 60_000;
    await env.app.jobs.runOnce('expire-orders');
    const winner = (await participate(env, other.token, small.dealId, 10)).body.order;
    await payOnline(env, other.token, winner.id);
    const tx2 = env.sandbox.simulate(loserRow!.tx_ref, 'successful');
    const res = await sendWebhook({ id: Number(tx2.providerId), tx_ref: loserRow!.tx_ref, status: 'successful' });
    env.app.clock.offsetMs = 0;
    assert.equal(res.body.outcome, 'REFUND_REQUIRED');
    assert.equal(await status(loser.id), 'EXPIRED');
    const deal = await env.app.db.one(`SELECT paid_quantity, held_quantity, max_quantity FROM group_deals WHERE id = $1`, [small.dealId]);
    assert.deepEqual([deal!.paid_quantity, deal!.held_quantity], [30, 0], 'jamais plus que le plafond');
  });

  it('webhook non arrivé : avant d’expirer une commande, la tâche interroge le prestataire', async () => {
    const o = await newOrder();
    const row = await env.app.db.one(`SELECT tx_ref FROM orders WHERE id = $1`, [o.id]);
    await env.api('POST', '/payments', { token: user.token, body: { orderId: o.id } });
    env.sandbox.simulate(row!.tx_ref, 'successful'); // payé chez le prestataire, mais aucun webhook reçu
    env.app.clock.offsetMs = 31 * 60_000;
    await env.app.jobs.runOnce('expire-orders');
    env.app.clock.offsetMs = 0;
    assert.equal(await status(o.id), 'PAID');
  });

  it('commande d’un autre utilisateur : impossible d’ouvrir un paiement', async () => {
    const o = await newOrder();
    const stranger = await createUser(env);
    assert.equal((await env.api('POST', '/payments', { token: stranger.token, body: { orderId: o.id } })).status, 404);
  });

  it('« Mes commandes » : filtres par statut et compteurs', async () => {
    const res = await env.api('GET', '/orders', { token: user.token });
    assert.ok(res.body.total >= 5);
    assert.ok(res.body.counts.PAID >= 1);
    const paid = await env.api('GET', '/orders?status=PAID', { token: user.token });
    assert.ok(paid.body.items.every((o: any) => o.status === 'PAID'));
    assert.equal(paid.body.total, res.body.counts.PAID);
  });
});
