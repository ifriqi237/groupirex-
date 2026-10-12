import { Countdown, Deal, DealGrid, Gauge, unitLabel } from '../components/deal';
import { Empty, ErrorNote, Icon, Loading, ProductImage, useApi } from '../components/ui';
import { useAuth } from '../lib/auth';
import { formatNumber, useI18n, useT } from '../lib/i18n';
import { Link } from '../lib/router';
import { HeroSea } from '../components/sea';

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  imageUrl: string | null;
  activeDeals: number;
}

interface HomeData {
  stats: { members: number; countries: number; activeDeals: number; unitsOrdered: number };
  categories: Category[];
  featured: Deal[];
  endingSoon: Deal[];
  upcoming: Deal[];
}

/** L'offre mise en avant, « en direct » : c'est elle qui montre ce qu'est un achat groupé. */
function LiveDeal({ deal }: { deal: Deal }) {
  const t = useT();
  const { lang } = useI18n();
  return (
    <Link to={`/deals/${deal.slug}`} className="live">
      <div className="live__media">{deal.product.cover && <ProductImage src={deal.product.cover.url} alt={deal.product.cover.alt} width="800" height="500" />}</div>
      <div className="live__body">
        <div className="row row--between row--top">
          <div>
            <div className="live__cat">{deal.product.category.name}</div>
            <h2>{deal.title}</h2>
          </div>
          {deal.discountPercent ? <span className="badge badge--deal num">−{deal.discountPercent} %</span> : null}
        </div>
        <div className="row row--wrap" style={{ alignItems: 'baseline' }}>
          {deal.price && <span className="price price--xl">{deal.price.formatted}</span>}
          {deal.compareAtPrice && <span className="price-old">{deal.compareAtPrice.formatted}</span>}
        </div>
        <div>
          <Gauge percent={deal.progress.percent} large label={t('Progression de la commande groupée')} />
          <div className="gauge-legend">
            <span className="num">
              <b>{formatNumber(deal.progress.ordered, lang)}</b> / {formatNumber(deal.progress.target, lang)} {unitLabel(deal.product.saleUnit, deal.progress.target, t)}
            </span>
            <span className="num">{t('{n} participants', { n: deal.progress.participants })}</span>
          </div>
        </div>
        <Countdown deal={deal} />
        <span className="btn btn--primary btn--l btn--block">{t('Participer au GroupDeals')}</span>
      </div>
    </Link>
  );
}

export function HomePage() {
  const t = useT();
  const { lang } = useI18n();
  const { country, user } = useAuth();
  const { data, error, loading, reload } = useApi<HomeData>(`/home?c=${country}`);

  return (
    <>
      <section className="hero">
        <HeroSea />
        <div className="wrap hero__in">
          <div>
            <h1 className="h-display">{t('Importons ensemble et obtenons les prix usines.')}</h1>
            <p className="lead hero__lead" style={{ marginTop: 24 }}>
              {t('Rejoignez une commande groupée, payez un seul prix livraison comprise, et suivez votre colis jusqu’au retrait.')}
            </p>
            <div className="row row--wrap hero__ctas">
              <Link to="/deals" className="btn btn--primary btn--l">
                {t('Voir les offres en cours')}
              </Link>
              {!user && (
                <Link to="/register" className="btn btn--outline-light btn--l">
                  {t('Créer un compte')}
                </Link>
              )}
            </div>
          </div>
          {data?.featured[0] && <LiveDeal deal={data.featured[0]} />}
        </div>
      </section>

      <section className="how" aria-labelledby="how">
        <div className="wrap">
          <h2 className="h2" id="how">{t('Comment ça marche')}</h2>
          <p className="how__lead">{t('Un achat groupé suit toujours le même chemin, de l’usine jusqu’au bureau de retrait de votre ville.')}</p>
          <ol className="how__steps">
            <li>
              <h3>{t('Choisissez une offre')}</h3>
              <p>{t('Indiquez votre quantité : le prix affiché est final, livraison comprise.')}</p>
            </li>
            <li>
              <h3>{t('Payez en ligne ou au bureau')}</h3>
              <p>{t('Mobile Money, carte bancaire, ou au bureau GROUPDEALS de votre pays.')}</p>
            </li>
            <li>
              <h3>{t('Suivez le conteneur')}</h3>
              <p>{t('Neuf étapes, de l’usine au port, puis jusqu’à votre ville.')}</p>
            </li>
            <li>
              <h3>{t('Retirez votre colis')}</h3>
              <p>{t('Au bureau de retrait choisi, sur présentation de votre QR code.')}</p>
            </li>
          </ol>
        </div>
      </section>

      <div className="wrap" style={{ paddingBottom: 24 }}>
        {loading && !data && <Loading />}
        <div style={{ marginTop: 24 }}>
          <ErrorNote error={error} onRetry={reload} />
        </div>

        {data && (
          <>
            <section className="section" aria-labelledby="cats">
              <div className="section__head">
                <h2 className="h2" id="cats">
                  {t('Catégories')}
                </h2>
              </div>
              <div className="cats">
                {data.categories.map((c) => (
                  <Link key={c.id} to={`/deals?category=${c.slug}`} className="cat">
                    {c.imageUrl && <img src={c.imageUrl} alt="" loading="lazy" width="400" height="320" />}
                    <span className="cat__label">
                      <b>{c.name}</b>
                      {c.activeDeals > 0 && <span className="tiny num">{c.activeDeals > 1 ? t('{n} offres', { n: c.activeDeals }) : t('1 offre')}</span>}
                    </span>
                  </Link>
                ))}
              </div>
            </section>

            <section className="section" aria-labelledby="featured">
              <div className="section__head">
                <h2 className="h2" id="featured">
                  {t('Offres en cours')}
                </h2>
                <Link to="/deals" className="link">
                  {t('Tout voir')}
                </Link>
              </div>
              {data.featured.length ? (
                <DealGrid deals={data.featured.slice(1, 9).length ? data.featured.slice(1, 9) : data.featured} />
              ) : (
                <Empty title={t('Aucune offre en cours dans votre pays')} action={<Link to="/matching" className="btn btn--navy">{t('Dire ce que vous recherchez')}</Link>}>
                  {t('Publiez une demande dans Matching : quand assez de membres veulent le même produit, GROUPDEALS lance une commande groupée.')}
                </Empty>
              )}
            </section>

            {data.endingSoon.length > 0 && (
              <section className="section" aria-labelledby="ending">
                <div className="section__head">
                  <h2 className="h2" id="ending">
                    {t('Se terminent bientôt')}
                  </h2>
                  <Link to="/deals?sort=ending" className="link">
                    {t('Tout voir')}
                  </Link>
                </div>
                <DealGrid deals={data.endingSoon} />
              </section>
            )}

            {data.upcoming.length > 0 && (
              <section className="section" aria-labelledby="upcoming">
                <div className="section__head">
                  <h2 className="h2" id="upcoming">
                    {t('Bientôt ouvertes')}
                  </h2>
                </div>
                <DealGrid deals={data.upcoming} />
              </section>
            )}

            <section className="section">
              <div className="panel panel--navy">
                <div className="split" style={{ alignItems: 'center' }}>
                  <div>
                    <h2 className="h2">{t('Vous ne trouvez pas votre produit ?')}</h2>
                    <p style={{ marginTop: 8, color: '#C9D2EE', maxWidth: '52ch' }}>
                      {t('Dites ce que vous recherchez. Les autres membres cliquent « Je veux aussi ce produit », et les demandes les plus suivies deviennent des commandes groupées.')}
                    </p>
                  </div>
                  <div>
                    <Link to="/matching" className="btn btn--primary">
                      {t('Publier une demande')}
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      <section className="trust" aria-label={t('Nos engagements')}>
        <div className="wrap trust__grid">
          <div className="trust__item">
            <Icon name="shield" size={28} />
            <div>
              <b>{t('Paiement vérifié')}</b>
              <p>{t('Chaque paiement est confirmé par le prestataire avant que la commande ne passe en « payée ».')}</p>
            </div>
          </div>
          <div className="trust__item">
            <Icon name="truck" size={28} />
            <div>
              <b>{t('Prix final, livraison comprise')}</b>
              <p>{t('Le prix affiché inclut le transport jusqu’à votre pays : aucun frais caché au retrait.')}</p>
            </div>
          </div>
          <div className="trust__item">
            <Icon name="pin" size={28} />
            <div>
              <b>{t('Bureaux locaux')}</b>
              <p>{t('Payez et retirez dans un bureau GROUPDEALS de votre ville.')}</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
