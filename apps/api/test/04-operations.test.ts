import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Catalog, TestEnv, createCatalog, createOffice, createUser, participate, payOnline, setRates, startEnv } from './helpers';

describe('Bureau local : réservation, encaissement par l’agent, clôture de caisse (§23 à §26)', () => {
  let env: TestEnv;
  let admin: { token: string };
  let customer: { id: string; token: string };
  let douala: string;
  let yaounde: string;
  let agent: { id: string; token: string };
  let otherAgent: { id: string; token: string };
  let manager: { id: string; token: string };
  let cat: Catalog;
  let order: any;

  before(async () => {
    env = await startEnv();
    admin = await createUser(env, { roles: ['SUPER_ADMIN'] });
    await setRates(env, admin.token);
    douala = await createOffice(env, admin.token, 'CM', 'Douala');
    yaounde = await createOffice(env, admin.token, 'CM', 'Yaoundé');
    agent = await createUser(env, { roles: ['OFFICE_AGENT'], officeId: douala });
    otherAgent = await createUser(env, { roles: ['OFFICE_AGENT'], officeId: yaounde });
    manager = await createUser(env, { roles: ['OFFICE_MANAGER'], officeId: douala, position: 'MANAGER' });
    customer = await createUser(env);
    cat = await createCatalog(env, admin.token, { target: 10_000 });
    order = (await participate(env, customer.token, cat.dealId, 50, { paymentMethod: 'OFFICE', officeId: douala })).body.order;
  });
  after(async () => env.close());
  beforeEach(() => env.app.rateLimiter.reset());

  it('la réservation porte un numéro, un QR Code, un montant, un bureau et une date limite', async () => {
    const r = order.reservation;
    assert.match(r.number, /^RB-/);
    assert.equal(r.amount.amount, 575_000);
    assert.equal(r.office.city, 'Douala');
    assert.ok(new Date(r.expiresAt).getTime() > Date.now() + 71 * 3_600_000);
    assert.match(r.qrContent, /\/agent\/scan\/[\w-]{20,}$/);
    const proforma = await env.api('GET', `/orders/${order.id}/documents/proforma`, { token: customer.token });
    assert.equal(proforma.raw.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await env.api('GET', `/orders/${order.id}/documents/receipt`, { token: customer.token })).status, 404, 'pas de reçu avant paiement');
  });

  it('l’agent retrouve la réservation par recherche et par QR Code, avec le montant attendu', async () => {
    const list = await env.api('GET', `/agent/reservations?q=${order.reservation.number}`, { token: agent.token });
    assert.equal(list.body.reservations.length, 1);
    assert.equal(list.body.reservations[0].amount.amount, 575_000);
    const token = order.reservation.qrContent.split('/').pop();
    const scan = await env.api('GET', `/agent/reservations/scan/${token}`, { token: agent.token });
    assert.equal(scan.body.reservation.number, order.reservation.number);
    assert.equal(scan.body.reservation.items[0].unitPrice.amount, 11_500);
    assert.equal(scan.body.reservation.payable, true);
  });

  it('un agent d’un autre bureau ne voit ni n’encaisse cette réservation', async () => {
    const list = await env.api('GET', '/agent/reservations', { token: otherAgent.token });
    assert.equal(list.body.reservations.length, 0);
    const token = order.reservation.qrContent.split('/').pop();
    assert.equal((await env.api('GET', `/agent/reservations/scan/${token}`, { token: otherAgent.token })).body.error.code, 'RESERVATION_WRONG_OFFICE');
    const pay = await env.api('POST', `/agent/reservations/${order.reservation.id}/pay`, { token: otherAgent.token, body: { channel: 'CASH' } });
    assert.equal(pay.status, 403);
    assert.equal((await env.app.db.one(`SELECT payment_status FROM orders WHERE id = $1`, [order.id]))!.payment_status, 'PENDING');
  });

  it('un client ne peut pas utiliser l’interface agent', async () => {
    assert.equal((await env.api('GET', '/agent/reservations', { token: customer.token })).status, 403);
    assert.equal((await env.api('POST', `/agent/reservations/${order.reservation.id}/pay`, { token: customer.token, body: { channel: 'CASH' } })).status, 403);
  });

  it('l’agent ne peut pas modifier le prix : un montant envoyé avec l’encaissement est refusé', async () => {
    const res = await env.api('POST', `/agent/reservations/${order.reservation.id}/pay`, { token: agent.token, body: { channel: 'CASH', amount: 1_000 } });
    assert.equal(res.status, 400);
    assert.equal((await env.app.db.one(`SELECT payment_status FROM orders WHERE id = $1`, [order.id]))!.payment_status, 'PENDING');
  });

  it('l’agent ne peut modifier ni commande, ni tarif de livraison, ni produit (§25)', async () => {
    const attempts: [string, string, unknown][] = [
      ['PUT', `/admin/products/${cat.productId}/shipping-rates`, { rates: [{ countryCode: 'CM', enabled: true, amount: 1, currency: 'XAF' }] }],
      ['PUT', `/admin/products/${cat.productId}`, {}],
      ['POST', `/admin/orders/${order.id}/cancel`, { reason: 'test' }],
      ['GET', `/admin/orders/${order.id}`, undefined],
      ['GET', `/admin/products/${cat.productId}/pricing`, undefined],
      ['POST', `/admin/deals/${cat.dealId}/decide`, { type: 'CONFIRM' }],
      ['PUT', '/admin/settings/office-payment', { isActive: true, minTotalAmount: 0, minTotalCurrency: 'XAF' }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await env.api(method, path, { token: agent.token, body });
      assert.equal(res.status, 403, `${method} ${path}`);
    }
  });

  it('encaissement : commande payée, reçu émis, jauge mise à jour, action journalisée', async () => {
    const confirm = await env.api('POST', `/agent/reservations/${order.reservation.id}/confirm`, { token: agent.token });
    assert.equal(confirm.body.status, 'CONFIRMED');
    const pay = await env.api('POST', `/agent/reservations/${order.reservation.id}/pay`, { token: agent.token, body: { channel: 'CASH' } });
    assert.equal(pay.status, 200);
    assert.equal(pay.body.outcome, 'PAID');
    assert.equal(pay.body.reservation.status, 'PAID');

    const detail = await env.api('GET', `/orders/${order.id}`, { token: customer.token });
    assert.equal(detail.body.order.status, 'PAID');
    assert.deepEqual(detail.body.order.documents.map((d: any) => d.kind), ['PROFORMA', 'RECEIPT']);
    const receipt = await env.api('GET', `/orders/${order.id}/documents/receipt`, { token: agent.token });
    assert.equal(receipt.raw.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await env.api('GET', `/orders/${order.id}/documents/receipt`, { token: otherAgent.token })).status, 404);
    assert.equal((await env.app.db.one(`SELECT paid_quantity FROM group_deals WHERE id = $1`, [cat.dealId]))!.paid_quantity, 50);

    const logs = await env.api('GET', '/admin/audit-logs?action=office_payment', { token: admin.token });
    const actions = logs.body.items.map((l: any) => l.action);
    assert.ok(actions.includes('office_payment.record') && actions.includes('office_payment.confirm'));
    const record = logs.body.items.find((l: any) => l.action === 'office_payment.record');
    assert.equal(record.actor.id, agent.id);
    assert.equal(record.after.amount, 575_000);
  });

  it('double clic sur « encaisser » : pas de second paiement', async () => {
    const again = await env.api('POST', `/agent/reservations/${order.reservation.id}/pay`, { token: agent.token, body: { channel: 'CASH' } });
    assert.equal(again.body.outcome, 'ALREADY_PROCESSED');
    assert.equal((await env.app.db.one(`SELECT count(*)::int AS n FROM payments WHERE order_id = $1`, [order.id]))!.n, 1);
    assert.equal((await env.app.db.one(`SELECT paid_quantity FROM group_deals WHERE id = $1`, [cat.dealId]))!.paid_quantity, 50);
  });

  it('réservation expirée : l’encaissement est refusé', async () => {
    const o = (await participate(env, customer.token, cat.dealId, 50, { paymentMethod: 'OFFICE', officeId: douala })).body.order;
    env.app.clock.offsetMs = 73 * 3_600_000;
    const res = await env.api('POST', `/agent/reservations/${o.reservation.id}/pay`, { token: agent.token, body: { channel: 'CASH' } });
    await env.app.jobs.runOnce('expire-orders');
    const after = await env.app.db.one(`SELECT status FROM office_payments WHERE id = $1`, [o.reservation.id]);
    env.app.clock.offsetMs = 0;
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'RESERVATION_EXPIRED');
    assert.equal(res.body.error.action, 'NEW_RESERVATION');
    assert.equal(after!.status, 'EXPIRED');
  });

  it('clôture de caisse : l’écart entre le compté et l’attendu est enregistré ; réservée au responsable', async () => {
    const cash = await env.api('GET', `/agent/cash?officeId=${douala}`, { token: agent.token });
    assert.equal(cash.body.open.length, 1);
    assert.equal(cash.body.expected[0].amount, 575_000);
    assert.equal(cash.body.canClose, false);
    const denied = await env.api('POST', '/agent/cash/close', { token: agent.token, body: { officeId: douala, currency: 'XAF', declaredAmount: 575_000 } });
    assert.equal(denied.status, 403);
    const wrongOffice = await env.api('POST', '/agent/cash/close', { token: manager.token, body: { officeId: yaounde, currency: 'XAF', declaredAmount: 0 } });
    assert.equal(wrongOffice.status, 403);

    const close = await env.api('POST', '/agent/cash/close', { token: manager.token, body: { officeId: douala, currency: 'XAF', declaredAmount: 570_000, note: 'Manque 5 000' } });
    assert.equal(close.status, 201);
    assert.equal(close.body.difference, -5_000);
    const after = await env.api('GET', `/agent/cash?officeId=${douala}`, { token: manager.token });
    assert.equal(after.body.open.length, 0);
    assert.equal(after.body.closings[0].differenceSign, -1);
    const nothing = await env.api('POST', '/agent/cash/close', { token: manager.token, body: { officeId: douala, currency: 'XAF', declaredAmount: 0 } });
    assert.equal(nothing.status, 400);
  });

  it('bascule vers le bureau d’une commande en ligne éligible', async () => {
    const o = (await participate(env, customer.token, cat.dealId, 50)).body.order;
    const sw = await env.api('POST', '/office-payments', { token: customer.token, body: { orderId: o.id, officeId: yaounde } });
    assert.equal(sw.status, 201);
    const detail = await env.api('GET', `/orders/${o.id}`, { token: customer.token });
    assert.equal(detail.body.order.paymentMethod, 'OFFICE');
    assert.equal(detail.body.order.reservation.office.city, 'Yaoundé');
    assert.equal(detail.body.order.canPayOnline, false);
  });
});

describe('Fin de campagne et logistique en 9 étapes (§11, §28, §47, §51)', () => {
  let env: TestEnv;
  let admin: { token: string };
  let logistics: { id: string; token: string };
  let plainAdmin: { token: string };
  let finance: { token: string };
  let office: string;
  let agent: { token: string };
  let buyer: { id: string; token: string };

  before(async () => {
    env = await startEnv();
    admin = await createUser(env, { roles: ['SUPER_ADMIN'] });
    await setRates(env, admin.token);
    logistics = await createUser(env, { roles: ['LOGISTICS_MANAGER'] });
    plainAdmin = await createUser(env, { roles: ['MODERATOR'] });
    finance = await createUser(env, { roles: ['FINANCE_MANAGER'] });
    office = await createOffice(env, admin.token);
    agent = await createUser(env, { roles: ['OFFICE_AGENT'], officeId: office });
    buyer = await createUser(env);
  });
  after(async () => env.close());
  beforeEach(() => {
    env.app.rateLimiter.reset();
    env.app.clock.offsetMs = 0;
  });

  /** Campagne courte avec une commande payée, puis l'horloge passe après la date de fin. */
  async function endedDeal(qty = 20, target = 100): Promise<{ cat: Catalog; orderId: string }> {
    const cat = await createCatalog(env, admin.token, { target, endsInMs: 3_600_000 });
    const o = (await participate(env, buyer.token, cat.dealId, qty, { pickupOfficeId: office })).body.order;
    await payOnline(env, buyer.token, o.id);
    env.app.clock.offsetMs = 2 * 3_600_000;
    return { cat, orderId: o.id };
  }

  it('objectif non atteint à la date de fin : rien d’automatique, la campagne attend une décision', async () => {
    const { cat, orderId } = await endedDeal();
    const d = await env.api('GET', `/admin/deals/${cat.dealId}`, { token: admin.token });
    assert.equal(d.body.deal.status, 'EXPIRED');
    assert.equal(d.body.deal.needsDecision, true);
    assert.equal((await env.app.db.one(`SELECT payment_status FROM orders WHERE id = $1`, [orderId]))!.payment_status, 'PAID');
    const pub = await env.api('GET', `/group-deals/${cat.dealId}`, { token: buyer.token });
    assert.equal(pub.body.deal.status, 'EXPIRED');
    assert.equal(pub.body.deal.open, false);
    assert.equal((await participate(env, buyer.token, cat.dealId, 10)).body.error.code, 'DEAL_EXPIRED');
    const dash = await env.api('GET', '/admin/dashboard', { token: admin.token });
    assert.ok(dash.body.counts.dealsToDecide >= 1);
  });

  it('décision « prolonger » : la campagne rouvre', async () => {
    const { cat } = await endedDeal();
    const bad = await env.api('POST', `/admin/deals/${cat.dealId}/decide`, { token: admin.token, body: { type: 'EXTEND', newEndsAt: new Date(Date.now() + 3_600_000).toISOString() } });
    assert.equal(bad.status, 400, 'la nouvelle date doit être dans le futur');
    const ok = await env.api('POST', `/admin/deals/${cat.dealId}/decide`, { token: admin.token, body: { type: 'EXTEND', newEndsAt: new Date(Date.now() + 5 * 86_400_000).toISOString() } });
    assert.equal(ok.status, 200);
    assert.equal((await env.api('GET', `/group-deals/${cat.dealId}`, { token: buyer.token })).body.deal.status, 'ACTIVE');
    assert.equal((await participate(env, buyer.token, cat.dealId, 10)).status, 201);
  });

  it('décision « annuler » : motif obligatoire, commandes payées mises en remboursement, impayées annulées', async () => {
    const cat = await createCatalog(env, admin.token, { endsInMs: 3_600_000 });
    const paid = (await participate(env, buyer.token, cat.dealId, 20)).body.order;
    await payOnline(env, buyer.token, paid.id);
    const pending = (await participate(env, buyer.token, cat.dealId, 10)).body.order;
    env.app.clock.offsetMs = 2 * 3_600_000;

    assert.equal((await env.api('POST', `/admin/deals/${cat.dealId}/decide`, { token: admin.token, body: { type: 'CANCEL', reason: '' } })).status, 400);
    assert.equal((await env.api('POST', `/admin/deals/${cat.dealId}/decide`, { token: plainAdmin.token, body: { type: 'CANCEL', reason: 'Objectif non atteint' } })).status, 403);
    const res = await env.api('POST', `/admin/deals/${cat.dealId}/decide`, { token: admin.token, body: { type: 'CANCEL', reason: 'Objectif non atteint' } });
    assert.equal(res.status, 200);

    const statuses = await env.app.db.all(`SELECT id, payment_status FROM orders WHERE deal_id = $1`, [cat.dealId]);
    assert.equal(statuses.find((o) => o.id === paid.id)!.payment_status, 'REFUND_PENDING');
    assert.equal(statuses.find((o) => o.id === pending.id)!.payment_status, 'CANCELLED');
    const d = await env.app.db.one(`SELECT held_quantity, stored_status FROM group_deals WHERE id = $1`, [cat.dealId]);
    assert.deepEqual([d!.held_quantity, d!.stored_status], [0, 'CANCELLED']);

    // La finance traite le remboursement.
    const refunds = await env.api('GET', '/admin/refunds?status=PENDING', { token: finance.token });
    const mine = refunds.body.items.find((x: any) => x.orderId === paid.id);
    assert.equal(mine.amount.amount, 230_000);
    assert.equal((await env.api('POST', `/admin/refunds/${mine.id}/complete`, { token: logistics.token, body: { providerRef: 'X' } })).status, 403);
    const done = await env.api('POST', `/admin/refunds/${mine.id}/complete`, { token: finance.token, body: { providerRef: 'VIR-2026-001' } });
    assert.equal(done.body.status, 'DONE');
    assert.equal((await env.api('GET', `/orders/${paid.id}`, { token: buyer.token })).body.order.status, 'REFUNDED');
    assert.equal((await env.api('POST', `/admin/refunds/${mine.id}/complete`, { token: finance.token, body: { providerRef: 'VIR-2026-002' } })).status, 409);
  });

  it('décision « confirmer » puis logistique : les 9 étapes, dans l’ordre', async () => {
    const { cat, orderId } = await endedDeal();
    const confirm = await env.api('POST', `/admin/deals/${cat.dealId}/decide`, { token: admin.token, body: { type: 'CONFIRM' } });
    assert.equal(confirm.status, 200);
    const shipments = await env.api('GET', '/admin/shipments', { token: logistics.token });
    const s = shipments.body.items.find((x: any) => x.deal.id === cat.dealId);
    assert.equal(s.country.code, 'CM');
    assert.equal(s.currentStep, 0);
    assert.equal(s.ordersCount, 1);
    const advance = (targetStep: number, extra: object = {}, token = logistics.token) =>
      env.api('POST', `/admin/shipments/${s.id}/advance`, { token, body: { targetStep, ...extra } });
    const step = async () => (await env.api('GET', `/orders/${orderId}`, { token: buyer.token })).body.order.logistics;

    // Étapes 1 à 5, une par une
    for (let t = 1; t <= 5; t++) assert.equal((await advance(t)).status, 200, `étape ${t}`);
    assert.equal((await step()).currentStep, 5);

    // §47 : impossible de passer à l'étape 7 si la 6 n'est pas validée
    const jump = await advance(7);
    assert.equal(jump.status, 409);
    assert.equal(jump.body.error.code, 'LOGISTICS_STEP_OUT_OF_ORDER');
    assert.equal((await step()).currentStep, 5);

    // Forçage : il faut la permission ET un motif
    assert.equal((await advance(7, { override: { reason: 'Urgence' } }, plainAdmin.token)).status, 403);
    assert.equal((await advance(7, { override: { reason: '   ' } })).status, 400);
    const forced = await advance(7, { override: { reason: 'Fret aérien : pas d’étape port' } });
    assert.equal(forced.status, 200);
    assert.deepEqual(forced.body, { currentStep: 7, overridden: true, skippedSteps: [6] });

    // … et l'intervention est journalisée
    const logs = await env.api('GET', `/admin/audit-logs?action=logistics.override&entityId=${s.id}`, { token: admin.token });
    assert.equal(logs.body.items.length, 1);
    assert.equal(logs.body.items[0].reason, 'Fret aérien : pas d’étape port');
    assert.equal(logs.body.items[0].actor.id, logistics.id);
    assert.deepEqual(logs.body.items[0].after, { step: 7, skipped: [6] });

    const l7 = await step();
    assert.equal(l7.currentStep, 7);
    assert.deepEqual(l7.steps.map((x: any) => x.state), ['done', 'done', 'done', 'done', 'done', 'skipped', 'done', 'next', 'pending']);
    assert.equal(l7.pickup.code, null, 'pas de code de retrait avant l’étape 8');

    // Étape 8 : disponible au retrait, avec code
    const ready = await env.api('POST', `/admin/shipments/${s.id}/ready-for-pickup`, { token: logistics.token, body: {} });
    assert.equal(ready.body.ordersReady, 1);
    const l8 = await step();
    assert.equal(l8.currentStep, 8);
    assert.match(l8.pickup.code, /^\d{6}$/);
    assert.equal((await env.api('GET', '/orders?status=READY_FOR_PICKUP', { token: buyer.token })).body.items.length, 1);

    // Étape 9 : retrait confirmé par l'agent, sur présentation du code
    const wrongCode = l8.pickup.code === '000000' ? '111111' : '000000';
    assert.equal((await env.api('POST', `/agent/pickups/${orderId}/confirm`, { token: agent.token, body: { code: wrongCode } })).status, 400);
    assert.equal((await env.api('POST', `/agent/pickups/${orderId}/confirm`, { token: buyer.token, body: { code: l8.pickup.code } })).status, 403);
    const picked = await env.api('POST', `/agent/pickups/${orderId}/confirm`, { token: agent.token, body: { code: l8.pickup.code } });
    assert.equal(picked.body.status, 'PICKED_UP');
    const l9 = await step();
    assert.equal(l9.currentStep, 9);
    assert.equal((await env.api('GET', `/orders/${orderId}`, { token: buyer.token })).body.order.status, 'COMPLETED');
    assert.equal((await env.api('POST', `/agent/pickups/${orderId}/confirm`, { token: agent.token, body: { code: l8.pickup.code } })).status, 409);

    // Le client a été prévenu à chaque étape
    const notifs = await env.api('GET', '/me/notifications', { token: buyer.token });
    const steps = notifs.body.items.filter((n: any) => n.type === 'LOGISTICS_STEP').map((n: any) => n.params.step).sort();
    assert.deepEqual(steps, [1, 2, 3, 4, 5, 7, 8, 9]);
  });

  it('étape 8 refusée tant que le lot n’est pas dédouané ; position du navire à l’étape 5', async () => {
    const { cat, orderId } = await endedDeal(120, 100);
    await env.api('POST', `/admin/deals/${cat.dealId}/decide`, { token: admin.token, body: { type: 'CONFIRM' } });
    const s = (await env.api('GET', '/admin/shipments', { token: logistics.token })).body.items.find((x: any) => x.deal.id === cat.dealId);
    for (let t = 1; t <= 5; t++) await env.api('POST', `/admin/shipments/${s.id}/advance`, { token: logistics.token, body: { targetStep: t } });
    const early = await env.api('POST', `/admin/shipments/${s.id}/ready-for-pickup`, { token: logistics.token, body: {} });
    assert.equal(early.body.error.code, 'LOGISTICS_STEP_OUT_OF_ORDER');

    const patch = await env.api('PATCH', `/admin/shipments/${s.id}`, {
      token: logistics.token,
      body: { vesselName: 'MSC TEST', departurePort: 'Ningbo', arrivalPort: 'Douala', eta: new Date(Date.now() + 9 * 86_400_000).toISOString(), position: { latitude: -20.5, longitude: 5.1, progressPercent: 62 } },
    });
    assert.equal(patch.status, 200);
    const vessel = (await env.api('GET', `/orders/${orderId}`, { token: buyer.token })).body.order.logistics.vessel;
    assert.equal(vessel.name, 'MSC TEST');
    assert.equal(vessel.arrivalPort, 'Douala');
    assert.equal(vessel.position.progressPercent, 62);
    assert.equal(vessel.position.source, 'MANUAL');

    // Retour en arrière (erreur de saisie) : uniquement par forçage motivé
    assert.equal((await env.api('POST', `/admin/shipments/${s.id}/advance`, { token: logistics.token, body: { targetStep: 4 } })).status, 409);
    const back = await env.api('POST', `/admin/shipments/${s.id}/advance`, { token: logistics.token, body: { targetStep: 4, override: { reason: 'Étape 5 validée par erreur' } } });
    assert.equal(back.body.currentStep, 4);
    assert.equal((await env.api('GET', `/orders/${orderId}`, { token: buyer.token })).body.order.logistics.steps[4].state, 'next');
  });

  it('paiement d’une commande en attente après confirmation de la campagne : elle rejoint l’expédition', async () => {
    const cat = await createCatalog(env, admin.token, { endsInMs: 3_600_000, target: 10 });
    const first = (await participate(env, buyer.token, cat.dealId, 10, { pickupOfficeId: office })).body.order;
    await payOnline(env, buyer.token, first.id);
    const late = (await participate(env, buyer.token, cat.dealId, 10, { pickupOfficeId: office })).body.order;
    await env.api('POST', `/admin/deals/${cat.dealId}/decide`, { token: admin.token, body: { type: 'CONFIRM' } });
    await payOnline(env, buyer.token, late.id);
    const rows = await env.app.db.all(`SELECT shipment_id FROM orders WHERE deal_id = $1`, [cat.dealId]);
    assert.ok(rows.every((x) => x.shipment_id !== null));
    assert.equal(new Set(rows.map((x) => x.shipment_id)).size, 1);
  });
});

describe('Matching, droits et administration (§30, §31, §35, §38)', () => {
  let env: TestEnv;
  let admin: { id: string; token: string };
  let moderator: { token: string };
  let a: { id: string; token: string };
  let b: { id: string; token: string };

  before(async () => {
    env = await startEnv();
    admin = await createUser(env, { roles: ['SUPER_ADMIN'] });
    await setRates(env, admin.token);
    moderator = await createUser(env, { roles: ['MODERATOR'] });
    a = await createUser(env);
    b = await createUser(env);
    await env.api('PUT', '/admin/settings', { token: admin.token, body: { settings: { 'matching.alert_threshold': 2 } } });
  });
  after(async () => env.close());
  beforeEach(() => env.app.rateLimiter.reset());

  it('matching : modération, un seul intérêt par utilisateur, alerte au seuil sans création automatique', async () => {
    const created = await env.api('POST', '/matching', { token: a.token, body: { title: 'Je recherche des panneaux solaires 550W', desiredQuantity: 40 } });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'PENDING_REVIEW');
    const id = created.body.id;
    assert.equal((await env.api('GET', '/matching', { token: b.token })).body.items.length, 0, 'invisible avant modération');
    assert.equal((await env.api('POST', `/matching/${id}/interest`, { token: b.token, body: {} })).body.error.code, 'MATCHING_NOT_PUBLISHED');

    assert.equal((await env.api('POST', `/admin/matching/${id}/moderate`, { token: a.token, body: { decision: 'PUBLISH' } })).status, 403);
    assert.equal((await env.api('POST', `/admin/matching/${id}/moderate`, { token: moderator.token, body: { decision: 'PUBLISH' } })).status, 200);
    assert.equal((await env.api('GET', '/matching', { token: b.token })).body.items.length, 1);

    // §47 : une seule fois par utilisateur
    const first = await env.api('POST', `/matching/${id}/interest`, { token: b.token, body: { quantity: 12 } });
    assert.equal(first.status, 201);
    assert.equal(first.body.interestCount, 1);
    const second = await env.api('POST', `/matching/${id}/interest`, { token: b.token, body: { quantity: 99 } });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'MATCHING_ALREADY_INTERESTED');
    const burst = await Promise.all(Array.from({ length: 5 }, () => env.api('POST', `/matching/${id}/interest`, { token: a.token, body: {} })));
    assert.equal(burst.filter((r) => r.status === 201).length, 1, 'cinq clics simultanés : un seul intérêt');
    const row = await env.app.db.one(`SELECT interest_count, total_quantity FROM matching_requests WHERE id = $1`, [id]);
    assert.deepEqual([row!.interest_count, row!.total_quantity], [2, 12]);
    assert.equal((await env.api('GET', '/matching', { token: b.token })).body.items[0].interested, true);

    // Seuil (2) atteint : l'administration est alertée, une seule fois, et rien n'est créé automatiquement
    const c = await createUser(env);
    await env.api('POST', `/matching/${id}/interest`, { token: c.token, body: {} });
    const alerts = await env.api('GET', '/me/notifications', { token: admin.token });
    assert.equal(alerts.body.items.filter((n: any) => n.type === 'MATCHING_THRESHOLD').length, 1);
    assert.equal((await env.app.db.one(`SELECT count(*)::int AS n FROM group_deals`))!.n, 0);
    assert.equal((await env.app.db.one(`SELECT count(*)::int AS n FROM orders`))!.n, 0);

    // L'administration décide : elle crée la campagne et la rattache ; les intéressés sont prévenus
    const cat = await createCatalog(env, admin.token);
    assert.equal((await env.api('POST', `/admin/matching/${id}/convert`, { token: moderator.token, body: { dealId: cat.dealId } })).status, 403);
    assert.equal((await env.api('POST', `/admin/matching/${id}/convert`, { token: admin.token, body: { dealId: cat.dealId } })).status, 200);
    const item = (await env.api('GET', '/matching', { token: b.token })).body.items[0];
    assert.equal(item.status, 'CONVERTED');
    assert.equal(item.dealSlug, cat.dealSlug);
    const bNotifs = await env.api('GET', '/me/notifications', { token: b.token });
    assert.ok(bNotifs.body.items.some((n: any) => n.type === 'MATCHING_CONVERTED'));

    // Retrait d'intérêt
    const m2 = await env.api('POST', '/matching', { token: a.token, body: { title: 'Cahiers scolaires 200 pages' } });
    await env.api('POST', `/admin/matching/${m2.body.id}/moderate`, { token: moderator.token, body: { decision: 'PUBLISH' } });
    await env.api('POST', `/matching/${m2.body.id}/interest`, { token: b.token, body: { quantity: 5 } });
    await env.api('DELETE', `/matching/${m2.body.id}/interest`, { token: b.token });
    assert.equal((await env.app.db.one(`SELECT interest_count FROM matching_requests WHERE id = $1`, [m2.body.id]))!.interest_count, 0);
    const rejected = await env.api('POST', '/matching', { token: a.token, body: { title: 'Produit interdit à la vente' } });
    assert.equal((await env.api('POST', `/admin/matching/${rejected.body.id}/moderate`, { token: moderator.token, body: { decision: 'REJECT' } })).status, 400, 'motif obligatoire');
    assert.equal((await env.api('POST', `/admin/matching/${rejected.body.id}/moderate`, { token: moderator.token, body: { decision: 'REJECT', reason: 'Hors catalogue' } })).status, 200);
  });

  it('RBAC : chaque route d’administration refuse un simple client (403) et un visiteur (401)', async () => {
    const adminRoutes = env.app.router.routes.filter((r) => r.pattern.startsWith('/admin') || r.pattern.startsWith('/agent'));
    assert.ok(adminRoutes.length > 60, `${adminRoutes.length} routes protégées`);
    for (const route of adminRoutes) {
      assert.ok(route.opts.permission, `${route.method} ${route.pattern} doit exiger une permission`);
      const path = route.pattern.replace(/:(\w+)/g, '00000000-0000-0000-0000-000000000000');
      const asCustomer = await env.api(route.method, path, { token: a.token, body: route.method === 'GET' || route.method === 'DELETE' ? undefined : {} });
      assert.equal(asCustomer.status, 403, `${route.method} ${route.pattern} (client)`);
      const anonymous = await env.api(route.method, path, { body: route.method === 'GET' || route.method === 'DELETE' ? undefined : {} });
      assert.equal(anonymous.status, 401, `${route.method} ${route.pattern} (visiteur)`);
      env.app.rateLimiter.reset();
    }
  });

  it('RBAC : périmètre de chaque rôle du personnel', async () => {
    const finance = await createUser(env, { roles: ['FINANCE_MANAGER'] });
    const logistics = await createUser(env, { roles: ['LOGISTICS_MANAGER'] });
    const plain = await createUser(env, { roles: ['ADMIN'] });
    const check = async (token: string, method: string, path: string, expected: number, body?: unknown) =>
      assert.equal((await env.api(method, path, { token, body })).status, expected, `${method} ${path}`);
    // Finance : paiements oui, catalogue non
    await check(finance.token, 'GET', '/admin/payments', 200);
    await check(finance.token, 'GET', '/admin/refunds', 200);
    await check(finance.token, 'POST', '/admin/categories', 403, { name: 'X' });
    // Logistique : expéditions oui, paiements non
    await check(logistics.token, 'GET', '/admin/shipments', 200);
    await check(logistics.token, 'GET', '/admin/payments', 403);
    // Modération : catalogue et matching, pas les utilisateurs ni les prix
    await check(moderator.token, 'GET', '/admin/matching', 200);
    await check(moderator.token, 'GET', '/admin/users', 403);
    await check(moderator.token, 'PUT', '/admin/products/00000000-0000-0000-0000-000000000000/shipping-rates', 403, { rates: [] });
    // Admin : gestion opérationnelle, mais ni rôles, ni réglages, ni suppression de catégorie
    await check(plain.token, 'GET', '/admin/users', 200);
    await check(plain.token, 'PUT', `/admin/users/${a.id}/roles`, 403, { roles: ['ADMIN'] });
    await check(plain.token, 'GET', '/admin/settings', 403);
    await check(plain.token, 'DELETE', '/admin/categories/00000000-0000-0000-0000-000000000000', 403);
  });

  it('élévation de privilèges : un client ne peut pas se donner un rôle, ni par l’inscription ni par son profil', async () => {
    const reg = await env.api('POST', '/auth/register', {
      body: { firstName: 'X', lastName: 'Y', countryCode: 'CM', email: 'escalade@test.local', whatsapp: '+237600000099', password: 'Motdepasse2026', roles: ['SUPER_ADMIN'], role: 'ADMIN' },
    });
    assert.deepEqual(reg.body.user.roles, ['CUSTOMER']);
    const patch = await env.api('PATCH', '/me', { token: reg.body.accessToken, body: { roles: ['SUPER_ADMIN'], status: 'ACTIVE', emailVerified: true } });
    assert.deepEqual(patch.body.user.roles, ['CUSTOMER']);
    assert.equal(patch.body.user.emailVerified, false);
    assert.equal((await env.api('GET', '/admin/dashboard', { token: reg.body.accessToken })).status, 403);
  });

  it('attribution d’un rôle par le super-admin : effective, journalisée, et les anciennes sessions sont fermées', async () => {
    const u = await createUser(env);
    assert.equal((await env.api('PUT', `/admin/users/${u.id}/roles`, { token: admin.token, body: { roles: ['FINANCE_MANAGER'] } })).status, 200);
    assert.equal((await env.api('GET', '/me', { token: u.token })).status, 401);
    const login = await env.api('POST', '/auth/login', { body: { email: u.email, password: 'Motdepasse2026' } });
    assert.equal((await env.api('GET', '/admin/payments', { token: login.body.accessToken })).status, 200);
    const logs = await env.api('GET', `/admin/audit-logs?action=user.roles&entityId=${u.id}`, { token: admin.token });
    assert.deepEqual(logs.body.items[0].after.roles, ['CUSTOMER', 'FINANCE_MANAGER']);
  });

  it('compte suspendu : plus aucun accès', async () => {
    const u = await createUser(env);
    await env.api('PATCH', `/admin/users/${u.id}`, { token: admin.token, body: { status: 'SUSPENDED' } });
    assert.equal((await env.api('GET', '/me', { token: u.token })).status, 401);
    assert.equal((await env.api('POST', '/auth/login', { body: { email: u.email, password: 'Motdepasse2026' } })).status, 403);
  });

  it('injection SQL et balises dans les champs : stockées comme du texte, sans effet', async () => {
    const evil = `Robert'); DROP TABLE users; --`;
    const xss = `<script>alert(1)</script> panneaux`;
    const m = await env.api('POST', '/matching', { token: a.token, body: { title: xss, description: evil } });
    assert.equal(m.status, 201);
    const search = await env.api('GET', `/group-deals?q=${encodeURIComponent(`' OR '1'='1`)}`, { token: a.token });
    assert.equal(search.status, 200);
    assert.equal(search.body.items.length, 0);
    const like = await env.api('GET', `/group-deals?q=${encodeURIComponent('%')}`, { token: a.token });
    assert.equal(like.body.items.length, 0, 'le joker % est neutralisé');
    const stored = await env.app.db.one(`SELECT title, description FROM matching_requests WHERE id = $1`, [m.body.id]);
    assert.equal(stored!.title, xss);
    assert.equal(stored!.description, evil);
    assert.ok((await env.app.db.one(`SELECT count(*)::int AS n FROM users`))!.n > 0);
    const res = await env.api('GET', '/matching/mine', { token: a.token });
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  it('identifiant mal formé : 404, pas d’erreur serveur', async () => {
    assert.equal((await env.api('GET', '/orders/pas-un-uuid', { token: a.token })).status, 404);
    assert.equal((await env.api('GET', '/group-deals/inconnu', { token: a.token })).status, 404);
    assert.equal((await env.api('GET', `/admin/orders/1'--`, { token: admin.token })).status, 404);
  });

  it('catégories : création, modification, ordre, désactivation ; suppression réservée au super-admin', async () => {
    // Les quinze catégories livrées : les six d'origine, puis six, puis trois ajoutées ensuite.
    const delivered = (await env.api('GET', '/categories')).body.categories.map((c: any) => c.slug);
    assert.deepEqual(delivered, ['mode-homme', 'mode-femme', 'mode-enfant', 'papier', 'energie-solaire', 'gadgets', 'meubles', 'auto-motos', 'electronique', 'extensions', 'menage', 'electromenager', 'materiaux-construction', 'agro-alimentaire', 'abonnements']);
    const created = await env.api('POST', '/admin/categories', { token: moderator.token, body: { name: 'Jouets éducatifs', description: 'Jeux et jouets', sortOrder: 20 } });
    assert.equal(created.status, 201);
    const list = (await env.api('GET', '/admin/categories', { token: moderator.token })).body.categories;
    assert.equal(list.length, 16);
    const mine = list.find((c: any) => c.id === created.body.id);
    assert.equal(mine.slug, 'jouets-educatifs');
    await env.api('PUT', `/admin/categories/${mine.id}`, { token: moderator.token, body: { name: 'Jouets éducatifs', isActive: false, sortOrder: 20 } });
    assert.equal((await env.api('GET', '/categories')).body.categories.length, 15, 'une catégorie désactivée disparaît du site');
    const ids = list.map((c: any) => c.id).reverse();
    await env.api('POST', '/admin/categories/reorder', { token: moderator.token, body: { ids } });
    assert.equal((await env.api('GET', '/admin/categories', { token: moderator.token })).body.categories[0].id, ids[0]);
    assert.equal((await env.api('DELETE', `/admin/categories/${mine.id}`, { token: moderator.token })).status, 403);
    assert.equal((await env.api('DELETE', `/admin/categories/${mine.id}`, { token: admin.token })).status, 204);
    const used = list.find((c: any) => c.productsCount > 0);
    assert.equal((await env.api('DELETE', `/admin/categories/${used.id}`, { token: admin.token })).status, 409, 'catégorie non vide');
  });

  it('tableau de bord et statistiques : chiffres cohérents avec les commandes payées', async () => {
    const cat = await createCatalog(env, admin.token);
    const o = (await participate(env, a.token, cat.dealId, 20)).body.order;
    await payOnline(env, a.token, o.id);
    await env.api('POST', '/analytics/events', { body: { type: 'deal_view', entityType: 'deal', entityId: cat.dealId } });
    const dash = await env.api('GET', '/admin/dashboard', { token: admin.token });
    assert.equal(dash.body.counts.paidOrders, 1);
    assert.equal(dash.body.revenue.total.amount, 230_000);
    assert.equal(dash.body.revenue.total.currency, 'XAF');
    assert.equal(dash.body.byCountry[0].country.code, 'CM');
    assert.equal(dash.body.series.length, 30);
    assert.equal(dash.body.series.at(-1).amount, 230_000);
    const stats = await env.api('GET', '/admin/analytics?days=7', { token: admin.token });
    assert.equal(stats.body.paidOrders, 1);
    assert.equal(stats.body.averageBasket.amount, 230_000);
    assert.equal(stats.body.funnel.dealViews, 1);
    assert.equal(stats.body.funnel.ordersPaid, 1);
    assert.equal(stats.body.topViewed[0].views, 1);
  });

  it('journal d’audit : en ajout seul, même pour le compte de la base', async () => {
    await assert.rejects(env.app.db.query(`UPDATE audit_logs SET action = 'x'`), /ajout seul/);
    await assert.rejects(env.app.db.query(`DELETE FROM audit_logs`), /ajout seul/);
  });

  it('langues : activer une langue et saisir ses textes sans toucher au code (§34)', async () => {
    await env.app.db.query(`INSERT INTO translations (language_code, key, value) VALUES ('fr', 'nav.home', 'Accueil'), ('fr', 'nav.deals', 'Deals') ON CONFLICT DO NOTHING`);
    await env.api('PATCH', '/admin/languages/sw', { token: admin.token, body: { isActive: false } });
    assert.equal((await env.api('GET', '/i18n/sw')).status, 404, 'langue inactive');
    assert.ok(!(await env.api('GET', '/languages')).body.languages.some((l: any) => l.code === 'sw'), 'une langue inactive quitte le sélecteur');
    await env.api('PATCH', '/admin/languages/sw', { token: admin.token, body: { isActive: true } });
    assert.equal((await env.api('GET', '/i18n/sw')).body.language.translated, 0, 'aucun texte traduit pour l’instant');
    await env.api('PUT', '/admin/translations/sw', { token: admin.token, body: { entries: { 'nav.home': 'Nyumbani' } } });
    const sw = await env.api('GET', '/i18n/sw');
    assert.equal(sw.body.messages['nav.home'], 'Nyumbani');
    assert.equal(sw.body.messages['nav.deals'], 'Deals', 'clé non traduite : repli sur le français');
    assert.equal(sw.body.language.translated, 1, 'le compte des textes traduits suit la saisie');
    const ar = (await env.api('GET', '/admin/languages', { token: admin.token })).body.languages.find((l: any) => l.code === 'ar');
    assert.equal(ar.isRtl, true);
    assert.ok((await env.api('GET', '/languages')).body.languages.some((l: any) => l.code === 'sw'));
  });

  it('langues : le sélecteur propose toutes les langues officielles d’Afrique', async () => {
    const { languages } = (await env.api('GET', '/languages')).body;
    assert.equal(languages.length, 57);
    assert.deepEqual(languages.slice(0, 6).map((l: any) => l.code), ['fr', 'en', 'ar', 'pt', 'es', 'sw'], 'les plus répandues en tête');
    for (const code of ['am', 'zu', 'rw', 'mg', 'so', 'ti', 'zgh', 'nso', 'bm', 'sn', 'qph', 'crs']) assert.ok(languages.some((l: any) => l.code === code), code);
    assert.deepEqual(languages.filter((l: any) => l.isRtl).map((l: any) => l.code).sort(), ['ar', 'mey']);
    assert.ok(languages.find((l: any) => l.code === 'fr').translated > 0);
    // Une langue sans traduction se choisit quand même : ses textes arrivent en français.
    await env.app.db.query(`INSERT INTO translations (language_code, key, value) VALUES ('fr', 'nav.deals', 'Deals') ON CONFLICT DO NOTHING`);
    const nso = await env.api('GET', '/i18n/nso');
    assert.equal(nso.status, 200);
    assert.equal(nso.body.language.translated, 0);
    assert.equal(nso.body.messages['nav.deals'], 'Deals');
    // Les codes à trois lettres passent par l'en-tête Accept-Language ; une variante régionale vaut la langue.
    const home = await env.api('GET', '/home', { headers: { 'accept-language': 'nso' } });
    assert.equal(home.status, 200);
    assert.equal((await env.api('GET', '/home', { headers: { 'accept-language': 'pt-BR,pt;q=0.9' } })).status, 200);
  });

  it('favoris et notifications', async () => {
    const cat = await createCatalog(env, admin.token);
    assert.equal((await env.api('PUT', `/me/favorites/${cat.productId}`, { token: b.token })).status, 200);
    await env.api('PUT', `/me/favorites/${cat.productId}`, { token: b.token });
    const favs = await env.api('GET', '/me/favorites', { token: b.token });
    assert.equal(favs.body.items.length, 1);
    assert.equal(favs.body.items[0].price.amount, 11_500);
    assert.equal((await env.api('GET', `/group-deals/${cat.dealId}`, { token: b.token })).body.deal.isFavorite, true);
    await env.api('DELETE', `/me/favorites/${cat.productId}`, { token: b.token });
    assert.equal((await env.api('GET', '/me/favorites', { token: b.token })).body.items.length, 0);

    const n = await env.api('GET', '/me/notifications', { token: b.token });
    assert.ok(n.body.unread > 0);
    assert.ok(n.body.items.some((x: any) => x.type === 'DEAL_NEW'), 'nouvelle offre annoncée aux membres des pays desservis');
    await env.api('POST', '/me/notifications/read', { token: b.token, body: {} });
    assert.equal((await env.api('GET', '/me/notifications', { token: b.token })).body.unread, 0);
  });

  it('envoi d’image : recompressée en WebP avec vignette ; fichier non-image refusé', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#FF4F79' } }).png().toBuffer();
    const up = await env.api('POST', '/admin/media', { token: admin.token, rawBody: png, headers: { 'Content-Type': 'image/png' } });
    assert.equal(up.status, 201);
    assert.match(up.body.url, /^\/media\/.+\.webp$/);
    const file = await fetch(env.base + up.body.url);
    assert.equal(file.headers.get('content-type'), 'image/webp');
    const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
    assert.equal(meta.width, 1600);
    const thumb = await sharp(Buffer.from(await (await fetch(env.base + up.body.thumbnailUrl)).arrayBuffer())).metadata();
    assert.deepEqual([thumb.width, thumb.height], [480, 480]);

    const fake = await env.api('POST', '/admin/media', { token: admin.token, rawBody: Buffer.from('<?php echo 1; ?>'), headers: { 'Content-Type': 'image/png' } });
    assert.equal(fake.status, 400);
    const exe = await env.api('POST', '/admin/media', { token: admin.token, rawBody: Buffer.from('MZ....'), headers: { 'Content-Type': 'application/x-msdownload' } });
    assert.equal(exe.status, 400);
    assert.equal((await fetch(`${env.base}/media/../../etc/passwd`)).status, 404);
  });

  it('médias d’un produit : dix photos et une vidéo au plus (carrousel de la page de l’offre)', async () => {
    const cat = await createCatalog(env, admin.token);
    const url = `/admin/products/${cat.productId}/media`;
    const photo = (n: number) => ({ kind: 'IMAGE', url: `/media/aa/photo-${n}.webp`, thumbnailUrl: `/media/aa/photo-${n}-thumb.webp`, alt: `Photo ${n}` });
    const video = (n: number) => ({ kind: 'VIDEO', url: `/media/aa/video-${n}.mp4`, thumbnailUrl: null, alt: 'Vidéo' });
    const photos = (n: number) => Array.from({ length: n }, (_, i) => photo(i + 1));

    const full = await env.api('PUT', url, { token: admin.token, body: { media: [...photos(10), video(1)] } });
    assert.equal(full.status, 200, 'dix photos et une vidéo : accepté');
    // La fiche de l'offre renvoie les onze médias, dans l'ordre choisi, la vidéo en dernier.
    const deal = await env.api('GET', `/group-deals/${cat.dealId}`, { token: b.token });
    const media = deal.body.deal.product.media;
    assert.equal(media.length, 11);
    assert.deepEqual(media.map((m: any) => m.kind), [...Array(10).fill('IMAGE'), 'VIDEO']);
    assert.equal(media[0].url, '/media/aa/photo-1.webp');

    const tooManyPhotos = await env.api('PUT', url, { token: admin.token, body: { media: photos(11) } });
    assert.equal(tooManyPhotos.status, 400);
    assert.equal(tooManyPhotos.body.error.details.fields[0].message, 'Dix photos au maximum par produit.');
    const twoVideos = await env.api('PUT', url, { token: admin.token, body: { media: [photo(1), video(1), video(2)] } });
    assert.equal(twoVideos.status, 400);
    assert.equal(twoVideos.body.error.details.fields[0].message, 'Une seule vidéo par produit.');
    // Un refus ne touche pas aux médias déjà enregistrés.
    assert.equal((await env.api('GET', `/group-deals/${cat.dealId}`, { token: b.token })).body.deal.product.media.length, 11);
  });
});
