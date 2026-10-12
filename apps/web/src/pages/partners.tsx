/**
 * Partenaires locaux : l'annuaire public des bureaux qui encaissent les paiements et
 * remettent les colis, pays par pays. On choisit son pays, puis on voit ses partenaires.
 */

import { useEffect, useState } from 'react';
import { Empty, ErrorNote, Loading, useApi } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { Link, navigate } from '../lib/router';
import { CountryPicker, Flag, PickerCountry } from '../components/country-picker';
import { OfficeCard } from './deals';

type PartnerCountry = PickerCountry;
type Partner = Parameters<typeof OfficeCard>[0]['office'];

/** Étape 1 : choisir son pays. */
export function PartnersPage() {
  const t = useT();
  const { country } = useAuth();
  const { data, error, reload } = useApi<{ countries: PartnerCountry[] }>('/local-partners/countries');
  const [code, setCode] = useState('');
  // Le pays du visiteur est proposé d'emblée ; il reste libre d'en choisir un autre.
  useEffect(() => {
    if (!code && data?.countries.some((c) => c.code === country)) setCode(country);
  }, [data, country]);

  return (
    <div className="wrap wrap--form page">
      <h1 className="h1">{t('Partenaires locaux')}</h1>
      <p className="muted" style={{ marginTop: 8 }}>{t('Nos partenaires locaux encaissent vos paiements et vous remettent vos colis. Choisissez votre pays pour voir ceux qui sont près de chez vous.')}</p>
      <ErrorNote error={error} onRetry={reload} />
      {!data && !error && <Loading />}
      {data && (
        <form
          className="stack"
          style={{ marginTop: 24 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (code) navigate(`/partners/${code}`);
          }}
        >
          <div className="field">
            <span className="field__label" id="partner-country-label">{t('Votre pays')}</span>
            <CountryPicker id="partner-country" label={t('Votre pays')} countries={data.countries} value={code} onChange={setCode} placeholder={t('Choisir un pays')} />
            <span className="field__hint">{t('Les 54 pays d’Afrique sont proposés. Ceux où GROUPDEALS a déjà des partenaires l’indiquent.')}</span>
          </div>
          <button className="btn btn--primary btn--block" disabled={!code}>{t('Voir les partenaires')}</button>
        </form>
      )}
    </div>
  );
}

/** Étape 2 : les partenaires du pays choisi, regroupés par ville. */
export function CountryPartnersPage({ country }: { country: string }) {
  const t = useT();
  const { data, error, loading, reload } = useApi<{ country: { code: string; name: string; served: boolean }; cities: string[]; partners: (Partner & { id: string; acceptsPayments: boolean; isPickupPoint: boolean })[] }>(`/local-partners/${country}`);
  const list = useApi<{ countries: PartnerCountry[] }>('/local-partners/countries');

  if (error) {
    return (
      <div className="wrap wrap--narrow page">
        <ErrorNote error={error} onRetry={reload} />
        <Link to="/partners" className="btn btn--navy" style={{ marginTop: 16 }}>{t('Choisir un autre pays')}</Link>
      </div>
    );
  }
  if (!data || loading) return <Loading />;

  return (
    <div className="wrap wrap--narrow page">
      <p className="small"><Link to="/partners" className="link">{t('Partenaires locaux')}</Link> / {data.country.name}</p>
      <div className="row row--between row--wrap" style={{ marginTop: 8, alignItems: 'flex-end' }}>
        <div>
          <h1 className="h1 partner-title"><Flag code={data.country.code} size={44} />{data.country.name}</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            {data.partners.length === 0 ? t('Aucun partenaire local pour le moment') : data.partners.length === 1 ? t('1 partenaire local') : t('{n} partenaires locaux', { n: data.partners.length })}
          </p>
        </div>
        {list.data && (
          <div className="row small" style={{ flex: '1 1 260px', maxWidth: 380 }}>
            <span className="muted" style={{ whiteSpace: 'nowrap' }}>{t('Changer de pays')}</span>
            <div className="grow"><CountryPicker id="partner-switch" label={t('Changer de pays')} countries={list.data.countries} value={data.country.code} onChange={(c) => navigate(`/partners/${c}`)} placeholder={t('Choisir un pays')} /></div>
          </div>
        )}
      </div>

      {data.partners.length === 0 ? (
        <div style={{ marginTop: 24 }}>
          <Empty title={data.country.served ? t('Pas encore de partenaire dans ce pays') : t('GROUPDEALS n’est pas encore présent dans ce pays')} action={<Link to="/partners" className="btn btn--navy">{t('Choisir un autre pays')}</Link>}>
            {data.country.served ? t('Vous pouvez tout de même commander : le paiement en ligne reste disponible.') : t('Nous n’y avons pas encore de partenaire, et les commandes n’y sont pas encore livrées.')}
          </Empty>
        </div>
      ) : (
        data.cities.map((city) => (
          <section key={city} style={{ marginTop: 28 }}>
            <h2 className="h2">{city}</h2>
            <div className="grid grid--2" style={{ marginTop: 12 }}>
              {data.partners.filter((p) => p.city === city).map((p) => (
                <article key={p.id} className="card partner">
                  <OfficeCard office={p} />
                  <div className="row row--wrap" style={{ marginTop: 12 }}>
                    {p.acceptsPayments && <span className="badge badge--green">{t('Paiement sur place')}</span>}
                    {p.isPickupPoint && <span className="badge badge--navy">{t('Retrait des colis')}</span>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
