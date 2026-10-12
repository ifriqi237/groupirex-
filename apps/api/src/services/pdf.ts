/**
 * Documents PDF (§26) : facture proforma, facture, reçu.
 *
 * Ce fichier ne dépend que de pdf-lib : la démonstration sans serveur (apps/web/src/demo/documents.ts)
 * réutilise le même rendu dans le navigateur, pour que les documents y soient identiques.
 *
 * Règle d'affichage du §16 : une ligne par produit, avec le prix unitaire FINAL.
 * Il n'existe aucune ligne « frais de livraison » sur un document client.
 */

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { qrMatrix } from '../lib/qr';

export interface InvoiceData {
  kind: 'PROFORMA' | 'INVOICE' | 'RECEIPT';
  number: string;
  issuedAt: string;
  /** Absent pour une proforma établie avant la commande (page « Votre commande »). */
  orderNumber: string | null;
  /** Proforma avant commande : l'offre concernée et sa date de clôture. */
  offer?: { title: string; validUntil: string | null };
  /** Mentions propres au document, déjà rédigées dans sa langue. */
  notes?: string[];
  /**
   * QR Code du document : il ramène à la commande (facture, reçu) ou à l'offre (proforma avant commande).
   * La proforma d'une réservation au bureau porte déjà le QR Code que lit l'agent : celui-ci n'y est pas ajouté.
   */
  qr?: { content: string; target: 'ORDER' | 'OFFER' };
  lang: string;
  customer: { name: string; email: string; whatsapp: string; country: string };
  currency: string;
  /** `image` : vignette du produit, en JPEG codé en base64 (figée dans le document à son émission). */
  lines: { name: string; variant: string | null; unit: string; quantity: number; unitPrice: string; total: string; image?: string | null }[];
  total: string;
  payment: { method: 'ONLINE' | 'OFFICE'; status: string; paidAt: string | null; channel: string | null };
  office: { name: string; city: string; address: string; phone: string | null } | null;
  reservation: { number: string; expiresAt: string; qrContent: string } | null;
  /** Identité légale du vendeur, figée à l'émission (pied de page). Absente des documents émis avant cette version. */
  seller?: string[];
}

export interface CompanyIdentity {
  legalName: string;
  legalForm: string;
  capital: string;
  address: string;
  rccm: string;
  taxId: string;
  phone: string;
  email: string;
}

/** Les lignes du pied de page : raison sociale, forme et capital, adresse, immatriculations, contact. Les champs vides sont omis. */
export function sellerLines(c: CompanyIdentity, lang: string): string[] {
  const en = lang === 'en';
  const join = (parts: string[]) => parts.filter((p) => p.trim()).join(' — ');
  return [
    join([c.legalName, c.legalForm, c.capital ? (en ? `share capital ${c.capital}` : `capital ${c.capital}`) : '', c.address]),
    join([c.rccm ? `RCCM ${c.rccm}` : '', c.taxId ? (en ? `Tax ID ${c.taxId}` : `NIU ${c.taxId}`) : '', c.phone, c.email]),
  ].filter(Boolean);
}

/** Unités de vente, telles qu'elles s'écrivent après une quantité. */
export const UNIT_LABELS: Record<string, Record<string, string>> = {
  fr: { UNIT: 'unité(s)', LOT: 'lot(s)', CARTON: 'carton(s)', PALLET: 'palette(s)' },
  en: { UNIT: 'unit(s)', LOT: 'lot(s)', CARTON: 'carton(s)', PALLET: 'pallet(s)' },
};

const NAVY = rgb(0x0d / 255, 0x1b / 255, 0x45 / 255);
const PINK = rgb(0xff / 255, 0x4f / 255, 0x79 / 255);
const GREEN = rgb(0x12 / 255, 0x8a / 255, 0x3e / 255);
const GREY = rgb(0.42, 0.45, 0.52);
const LINE = rgb(0.88, 0.9, 0.94);

const LABELS = {
  fr: {
    PROFORMA: 'FACTURE PROFORMA',
    INVOICE: 'FACTURE',
    RECEIPT: 'REÇU DE PAIEMENT',
    date: 'Date',
    order: 'Commande',
    offer: 'Offre',
    validUntil: 'Offre ouverte jusqu’au',
    customer: 'Client',
    product: 'Produit',
    unitPrice: 'Prix unitaire',
    quantity: 'Quantité',
    total: 'Total',
    totalDue: 'Total à payer',
    totalPaid: 'Total payé',
    payment: 'Paiement',
    ONLINE: 'Paiement en ligne',
    OFFICE: 'Paiement au bureau local',
    paidOn: 'Payé le',
    office: 'Bureau',
    reservation: 'Réservation',
    deadline: 'À régler avant le',
    qrORDER: 'Scannez pour retrouver votre commande sur GROUPDEALS.',
    qrOFFER: 'Scannez pour retrouver cette offre et confirmer votre commande.',
    showQr: 'Présentez cette facture au bureau pour régler votre commande. L’agent lit le QR Code ou saisit le numéro de réservation.',
    priceNote: 'Les prix GROUPDEALS sont des prix finaux : la livraison vers votre pays est comprise.',
    proformaNote: "Ce document n'est pas un reçu. La commande est confirmée après encaissement.",
    slogan: 'Importons ensemble et obtenons les prix usines.',
  },
  en: {
    PROFORMA: 'PROFORMA INVOICE',
    INVOICE: 'INVOICE',
    RECEIPT: 'PAYMENT RECEIPT',
    date: 'Date',
    order: 'Order',
    offer: 'Offer',
    validUntil: 'Offer open until',
    customer: 'Customer',
    product: 'Product',
    unitPrice: 'Unit price',
    quantity: 'Quantity',
    total: 'Total',
    totalDue: 'Total due',
    totalPaid: 'Total paid',
    payment: 'Payment',
    ONLINE: 'Online payment',
    OFFICE: 'Payment at local office',
    paidOn: 'Paid on',
    office: 'Office',
    reservation: 'Reservation',
    deadline: 'To be paid before',
    qrORDER: 'Scan to find your order on GROUPDEALS.',
    qrOFFER: 'Scan to find this offer and confirm your order.',
    showQr: 'Show this invoice at the office to pay for your order. The agent scans the QR code or enters the reservation number.',
    priceNote: 'GROUPDEALS prices are final prices: delivery to your country is included.',
    proformaNote: 'This document is not a receipt. The order is confirmed once payment is collected.',
    slogan: "Let's import together and get factory prices.",
  },
};

/**
 * Les polices standard PDF ne couvrent que le jeu Latin-1 étendu (WinAnsi).
 * Tout caractère hors de ce jeu est remplacé, pour qu'un nom en arabe ou en
 * amharique ne fasse jamais échouer la génération d'un document.
 */
export function winAnsiSafe(text: string): string {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e¡-ÿ€–—…Œœ]/g, '?');
}

function fmtDate(iso: string, lang: string): string {
  return winAnsiSafe(
    new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso)) + ' UTC',
  );
}

/** Le jour seul, sans l'heure. */
function fmtDay(iso: string, lang: string): string {
  return winAnsiSafe(new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso)));
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !cur) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawQr(page: PDFPage, content: string, x: number, y: number, size: number): void {
  const m = qrMatrix(content);
  const n = m.length + 8;
  const cell = size / n;
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
  m.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) page.drawRectangle({ x: x + (c + 4) * cell, y: y + size - (r + 5) * cell, width: cell + 0.05, height: cell + 0.05, color: NAVY });
    }),
  );
}

/* ---------------------------------------------------------------------------------- */
/* Proforma avant commande (page « Votre commande »)                                    */
/* ---------------------------------------------------------------------------------- */

const QUOTE_NOTES = {
  fr: {
    notOrder: 'Cette facture proforma reprend votre commande avant sa confirmation. Vos quantités sont réservées, et le prix garanti, au moment où vous confirmez la commande sur GROUPDEALS.',
    office: 'Pour régler au bureau local : confirmez votre commande en choisissant « Payer au bureau local ». Vous recevez alors un numéro de réservation ; présentez-le au bureau, avec cette facture, pour payer.',
    threshold: (amount: string) => `Le paiement au bureau local est proposé à partir de ${amount}. En dessous, le règlement se fait en ligne.`,
  },
  en: {
    notOrder: 'This proforma invoice shows your order before it is confirmed. Your quantities are reserved, and the price guaranteed, when you confirm the order on GROUPDEALS.',
    office: 'To pay at the local office: confirm your order and choose “Pay at the local office”. You then receive a reservation number; show it at the office, with this invoice, to pay.',
    threshold: (amount: string) => `Payment at the local office is available from ${amount}. Below that, payment is made online.`,
  },
};

export interface QuoteProformaInput {
  lang: string;
  now: Date;
  /** Six chiffres tirés au hasard : la référence du document. */
  reference: string;
  customer: InvoiceData['customer'];
  offer: { title: string; validUntil: string | null };
  currency: string;
  lines: InvoiceData['lines'];
  total: string;
  method: 'ONLINE' | 'OFFICE';
  office: InvoiceData['office'];
  officeEligible: boolean;
  /** Seuil du paiement au bureau, prêt à afficher, s'il y en a un. */
  officeThreshold: string | null;
  /** Adresse que porte le QR Code : la page de l'offre, ou « Votre commande » avec les quantités choisies. */
  qrContent: string;
  seller?: string[];
}

/**
 * Contenu de la proforma téléchargée depuis la page « Votre commande », avant toute commande.
 * Elle n'est pas enregistrée et ne porte pas de numéro de la série des factures : sa référence
 * est faite de la date et de six chiffres.
 */
export function quoteProformaData(q: QuoteProformaInput): InvoiceData {
  const lang = q.lang === 'en' ? 'en' : 'fr';
  const N = QUOTE_NOTES[lang];
  const notes = [N.notOrder];
  if (q.officeEligible) notes.push(N.office);
  else if (q.officeThreshold) notes.push(N.threshold(q.officeThreshold));
  return {
    kind: 'PROFORMA',
    number: `PF-${q.now.toISOString().slice(0, 10).replace(/-/g, '')}-${q.reference}`,
    issuedAt: q.now.toISOString(),
    orderNumber: null,
    offer: q.offer,
    notes,
    lang,
    customer: q.customer,
    currency: q.currency,
    lines: q.lines,
    total: q.total,
    payment: { method: q.officeEligible ? q.method : 'ONLINE', status: 'PENDING', paidAt: null, channel: null },
    office: q.officeEligible && q.method === 'OFFICE' ? q.office : null,
    reservation: null,
    qr: { content: q.qrContent, target: 'OFFER' },
    seller: q.seller,
  };
}

/** Le document, en octets : utilisable côté serveur comme dans un navigateur. */
export async function renderInvoiceBytes(d: InvoiceData): Promise<Uint8Array> {
  const L = LABELS[d.lang === 'en' ? 'en' : 'fr'];
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${L[d.kind]} ${d.number}`);
  pdf.setAuthor('GROUPDEALS');
  pdf.setCreationDate(new Date(d.issuedAt));
  pdf.setModificationDate(new Date(d.issuedAt));
  const page = pdf.addPage([595.28, 841.89]); // A4
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = page.getWidth();
  const M = 48;
  const text = (s: string, x: number, y: number, size = 10, font = regular, color = NAVY) =>
    page.drawText(winAnsiSafe(s), { x, y, size, font, color });
  const right = (s: string, xRight: number, y: number, size = 10, font = regular, color = NAVY) => {
    const safe = winAnsiSafe(s);
    page.drawText(safe, { x: xRight - font.widthOfTextAtSize(safe, size), y, size, font, color });
  };

  // En-tête
  page.drawRectangle({ x: 0, y: 841.89 - 96, width: W, height: 96, color: NAVY });
  page.drawText('GROUP', { x: M, y: 841.89 - 56, size: 24, font: bold, color: rgb(1, 1, 1) });
  page.drawText('DEALS', { x: M + bold.widthOfTextAtSize('GROUP', 24), y: 841.89 - 56, size: 24, font: bold, color: PINK });
  page.drawText(winAnsiSafe(L.slogan), { x: M, y: 841.89 - 74, size: 9, font: regular, color: rgb(0.8, 0.84, 0.93) });
  right(L[d.kind], W - M, 841.89 - 50, 15, bold, rgb(1, 1, 1));
  right(d.number, W - M, 841.89 - 68, 10, regular, rgb(0.8, 0.84, 0.93));

  // Bloc d'informations
  let y = 841.89 - 132;
  text(L.customer.toUpperCase(), M, y, 8, bold, GREY);
  text((d.orderNumber ? L.order : L.offer).toUpperCase(), 330, y, 8, bold, GREY);
  y -= 16;
  text(d.customer.name, M, y, 11, bold);
  // Sans commande, on nomme l'offre ; un titre trop long est abrégé pour tenir sur la ligne.
  let heading = winAnsiSafe(d.orderNumber ?? d.offer?.title ?? '');
  while (heading.length > 4 && bold.widthOfTextAtSize(heading, 11) > W - M - 330) heading = heading.slice(0, -2).trimEnd() + '…';
  text(heading, 330, y, 11, bold);
  y -= 14;
  text(d.customer.country, M, y);
  text(`${L.date} : ${fmtDate(d.issuedAt, d.lang)}`, 330, y);
  y -= 14;
  text(d.customer.whatsapp, M, y);
  text(`${L.payment} : ${L[d.payment.method]}`, 330, y);
  y -= 14;
  text(d.customer.email, M, y);
  if (d.payment.paidAt) text(`${L.paidOn} ${fmtDate(d.payment.paidAt, d.lang)}`, 330, y, 10, regular, GREEN);
  else if (d.offer?.validUntil) text(`${L.validUntil} ${fmtDay(d.offer.validUntil, d.lang)}`, 330, y, 10, bold, PINK);

  // Tableau des lignes
  y -= 34;
  const cols = { product: M + 8, unit: 360, qty: 440, total: W - M - 8 };
  page.drawRectangle({ x: M, y: y - 8, width: W - 2 * M, height: 24, color: rgb(0.95, 0.96, 0.98) });
  text(L.product, cols.product, y, 9, bold);
  right(L.unitPrice, cols.unit, y, 9, bold);
  right(L.quantity, cols.qty, y, 9, bold);
  right(L.total, cols.total, y, 9, bold);
  y -= 26;
  // Image du produit : une vignette carrée devant le nom. Si une image est illisible, la ligne s'en passe.
  const THUMB = 46;
  const thumbs = await Promise.all(
    d.lines.map(async (line) => {
      if (!line.image) return null;
      try {
        return await pdf.embedJpg(Uint8Array.from(atob(line.image), (c) => c.charCodeAt(0)));
      } catch {
        return null;
      }
    }),
  );
  const nameX = thumbs.some(Boolean) ? cols.product + THUMB + 10 : cols.product;
  for (const [n, line] of d.lines.entries()) {
    const thumb = thumbs[n];
    if (thumb) {
      const k = Math.min(THUMB / thumb.width, THUMB / thumb.height);
      page.drawRectangle({ x: cols.product, y: y + 10 - THUMB, width: THUMB, height: THUMB, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.5 });
      page.drawImage(thumb, { x: cols.product + (THUMB - thumb.width * k) / 2, y: y + 10 - THUMB + (THUMB - thumb.height * k) / 2, width: thumb.width * k, height: thumb.height * k });
    }
    const nameLines = wrap(winAnsiSafe(line.name), bold, 10, 210 - (nameX - cols.product));
    nameLines.forEach((l, i) => text(l, nameX, y - i * 12, 10, bold));
    right(line.unitPrice, cols.unit, y);
    right(`${line.quantity} ${line.unit}`, cols.qty, y);
    right(line.total, cols.total, y, 10, bold);
    let used = nameLines.length * 12;
    if (line.variant) {
      text(line.variant, nameX, y - used, 9, regular, GREY);
      used += 12;
    }
    if (thumb) used = Math.max(used, THUMB - 6);
    y -= used + 8;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.5, color: LINE });
    y -= 6;
  }

  // Total
  y -= 6;
  const paid = d.kind !== 'PROFORMA';
  page.drawRectangle({ x: 330, y: y - 14, width: W - M - 330, height: 36, color: paid ? rgb(0.91, 0.98, 0.94) : rgb(1, 0.94, 0.96) });
  text(paid ? L.totalPaid : L.totalDue, 342, y, 10, bold);
  right(d.total, cols.total, y - 1, 14, bold, paid ? GREEN : NAVY);
  y -= 44;
  wrap(L.priceNote, regular, 9, W - 2 * M).forEach((l, i) => text(l, M, y - i * 12, 9, regular, GREY));
  y -= 30;

  // QR Code du document, à droite ; le bureau et les mentions se rangent à sa gauche.
  const ownQr = d.qr && !(d.reservation && d.kind === 'PROFORMA') ? d.qr : null;
  const QR = 96;
  const textWidth = ownQr ? W - 2 * M - QR - 28 : W - 2 * M;
  if (ownQr) {
    try {
      drawQr(page, ownQr.content, W - M - QR, y + 8 - QR, QR);
      wrap(L[`qr${ownQr.target}`], regular, 8, QR + 8).forEach((l, i) => text(l, W - M - QR, y - QR - 4 - i * 10, 8, regular, GREY));
    } catch {
      /* contenu trop long pour un QR Code : le document reste valable sans lui */
    }
  }

  // Bureau et réservation
  if (d.office) {
    text(L.office.toUpperCase(), M, y, 8, bold, GREY);
    y -= 16;
    text(`${d.office.name} — ${d.office.city}`, M, y, 11, bold);
    y -= 14;
    wrap(winAnsiSafe(d.office.address), regular, 10, 280).forEach((l) => {
      text(l, M, y);
      y -= 14;
    });
    if (d.office.phone) {
      text(d.office.phone, M, y);
      y -= 14;
    }
  }
  for (const note of d.notes ?? []) {
    y -= 6;
    wrap(winAnsiSafe(note), regular, 10, textWidth).forEach((l) => {
      text(l, M, y);
      y -= 14;
    });
  }
  if (d.reservation && d.kind === 'PROFORMA') {
    const top = y - 6;
    drawQr(page, d.reservation.qrContent, W - M - 130, top - 118, 130);
    text(L.reservation.toUpperCase(), M, top - 10, 8, bold, GREY);
    text(d.reservation.number, M, top - 28, 13, bold);
    text(`${L.deadline} ${fmtDate(d.reservation.expiresAt, d.lang)}`, M, top - 46, 10, bold, PINK);
    const how = wrap(L.showQr, regular, 10, 280);
    how.forEach((l, i) => text(l, M, top - 66 - i * 13));
    wrap(L.proformaNote, regular, 9, 280).forEach((l, i) => text(l, M, top - 74 - how.length * 13 - i * 12, 9, regular, GREY));
  }

  // Pied de page
  const seller = (d.seller ?? []).flatMap((l) => wrap(l, regular, 7.5, W - 2 * M - 110)).slice(0, 3);
  const footTop = 56 + seller.length * 10;
  page.drawLine({ start: { x: M, y: footTop }, end: { x: W - M, y: footTop }, thickness: 0.5, color: LINE });
  seller.forEach((l, i) => text(l, M, footTop - 12 - i * 10, 7.5, regular, GREY));
  text(d.lang === 'en' ? 'GROUPDEALS — a GROUPIREX platform' : 'GROUPDEALS — une plateforme GROUPIREX', M, 40 - (seller.length ? 0 : 0), 8, regular, GREY);
  right(d.number, W - M, 40, 8, regular, GREY);

  return pdf.save();
}

export async function renderInvoicePdf(d: InvoiceData): Promise<Buffer> {
  return Buffer.from(await renderInvoiceBytes(d));
}
