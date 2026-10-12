/**
 * Remise d'un fichier à la personne (facture, reçu).
 *
 * Sur le site, c'est un téléchargement ordinaire du navigateur. La démonstration publiée s'affiche
 * dans un cadre qui ne peut pas télécharger seul : elle passe par l'hôte (window.claude), qui demande
 * confirmation à la personne avant d'enregistrer le fichier.
 */

import { DEMO } from './env';

interface HostDownloads {
  save(request: { filename: string; data: Blob }): Promise<{ status: string }>;
}

// Demandé dès le chargement : la réponse de l'hôte est prête quand on clique sur « Télécharger ».
const hostDownloads: Promise<HostDownloads | null> =
  DEMO && typeof window !== 'undefined' && typeof (window as any).claude?.use === 'function'
    ? ((window as any).claude.use('downloads') as Promise<HostDownloads | null>).catch(() => null)
    : Promise.resolve(null);

function browserDownload(filename: string, blob: Blob): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

/**
 * Issue d'une remise de fichier :
 * - « saved » : le fichier est parti vers le téléchargement ;
 * - « declined » : la personne a refusé l'enregistrement ;
 * - « unsure » : la démonstration est affichée dans un cadre qui n'a pas le droit d'enregistrer des
 *   fichiers ; le téléchargement a été tenté, sans moyen de savoir s'il a abouti.
 */
export type SaveOutcome = 'saved' | 'declined' | 'unsure';

/** La démonstration est-elle affichée à l'intérieur d'une autre page ? */
function framed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export async function saveFile(filename: string, blob: Blob): Promise<SaveOutcome> {
  const host = await hostDownloads;
  if (host) {
    try {
      await host.save({ filename, data: blob });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === 'declined' || code === 'rate_limited') return 'declined';
      // Enregistrement impossible par l'hôte : on tente le téléchargement ordinaire.
    }
  }
  browserDownload(filename, blob);
  return DEMO && framed() ? 'unsure' : 'saved';
}

/** Message à afficher après une remise de fichier, ou null s'il n'y a rien à dire (refus). */
export function saveMessage(outcome: SaveOutcome, saved: string): string | null {
  if (outcome === 'saved') return saved;
  if (outcome === 'unsure') return UNSURE;
  return null;
}
/** Marque un texte à traduire (relevé par scripts/i18n.mjs). */
const N_ = (s: string): string => s;
const UNSURE = N_('Démonstration : si le PDF ne s’est pas enregistré, c’est que cette page n’y est pas autorisée. Sur le site réel, il se télécharge ici.');
