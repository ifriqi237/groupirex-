import { PRODUCT_MEDIA_LIMITS } from '@groupdeals/core';
import { useEffect, useRef, useState } from 'react';
import { ErrorNote, Form, Icon, Input, Loading, Modal, Select, Tabs, Textarea, useAction, useApi, useToast } from '../components/ui';
import { ApiError, api, del, post, put, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';
import { Link, navigate, useLocation } from '../lib/router';
import { Confirm, DataTable, IconButton, MoneyField, Page, Pill, RowActions, fromMinor, toMinor, useCurrencies } from './kit';

/* -------------------------------------------------------------------------- */
/* Catégories                                                                  */
/* -------------------------------------------------------------------------- */

interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  i18n: Record<string, Record<string, string>>;
  productsCount: number;
}

/** Envoie un fichier au serveur, qui le recompresse ; renvoie ses adresses. */
export async function uploadMedia(file: File): Promise<{ kind: 'IMAGE' | 'VIDEO'; url: string; thumbnailUrl: string | null }> {
  return api('POST', '/admin/media', file, { 'Content-Type': file.type });
}

function CategoryForm({ category, onDone, onClose }: { category: AdminCategory | null; onDone: () => void; onClose: () => void }) {
  const t = useT();
  const [f, setF] = useState({
    name: category?.name ?? '',
    description: category?.description ?? '',
    imageUrl: category?.imageUrl ?? '',
    videoUrl: category?.videoUrl ?? '',
    icon: category?.icon ?? '',
    isActive: category?.isActive ?? true,
    nameEn: category?.i18n?.en?.name ?? '',
    descriptionEn: category?.i18n?.en?.description ?? '',
  });
  const upload = useAction(async (file: File) => {
    const m = await uploadMedia(file);
    setF((s) => ({ ...s, imageUrl: m.url }));
  });
  const save = useAction(async () => {
    const body = {
      name: f.name, description: f.description, icon: f.icon || null, imageUrl: f.imageUrl || null, videoUrl: f.videoUrl || null,
      sortOrder: category?.sortOrder ?? 99, isActive: f.isActive,
      i18n: { ...(category?.i18n ?? {}), en: { name: f.nameEn, description: f.descriptionEn } },
    };
    await (category ? put(`/admin/categories/${category.id}`, body) : post('/admin/categories', body));
    onDone();
    onClose();
  });
  return (
    <Modal title={category ? t('Modifier la catégorie') : t('Nouvelle catégorie')} onClose={onClose}>
      <Form onSubmit={() => save.run()}>
        <Input label={t('Nom')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <Textarea label={t('Description')} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ minHeight: 70 }} />
        <div className="form-grid form-grid--2">
          <Input label={t('Nom en anglais')} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
          <Input label={t('Description en anglais')} value={f.descriptionEn} onChange={(e) => setF({ ...f, descriptionEn: e.target.value })} />
        </div>
        <div className="row row--top">
          {f.imageUrl && <img src={f.imageUrl} alt="" style={{ width: 84, height: 68, objectFit: 'cover', borderRadius: 10 }} />}
          <label className="field grow">
            <span className="field__label">{t('Image')}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && upload.run(e.target.files[0])} />
            <span className="field__hint">{t('JPEG, PNG ou WebP. L’image est recompressée automatiquement.')}</span>
          </label>
        </div>
        <Input label={t('Adresse de la vidéo (facultatif)')} value={f.videoUrl} onChange={(e) => setF({ ...f, videoUrl: e.target.value })} />
        <label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /><span>{t('Visible sur le site')}</span></label>
        <ErrorNote error={save.error ?? upload.error} />
        <button className="btn btn--primary" disabled={save.busy || upload.busy}>{t('Enregistrer')}</button>
      </Form>
    </Modal>
  );
}

export function CategoriesPage() {
  const t = useT();
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useApi<{ categories: AdminCategory[] }>('/admin/categories');
  const [editing, setEditing] = useState<AdminCategory | null | 'new'>(null);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);
  const manage = can('catalog.manage');
  const move = useAction(async (index: number, delta: number) => {
    const ids = data!.categories.map((c) => c.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    await post('/admin/categories/reorder', { ids });
    reload();
  });
  return (
    <Page title={t('Catégories')} actions={manage && <button className="btn btn--primary" onClick={() => setEditing('new')}><Icon name="plus" /> {t('Nouvelle catégorie')}</button>}>
      <ErrorNote error={error ?? move.error} onRetry={reload} />
      <DataTable
        rows={data?.categories}
        rowKey={(c) => c.id}
        empty={t('Aucune catégorie.')}
        columns={[
          { head: t('Ordre'), width: 96, cell: (c) => {
            const i = data!.categories.indexOf(c);
            return manage ? (
              <span className="row" style={{ gap: 0 }}>
                <IconButton icon="up" label={t('Monter')} disabled={i === 0 || move.busy} onClick={() => move.run(i, -1)} />
                <IconButton icon="down" label={t('Descendre')} disabled={i === data!.categories.length - 1 || move.busy} onClick={() => move.run(i, 1)} />
              </span>
            ) : <span className="num">{i + 1}</span>;
          } },
          { head: t('Catégorie'), cell: (c) => <span className="row">{c.imageUrl && <img src={c.imageUrl} alt="" style={{ width: 44, height: 36, objectFit: 'cover', borderRadius: 6 }} />}<span><span className="strong">{c.name}</span><br /><span className="tiny muted">{c.description}</span></span></span> },
          { head: t('Produits'), right: true, cell: (c) => c.productsCount },
          { head: t('État'), cell: (c) => (c.isActive ? <Pill tone="green">{t('Visible')}</Pill> : <Pill>{t('Masquée')}</Pill>) },
          { head: '', cell: (c) => manage && (
            <RowActions>
              <IconButton icon="edit" label={t('Modifier')} onClick={() => setEditing(c)} />
              {can('categories.delete') && <IconButton icon="trash" label={t('Supprimer')} onClick={() => setDeleting(c)} />}
            </RowActions>
          ) },
        ]}
      />
      {editing && <CategoryForm category={editing === 'new' ? null : editing} onDone={reload} onClose={() => setEditing(null)} />}
      {deleting && (
        <Confirm title={t('Supprimer « {name} » ?', { name: deleting.name })} confirmLabel={t('Supprimer')} danger onClose={() => setDeleting(null)}
          onConfirm={async () => { await del(`/admin/categories/${deleting.id}`); toast(t('Catégorie supprimée')); reload(); }}>
          <p>{t('Une catégorie qui contient des produits ne peut pas être supprimée : désactivez-la plutôt.')}</p>
        </Confirm>
      )}
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Produits                                                                    */
/* -------------------------------------------------------------------------- */

interface AdminProduct {
  id: string;
  categoryId: string;
  categoryName: string;
  slug: string;
  name: string;
  description: string;
  features: string[];
  specifications: { label: string; value: string }[];
  originCountry: string | null;
  leadTimeDaysMin: number | null;
  leadTimeDaysMax: number | null;
  saleUnit: string;
  piecesPerSaleUnit: number;
  moq: number;
  maxPerOrder: number | null;
  basePrice: { amount: number; currency: string };
  compareAtAmount: number | null;
  supplierCost: { amount: number; currency: string } | null;
  isActive: boolean;
  i18n: Record<string, any>;
  cover: { url: string; thumbnailUrl: string | null } | null;
  countriesCount: number;
  dealsCount: number;
}

export function ProductsPage() {
  const t = useT();
  const { can } = useAuth();
  const cur = useCurrencies();
  const [q, setQ] = useState('');
  const { data, error, reload } = useApi<{ items: AdminProduct[]; total: number }>(`/admin/products${qs({ q, pageSize: 100 })}`);
  return (
    <Page title={t('Produits')} actions={can('catalog.manage') && <Link to="/admin/products/new" className="btn btn--primary"><Icon name="plus" /> {t('Nouveau produit')}</Link>}>
      <div className="toolbar"><input className="input input--s" placeholder={t('Rechercher un produit')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} /></div>
      <ErrorNote error={error} onRetry={reload} />
      <DataTable
        rows={data?.items}
        rowKey={(p) => p.id}
        empty={t('Aucun produit. Créez le premier.')}
        columns={[
          { head: t('Produit'), cell: (p) => <span className="row">{p.cover && <img src={p.cover.thumbnailUrl ?? p.cover.url} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8 }} />}<span><Link to={`/admin/products/${p.id}`}>{p.name}</Link><br /><span className="tiny muted">{p.categoryName}</span></span></span> },
          { head: t('Prix de base'), right: true, cell: (p) => `${fromMinor(p.basePrice.amount, cur.decimals(p.basePrice.currency))} ${p.basePrice.currency}` },
          { head: t('MOQ'), right: true, cell: (p) => p.moq },
          { head: t('Pays desservis'), right: true, cell: (p) => (p.countriesCount > 0 ? p.countriesCount : <Pill tone="amber">{t('Aucun')}</Pill>) },
          { head: t('Campagnes'), right: true, cell: (p) => p.dealsCount },
          { head: t('État'), cell: (p) => (p.isActive ? <Pill tone="green">{t('Actif')}</Pill> : <Pill>{t('Désactivé')}</Pill>) },
        ]}
      />
    </Page>
  );
}

const UNITS = ['UNIT', 'LOT', 'CARTON', 'PALLET'] as const;

function ProductInfo({ product, onSaved }: { product: AdminProduct | null; onSaved: (id: string) => void }) {
  const t = useT();
  const cur = useCurrencies();
  const cats = useApi<{ categories: AdminCategory[] }>('/admin/categories');
  const dec = (code: string) => cur.decimals(code);
  const unitLabels: Record<string, string> = { UNIT: t('Unité'), LOT: t('Lot'), CARTON: t('Carton'), PALLET: t('Palette') };
  const [f, setF] = useState(() => ({
    categoryId: product?.categoryId ?? '',
    name: product?.name ?? '',
    description: product?.description ?? '',
    features: (product?.features ?? []).join('\n'),
    specifications: (product?.specifications ?? []).map((s) => `${s.label} : ${s.value}`).join('\n'),
    originCountry: product?.originCountry ?? '',
    leadMin: product?.leadTimeDaysMin?.toString() ?? '',
    leadMax: product?.leadTimeDaysMax?.toString() ?? '',
    saleUnit: product?.saleUnit ?? 'UNIT',
    pieces: String(product?.piecesPerSaleUnit ?? 1),
    moq: String(product?.moq ?? 1),
    maxPerOrder: product?.maxPerOrder?.toString() ?? '',
    baseAmount: '', baseCurrency: product?.basePrice.currency ?? 'USD',
    compareAt: '',
    supplierAmount: '', supplierCurrency: product?.supplierCost?.currency ?? 'USD',
    isActive: product?.isActive ?? true,
    nameEn: product?.i18n?.en?.name ?? '',
    descriptionEn: product?.i18n?.en?.description ?? '',
  }));
  // Les montants ne peuvent être affichés qu'une fois les décimales des devises connues.
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || !cur.list.length || !product) return;
    filled.current = true;
    setF((s) => ({
      ...s,
      baseAmount: fromMinor(product.basePrice.amount, dec(product.basePrice.currency)),
      compareAt: fromMinor(product.compareAtAmount, dec(product.basePrice.currency)),
      supplierAmount: product.supplierCost ? fromMinor(product.supplierCost.amount, dec(product.supplierCost.currency)) : '',
    }));
  }, [cur.list.length, product]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const [problem, setProblem] = useState('');

  const save = useAction(async () => {
    setProblem('');
    const base = toMinor(f.baseAmount, dec(f.baseCurrency));
    if (base === null) return setProblem(t('Le prix de base est invalide.'));
    const compareAt = f.compareAt.trim() ? toMinor(f.compareAt, dec(f.baseCurrency)) : null;
    const supplier = f.supplierAmount.trim() ? toMinor(f.supplierAmount, dec(f.supplierCurrency)) : null;
    if (f.compareAt.trim() && compareAt === null) return setProblem(t('L’ancien prix est invalide.'));
    if (f.supplierAmount.trim() && supplier === null) return setProblem(t('Le coût fournisseur est invalide.'));
    if (!f.categoryId) return setProblem(t('Choisissez une catégorie.'));
    const body = {
      categoryId: f.categoryId, name: f.name, description: f.description,
      features: f.features.split('\n').map((x) => x.trim()).filter(Boolean),
      specifications: f.specifications.split('\n').map((line) => { const i = line.indexOf(':'); return i > 0 ? { label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() } : null; }).filter((x) => x && x.label && x.value),
      originCountry: f.originCountry || null,
      leadTimeDaysMin: f.leadMin ? Number(f.leadMin) : null, leadTimeDaysMax: f.leadMax ? Number(f.leadMax) : null,
      saleUnit: f.saleUnit, piecesPerSaleUnit: Number(f.pieces) || 1, moq: Number(f.moq) || 1, maxPerOrder: f.maxPerOrder ? Number(f.maxPerOrder) : null,
      basePrice: { amount: base, currency: f.baseCurrency }, compareAtAmount: compareAt,
      supplierCost: supplier === null ? null : { amount: supplier, currency: f.supplierCurrency },
      isActive: f.isActive,
      i18n: { ...(product?.i18n ?? {}), en: { ...(product?.i18n?.en ?? {}), name: f.nameEn, description: f.descriptionEn } },
    };
    const res = await (product ? put(`/admin/products/${product.id}`, body) : post('/admin/products', body));
    onSaved(res.id);
  });

  return (
    <Form onSubmit={() => save.run()}>
      <div className="card stack">
        <div className="form-grid form-grid--2">
          <Input label={t('Nom du produit')} value={f.name} onChange={set('name')} required />
          <Select label={t('Catégorie')} value={f.categoryId} onChange={set('categoryId')}>
            <option value="">{t('Choisir')}</option>
            {cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <Textarea label={t('Description')} value={f.description} onChange={set('description')} />
        <div className="form-grid form-grid--2">
          <Textarea label={t('Caractéristiques')} hint={t('Une par ligne.')} value={f.features} onChange={set('features')} />
          <Textarea label={t('Spécifications')} hint={t('Une par ligne, au format « Libellé : valeur ».')} value={f.specifications} onChange={set('specifications')} />
        </div>
        <div className="form-grid form-grid--2">
          <Input label={t('Nom en anglais')} value={f.nameEn} onChange={set('nameEn')} />
          <Input label={t('Description en anglais')} value={f.descriptionEn} onChange={set('descriptionEn')} />
        </div>
      </div>

      <div className="card stack">
        <h2 className="h3">{t('Vente')}</h2>
        <div className="form-grid form-grid--3">
          <Select label={t('Unité de vente')} value={f.saleUnit} onChange={set('saleUnit')}>
            {UNITS.map((u) => <option key={u} value={u}>{unitLabels[u]}</option>)}
          </Select>
          <Input label={t('Pièces par unité de vente')} type="number" min={1} value={f.pieces} onChange={set('pieces')} hint={t('1 pour une vente à l’unité.')} />
          <Input label={t('Quantité minimum (MOQ)')} type="number" min={1} value={f.moq} onChange={set('moq')} hint={t('En unités de vente, par commande.')} />
          <Input label={t('Quantité maximum par commande')} type="number" min={1} value={f.maxPerOrder} onChange={set('maxPerOrder')} hint={t('Vide : pas de limite.')} />
          <Input label={t('Origine')} value={f.originCountry} onChange={set('originCountry')} placeholder="Chine — Guangzhou" />
          <div className="form-grid form-grid--2" style={{ gap: 8 }}>
            <Input label={t('Délai min. (jours)')} type="number" min={0} value={f.leadMin} onChange={set('leadMin')} />
            <Input label={t('Délai max. (jours)')} type="number" min={0} value={f.leadMax} onChange={set('leadMax')} />
          </div>
        </div>
      </div>

      <div className="card stack">
        <h2 className="h3">{t('Prix')}</h2>
        <p className="small muted">{t('Le prix de base est commun à tous les pays. La livraison se règle pays par pays dans l’onglet « Prix par pays » ; le client ne voit que le total des deux.')}</p>
        <div className="form-grid form-grid--3">
          <MoneyField label={t('Prix de base, par unité de vente')} amount={f.baseAmount} currency={f.baseCurrency} currencies={cur.list} onChange={(a, c) => setF({ ...f, baseAmount: a, baseCurrency: c })} />
          <MoneyField label={t('Ancien prix barré (facultatif)')} amount={f.compareAt} currency={f.baseCurrency} currencies={cur.list} fixedCurrency allowEmpty onChange={(a) => setF({ ...f, compareAt: a })} hint={t('Hors livraison, dans la devise du prix de base.')} />
          <MoneyField label={t('Coût d’achat fournisseur (interne)')} amount={f.supplierAmount} currency={f.supplierCurrency} currencies={cur.list} allowEmpty onChange={(a, c) => setF({ ...f, supplierAmount: a, supplierCurrency: c })} hint={t('Jamais montré au client. Sert au calcul de la marge.')} />
        </div>
        <label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /><span>{t('Produit actif')}</span></label>
      </div>

      {problem && <div className="notice notice--error" role="alert"><Icon name="alert" /><span>{problem}</span></div>}
      <ErrorNote error={save.error} />
      <div><button className="btn btn--primary" disabled={save.busy}>{product ? t('Enregistrer') : t('Créer le produit')}</button></div>
    </Form>
  );
}

function ProductVariants({ productId, initial, baseCurrency, onSaved }: { productId: string; initial: any[]; baseCurrency: string; onSaved: () => void }) {
  const t = useT();
  const cur = useCurrencies();
  const toast = useToast();
  const dec = cur.decimals(baseCurrency);
  const [rows, setRows] = useState<{ id?: string; sku: string; label: string; delta: string; isActive: boolean }[]>([]);
  useEffect(() => {
    if (!cur.list.length) return;
    setRows(initial.map((v) => ({ id: v.id, sku: v.sku, label: v.label, delta: v.priceDeltaAmount ? fromMinor(v.priceDeltaAmount, dec) : '', isActive: v.isActive })));
  }, [initial, cur.list.length]);
  const update = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const save = useAction(async () => {
    await put(`/admin/products/${productId}/variants`, {
      variants: rows.filter((r) => r.label.trim() && r.sku.trim()).map((r, i) => ({ id: r.id, sku: r.sku.trim(), label: r.label.trim(), priceDeltaAmount: r.delta.trim() ? (toMinor(r.delta, dec) ?? 0) : 0, sortOrder: i, isActive: r.isActive })),
    });
    toast(t('Variantes enregistrées'));
    onSaved();
  });
  return (
    <div className="card stack">
      <p className="small muted">{t('Tailles, couleurs, pointures… Quand un produit a des variantes, le client répartit sa quantité entre elles ; le minimum de commande porte sur le total.')}</p>
      {rows.map((r, i) => (
        <div className="form-grid form-grid--3" key={i} style={{ alignItems: 'end' }}>
          <Input label={t('Libellé')} value={r.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="Noir / 42" />
          <Input label={t('Référence (SKU)')} value={r.sku} onChange={(e) => update(i, { sku: e.target.value })} />
          <div className="row" style={{ alignItems: 'end' }}>
            <div className="grow"><Input label={t('Supplément de prix ({currency})', { currency: baseCurrency })} value={r.delta} onChange={(e) => update(i, { delta: e.target.value })} inputMode="decimal" /></div>
            <label className="check" style={{ paddingBottom: 12 }}><input type="checkbox" checked={r.isActive} onChange={(e) => update(i, { isActive: e.target.checked })} /><span className="small">{t('Active')}</span></label>
            <IconButton icon="trash" label={t('Retirer')} onClick={() => setRows((x) => x.filter((_, n) => n !== i))} />
          </div>
        </div>
      ))}
      <div className="row">
        <button className="btn btn--ghost btn--s" onClick={() => setRows((r) => [...r, { sku: '', label: '', delta: '', isActive: true }])}><Icon name="plus" size={16} /> {t('Ajouter une variante')}</button>
        <button className="btn btn--primary btn--s" onClick={() => save.run()} disabled={save.busy}>{t('Enregistrer les variantes')}</button>
      </div>
      <ErrorNote error={save.error} />
    </div>
  );
}

function ProductMedia({ productId, initial, onSaved }: { productId: string; initial: any[]; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const [items, setItems] = useState<{ kind: string; url: string; thumbnailUrl: string | null; alt: string }[]>(initial);
  useEffect(() => setItems(initial), [initial]);
  const photos = items.filter((m) => m.kind === 'IMAGE').length;
  const videos = items.filter((m) => m.kind === 'VIDEO').length;
  const upload = useAction(async (files: FileList) => {
    // Le carrousel de la page d'une offre présente au plus dix photos et une vidéo : les fichiers en trop ne sont pas envoyés.
    const room = { IMAGE: PRODUCT_MEDIA_LIMITS.photos - photos, VIDEO: PRODUCT_MEDIA_LIMITS.videos - videos };
    const added = [];
    let refused = 0;
    for (const file of Array.from(files)) {
      const kind = file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE';
      if (room[kind] <= 0) {
        refused++;
        continue;
      }
      room[kind]--;
      added.push({ ...(await uploadMedia(file)), alt: '' });
    }
    setItems((x) => [...x, ...added]);
    if (refused) toast(t('Limite atteinte : dix photos et une vidéo par produit. {n} fichier(s) non ajouté(s).', { n: refused }), true);
  });
  const poster = useAction(async (index: number, file: File) => {
    const m = await uploadMedia(file);
    setItems((x) => x.map((it, i) => (i === index ? { ...it, thumbnailUrl: m.thumbnailUrl ?? m.url } : it)));
  });
  const save = useAction(async () => {
    await put(`/admin/products/${productId}/media`, { media: items });
    toast(t('Médias enregistrés'));
    onSaved();
  });
  const move = (i: number, d: number) => setItems((x) => { const y = [...x]; const [m] = y.splice(i, 1); y.splice(i + d, 0, m); return y; });
  return (
    <div className="card stack">
      <p className="small muted">{t('La première image sert de couverture. Les images sont recompressées en WebP. Une vidéo n’est chargée que lorsque le client lance la lecture : ajoutez-lui une image d’aperçu.')}</p>
      <p className="small">
        {t('La page de l’offre les présente dans un carrousel : jusqu’à dix photos et une vidéo.')}{' '}
        <Pill tone={photos >= PRODUCT_MEDIA_LIMITS.photos ? 'amber' : undefined}>{t('Photos : {n} / {max}', { n: photos, max: PRODUCT_MEDIA_LIMITS.photos })}</Pill>{' '}
        <Pill tone={videos >= PRODUCT_MEDIA_LIMITS.videos ? 'amber' : undefined}>{t('Vidéo : {n} / {max}', { n: videos, max: PRODUCT_MEDIA_LIMITS.videos })}</Pill>
      </p>
      <div className="grid grid--3">
        {items.map((m, i) => (
          <div key={m.url} className="panel" style={{ padding: 10 }}>
            <div style={{ aspectRatio: '4 / 3', background: 'var(--mist)', borderRadius: 10, overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
              {m.kind === 'IMAGE' || m.thumbnailUrl ? <img src={m.thumbnailUrl ?? m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="muted small">{t('Vidéo sans aperçu')}</span>}
            </div>
            <input className="input input--s" style={{ marginTop: 8 }} placeholder={t('Texte alternatif')} value={m.alt} onChange={(e) => setItems((x) => x.map((it, n) => (n === i ? { ...it, alt: e.target.value } : it)))} />
            {m.kind === 'VIDEO' && (
              <label className="tiny" style={{ display: 'block', marginTop: 6 }}>{t('Image d’aperçu')} <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && poster.run(i, e.target.files[0])} /></label>
            )}
            <RowActions>
              <Pill>{m.kind === 'VIDEO' ? t('Vidéo') : i === 0 ? t('Couverture') : t('Image')}</Pill>
              <IconButton icon="up" label={t('Avancer dans l’ordre')} disabled={i === 0} onClick={() => move(i, -1)} />
              <IconButton icon="trash" label={t('Retirer')} onClick={() => setItems((x) => x.filter((_, n) => n !== i))} />
            </RowActions>
          </div>
        ))}
      </div>
      <label className="field">
        <span className="field__label">{t('Ajouter des photos ou des vidéos')}</span>
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={(e) => e.target.files?.length && upload.run(e.target.files)} />
        <span className="field__hint">{t('Images jusqu’à 12 Mo, vidéos MP4 ou WebM jusqu’à 60 Mo.')}</span>
      </label>
      {upload.busy && <p className="small muted">{t('Envoi en cours…')}</p>}
      <ErrorNote error={upload.error ?? poster.error ?? save.error} />
      <div><button className="btn btn--primary btn--s" onClick={() => save.run()} disabled={save.busy || upload.busy}>{t('Enregistrer les médias')}</button></div>
    </div>
  );
}

/**
 * Produit -> Pays -> Tarif (§37). Chaque ligne montre le prix final calculé par le
 * serveur : c'est exactement celui que verra le client de ce pays.
 */
function ProductPricing({ productId }: { productId: string }) {
  const t = useT();
  const cur = useCurrencies();
  const toast = useToast();
  const { data, error, reload } = useApi<any>(`/admin/products/${productId}/pricing`);
  const [rows, setRows] = useState<Record<string, { enabled: boolean; amount: string; currency: string; freight: string; customs: string }>>({});
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  useEffect(() => {
    if (!data || !cur.list.length) return;
    setRows(Object.fromEntries(data.countries.map((c: any) => {
      const currency = c.shipping?.currency ?? c.country.currency;
      const d = cur.decimals(currency);
      return [c.country.code, { enabled: c.enabled, amount: c.shipping ? fromMinor(c.shipping.amount, d) : '', currency, freight: c.shipping?.freightCost ? fromMinor(c.shipping.freightCost, d) : '', customs: c.shipping?.customsCost ? fromMinor(c.shipping.customsCost, d) : '' }];
    })));
  }, [data, cur.list.length]);
  const update = (code: string, patch: object) => setRows((r) => ({ ...r, [code]: { ...r[code], ...patch } }));

  const save = useAction(async () => {
    const rates = [];
    for (const [countryCode, r] of Object.entries(rows)) {
      const d = cur.decimals(r.currency);
      const amount = r.amount.trim() === '' ? null : toMinor(r.amount, d);
      if (r.amount.trim() !== '' && amount === null) throw new ApiError(400, 'VALIDATION_FAILED', t('Un tarif de livraison est invalide ({country}).', { country: countryCode }));
      rates.push({ countryCode, enabled: r.enabled, amount, currency: r.currency, freightCost: toMinor(r.freight || '0', d) ?? 0, customsCost: toMinor(r.customs || '0', d) ?? 0 });
    }
    await put(`/admin/products/${productId}/shipping-rates`, { rates });
    toast(t('Tarifs enregistrés'));
    reload();
  });

  if (!data) return error ? <ErrorNote error={error} onRetry={reload} /> : <Loading />;
  const list = data.countries.filter((c: any) => !onlyEnabled || rows[c.country.code]?.enabled);
  return (
    <div className="stack">
      <div className="card small">
        <p><b>{t('Prix GROUPDEALS = prix du produit + livraison du pays.')}</b> {t('Le client voit un seul prix ; ce tableau est la vue interne.')}</p>
      </div>
      <div className="toolbar">
        <label className="check"><input type="checkbox" checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)} /><span className="small">{t('Afficher seulement les pays desservis')}</span></label>
      </div>
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('Pays')}</th><th>{t('Desservi')}</th><th>{t('Livraison facturée, par unité')}</th>
              {data.canSeeMargins && <th>{t('Coût de fret')}</th>}
              {data.canSeeMargins && <th>{t('Douane')}</th>}
              <th className="r">{t('Prix final client')}</th>
              {data.canSeeMargins && <th className="r">{t('Marge estimée')}</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((c: any) => {
              const r = rows[c.country.code];
              if (!r) return null;
              return (
                <tr key={c.country.code}>
                  <td><span className="strong">{c.country.name}</span><br /><span className="tiny muted">{c.country.currency}</span></td>
                  <td><input type="checkbox" aria-label={t('Desservi')} checked={r.enabled} disabled={!data.canEdit} onChange={(e) => update(c.country.code, { enabled: e.target.checked })} style={{ width: 20, height: 20 }} /></td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <input className="input input--s num" style={{ width: 110 }} inputMode="decimal" value={r.amount} disabled={!data.canEdit} onChange={(e) => update(c.country.code, { amount: e.target.value })} aria-label={t('Livraison')} />
                      <select className="select select--s" style={{ width: 80 }} value={r.currency} disabled={!data.canEdit} onChange={(e) => update(c.country.code, { currency: e.target.value })} aria-label={t('Devise')}>
                        {cur.list.map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}
                      </select>
                    </span>
                  </td>
                  {data.canSeeMargins && <td><input className="input input--s num" style={{ width: 96 }} inputMode="decimal" value={r.freight} disabled={!data.canEdit} onChange={(e) => update(c.country.code, { freight: e.target.value })} aria-label={t('Coût de fret')} /></td>}
                  {data.canSeeMargins && <td><input className="input input--s num" style={{ width: 96 }} inputMode="decimal" value={r.customs} disabled={!data.canEdit} onChange={(e) => update(c.country.code, { customs: e.target.value })} aria-label={t('Douane')} /></td>}
                  <td className="r num">
                    {c.finalPrice ? (
                      <><span className="strong" style={{ color: 'var(--green-ink)' }}>{c.finalPrice.formatted}</span><br /><span className="tiny muted">{c.components.base.formatted} + {c.components.shipping.formatted}{c.components.rounding.amount ? ` + ${c.components.rounding.formatted}` : ''}</span></>
                    ) : c.enabled || c.shipping ? <Pill tone="amber">{unavailable(c.unavailable, t)}</Pill> : <span className="muted">—</span>}
                  </td>
                  {data.canSeeMargins && <td className="r num">{c.margin ? <span style={{ color: c.margin.negative ? 'var(--red)' : undefined }}>{c.margin.negative ? '−' : ''}{c.margin.amount.formatted}<br /><span className="tiny muted">{c.margin.percent} %</span></span> : <span className="muted">—</span>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ErrorNote error={save.error} />
      {data.canEdit && <div><button className="btn btn--primary" onClick={() => save.run()} disabled={save.busy}>{t('Enregistrer les tarifs')}</button></div>}
    </div>
  );
}

function unavailable(code: string | null, t: (s: string) => string): string {
  if (code === 'COUNTRY_NOT_COVERED') return t('Pays non desservi');
  if (code === 'SHIPPING_RATE_MISSING') return t('Tarif à saisir');
  if (code === 'FX_RATE_MISSING') return t('Taux de change manquant');
  if (code === 'FX_RATE_STALE') return t('Taux de change périmé');
  return t('Indisponible');
}

export function ProductEditPage({ id }: { id: string }) {
  const t = useT();
  const { search } = useLocation();
  const isNew = id === 'new';
  const { data, error, reload } = useApi<{ product: AdminProduct; variants: any[]; media: any[] }>(isNew ? null : `/admin/products/${id}`);
  const tab = (search.get('tab') ?? 'info') as 'info' | 'pricing' | 'variants' | 'media';
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!isNew && !data) return error ? <ErrorNote error={error} onRetry={reload} /> : <Loading />;
  return (
    <Page
      title={isNew ? t('Nouveau produit') : data!.product.name}
      actions={!isNew && <button className="btn btn--danger btn--s" onClick={() => setConfirmDelete(true)}>{t('Supprimer')}</button>}
    >
      <Link to="/admin/products" className="link small">{t('Tous les produits')}</Link>
      {!isNew && (
        <div style={{ marginBlock: 12 }}>
          <Tabs value={tab} onChange={(v) => navigate(`/admin/products/${id}?tab=${v}`, { keepScroll: true })}
            items={[{ value: 'info', label: t('Fiche') }, { value: 'pricing', label: t('Prix par pays') }, { value: 'variants', label: t('Variantes'), count: data!.variants.length }, { value: 'media', label: t('Photos et vidéos'), count: data!.media.length }]} />
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        {(isNew || tab === 'info') && (
          <ProductInfo
            key={data?.product.id ?? 'new'}
            product={data?.product ?? null}
            onSaved={(newId) => { toast(t('Produit enregistré')); if (isNew) navigate(`/admin/products/${newId}?tab=pricing`); else reload(); }}
          />
        )}
        {!isNew && tab === 'pricing' && <ProductPricing productId={id} />}
        {!isNew && tab === 'variants' && <ProductVariants productId={id} initial={data!.variants} baseCurrency={data!.product.basePrice.currency} onSaved={reload} />}
        {!isNew && tab === 'media' && <ProductMedia productId={id} initial={data!.media} onSaved={reload} />}
      </div>
      {confirmDelete && (
        <Confirm title={t('Supprimer ce produit ?')} confirmLabel={t('Supprimer')} danger onClose={() => setConfirmDelete(false)}
          onConfirm={async () => { await del(`/admin/products/${id}`); toast(t('Produit supprimé')); navigate('/admin/products'); }}>
          <p>{t('Le produit disparaît du catalogue. Les commandes passées le conservent. Impossible tant qu’une campagne publiée l’utilise.')}</p>
        </Confirm>
      )}
    </Page>
  );
}
