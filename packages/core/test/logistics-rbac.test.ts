import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LOGISTICS_STEPS,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  assertOrderCanEnterPickup,
  canTransitionMatching,
  effectiveOrderStep,
  hasPermission,
  isOfficeScoped,
  planAdvance,
  requiresTwoFactor,
  shouldAlertAdmin,
} from '../src';
import { codeOf } from './fixtures';

describe('Logistics Engine — 9 étapes (§28, §47)', () => {
  it('le référentiel compte 9 étapes, dans l’ordre du cahier des charges', () => {
    assert.equal(LOGISTICS_STEPS.length, 9);
    assert.deepEqual(LOGISTICS_STEPS.map((s) => s.step), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(LOGISTICS_STEPS[6].code, 'CUSTOMS_CLEARED');
  });

  it('avance d’une étape à la fois', () => {
    const plan = planAdvance({ currentStep: 6, targetStep: 7, scope: 'SHIPMENT' });
    assert.deepEqual(plan, { newStep: 7, skippedSteps: [], overridden: false, overrideReason: null });
  });

  it('impossible de passer à l’étape 7 si la 6 n’est pas validée', () => {
    assert.equal(
      codeOf(() => planAdvance({ currentStep: 5, targetStep: 7, scope: 'SHIPMENT' })),
      'LOGISTICS_STEP_OUT_OF_ORDER',
    );
  });

  it('sans la permission de forçage, un motif ne suffit pas', () => {
    assert.equal(
      codeOf(() =>
        planAdvance({
          currentStep: 5,
          targetStep: 7,
          scope: 'SHIPMENT',
          override: { permitted: false, reason: 'Urgent' },
        }),
      ),
      'LOGISTICS_STEP_OUT_OF_ORDER',
    );
  });

  it('forçage autorisé : motif obligatoire', () => {
    assert.equal(
      codeOf(() =>
        planAdvance({ currentStep: 5, targetStep: 7, scope: 'SHIPMENT', override: { permitted: true, reason: ' ' } }),
      ),
      'LOGISTICS_OVERRIDE_REASON_REQUIRED',
    );
  });

  it('forçage autorisé et motivé : passe, et marque ce qui doit être journalisé', () => {
    const plan = planAdvance({
      currentStep: 4,
      targetStep: 7,
      scope: 'SHIPMENT',
      override: { permitted: true, reason: 'Fret aérien, pas de navire' },
    });
    assert.deepEqual(plan, {
      newStep: 7,
      skippedSteps: [5, 6],
      overridden: true,
      overrideReason: 'Fret aérien, pas de navire',
    });
  });

  it('un retour en arrière est aussi un forçage', () => {
    assert.equal(
      codeOf(() => planAdvance({ currentStep: 6, targetStep: 5, scope: 'SHIPMENT' })),
      'LOGISTICS_STEP_OUT_OF_ORDER',
    );
  });

  it('les étapes 8 et 9 se valident sur la commande, pas sur l’expédition', () => {
    assert.equal(
      codeOf(() => planAdvance({ currentStep: 7, targetStep: 8, scope: 'SHIPMENT' })),
      'LOGISTICS_STEP_INVALID',
    );
    assert.equal(planAdvance({ currentStep: 7, targetStep: 8, scope: 'ORDER' }).newStep, 8);
    assert.equal(codeOf(() => planAdvance({ currentStep: 9, targetStep: 10, scope: 'ORDER' })), 'LOGISTICS_STEP_INVALID');
  });

  it('pas de retrait tant que le lot n’est pas dédouané', () => {
    assert.equal(codeOf(() => assertOrderCanEnterPickup(6, false)), 'LOGISTICS_STEP_OUT_OF_ORDER');
    assert.equal(codeOf(() => assertOrderCanEnterPickup(7, false)), null);
  });

  it('étape montrée au client : celle du lot, puis celle de sa commande', () => {
    assert.equal(effectiveOrderStep(4, 0), 4);
    assert.equal(effectiveOrderStep(7, 0), 7);
    assert.equal(effectiveOrderStep(7, 9), 9);
  });
});

describe('RBAC (§25, §38)', () => {
  it('le super-admin a toutes les permissions', () => {
    for (const p of PERMISSIONS) assert.equal(hasPermission(['SUPER_ADMIN'], p), true);
  });

  it('l’agent de bureau encaisse mais ne modifie ni prix, ni commande, ni livraison', () => {
    assert.equal(hasPermission(['OFFICE_AGENT'], 'office.payments.record'), true);
    for (const p of ['pricing.manage', 'orders.manage', 'catalog.manage', 'deals.manage', 'logistics.advance'] as const) {
      assert.equal(hasPermission(['OFFICE_AGENT'], p), false);
    }
  });

  it('seuls les rôles prévus peuvent forcer une étape logistique', () => {
    const allowed = ROLES.filter((r) => hasPermission([r], 'logistics.override'));
    assert.deepEqual(allowed, ['SUPER_ADMIN', 'ADMIN', 'LOGISTICS_MANAGER']);
  });

  it('la marge n’est visible que de la direction et de la finance', () => {
    const allowed = ROLES.filter((r) => hasPermission([r], 'margins.view'));
    assert.deepEqual(allowed, ['SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER']);
  });

  it('un client n’a aucune permission de back-office', () => {
    assert.deepEqual(ROLE_PERMISSIONS.CUSTOMER, []);
  });

  it('double authentification obligatoire pour tout le personnel', () => {
    assert.equal(requiresTwoFactor(['CUSTOMER']), false);
    for (const r of ROLES.filter((x) => x !== 'CUSTOMER')) assert.equal(requiresTwoFactor([r]), true);
  });

  it('les rôles de bureau sont limités à leur bureau', () => {
    assert.equal(isOfficeScoped(['OFFICE_AGENT']), true);
    assert.equal(isOfficeScoped(['OFFICE_MANAGER']), true);
    assert.equal(isOfficeScoped(['ADMIN']), false);
  });
});

describe('Matching (§30, §31)', () => {
  it('le seuil alerte l’administration une seule fois', () => {
    assert.equal(shouldAlertAdmin(49, 50, false), false);
    assert.equal(shouldAlertAdmin(50, 50, false), true);
    assert.equal(shouldAlertAdmin(51, 50, true), false);
  });

  it('une demande passe par la modération avant publication', () => {
    assert.equal(canTransitionMatching('PENDING_REVIEW', 'PUBLISHED'), true);
    assert.equal(canTransitionMatching('PENDING_REVIEW', 'CONVERTED'), false);
    assert.equal(canTransitionMatching('PUBLISHED', 'CONVERTED'), true);
  });
});
