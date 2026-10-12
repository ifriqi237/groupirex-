/**
 * Photos et vidéo d'un produit.
 *
 * La page d'une offre présente le produit dans un carrousel : jusqu'à dix photos et une vidéo.
 * La limite est la même dans le back-office (ce qu'on peut ajouter) et dans l'API (ce qu'elle accepte).
 */

export const PRODUCT_MEDIA_LIMITS = { photos: 10, videos: 1 } as const;

export type MediaProblem = 'TOO_MANY_PHOTOS' | 'TOO_MANY_VIDEOS';

/** Première limite dépassée par une liste de médias, ou null si la liste est acceptable. */
export function mediaProblem(media: readonly { kind: string }[]): MediaProblem | null {
  if (media.filter((m) => m.kind === 'IMAGE').length > PRODUCT_MEDIA_LIMITS.photos) return 'TOO_MANY_PHOTOS';
  if (media.filter((m) => m.kind === 'VIDEO').length > PRODUCT_MEDIA_LIMITS.videos) return 'TOO_MANY_VIDEOS';
  return null;
}
