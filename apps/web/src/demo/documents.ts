/**
 * Documents PDF de la démonstration : facture proforma, facture, reçu.
 *
 * Sans serveur, le document est produit dans le navigateur, avec le même rendu que l'API
 * (apps/api/src/services/pdf.ts) et à partir de la fiche de la commande affichée.
 * Ce module n'est chargé qu'en démonstration, au premier téléchargement.
 */

import { UNIT_LABELS as UNITS, quoteProformaData, renderInvoiceBytes, winAnsiSafe, type InvoiceData } from '../../../api/src/services/pdf';
import { ApiError, get, post, type ProformaRequest } from '../lib/api';
import { demoCustomer } from './backend';

type Json = any;
/** Marque un texte à traduire (relevé par scripts/i18n.mjs). */
const N_ = (s: string): string => s;

/** Montant lisible dans un PDF : le texte affiché à l'écran, ou le code de la devise si son symbole ne s'imprime pas. */
function printable(m: { amount: number; currency: string; decimals: number; formatted: string }, lang: string): string {
  if (!winAnsiSafe(m.formatted).includes('?')) return m.formatted;
  const digits = new Intl.NumberFormat(lang, { minimumFractionDigits: m.decimals, maximumFractionDigits: m.decimals }).format(m.amount / 10 ** m.decimals);
  return `${digits} ${m.currency}`;
}

/** Vignette d'une image du site, en JPEG codé en base64 : le format PDF n'accepte ni le WebP ni le SVG. */
async function thumb(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = 144;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = side;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, side, side);
    const k = Math.min(side / img.naturalWidth, side / img.naturalHeight);
    ctx.drawImage(img, (side - img.naturalWidth * k) / 2, (side - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
    return canvas.toDataURL('image/jpeg', 0.82).split(',')[1] ?? null;
  } catch {
    return null; // image illisible : le document s'en passe
  }
}

export async function demoDocument(url: string, uiLang: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const hit = /\/orders\/([^/]+)\/documents\/(proforma|invoice|receipt)/i.exec(url);
  const lang = uiLang === 'en' ? 'en' : 'fr';
  const customer = await demoCustomer(lang);
  if (!hit || !customer) throw new ApiError(0, 'DEMO', N_('Démonstration : ce document se télécharge depuis le compte du client.'));
  const kind = hit[2].toUpperCase() as InvoiceData['kind'];
  const { order: o } = await get<{ order: Json }>(`/orders/${hit[1]}`);
  const doc = (o.documents as Json[]).find((d) => d.kind === kind);
  if (!doc) throw new ApiError(404, 'NOT_FOUND', N_('Élément introuvable.'));
  const r = o.reservation;
  const image = await thumb(o.product?.cover?.thumbnailUrl ?? o.product?.cover?.url);
  const data: InvoiceData = {
    kind,
    number: doc.number,
    issuedAt: doc.issuedAt,
    orderNumber: o.number,
    lang,
    customer: { name: `${customer.firstName} ${customer.lastName}`.trim(), email: customer.email, whatsapp: customer.whatsapp, country: customer.country.name },
    currency: o.total.currency,
    lines: (o.items as Json[]).map((i) => ({
      name: i.productName,
      variant: i.variantLabel,
      unit: UNITS[lang][i.saleUnit] ?? '',
      quantity: i.quantity,
      unitPrice: printable(i.unitPrice, lang),
      total: printable(i.lineTotal, lang),
      image,
    })),
    total: printable(o.total, lang),
    payment: { method: o.paymentMethod, status: o.paymentStatus, paidAt: kind === 'PROFORMA' ? null : o.paidAt, channel: null },
    office: r ? { name: r.office.name, city: r.office.city, address: r.office.address, phone: r.office.phone ?? null } : null,
    reservation: r ? { number: r.number, expiresAt: r.expiresAt, qrContent: r.qrContent ?? `GROUPDEALS ${r.number}` } : null,
    // Sur le site réel, ce QR Code ramène à la commande ; ici il n'y a pas d'adresse à ouvrir.
    qr: { content: `GROUPDEALS demonstration - commande ${o.number}`, target: 'ORDER' },
  };
  return { filename: `${doc.number}.pdf`, bytes: await renderInvoiceBytes(data) };
}

/** Proforma de la page « Votre commande » : établie à partir du devis affiché, avant toute commande. */
export async function demoQuoteProforma(req: ProformaRequest, uiLang: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const lang = uiLang === 'en' ? 'en' : 'fr';
  const customer = await demoCustomer(lang);
  if (!customer) throw new ApiError(0, 'DEMO', N_('Démonstration : ce document se télécharge depuis le compte du client.'));
  const { deal } = await get<{ deal: Json }>(`/group-deals/${req.dealSlug}`);
  const quote = await post<Json>(`/group-deals/${req.dealId}/quote`, { items: req.items });
  if (!quote.canOrder) throw new ApiError(422, quote.problem?.code ?? 'QUANTITY_INVALID', quote.problem?.message ?? '');
  const offices: Json[] = req.officeId ? ((await get<{ offices: Json[] }>('/local-offices')).offices ?? []) : [];
  const office = offices.find((o) => o.id === req.officeId) ?? null;
  const image = await thumb(deal.product.cover?.thumbnailUrl ?? deal.product.cover?.url);
  const data = quoteProformaData({
    lang,
    now: new Date(),
    reference: String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    customer: { name: `${customer.firstName} ${customer.lastName}`.trim(), email: customer.email, whatsapp: customer.whatsapp, country: customer.country.name },
    offer: { title: deal.title, validUntil: deal.endsAt ?? null },
    currency: quote.total.currency,
    lines: (quote.lines as Json[]).map((l) => ({
      name: deal.product.name,
      variant: l.variantLabel,
      unit: UNITS[lang][deal.product.saleUnit] ?? '',
      quantity: l.quantity,
      unitPrice: printable(l.unitPrice, lang),
      total: printable(l.lineTotal, lang),
      image,
    })),
    total: printable(quote.total, lang),
    method: req.paymentMethod,
    office: office ? { name: office.name, city: office.city, address: office.address, phone: office.phone ?? null } : null,
    officeEligible: !!quote.paymentMethods.office,
    officeThreshold: quote.paymentMethods.officeThreshold ? printable(quote.paymentMethods.officeThreshold, lang) : null,
    qrContent: `GROUPDEALS demonstration - offre ${deal.slug}`.slice(0, 180),
  });
  return { filename: `${data.number}.pdf`, bytes: await renderInvoiceBytes(data) };
}
