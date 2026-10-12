/**
 * Vignette d'un produit pour les documents PDF (facture proforma, facture, reçu).
 *
 * Les images du site sont en WebP ou en SVG, que le format PDF n'accepte pas : la vignette est
 * convertie en JPEG, sur fond blanc. Elle est ensuite figée dans le document, comme le reste de
 * son contenu. Une image introuvable ou illisible ne bloque jamais l'émission d'un document.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { App } from '../app';

const SIDE = 144; // points d'image : net à l'impression pour une vignette de 46 pt
const cache = new Map<string, string | null>();

/** Fichier correspondant à l'adresse d'une image du site, ou null si elle n'est pas servie par ce serveur. */
function fileOf(app: App, url: string): string | null {
  const pathname = url.split(/[?#]/)[0];
  const [root, rel] = pathname.startsWith('/media/')
    ? [app.config.uploadsDir, pathname.slice('/media/'.length)]
    : [app.config.webDir, pathname];
  if (!root || !pathname.startsWith('/')) return null;
  const file = path.join(root, path.normalize(rel));
  return file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

/** La vignette en JPEG, codée en base64 ; null si l'image manque ou ne se lit pas. */
export async function productThumb(app: App, url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url)!;
  let out: string | null = null;
  try {
    const file = fileOf(app, url);
    if (file) {
      const sharp = (await import('sharp')).default;
      const buf = await sharp(file)
        .resize({ width: SIDE, height: SIDE, fit: 'contain', background: '#ffffff' })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82 })
        .toBuffer();
      out = buf.toString('base64');
    }
  } catch {
    out = null;
  }
  if (cache.size > 500) cache.clear();
  cache.set(url, out);
  return out;
}
