/**
 * Page Support : comment joindre GROUPIREX (email, téléphone, WhatsApp).
 * Les coordonnées viennent des Réglages du back-office (support.*) : un champ vide masque ce moyen de contact.
 */

import { ReactNode } from 'react';
import { Loading, useApi } from '../components/ui';
import { useT } from '../lib/i18n';
import { Link } from '../lib/router';

interface Support {
  email: string;
  phone: string;
  whatsapp: string;
}

const digits = (s: string) => s.replace(/[^0-9]/g, '');

const Icon = ({ d }: { d: ReactNode }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const MAIL = <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></>;
const PHONE = <path d="M5 3.5h3.2l1.6 4.2-2.1 1.3a11 11 0 0 0 7.3 7.3l1.3-2.1 4.2 1.6V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5Z" />;
const CHAT = <path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z" />;

export function SupportPage() {
  const t = useT();
  const { data, error } = useApi<{ support?: Support }>('/config');
  const s = data?.support;

  const rows: { key: string; icon: ReactNode; label: string; value: string; href: string; action: string; hint: string }[] = [];
  if (s?.email) rows.push({ key: 'email', icon: MAIL, label: t('Email'), value: s.email, href: `mailto:${s.email}`, action: t('Écrire un email'), hint: t('Pour une demande détaillée, avec pièces jointes.') });
  if (s?.phone) rows.push({ key: 'phone', icon: PHONE, label: t('Téléphone'), value: s.phone, href: `tel:+${digits(s.phone)}`, action: t('Appeler'), hint: t('Pour une question urgente sur un paiement ou un retrait.') });
  if (s?.whatsapp) rows.push({ key: 'whatsapp', icon: CHAT, label: t('WhatsApp'), value: s.whatsapp, href: `https://wa.me/${digits(s.whatsapp)}`, action: t('Écrire sur WhatsApp'), hint: t('Pour envoyer une photo ou suivre une demande.') });

  return (
    <div className="wrap wrap--narrow page support">
      <h1 className="h1">{t('Support')}</h1>
      <p className="support__lead">{t('Une question sur une offre, un paiement, le transport ou le retrait de votre colis ? L’équipe GROUPIREX vous répond.')}</p>

      {!data && !error ? (
        <Loading />
      ) : rows.length ? (
        <ul className="support__list">
          {rows.map((r) => (
            <li key={r.key} className="support__row">
              <span className="support__icon"><Icon d={r.icon} /></span>
              <div className="support__text">
                <span className="small muted">{r.label}</span>
                <a className="support__value" href={r.href} target={r.key === 'whatsapp' ? '_blank' : undefined} rel={r.key === 'whatsapp' ? 'noopener noreferrer' : undefined}>{r.value}</a>
                <span className="small muted">{r.hint}</span>
              </div>
              <a className="btn btn--ghost support__btn" href={r.href} target={r.key === 'whatsapp' ? '_blank' : undefined} rel={r.key === 'whatsapp' ? 'noopener noreferrer' : undefined}>{r.action}</a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="notice" style={{ marginTop: 24 }}>{t('Les coordonnées du support seront bientôt disponibles.')}</p>
      )}

      <section className="support__tips">
        <h2 className="h3">{t('Pour une réponse plus rapide')}</h2>
        <ul>
          <li>
            {t('Indiquez votre numéro de commande : il figure dans')} <Link to="/orders">{t('Mes commandes')}</Link>.
          </li>
          <li>{t('Précisez votre pays et le bureau local où vous retirez votre colis.')}</li>
          <li>{t('Pour un produit abîmé ou non conforme, joignez des photos du colis et du produit.')}</li>
        </ul>
        <p className="small muted">
          {t('Les règles de remboursement, d’annulation et de réclamation sont dans les')} <Link to="/legal/conditions">{t('conditions générales')}</Link>.
        </p>
      </section>
    </div>
  );
}
