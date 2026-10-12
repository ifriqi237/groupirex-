/**
 * LOGISTICS ENGINE (§28, §29, §47, §52).
 *
 * Les étapes 1 à 7 se pilotent au niveau de l'EXPÉDITION (une campagne × un pays
 * de destination) : une seule mise à jour fait avancer toutes les commandes du lot.
 * Les étapes 8 et 9 se pilotent commande par commande, au bureau de retrait.
 */

import { DomainError } from './errors';

export const LOGISTICS_STEPS = [
  { step: 1, code: 'ORDER_PLACED', scope: 'SHIPMENT', label: 'Commande actionnée' },
  { step: 2, code: 'PRODUCTION_DONE', scope: 'SHIPMENT', label: 'Production terminée' },
  { step: 3, code: 'HANDED_TO_FORWARDER', scope: 'SHIPMENT', label: 'Colis transmis au transitaire' },
  { step: 4, code: 'DEPARTED_ORIGIN', scope: 'SHIPMENT', label: "Colis ayant quitté le pays d'origine" },
  { step: 5, code: 'VESSEL_IN_TRANSIT', scope: 'SHIPMENT', label: 'Position du bateau' },
  { step: 6, code: 'ARRIVED_PORT', scope: 'SHIPMENT', label: 'Colis au port de destination' },
  { step: 7, code: 'CUSTOMS_CLEARED', scope: 'SHIPMENT', label: 'Colis dédouanés' },
  { step: 8, code: 'READY_FOR_PICKUP', scope: 'ORDER', label: 'Colis disponible au retrait' },
  { step: 9, code: 'PICKED_UP', scope: 'ORDER', label: 'Retrait colis confirmé' },
] as const;

export type LogisticsStepCode = (typeof LOGISTICS_STEPS)[number]['code'];
export type LogisticsScope = 'SHIPMENT' | 'ORDER';

export const FIRST_STEP = 1;
export const LAST_SHIPMENT_STEP = 7;
export const LAST_STEP = 9;

export function stepInfo(step: number) {
  const info = LOGISTICS_STEPS[step - 1];
  if (!info || !Number.isInteger(step)) throw new DomainError('LOGISTICS_STEP_INVALID', { step });
  return info;
}

export interface AdvanceRequest {
  /** Dernière étape validée (0 = aucune). */
  currentStep: number;
  targetStep: number;
  scope: LogisticsScope;
  /** Intervention administrative : saut d'étape ou retour en arrière. */
  override?: { permitted: boolean; reason?: string };
}

export interface AdvancePlan {
  newStep: number;
  /** Étapes sautées, à enregistrer comme telles dans l'historique. */
  skippedSteps: number[];
  overridden: boolean;
  /** Motif à écrire dans le journal d'audit quand `overridden` est vrai. */
  overrideReason: string | null;
}

/**
 * Règle du §47 : une étape ne peut être validée que si la précédente l'est.
 * Seule exception : une intervention administrative autorisée, motivée et journalisée.
 */
export function planAdvance(req: AdvanceRequest): AdvancePlan {
  const target = stepInfo(req.targetStep);
  if (req.currentStep < 0 || req.currentStep > LAST_STEP || !Number.isInteger(req.currentStep)) {
    throw new DomainError('LOGISTICS_STEP_INVALID', { step: req.currentStep });
  }
  if (target.scope !== req.scope) {
    throw new DomainError('LOGISTICS_STEP_INVALID', { step: req.targetStep, scope: req.scope });
  }
  if (req.targetStep === req.currentStep) {
    throw new DomainError('CONFLICT', { step: req.targetStep });
  }

  if (req.targetStep === req.currentStep + 1) {
    return { newStep: req.targetStep, skippedSteps: [], overridden: false, overrideReason: null };
  }

  if (!req.override?.permitted) {
    throw new DomainError('LOGISTICS_STEP_OUT_OF_ORDER', {
      currentStep: req.currentStep,
      targetStep: req.targetStep,
    });
  }
  const reason = req.override.reason?.trim();
  if (!reason) throw new DomainError('LOGISTICS_OVERRIDE_REASON_REQUIRED');

  const skippedSteps: number[] = [];
  for (let s = req.currentStep + 1; s < req.targetStep; s++) skippedSteps.push(s);
  return { newStep: req.targetStep, skippedSteps, overridden: true, overrideReason: reason };
}

/**
 * Étape affichée au client pour une commande : celle de son expédition tant que
 * le lot n'est pas dédouané, puis celle de la commande elle-même (retrait).
 */
export function effectiveOrderStep(shipmentStep: number, orderStep: number): number {
  return Math.max(Math.min(shipmentStep, LAST_SHIPMENT_STEP), orderStep);
}

/** Une commande ne peut passer en « disponible au retrait » que si son lot est dédouané. */
export function assertOrderCanEnterPickup(shipmentStep: number, overridePermitted: boolean): void {
  if (shipmentStep < LAST_SHIPMENT_STEP && !overridePermitted) {
    throw new DomainError('LOGISTICS_STEP_OUT_OF_ORDER', { shipmentStep });
  }
}

/* ------------------------------------------------------------------ */
/* Étape 5 : suivi du navire (§29)                                     */
/* ------------------------------------------------------------------ */

export interface VesselPosition {
  latitude: number;
  longitude: number;
  /** Avancement du trajet, de 0 à 100. */
  progressPercent: number;
  eta: string | null;
  departurePort: string;
  arrivalPort: string;
  updatedAt: string;
  /** MANUAL = saisi par la logistique ; sinon nom du fournisseur de données. */
  source: 'MANUAL' | string;
}

/**
 * Port à implémenter pour brancher une API de suivi maritime.
 * La V1 livre une implémentation manuelle ; le reste du code ne change pas.
 */
export interface VesselTrackingProvider {
  readonly name: string;
  getPosition(ref: { vesselImo?: string; containerNumber?: string; billOfLading?: string }): Promise<VesselPosition | null>;
}
