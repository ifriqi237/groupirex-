import { Countdown, Deal, DealGrid, Gauge, ReservedNote, taken, unitLabel } from '../components/deal';
import { Empty, ErrorNote, Icon, Loading, ProductImage, useApi } from '../components/ui';
import { useAuth } from '../lib/auth';
import { N_, formatNumber, useI18n, useT } from '../lib/i18n';
import { asset } from '../lib/env';
import { Link } from '../lib/router';
import { HeroCarousel } from '../components/hero';

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

/** L'offre mise en avant, « en direct », posée sur une pile de cartes : c'est elle qui montre ce qu'est un achat groupé. */
function LiveDeal({ deal }: { deal: Deal }) {
  const t = useT();
  const { lang } = useI18n();
  const got = taken(deal);
  return (
    <div className="livewrap">
      <Link to={`/deals/${deal.slug}`} className="live">
        <div className="live__media">
          {deal.product.cover && <ProductImage src={deal.product.cover.url} alt={deal.product.cover.alt} width="800" height="500" />}
          <span className="live__flag">{t('En vedette')}</span>
          {deal.discountPercent ? <span className="badge badge--deal num">−{deal.discountPercent} %</span> : null}
        </div>
        <div className="live__body">
          <div>
            <div className="live__cat">{deal.product.category.name}</div>
            <h2>{deal.title}</h2>
          </div>
          <div className="row row--wrap" style={{ alignItems: 'baseline' }}>
            {deal.price && <span className="price price--xl">{deal.price.formatted}</span>}
            {deal.compareAtPrice && <span className="price-old">{deal.compareAtPrice.formatted}</span>}
          </div>
          <div>
            <Gauge percent={deal.progress.percent} reserved={got.percent - deal.progress.percent} large label={t('Progression de la commande groupée')} />
            <div className="gauge-legend">
              <span className="num">
                <b>{formatNumber(got.n, lang)}</b> / {formatNumber(deal.progress.target, lang)} {unitLabel(deal.product.saleUnit, deal.progress.target, t)}
              </span>
              <span className="num">{t('{n} participants', { n: deal.progress.participants })}</span>
            </div>
            <ReservedNote deal={deal} />
          </div>
          <div className="live__time"><Countdown deal={deal} /></div>
          <span className="btn btn--navy btn--block">{t('Participer au GroupDeals')}</span>
        </div>
      </Link>
    </div>
  );
}

const STEPS: [icon: string, title: string, text: string][] = [
  ['tag', N_('Choisissez une offre'), N_('Indiquez votre quantité : le prix affiché est final, livraison comprise.')],
  ['card', N_('Payez en ligne ou au bureau'), N_('Mobile Money, carte bancaire, ou au bureau GROUPDEALS de votre pays.')],
  ['ship', N_('Suivez le conteneur'), N_('Neuf étapes, de l’usine au port, puis jusqu’à votre ville.')],
  ['pin', N_('Retirez votre colis'), N_('Au bureau de retrait choisi, sur présentation de votre QR code.')],
];

export function HomePage() {
  const t = useT();
  const { lang } = useI18n();
  const { country } = useAuth();
  const { data, error, loading, reload } = useApi<HomeData>(`/home?c=${country}`);

  return (
    <>
      <HeroCarousel
        badge={data && data.featured.length > 0 ? (
          <p className="hero__badge">
            <Icon name="ship" size={16} />
            {data.featured.length > 1 ? t('{n} commandes groupées ouvertes', { n: data.featured.length }) : t('1 commande groupée ouverte')}
          </p>
        ) : undefined}
        title={t('Achetons ensemble, Obtenons des prix bas')}
        lead={t('Rejoignez une commande groupée, payez un seul prix livraison comprise, et suivez votre colis jusqu’au retrait.')}
        aside={data?.featured[0] ? <LiveDeal deal={data.featured[0]} /> : undefined}
      />

      <section className="how" aria-labelledby="how">
        <div className="wrap">
          <h2 className="h2" id="how">{t('Comment ça marche')}</h2>
          <p className="how__lead">{t('Un achat groupé suit toujours le même chemin, de l’usine jusqu’au bureau de retrait de votre ville.')}</p>
          <ol className="how__steps">
            {STEPS.map(([icon, title, text], i) => (
              <li key={icon}>
                <span className="how__icon"><Icon name={icon} size={30} /></span>
                <span className="how__n num">{i + 1}</span>
                <h3>{t(title)}</h3>
                <p>{t(text)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="wrap">
        {loading && !data && <Loading />}
        <ErrorNote error={error} onRetry={reload} />
        {data && (
          <section className="section" style={{ marginTop: 24, marginBottom: 64 }} aria-labelledby="cats">
            <div className="section__head">
              <h2 className="h2" id="cats">{t('Catégories')}</h2>
            </div>
            <div className="cats">
              {data.categories.map((c) => (
                <Link key={c.id} to={`/deals?category=${c.slug}`} className="cat">
                  {c.imageUrl && <img src={c.imageUrl} alt="" loading="lazy" width="232" height="232" />}
                  <span className="cat__label">
                    <b>{c.name}</b>
                    {c.activeDeals > 0 && <span className="tiny num">{c.activeDeals > 1 ? t('{n} offres', { n: c.activeDeals }) : t('1 offre')}</span>}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      {data && (
        <div className="band band--rose">
          <div className="wrap">
            <section className="section" aria-labelledby="featured">
              <div className="section__head">
                <h2 className="h2" id="featured">{t('Offres en cours')}</h2>
                <Link to="/deals" className="link">{t('Tout voir')}</Link>
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
                  <h2 className="h2" id="ending">{t('Se terminent bientôt')}</h2>
                  <Link to="/deals?sort=ending" className="link">{t('Tout voir')}</Link>
                </div>
                <DealGrid deals={data.endingSoon} />
              </section>
            )}

            {/* Toujours affiché : sans campagne à venir, un message prend la place des cartes. */}
            <section className="section" aria-labelledby="upcoming">
              <div className="section__head">
                <h2 className="h2" id="upcoming">{t('Bientôt ouvertes')}</h2>
              </div>
              {data.upcoming.length > 0 ? (
                <DealGrid deals={data.upcoming} />
              ) : (
                <Empty title={t('Aucune commande groupée à venir pour le moment')}>
                  {t('Les prochaines campagnes s’afficheront ici avant leur ouverture.')}
                </Empty>
              )}
            </section>
          </div>
        </div>
      )}

      <div className="wrap" style={{ paddingBlock: '72px' }}>
        <section className="match">
          <img src={asset('/welcome/map.svg')} alt="" aria-hidden="true" />
          <div className="match__text">
            <h2 className="h2">{t('Vous ne trouvez pas votre produit ?')}</h2>
            <p>{t('Dites ce que vous recherchez. Les autres membres cliquent « Je veux aussi ce produit », et les demandes les plus suivies deviennent des commandes groupées.')}</p>
          </div>
          <Link to="/matching" className="btn btn--navy btn--l">{t('Publier une demande')}</Link>
        </section>
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
