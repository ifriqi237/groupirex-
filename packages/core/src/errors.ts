/**
 * Catalogue des erreurs métier (§44 du cahier des charges).
 * Chaque erreur porte : un code interne stable, un statut HTTP, une clé de message
 * utilisateur (traduite côté client) et une action recommandée.
 */

export type ErrorAction =
  | 'RETRY'
  | 'RETRY_PAYMENT'
  | 'ADJUST_QUANTITY'
  | 'BROWSE_DEALS'
  | 'CHANGE_COUNTRY'
  | 'CONTACT_SUPPORT'
  | 'CHOOSE_ONLINE_PAYMENT'
  | 'CHOOSE_OTHER_OFFICE'
  | 'NEW_RESERVATION'
  | 'LOGIN'
  | 'NONE';

export interface ErrorDef {
  code: string;
  http: number;
  /** Message par défaut en français ; la clé i18n est `errors.<code>`. */
  message: string;
  action: ErrorAction;
}

const def = (code: string, http: number, message: string, action: ErrorAction): ErrorDef => ({
  code,
  http,
  message,
  action,
});

export const ERRORS = {
  // Authentification et droits
  AUTH_REQUIRED: def('AUTH_REQUIRED', 401, 'Connectez-vous pour continuer.', 'LOGIN'),
  AUTH_INVALID_CREDENTIALS: def('AUTH_INVALID_CREDENTIALS', 401, 'Email ou mot de passe incorrect.', 'RETRY'),
  AUTH_LOCKED: def('AUTH_LOCKED', 429, 'Trop de tentatives. Réessayez dans quelques minutes.', 'RETRY'),
  AUTH_2FA_REQUIRED: def('AUTH_2FA_REQUIRED', 401, 'Code de double authentification requis.', 'RETRY'),
  AUTH_2FA_INVALID: def('AUTH_2FA_INVALID', 401, 'Code de double authentification incorrect.', 'RETRY'),
  AUTH_EMAIL_TAKEN: def('AUTH_EMAIL_TAKEN', 409, 'Un compte existe déjà avec cet email.', 'LOGIN'),
  AUTH_EMAIL_NOT_VERIFIED: def('AUTH_EMAIL_NOT_VERIFIED', 403, 'Vérifiez votre email avant de commander.', 'NONE'),
  AUTH_TOKEN_INVALID: def('AUTH_TOKEN_INVALID', 401, 'Lien ou session expiré.', 'LOGIN'),
  FORBIDDEN: def('FORBIDDEN', 403, "Vous n'avez pas le droit d'effectuer cette action.", 'NONE'),

  // Générique
  NOT_FOUND: def('NOT_FOUND', 404, 'Élément introuvable.', 'NONE'),
  VALIDATION_FAILED: def('VALIDATION_FAILED', 400, 'Certaines informations sont invalides.', 'RETRY'),
  RATE_LIMITED: def('RATE_LIMITED', 429, 'Trop de requêtes. Patientez un instant.', 'RETRY'),
  CONFLICT: def('CONFLICT', 409, 'Cette opération a déjà été effectuée.', 'NONE'),

  // Campagnes et participation
  DEAL_NOT_ACTIVE: def('DEAL_NOT_ACTIVE', 409, "Cette offre n'est pas ouverte aux participations.", 'BROWSE_DEALS'),
  DEAL_EXPIRED: def('DEAL_EXPIRED', 409, 'Cette offre est terminée.', 'BROWSE_DEALS'),
  DEAL_NOT_IN_COUNTRY: def('DEAL_NOT_IN_COUNTRY', 403, "Cette campagne d'achat groupé n'est pas disponible dans votre pays. Découvrez les campagnes accessibles dans votre région.", 'BROWSE_DEALS'),
  DEAL_SOLD_OUT: def('DEAL_SOLD_OUT', 409, 'Toutes les quantités de cette offre sont réservées.', 'BROWSE_DEALS'),
  QUANTITY_BELOW_MOQ: def('QUANTITY_BELOW_MOQ', 422, 'La quantité est inférieure au minimum de commande.', 'ADJUST_QUANTITY'),
  QUANTITY_ABOVE_MAX: def('QUANTITY_ABOVE_MAX', 422, 'La quantité dépasse le maximum autorisé.', 'ADJUST_QUANTITY'),
  QUANTITY_NOT_AVAILABLE: def('QUANTITY_NOT_AVAILABLE', 409, 'La quantité demandée dépasse le stock restant.', 'ADJUST_QUANTITY'),
  QUANTITY_INVALID: def('QUANTITY_INVALID', 422, 'La quantité doit être un nombre entier positif.', 'ADJUST_QUANTITY'),
  VARIANT_REQUIRED: def('VARIANT_REQUIRED', 422, 'Choisissez une variante (taille, couleur…).', 'RETRY'),
  VARIANT_INVALID: def('VARIANT_INVALID', 422, "Cette variante n'existe pas pour ce produit.", 'RETRY'),

  // Prix
  COUNTRY_NOT_COVERED: def('COUNTRY_NOT_COVERED', 422, "Ce produit n'est pas proposé dans votre pays.", 'BROWSE_DEALS'),
  SHIPPING_RATE_MISSING: def('SHIPPING_RATE_MISSING', 422, "Ce produit n'est pas encore disponible dans votre pays.", 'CONTACT_SUPPORT'),
  FX_RATE_MISSING: def('FX_RATE_MISSING', 503, 'Le prix ne peut pas être calculé pour le moment.', 'CONTACT_SUPPORT'),
  FX_RATE_STALE: def('FX_RATE_STALE', 503, 'Le prix est en cours de mise à jour. Réessayez plus tard.', 'RETRY'),
  PRICE_CHANGED: def('PRICE_CHANGED', 409, 'Le prix a changé. Vérifiez le nouveau montant.', 'RETRY'),

  // Pays du compte
  COUNTRY_CHANGE_PENDING_ORDERS: def('COUNTRY_CHANGE_PENDING_ORDERS', 409, 'Payez ou annulez vos commandes en attente avant de changer de pays.', 'NONE'),
  COUNTRY_CHANGE_TOO_SOON: def('COUNTRY_CHANGE_TOO_SOON', 429, 'Vous avez déjà changé de pays récemment. Contactez le support pour un nouveau changement.', 'CONTACT_SUPPORT'),

  // Commandes et paiements
  ORDER_NOT_PAYABLE: def('ORDER_NOT_PAYABLE', 409, 'Cette commande ne peut plus être payée.', 'BROWSE_DEALS'),
  ORDER_EXPIRED: def('ORDER_EXPIRED', 409, 'Le délai de paiement est dépassé.', 'BROWSE_DEALS'),
  PAYMENT_FAILED: def('PAYMENT_FAILED', 402, "Le paiement n'a pas abouti.", 'RETRY_PAYMENT'),
  PAYMENT_INTERRUPTED: def('PAYMENT_INTERRUPTED', 402, 'Le paiement a été interrompu.', 'RETRY_PAYMENT'),
  PAYMENT_ALREADY_PROCESSED: def('PAYMENT_ALREADY_PROCESSED', 409, 'Ce paiement a déjà été enregistré.', 'NONE'),
  PAYMENT_AMOUNT_MISMATCH: def('PAYMENT_AMOUNT_MISMATCH', 409, 'Le montant reçu ne correspond pas à la commande.', 'CONTACT_SUPPORT'),
  PAYMENT_CURRENCY_MISMATCH: def('PAYMENT_CURRENCY_MISMATCH', 409, 'La devise reçue ne correspond pas à la commande.', 'CONTACT_SUPPORT'),
  PAYMENT_REFERENCE_MISMATCH: def('PAYMENT_REFERENCE_MISMATCH', 409, 'Référence de paiement inconnue.', 'CONTACT_SUPPORT'),
  PAYMENT_PROVIDER_UNAVAILABLE: def('PAYMENT_PROVIDER_UNAVAILABLE', 503, 'Le service de paiement est momentanément indisponible.', 'RETRY_PAYMENT'),
  WEBHOOK_SIGNATURE_INVALID: def('WEBHOOK_SIGNATURE_INVALID', 401, 'Signature invalide.', 'NONE'),

  // Bureaux locaux
  OFFICE_PAYMENT_NOT_ELIGIBLE: def('OFFICE_PAYMENT_NOT_ELIGIBLE', 422, 'Le paiement en bureau est réservé aux commandes à partir de 500 000 FCFA.', 'CHOOSE_ONLINE_PAYMENT'),
  OFFICE_NOT_AVAILABLE: def('OFFICE_NOT_AVAILABLE', 422, "Ce bureau n'est pas disponible dans votre pays.", 'CHOOSE_OTHER_OFFICE'),
  OFFICE_CLOSED: def('OFFICE_CLOSED', 409, 'Ce bureau est fermé.', 'CHOOSE_OTHER_OFFICE'),
  RESERVATION_EXPIRED: def('RESERVATION_EXPIRED', 409, 'Cette réservation a expiré.', 'NEW_RESERVATION'),
  RESERVATION_NOT_PAYABLE: def('RESERVATION_NOT_PAYABLE', 409, 'Cette réservation ne peut plus être encaissée.', 'NONE'),
  RESERVATION_WRONG_OFFICE: def('RESERVATION_WRONG_OFFICE', 403, 'Cette réservation appartient à un autre bureau.', 'NONE'),

  // Logistique
  LOGISTICS_STEP_OUT_OF_ORDER: def('LOGISTICS_STEP_OUT_OF_ORDER', 409, "L'étape précédente n'est pas validée.", 'NONE'),
  LOGISTICS_OVERRIDE_REASON_REQUIRED: def('LOGISTICS_OVERRIDE_REASON_REQUIRED', 422, 'Un motif est obligatoire pour forcer une étape.', 'NONE'),
  LOGISTICS_STEP_INVALID: def('LOGISTICS_STEP_INVALID', 422, 'Étape logistique inconnue.', 'NONE'),

  // Matching
  MATCHING_ALREADY_INTERESTED: def('MATCHING_ALREADY_INTERESTED', 409, 'Vous avez déjà signalé votre intérêt pour cette demande.', 'NONE'),
  MATCHING_NOT_PUBLISHED: def('MATCHING_NOT_PUBLISHED', 409, "Cette demande n'est pas publiée.", 'NONE'),
} as const satisfies Record<string, ErrorDef>;

export type ErrorCode = keyof typeof ERRORS;

/** Erreur métier : levée par les moteurs, traduite en réponse HTTP par l'API. */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly http: number;
  readonly action: ErrorAction;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, details?: Record<string, unknown>) {
    const d: ErrorDef = ERRORS[code];
    super(d.message);
    this.name = 'DomainError';
    this.code = code;
    this.http = d.http;
    this.action = d.action;
    this.details = details;
  }
}
