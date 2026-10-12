/**
 * Campagnes d'achat groupé (§11, §12).
 *
 * Le statut enregistré en base ne contient que les décisions humaines
 * (brouillon, publiée, confirmée, annulée). Les statuts qui dépendent du temps
 * ou des quantités (à venir, active, objectif atteint, expirée) sont DÉRIVÉS
 * ici, côté serveur, pour qu'aucun écran ne puisse afficher un état différent.
 */

import { DomainError } from './errors';

export type DealStatus =
  | 'DRAFT'
  | 'UPCOMING'
  | 'ACTIVE'
  | 'TARGET_REACHED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';

/** Ce qui est réellement stocké. */
export type StoredDealStatus = 'DRAFT' | 'PUBLISHED' | 'COMPLETED' | 'CANCELLED';

export interface DealState {
  storedStatus: StoredDealStatus;
  startsAt: Date;
  endsAt: Date;
  /** Objectif collectif, en unités de vente. */
  targetQuantity: number;
  /** Plafond éventuel de la campagne, en unités de vente. */
  maxQuantity: number | null;
  /** Quantités payées : seules celles-ci font avancer la jauge. */
  paidQuantity: number;
  /** Quantités retenues par des commandes en attente de paiement non expirées. */
  heldQuantity: number;
}

export function deriveDealStatus(deal: DealState, now: Date): DealStatus {
  if (deal.storedStatus !== 'PUBLISHED') return deal.storedStatus;
  if (now < deal.startsAt) return 'UPCOMING';
  const reached = deal.paidQuantity >= deal.targetQuantity;
  if (now >= deal.endsAt) return reached ? 'TARGET_REACHED' : 'EXPIRED';
  return reached ? 'TARGET_REACHED' : 'ACTIVE';
}

/** Quantité encore réservable (null = pas de plafond). */
export function remainingQuantity(deal: DealState): number | null {
  if (deal.maxQuantity === null) return null;
  return Math.max(0, deal.maxQuantity - deal.paidQuantity - deal.heldQuantity);
}

export function isOpenForParticipation(deal: DealState, now: Date): boolean {
  const status = deriveDealStatus(deal, now);
  if (status !== 'ACTIVE' && status !== 'TARGET_REACHED') return false;
  if (now >= deal.endsAt) return false;
  const remaining = remainingQuantity(deal);
  return remaining === null || remaining > 0;
}

export interface DealProgress {
  status: DealStatus;
  orderedQuantity: number;
  targetQuantity: number;
  /** Pourcentage réel, peut dépasser 100. */
  percent: number;
  /** Secondes restantes, calculées par le serveur (§12). */
  secondsRemaining: number;
  /** Secondes avant l'ouverture, si la campagne est à venir. */
  secondsUntilStart: number;
  open: boolean;
}

export function dealProgress(deal: DealState, now: Date): DealProgress {
  const percent =
    deal.targetQuantity > 0 ? Math.floor((deal.paidQuantity * 100) / deal.targetQuantity) : 0;
  return {
    status: deriveDealStatus(deal, now),
    orderedQuantity: deal.paidQuantity,
    targetQuantity: deal.targetQuantity,
    percent,
    secondsRemaining: Math.max(0, Math.floor((deal.endsAt.getTime() - now.getTime()) / 1000)),
    secondsUntilStart: Math.max(0, Math.floor((deal.startsAt.getTime() - now.getTime()) / 1000)),
    open: isOpenForParticipation(deal, now),
  };
}

/** Décision de l'administration à la fin d'une campagne (§51, point 4). */
export type DealEndDecision =
  | { type: 'EXTEND'; newEndsAt: Date }
  | { type: 'CONFIRM' }
  | { type: 'CANCEL'; reason: string };

export interface DealDecisionOutcome {
  storedStatus: StoredDealStatus;
  endsAt: Date;
  /** Les commandes payées doivent-elles passer en remboursement ? */
  refundPaidOrders: boolean;
  /** Une expédition doit-elle être ouverte pour chaque pays ? */
  openShipments: boolean;
}

/**
 * Aucun automatisme : si l'objectif n'est pas atteint, c'est l'administration qui
 * choisit entre prolonger, confirmer malgré tout, ou annuler et rembourser.
 */
export function applyDealDecision(
  deal: DealState,
  decision: DealEndDecision,
  now: Date,
): DealDecisionOutcome {
  if (deal.storedStatus !== 'PUBLISHED') {
    throw new DomainError('DEAL_NOT_ACTIVE', { storedStatus: deal.storedStatus });
  }
  switch (decision.type) {
    case 'EXTEND':
      if (decision.newEndsAt <= now || decision.newEndsAt <= deal.endsAt) {
        throw new DomainError('VALIDATION_FAILED', { field: 'newEndsAt' });
      }
      return {
        storedStatus: 'PUBLISHED',
        endsAt: decision.newEndsAt,
        refundPaidOrders: false,
        openShipments: false,
      };
    case 'CONFIRM':
      if (deal.paidQuantity < 1) {
        throw new DomainError('VALIDATION_FAILED', { reason: 'no_paid_order' });
      }
      return {
        storedStatus: 'COMPLETED',
        endsAt: deal.endsAt < now ? deal.endsAt : now,
        refundPaidOrders: false,
        openShipments: true,
      };
    case 'CANCEL':
      if (!decision.reason.trim()) {
        throw new DomainError('VALIDATION_FAILED', { field: 'reason' });
      }
      return {
        storedStatus: 'CANCELLED',
        endsAt: deal.endsAt,
        refundPaidOrders: deal.paidQuantity > 0,
        openShipments: false,
      };
  }
}
