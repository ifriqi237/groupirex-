/**
 * Pages légales : mentions légales, conditions générales, politique de confidentialité.
 *
 * TEXTES DE TRAVAIL, à faire relire par un juriste avant l'ouverture au public. Les passages entre
 * crochets [comme ceci] sont des décisions ou des informations à fournir par GROUPIREX : ils
 * s'affichent surlignés. L'identité de l'entreprise (raison sociale, adresse, RCCM, NIU…) vient
 * des Réglages du back-office et se met à jour sans toucher au code.
 * Une fois les textes validés, passez LEGAL_DRAFT à false : le bandeau « document de travail » disparaît.
 */

import { Fragment, ReactNode } from 'react';
import { useApi } from '../components/ui';
import { useI18n, useT } from '../lib/i18n';
import { Link } from '../lib/router';

export const LEGAL_DRAFT = true;

export const LEGAL_PAGES = ['mentions-legales', 'conditions', 'confidentialite'] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

interface Company {
  legalName: string;
  legalForm: string;
  capital: string;
  address: string;
  rccm: string;
  taxId: string;
  phone: string;
  email: string;
  publicationDirector: string;
  host: string;
}

type Section = { h: string; p: string[] };
type Doc = { title: string; updated: string; sections: Section[] };

/** Valeur de l'entreprise, ou passage à compléter. */
const v = (value: string, missing: string) => (value.trim() ? value : `[${missing}]`);

function texts(c: Company): Record<'fr' | 'en', Record<LegalPage, Doc>> {
  const contact = c.email || c.phone ? [c.email, c.phone].filter(Boolean).join(' — ') : '[adresse email et téléphone de contact]';
  const contactEn = c.email || c.phone ? [c.email, c.phone].filter(Boolean).join(' — ') : '[contact email and phone]';
  return {
    fr: {
      'mentions-legales': {
        title: 'Mentions légales',
        updated: 'Dernière mise à jour : [date de mise en ligne]',
        sections: [
          {
            h: 'Éditeur du site',
            p: [
              `Le site GROUPDEALS est édité par ${c.legalName}${c.legalForm ? `, ${c.legalForm}` : ', [forme juridique]'}${c.capital ? ` au capital de ${c.capital}` : ' au capital de [montant]'}.`,
              `Siège social : ${v(c.address, 'adresse du siège social')}.`,
              `RCCM : ${v(c.rccm, 'numéro RCCM')}. Numéro d’identifiant unique (NIU) : ${v(c.taxId, 'NIU')}.`,
              `Contact : ${contact}.`,
            ],
          },
          { h: 'Directeur de la publication', p: [v(c.publicationDirector, 'nom et fonction du directeur de la publication')] },
          { h: 'Hébergement', p: [v(c.host, 'nom, adresse et téléphone de l’hébergeur du site')] },
          {
            h: 'Propriété intellectuelle',
            p: [
              'Les marques GROUPDEALS et GROUPIREX, le logo, la charte graphique et les textes du site sont la propriété de leur titulaire. Toute reproduction sans autorisation écrite est interdite.',
              'Les photos et descriptions des produits sont fournies par les fabricants ou les fournisseurs, ou réalisées pour GROUPDEALS ; elles restent la propriété de leurs auteurs.',
            ],
          },
          { h: 'Signaler un contenu', p: [`Pour signaler un contenu inexact ou illicite, écrivez-nous : ${contact}.`] },
        ],
      },
      conditions: {
        title: 'Conditions générales d’utilisation et de vente',
        updated: 'Dernière mise à jour : [date de mise en ligne]',
        sections: [
          {
            h: '1. Objet',
            p: [
              `GROUPDEALS est une plateforme d’achats groupés éditée par ${c.legalName}. Elle réunit les commandes de plusieurs clients pour acheter des produits directement auprès d’usines, à des prix proches des prix usine, puis les livrer jusqu’au pays du client.`,
              'Les présentes conditions s’appliquent à toute utilisation du site et à toute commande passée sur GROUPDEALS. En créant un compte, vous les acceptez.',
            ],
          },
          {
            h: '2. Compte',
            p: [
              'La création d’un compte est gratuite. Vous vous engagez à fournir des informations exactes (nom, pays, email, numéro WhatsApp) et à les tenir à jour.',
              'Votre adresse email doit être vérifiée avant votre première commande. Vous êtes responsable de la confidentialité de votre mot de passe.',
              'GROUPDEALS peut suspendre un compte en cas de fraude, d’usage abusif ou de non-respect des présentes conditions.',
            ],
          },
          {
            h: '3. Fonctionnement d’une offre',
            p: [
              'Chaque offre indique un prix final par unité de vente, une quantité minimum par commande, un objectif de quantité pour l’ensemble des participants et une date de clôture.',
              'Le prix affiché est final : il comprend le produit et la livraison jusqu’à votre pays. Il est affiché dans la monnaie de votre pays.',
              'À la clôture, si l’objectif est atteint, la commande groupée est confirmée et passée auprès du fournisseur. Si l’objectif n’est pas atteint, GROUPDEALS peut prolonger l’offre, la confirmer malgré tout, ou l’annuler. En cas d’annulation, les participants sont intégralement remboursés [délai de remboursement].',
            ],
          },
          {
            h: '4. Prix et paiement',
            p: [
              'Le paiement en ligne se fait par l’intermédiaire d’un prestataire de paiement agréé (Mobile Money, carte bancaire et autres moyens selon votre pays). GROUPDEALS ne conserve aucune donnée de carte bancaire.',
              'Le paiement au bureau local est proposé à partir d’un montant minimum de commande. La réservation doit être réglée au bureau choisi avant la date limite indiquée ; à défaut, elle expire et les quantités sont libérées.',
              'Une commande n’est considérée comme payée qu’après confirmation du paiement par le prestataire ou par l’agent du bureau. Une facture est alors émise.',
            ],
          },
          {
            h: '5. Livraison et retrait',
            p: [
              'Le délai de livraison affiché sur chaque offre est une estimation à compter de la clôture de la campagne. Vous êtes informé de chaque étape du transport.',
              'La commande est retirée au bureau GROUPDEALS choisi, sur présentation du QR code de la commande et d’une pièce d’identité. [Délai de retrait accordé et éventuels frais de garde au-delà.]',
            ],
          },
          {
            h: '6. Annulation et remboursement',
            p: [
              'Une commande non payée peut être annulée librement depuis la page de la commande.',
              '[Conditions d’annulation d’une commande payée avant la clôture de l’offre, et après la clôture.]',
            ],
          },
          {
            h: '7. Conformité et réclamations',
            p: [`Vérifiez votre commande au moment du retrait. Toute réclamation (produit manquant, endommagé ou non conforme) doit être adressée dans un délai de [nombre] jours après le retrait, à : ${contact}.`],
          },
          {
            h: '8. Responsabilité',
            p: [
              'GROUPDEALS s’engage à tout mettre en œuvre pour livrer les produits commandés dans les délais annoncés. Sa responsabilité ne peut être engagée en cas de force majeure (événements portuaires, douaniers, sanitaires ou climatiques indépendants de sa volonté).',
            ],
          },
          { h: '9. Données personnelles', p: ['Le traitement de vos données est décrit dans la politique de confidentialité.'] },
          { h: '10. Droit applicable et litiges', p: ['Les présentes conditions sont soumises au droit [pays]. À défaut d’accord amiable, tout litige relève des tribunaux de [ville].'] },
        ],
      },
      confidentialite: {
        title: 'Politique de confidentialité',
        updated: 'Dernière mise à jour : [date de mise en ligne]',
        sections: [
          { h: 'Responsable du traitement', p: [`${c.legalName}, ${v(c.address, 'adresse du siège social')}. Contact : ${contact}.`] },
          {
            h: 'Données collectées',
            p: [
              'Votre compte : nom, pays, adresse email, numéro WhatsApp, langue, mot de passe (enregistré sous une forme chiffrée irréversible).',
              'Vos achats : commandes, réservations, paiements (montant, moyen, statut ; jamais de numéro de carte), factures, bureau de retrait.',
              'Votre activité : favoris, demandes Matching, préférences de notification.',
              'La sécurité : adresse IP et journal des connexions et des actions sensibles.',
            ],
          },
          {
            h: 'Pourquoi nous les utilisons',
            p: ['Gérer votre compte et vos commandes, traiter les paiements, organiser le retrait au bureau, vous informer de l’avancement de vos commandes et des nouvelles offres (selon vos préférences), prévenir la fraude, et respecter nos obligations comptables et légales.'],
          },
          {
            h: 'Qui les reçoit',
            p: [
              'Le prestataire de paiement (pour traiter vos paiements), les bureaux GROUPDEALS de votre pays (pour le paiement au bureau et le retrait), notre hébergeur et notre fournisseur d’envoi d’emails. Vos données ne sont jamais vendues.',
            ],
          },
          {
            h: 'Durée de conservation',
            p: ['Les données du compte sont conservées tant que le compte est actif, puis [durée] après sa fermeture. Les factures sont conservées [durée légale de conservation des pièces comptables]. Les journaux de sécurité sont conservés 12 mois.'],
          },
          {
            h: 'Cookies',
            p: ['Le site utilise un seul cookie, indispensable à votre connexion. Votre choix de pays et de langue est gardé dans votre navigateur. Aucun cookie publicitaire ni outil de mesure d’audience d’un tiers n’est utilisé.'],
          },
          {
            h: 'Vos droits',
            p: [`Vous pouvez demander l’accès à vos données, leur correction ou leur suppression, et vous opposer à recevoir nos messages d’information, en écrivant à : ${contact}. Vous pouvez aussi saisir l’autorité de protection des données de votre pays.`],
          },
          { h: 'Sécurité', p: ['Connexion chiffrée (https), mots de passe chiffrés, double authentification pour le personnel, accès aux données limité selon le rôle de chacun.'] },
        ],
      },
    },
    en: {
      'mentions-legales': {
        title: 'Legal notice',
        updated: 'Last updated: [launch date]',
        sections: [
          {
            h: 'Publisher',
            p: [
              `GROUPDEALS is published by ${c.legalName}${c.legalForm ? `, ${c.legalForm}` : ', [legal form]'}${c.capital ? ` with a share capital of ${c.capital}` : ' with a share capital of [amount]'}.`,
              `Registered office: ${v(c.address, 'registered office address')}.`,
              `Trade register (RCCM): ${v(c.rccm, 'RCCM number')}. Tax ID (NIU): ${v(c.taxId, 'tax ID')}.`,
              `Contact: ${contactEn}.`,
            ],
          },
          { h: 'Publication director', p: [v(c.publicationDirector, 'name and position of the publication director')] },
          { h: 'Hosting', p: [v(c.host, 'name, address and phone number of the hosting provider')] },
          {
            h: 'Intellectual property',
            p: [
              'The GROUPDEALS and GROUPIREX trademarks, logo, visual identity and texts belong to their owner. Any reproduction without written permission is prohibited.',
              'Product photos and descriptions are supplied by manufacturers or suppliers, or produced for GROUPDEALS; they remain the property of their authors.',
            ],
          },
          { h: 'Report content', p: [`To report inaccurate or unlawful content, write to us: ${contactEn}.`] },
        ],
      },
      conditions: {
        title: 'Terms of use and sale',
        updated: 'Last updated: [launch date]',
        sections: [
          { h: '1. Purpose', p: [`GROUPDEALS is a group-buying platform published by ${c.legalName}. It pools the orders of many customers to buy products directly from factories, at prices close to factory prices, and delivers them to the customer’s country.`, 'These terms apply to any use of the site and any order placed on GROUPDEALS. By creating an account, you accept them.'] },
          { h: '2. Account', p: ['Creating an account is free. You agree to provide accurate information (name, country, email, WhatsApp number) and keep it up to date.', 'Your email address must be verified before your first order. You are responsible for keeping your password confidential.', 'GROUPDEALS may suspend an account in case of fraud, abuse or breach of these terms.'] },
          { h: '3. How an offer works', p: ['Each offer shows a final price per sale unit, a minimum quantity per order, a quantity target for all participants and a closing date.', 'The price shown is final: it includes the product and delivery to your country, in your country’s currency.', 'At closing, if the target is reached, the group order is confirmed and placed with the supplier. If not, GROUPDEALS may extend the offer, confirm it anyway, or cancel it. If cancelled, participants are refunded in full [refund time frame].'] },
          { h: '4. Prices and payment', p: ['Online payment goes through a licensed payment provider (Mobile Money, bank card and other methods depending on your country). GROUPDEALS never stores card details.', 'Payment at the local office is offered from a minimum order amount. The reservation must be paid at the chosen office before the stated deadline; otherwise it expires and the quantities are released.', 'An order counts as paid only once the payment is confirmed by the provider or by the office agent. An invoice is then issued.'] },
          { h: '5. Delivery and pickup', p: ['The delivery time shown on each offer is an estimate from the campaign closing date. You are notified of each transport step.', 'The order is collected at the chosen GROUPDEALS office, on presentation of the order QR code and an ID document. [Pickup period granted and any storage fees beyond it.]'] },
          { h: '6. Cancellation and refunds', p: ['An unpaid order can be cancelled freely from the order page.', '[Cancellation terms for a paid order, before and after the offer closes.]'] },
          { h: '7. Conformity and claims', p: [`Check your order when you collect it. Any claim (missing, damaged or non-conforming product) must be sent within [number] days after pickup to: ${contactEn}.`] },
          { h: '8. Liability', p: ['GROUPDEALS makes every effort to deliver the products ordered within the stated time. It cannot be held liable in case of force majeure (port, customs, health or weather events beyond its control).'] },
          { h: '9. Personal data', p: ['How your data is processed is described in the privacy policy.'] },
          { h: '10. Governing law and disputes', p: ['These terms are governed by the law of [country]. Failing an amicable settlement, any dispute falls under the courts of [city].'] },
        ],
      },
      confidentialite: {
        title: 'Privacy policy',
        updated: 'Last updated: [launch date]',
        sections: [
          { h: 'Data controller', p: [`${c.legalName}, ${v(c.address, 'registered office address')}. Contact: ${contactEn}.`] },
          { h: 'Data we collect', p: ['Your account: name, country, email address, WhatsApp number, language, password (stored in an irreversible encrypted form).', 'Your purchases: orders, reservations, payments (amount, method, status; never a card number), invoices, pickup office.', 'Your activity: favourites, Matching requests, notification preferences.', 'Security: IP address and a log of sign-ins and sensitive actions.'] },
          { h: 'Why we use it', p: ['To manage your account and orders, process payments, organise pickup at the office, keep you informed about your orders and new offers (according to your preferences), prevent fraud, and meet our accounting and legal obligations.'] },
          { h: 'Who receives it', p: ['The payment provider (to process your payments), GROUPDEALS offices in your country (for office payment and pickup), our hosting provider and our email provider. Your data is never sold.'] },
          { h: 'Retention', p: ['Account data is kept while the account is active, then [period] after it is closed. Invoices are kept [legal retention period for accounting records]. Security logs are kept for 12 months.'] },
          { h: 'Cookies', p: ['The site uses a single cookie, required to keep you signed in. Your country and language choice is kept in your browser. No advertising cookie or third-party audience measurement is used.'] },
          { h: 'Your rights', p: [`You can ask to access, correct or delete your data, and object to receiving our information messages, by writing to: ${contactEn}. You can also contact the data protection authority of your country.`] },
          { h: 'Security', p: ['Encrypted connection (https), encrypted passwords, two-factor authentication for staff, data access limited by role.'] },
        ],
      },
    },
  };
}

/** Les passages entre crochets sont surlignés : ils restent à compléter. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/);
  return (
    <>
      {parts.map((part, i) => (part.startsWith('[') && part.endsWith(']') ? <mark key={i} className="legal__todo">{part}</mark> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

const EMPTY: Company = { legalName: 'GROUPIREX', legalForm: '', capital: '', address: '', rccm: '', taxId: '', phone: '', email: '', publicationDirector: '', host: '' };

export function LegalPageView({ page }: { page: string }) {
  const t = useT();
  const { lang } = useI18n();
  const { data } = useApi<{ company?: Company }>('/config');
  const key = (LEGAL_PAGES as readonly string[]).includes(page) ? (page as LegalPage) : 'mentions-legales';
  const doc = texts(data?.company ?? EMPTY)[lang === 'en' ? 'en' : 'fr'][key];
  const nav: [LegalPage, string][] = [
    ['mentions-legales', t('Mentions légales')],
    ['conditions', t('Conditions générales')],
    ['confidentialite', t('Confidentialité')],
  ];
  return (
    <div className="wrap wrap--narrow page legal">
      <nav className="chips" aria-label={t('Informations légales')}>
        {nav.map(([p, label]) => (
          <Link key={p} to={`/legal/${p}`} className="chip" aria-current={p === key ? 'true' : undefined}>{label}</Link>
        ))}
      </nav>
      <h1 className="h1" style={{ marginTop: 24 }}>{doc.title}</h1>
      <p className="small muted" style={{ marginTop: 6 }}><Rich text={doc.updated} /></p>
      {LEGAL_DRAFT && (
        <div className="notice notice--warn" style={{ marginTop: 20 }}>
          <span>{t('Document de travail : ce texte doit être complété et validé par un juriste avant l’ouverture du site au public. Les passages surlignés restent à compléter.')}</span>
        </div>
      )}
      <div className="legal__body">
        {doc.sections.map((s) => (
          <section key={s.h}>
            <h2 className="h3">{s.h}</h2>
            {s.p.map((para, i) => <p key={i}><Rich text={para} /></p>)}
          </section>
        ))}
      </div>
    </div>
  );
}

/** Rappel sous le formulaire d'inscription. */
export function LegalConsent(): ReactNode {
  const t = useT();
  const [before, middle, after] = t('En créant un compte, vous acceptez les {terms} et la {privacy}.').split(/\{terms\}|\{privacy\}/);
  return (
    <p className="welcome__legal">
      {before}
      <Link to="/legal/conditions">{t('conditions générales')}</Link>
      {middle}
      <Link to="/legal/confidentialite">{t('politique de confidentialité')}</Link>
      {after}
    </p>
  );
}
