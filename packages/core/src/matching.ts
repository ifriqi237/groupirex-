/**
 * Matching (§30, §31) : détection de la demande.
 * Le seuil ne crée JAMAIS de campagne ni de commande : il alerte l'administration,
 * qui garde la décision commerciale.
 */

export type MatchingStatus = 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'CONVERTED' | 'CLOSED';

const TRANSITIONS: Record<MatchingStatus, MatchingStatus[]> = {
  PENDING_REVIEW: ['PUBLISHED', 'REJECTED'],
  PUBLISHED: ['CONVERTED', 'CLOSED', 'REJECTED'],
  REJECTED: [],
  CONVERTED: [],
  CLOSED: [],
};

export function canTransitionMatching(from: MatchingStatus, to: MatchingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Vrai une seule fois : au moment où le compteur franchit le seuil. */
export function shouldAlertAdmin(
  interestCount: number,
  threshold: number,
  alreadyAlerted: boolean,
): boolean {
  return !alreadyAlerted && threshold > 0 && interestCount >= threshold;
}
