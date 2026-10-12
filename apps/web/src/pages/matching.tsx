import { useState } from 'react';
import { Gauge } from '../components/deal';
import { Empty, ErrorNote, Form, Icon, Input, Loading, Modal, Select, Tabs, Textarea, useAction, useApi, useToast } from '../components/ui';
import { ApiError, del, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { N_, formatDate, useI18n, useT } from '../lib/i18n';
import { Link, navigate } from '../lib/router';
import type { Category } from './home';

interface MatchingItem {
  id: string;
  title: string;
  description: string;
  status: 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'CONVERTED' | 'CLOSED';
  category: { slug: string; name: string } | null;
  country: { code: string; name: string };
  desiredQuantity: number | null;
  interestCount: number;
  totalQuantity: number;
  threshold: number;
  author: string;
  isMine: boolean;
  interested: boolean;
  dealSlug: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

const STATUS: Record<string, string> = {
  PENDING_REVIEW: N_('En cours de vérification'),
  PUBLISHED: N_('Publiée'),
  REJECTED: N_('Refusée'),
  CONVERTED: N_('Devenue une offre'),
  CLOSED: N_('Clôturée'),
};

function MatchingCard({ item, onChange }: { item: MatchingItem; onChange: () => void }) {
  const t = useT();
  const { lang } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const [ask, setAsk] = useState(false);
  const [quantity, setQuantity] = useState('');

  const join = useAction(async () => {
    await post(`/matching/${item.id}/interest`, { quantity: quantity ? Number(quantity) : null });
    setAsk(false);
    toast(t('C’est noté : vous voulez aussi ce produit'));
    onChange();
  });
  const leave = useAction(async () => {
    await del(`/matching/${item.id}/interest`);
    onChange();
  });
  const pct = Math.round((item.interestCount / Math.max(1, item.threshold)) * 100);

  return (
    <article className="panel stack">
      <div className="row row--between row--top">
        <div className="grow">
          <h3 className="h3">{item.title}</h3>
          <p className="small muted" style={{ marginTop: 2 }}>
            {item.author}, {item.country.name}, {formatDate(item.createdAt, lang)}
          </p>
        </div>
        {item.category && <span className="badge">{item.category.name}</span>}
      </div>
      {item.description && <p style={{ maxWidth: '68ch' }}>{item.description}</p>}

      {item.status !== 'PUBLISHED' && item.status !== 'CONVERTED' && (
        <div className={`notice ${item.status === 'REJECTED' ? 'notice--error' : ''}`}>
          <Icon name="info" />
          <span>
            <b>{t(STATUS[item.status])}.</b> {item.status === 'PENDING_REVIEW' ? t('Votre demande sera visible de tous après vérification.') : (item.rejectionReason ?? '')}
          </span>
        </div>
      )}

      {(item.status === 'PUBLISHED' || item.status === 'CONVERTED') && (
        <div>
          <Gauge percent={pct} label={t('Membres intéressés')} />
          <div className="gauge-legend">
            <span className="num">
              <b>{t('{n} membres intéressés', { n: item.interestCount })}</b>
              {item.totalQuantity > 0 ? `, ${t('{n} unités souhaitées', { n: item.totalQuantity })}` : ''}
            </span>
          </div>
        </div>
      )}

      {item.status === 'CONVERTED' && item.dealSlug && (
        <div className="row row--between row--wrap">
          <span className="badge badge--green">{t('Cette demande est devenue une offre')}</span>
          <Link to={`/deals/${item.dealSlug}`} className="btn btn--primary btn--s">{t('Voir l’offre')}</Link>
        </div>
      )}

      {item.status === 'PUBLISHED' && (
        <div>
          <ErrorNote error={join.error ?? leave.error} />
          {item.interested ? (
            <div className="row row--between row--wrap">
              <span className="badge badge--green"><Icon name="check" size={14} /> {t('Vous voulez aussi ce produit')}</span>
              <button className="link small" onClick={() => leave.run()} disabled={leave.busy}>{t('Je ne suis plus intéressé')}</button>
            </div>
          ) : item.isMine ? (
            <p className="small muted">{t('C’est votre demande. Partagez-la pour rassembler plus de membres.')}</p>
          ) : (
            <button
              className="btn btn--navy"
              onClick={() => (user ? setAsk(true) : navigate(`/login?next=${encodeURIComponent('/matching')}`))}
            >
              {t('Je veux aussi ce produit')}
            </button>
          )}
        </div>
      )}

      {ask && (
        <Modal title={t('Je veux aussi ce produit')} onClose={() => setAsk(false)}>
          <Form onSubmit={() => join.run()}>
            <p className="muted">{item.title}</p>
            <Input label={t('Quelle quantité vous faudrait-il ? (facultatif)')} type="number" min={1} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} hint={t('Cette indication aide GROUPDEALS à négocier avec le fabricant. Elle ne vous engage pas.')} />
            <ErrorNote error={join.error} />
            <button className="btn btn--primary btn--block" disabled={join.busy}>{t('Confirmer mon intérêt')}</button>
          </Form>
        </Modal>
      )}
    </article>
  );
}

export function MatchingPage() {
  const t = useT();
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'popular' | 'recent' | 'mine'>('popular');
  const [creating, setCreating] = useState(false);
  const list = useApi<{ items: MatchingItem[] }>(tab === 'mine' ? (user ? '/matching/mine' : null) : `/matching${qs({ sort: tab, pageSize: 50 })}`);
  const cats = useApi<{ categories: Category[] }>('/categories');
  const [form, setForm] = useState({ title: '', description: '', categoryId: '', desiredQuantity: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const create = useAction(async () => {
    setFieldErrors({});
    try {
      await post('/matching', {
        title: form.title,
        description: form.description,
        categoryId: form.categoryId || null,
        desiredQuantity: form.desiredQuantity ? Number(form.desiredQuantity) : null,
      });
    } catch (e) {
      setFieldErrors((e as ApiError).fields);
      throw e;
    }
    setCreating(false);
    setForm({ title: '', description: '', categoryId: '', desiredQuantity: '' });
    toast(t('Demande envoyée. Elle sera publiée après vérification.'));
    setTab('mine');
    list.reload();
  });

  return (
    <div className="wrap wrap--narrow page">
      <div className="row row--between row--wrap row--top">
        <div>
          <h1 className="h1">{t('Matching')}</h1>
          <p className="muted" style={{ marginTop: 6, maxWidth: '56ch' }}>
            {t('Dites quel produit vous recherchez. Quand assez de membres veulent le même, GROUPDEALS étudie une commande groupée.')}
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => (user ? setCreating(true) : navigate(`/login?next=${encodeURIComponent('/matching')}`))}>
          <Icon name="plus" /> {t('Publier une demande')}
        </button>
      </div>

      <div style={{ marginTop: 20 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'popular', label: t('Les plus demandées') },
            { value: 'recent', label: t('Les plus récentes') },
            ...(user ? [{ value: 'mine' as const, label: t('Mes demandes') }] : []),
          ]}
        />
      </div>

      <div className="stack" style={{ marginTop: 20 }}>
        {list.loading && !list.data && <Loading />}
        <ErrorNote error={list.error} onRetry={list.reload} />
        {list.data && list.data.items.length === 0 && (
          <Empty title={tab === 'mine' ? t('Vous n’avez publié aucune demande') : t('Aucune demande pour le moment')} action={<button className="btn btn--navy" onClick={() => (user ? setCreating(true) : navigate('/login?next=%2Fmatching'))}>{t('Publier une demande')}</button>}>
            {t('Décrivez le produit que vous aimeriez importer à plusieurs.')}
          </Empty>
        )}
        {list.data?.items.map((m) => <MatchingCard key={m.id} item={m} onChange={list.reload} />)}
      </div>

      {creating && (
        <Modal title={t('Que recherchez-vous ?')} onClose={() => setCreating(false)}>
          <Form onSubmit={() => create.run()}>
            <Input label={t('Produit recherché')} placeholder={t('Ex. : panneaux solaires 550 W')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={140} required error={fieldErrors.title && N_('Décrivez le produit en 5 caractères au moins.')} />
            <Textarea label={t('Précisions')} placeholder={t('Modèle, qualité, usage, budget…')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
            <div className="form-grid form-grid--2">
              <Select label={t('Catégorie')} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">{t('Autre')}</option>
                {cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Input label={t('Quantité souhaitée')} type="number" min={1} inputMode="numeric" value={form.desiredQuantity} onChange={(e) => setForm({ ...form, desiredQuantity: e.target.value })} />
            </div>
            {create.error && !Object.keys(fieldErrors).length && <ErrorNote error={create.error} />}
            <button className="btn btn--primary btn--block" disabled={create.busy}>{t('Envoyer ma demande')}</button>
            <p className="small muted">{t('Votre demande est vérifiée avant publication. Seuls votre prénom et l’initiale de votre nom sont affichés.')}</p>
          </Form>
        </Modal>
      )}
    </div>
  );
}
