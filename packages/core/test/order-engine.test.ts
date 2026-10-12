import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_CURRENCIES,
  ExpectedPayment,
  ParticipationInput,
  applyDealDecision,
  assertCanParticipate,
  assertPaymentMethodAllowed,
  canTransitionPayment,
  canTransitionReservation,
  dealProgress,
  decidePayment,
  deriveDealStatus,
  formatInvoiceNumber,
  formatOrderNumber,
  isOfficePaymentEligible,
  paymentDeadline,
  totalPieces,
} from '../src';
import { NOW, codeOf, ctx, deal } from './fixtures';

const participation = (overrides: Partial<ParticipationInput> = {}): ParticipationInput => ({
  authenticated: true,
  emailVerified: true,
  requireVerifiedEmail: true,
  quantity: 10,
  moq: 10,
  maxPerOrder: null,
  deal: deal(),
  now: NOW,
  ...overrides,
});

describe('Order Engine — MOQ (§14, §47)', () => {
  it('MOQ = 10, quantité = 9 : commande refusée', () => {
    assert.equal(codeOf(() => assertCanParticipate(participation({ quantity: 9 }))), 'QUANTITY_BELOW_MOQ');
  });

  it('MOQ = 10, quantité = 10 : commande acceptée', () => {
    assert.equal(codeOf(() => assertCanParticipate(participation({ quantity: 10 }))), null);
  });

  it('quantité non entière, nulle ou négative refusée', () => {
    for (const quantity of [0, -5, 10.5, Number.NaN]) {
      assert.equal(codeOf(() => assertCanParticipate(participation({ quantity }))), 'QUANTITY_INVALID');
    }
  });

  it('quantité maximale par commande', () => {
    assert.equal(
      codeOf(() => assertCanParticipate(participation({ quantity: 51, maxPerOrder: 50 }))),
      'QUANTITY_ABOVE_MAX',
    );
  });

  it('lot, carton, palette : la quantité s’exprime en unités de vente', () => {
    assert.equal(totalPieces(3, { saleUnit: 'CARTON', piecesPerSaleUnit: 24 }), 72);
  });
});

describe('Order Engine — contrôles de participation (§20)', () => {
  it('utilisateur non connecté', () => {
    assert.equal(codeOf(() => assertCanParticipate(participation({ authenticated: false }))), 'AUTH_REQUIRED');
  });

  it('email non vérifié', () => {
    assert.equal(
      codeOf(() => assertCanParticipate(participation({ emailVerified: false }))),
      'AUTH_EMAIL_NOT_VERIFIED',
    );
  });

  it('campagne en brouillon, à venir ou annulée', () => {
    const cases = [
      deal({ storedStatus: 'DRAFT' }),
      deal({ startsAt: new Date('2026-11-01T00:00:00Z'), endsAt: new Date('2026-11-20T00:00:00Z') }),
      deal({ storedStatus: 'CANCELLED' }),
    ];
    for (const d of cases) {
      assert.equal(codeOf(() => assertCanParticipate(participation({ deal: d }))), 'DEAL_NOT_ACTIVE');
    }
  });

  it('campagne expirée', () => {
    const expired = deal({ endsAt: new Date('2026-10-03T00:00:00Z') });
    assert.equal(codeOf(() => assertCanParticipate(participation({ deal: expired }))), 'DEAL_EXPIRED');
  });

  it('objectif atteint mais date dépassée : fermée', () => {
    const closed = deal({ endsAt: new Date('2026-10-03T00:00:00Z'), paidQuantity: 1000 });
    assert.equal(codeOf(() => assertCanParticipate(participation({ deal: closed }))), 'DEAL_EXPIRED');
  });

  it('objectif atteint avant la fin : toujours ouverte', () => {
    const reached = deal({ paidQuantity: 1200 });
    assert.equal(deriveDealStatus(reached, NOW), 'TARGET_REACHED');
    assert.equal(codeOf(() => assertCanParticipate(participation({ deal: reached }))), null);
  });

  it('les commandes en attente retiennent des quantités : pas de survente', () => {
    const d = deal({ maxQuantity: 500, paidQuantity: 400, heldQuantity: 80 });
    assert.equal(
      codeOf(() => assertCanParticipate(participation({ deal: d, quantity: 21 }))),
      'QUANTITY_NOT_AVAILABLE',
    );
    assert.equal(codeOf(() => assertCanParticipate(participation({ deal: d, quantity: 20 }))), null);
  });

  it('campagne complète', () => {
    const d = deal({ maxQuantity: 500, paidQuantity: 500 });
    assert.equal(codeOf(() => assertCanParticipate(participation({ deal: d }))), 'DEAL_SOLD_OUT');
  });
});

describe('Campagnes — statut et progression (§11, §12)', () => {
  it('la jauge ne compte que les quantités payées', () => {
    const p = dealProgress(deal({ paidQuantity: 250, heldQuantity: 600 }), NOW);
    assert.equal(p.orderedQuantity, 250);
    assert.equal(p.percent, 25);
    assert.equal(p.status, 'ACTIVE');
  });

  it('le compte à rebours vient du serveur', () => {
    const p = dealProgress(deal({ endsAt: new Date('2026-10-04T13:00:00Z') }), NOW);
    assert.equal(p.secondsRemaining, 3600);
  });

  it('fin de campagne sans objectif : expirée, en attente de décision', () => {
    const d = deal({ endsAt: new Date('2026-10-03T00:00:00Z') });
    assert.equal(deriveDealStatus(d, NOW), 'EXPIRED');
  });

  it('décision : prolonger', () => {
    const d = deal({ endsAt: new Date('2026-10-03T00:00:00Z') });
    const out = applyDealDecision(d, { type: 'EXTEND', newEndsAt: new Date('2026-10-30T00:00:00Z') }, NOW);
    assert.equal(out.storedStatus, 'PUBLISHED');
    assert.equal(out.refundPaidOrders, false);
    assert.equal(
      codeOf(() => applyDealDecision(d, { type: 'EXTEND', newEndsAt: new Date('2026-10-04T00:00:00Z') }, NOW)),
      'VALIDATION_FAILED',
    );
  });

  it('décision : confirmer malgré tout ouvre les expéditions', () => {
    const out = applyDealDecision(deal({ endsAt: new Date('2026-10-03T00:00:00Z') }), { type: 'CONFIRM' }, NOW);
    assert.equal(out.storedStatus, 'COMPLETED');
    assert.equal(out.openShipments, true);
  });

  it('décision : annuler rembourse les commandes payées et exige un motif', () => {
    const d = deal({ endsAt: new Date('2026-10-03T00:00:00Z') });
    const out = applyDealDecision(d, { type: 'CANCEL', reason: 'Objectif non atteint' }, NOW);
    assert.equal(out.storedStatus, 'CANCELLED');
    assert.equal(out.refundPaidOrders, true);
    assert.equal(codeOf(() => applyDealDecision(d, { type: 'CANCEL', reason: '  ' }, NOW)), 'VALIDATION_FAILED');
  });
});

describe('Paiement en bureau — seuil de 500 000 FCFA (§22, §47)', () => {
  it('499 999 FCFA : bureau indisponible', () => {
    assert.equal(isOfficePaymentEligible({ amount: 499_999, currency: 'XAF' }, ctx), false);
  });

  it('500 000 FCFA : bureau disponible', () => {
    assert.equal(isOfficePaymentEligible({ amount: 500_000, currency: 'XAF' }, ctx), true);
  });

  it('le serveur refuse le bureau sous le seuil, même si le client le demande', () => {
    assert.equal(
      codeOf(() => assertPaymentMethodAllowed('OFFICE', { amount: 499_999, currency: 'XAF' }, ctx)),
      'OFFICE_PAYMENT_NOT_ELIGIBLE',
    );
    assert.equal(
      codeOf(() => assertPaymentMethodAllowed('ONLINE', { amount: 100, currency: 'XAF' }, ctx)),
      null,
    );
  });

  it('autre devise : le total est converti en XAF avant comparaison', () => {
    // 500 000 XAF = 833,33 USD = 108 333,33 KES au taux de test
    assert.equal(isOfficePaymentEligible({ amount: 10_833_400, currency: 'KES' }, ctx), true);
    assert.equal(isOfficePaymentEligible({ amount: 10_833_200, currency: 'KES' }, ctx), false);
    // XOF à parité avec XAF
    assert.equal(isOfficePaymentEligible({ amount: 500_000, currency: 'XOF' }, ctx), true);
  });
});

describe('Numérotation et délais (§21, §24)', () => {
  it('numéro de commande GD-2026-00000125', () => {
    assert.equal(formatOrderNumber(2026, 125), 'GD-2026-00000125');
    assert.equal(formatInvoiceNumber('PROFORMA', 2026, 7), 'PF-2026-00000007');
  });

  it('30 minutes pour payer en ligne, 72 heures au bureau', () => {
    const end = new Date('2026-10-20T00:00:00Z');
    assert.equal(paymentDeadline('ONLINE', NOW, end).toISOString(), '2026-10-04T12:30:00.000Z');
    assert.equal(paymentDeadline('OFFICE', NOW, end).toISOString(), '2026-10-07T12:00:00.000Z');
  });

  it('une commande en ligne impayée ne retient rien après la fin de campagne', () => {
    const end = new Date('2026-10-04T12:10:00Z');
    assert.equal(paymentDeadline('ONLINE', NOW, end).toISOString(), end.toISOString());
  });

  it('transitions de statut interdites', () => {
    assert.equal(canTransitionPayment('PENDING', 'PAID'), true);
    assert.equal(canTransitionPayment('PAID', 'PENDING'), false);
    assert.equal(canTransitionPayment('EXPIRED', 'PAID'), false);
    assert.equal(canTransitionReservation('PENDING_PAYMENT', 'PAID'), true);
    assert.equal(canTransitionReservation('EXPIRED', 'PAID'), false);
  });
});

describe('Intégrité des paiements (§43)', () => {
  const XAF = DEFAULT_CURRENCIES.XAF;
  const expected = (o: Partial<ExpectedPayment> = {}): ExpectedPayment => ({
    reference: 'GD-2026-00000125-A1',
    amount: 230_000,
    currency: 'XAF',
    paymentStatus: 'PENDING',
    recordedProviderId: null,
    ...o,
  });
  const provider = (o = {}) => ({
    providerId: 'FLW-1',
    status: 'successful',
    reference: 'GD-2026-00000125-A1',
    amountMajor: 230_000,
    currency: 'XAF',
    ...o,
  });

  it('paiement vérifié, bon montant, bonne devise, bonne référence : confirmé', () => {
    assert.deepEqual(decidePayment(expected(), provider(), XAF), {
      outcome: 'CONFIRM',
      paidAmount: 230_000,
      overpaid: 0,
    });
  });

  it('montant inférieur : rejeté', () => {
    const d = decidePayment(expected(), provider({ amountMajor: 229_999 }), XAF);
    assert.deepEqual(d, { outcome: 'REJECT', error: 'PAYMENT_AMOUNT_MISMATCH' });
  });

  it('mauvaise devise : rejeté', () => {
    const d = decidePayment(expected(), provider({ currency: 'NGN' }), XAF);
    assert.deepEqual(d, { outcome: 'REJECT', error: 'PAYMENT_CURRENCY_MISMATCH' });
  });

  it('mauvaise référence : rejeté', () => {
    const d = decidePayment(expected(), provider({ reference: 'AUTRE' }), XAF);
    assert.deepEqual(d, { outcome: 'REJECT', error: 'PAYMENT_REFERENCE_MISMATCH' });
  });

  it('statut « failed » ou « pending » : jamais confirmé', () => {
    assert.equal(decidePayment(expected(), provider({ status: 'failed' }), XAF).outcome, 'FAILED');
    assert.equal(decidePayment(expected(), provider({ status: 'pending' }), XAF).outcome, 'PENDING');
  });

  it('même webhook reçu deux fois : aucun double traitement', () => {
    const paid = expected({ paymentStatus: 'PAID', recordedProviderId: 'FLW-1' });
    assert.deepEqual(decidePayment(paid, provider(), XAF), { outcome: 'ALREADY_PROCESSED' });
  });

  it('second paiement réel sur une commande déjà payée : à rembourser', () => {
    const paid = expected({ paymentStatus: 'PAID', recordedProviderId: 'FLW-1' });
    const d = decidePayment(paid, provider({ providerId: 'FLW-2' }), XAF);
    assert.deepEqual(d, { outcome: 'REFUND_REQUIRED', paidAmount: 230_000, reason: 'DUPLICATE_PAYMENT' });
  });

  it('paiement arrivé après expiration de la commande : à rembourser, pas confirmé', () => {
    const d = decidePayment(expected({ paymentStatus: 'EXPIRED' }), provider(), XAF);
    assert.deepEqual(d, { outcome: 'REFUND_REQUIRED', paidAmount: 230_000, reason: 'ORDER_CLOSED' });
  });

  it('devise à décimales : 12,50 USD attendu', () => {
    const usd = expected({ amount: 1_250, currency: 'USD' });
    const d = decidePayment(usd, provider({ amountMajor: 12.5, currency: 'USD' }), DEFAULT_CURRENCIES.USD);
    assert.equal(d.outcome, 'CONFIRM');
  });
});
