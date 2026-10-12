import { useState } from 'react';
import { ErrorNote, Form, Icon, Input, Modal, Select, Tabs, useAction, useApi, useToast } from '../components/ui';
import { del, get, patch, post, put, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { N_, formatDate, useI18n, useT } from '../lib/i18n';
import { Link, navigate, useLocation } from '../lib/router';
import { Confirm, DataTable, IconButton, Page, Pill, RowActions } from './kit';

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: N_('Super administrateur'),
  ADMIN: N_('Administrateur'),
  LOGISTICS_MANAGER: N_('Responsable logistique'),
  FINANCE_MANAGER: N_('Responsable financier'),
  OFFICE_MANAGER: N_('Responsable de bureau'),
  OFFICE_AGENT: N_('Agent de bureau'),
  MODERATOR: N_('Modérateur'),
  CUSTOMER: N_('Client'),
};
const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'LOGISTICS_MANAGER', 'FINANCE_MANAGER', 'MODERATOR'];

/* -------------------------------------------------------------------------- */
/* Utilisateurs                                                                */
/* -------------------------------------------------------------------------- */

export function UsersPage() {
  const t = useT();
  const { lang } = useI18n();
  const { can, user: me, countries } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [staff, setStaff] = useState(false);
  const { data, error, reload } = useApi<{ items: any[]; total: number }>(`/admin/users${qs({ q, staff: staff ? '1' : '', pageSize: 100 })}`);
  const [roles, setRoles] = useState<any | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', countryCode: 'CM', whatsapp: '', role: 'ADMIN' });
  const [suspending, setSuspending] = useState<any | null>(null);

  const saveRoles = useAction(async () => {
    await put(`/admin/users/${roles.id}/roles`, { roles: picked });
    setRoles(null);
    toast(t('Rôles enregistrés. L’utilisateur devra se reconnecter.'));
    reload();
  });
  const create = useAction(async () => {
    const res = await post('/admin/users', { email: form.email, firstName: form.firstName, lastName: form.lastName, countryCode: form.countryCode, whatsapp: form.whatsapp.replace(/[\s().-]/g, ''), roles: [form.role] });
    setCreating(false);
    setCreated({ email: form.email, password: res.temporaryPassword });
    reload();
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <Page title={t('Utilisateurs')} intro={data ? t('{n} comptes', { n: data.total }) : undefined}
      actions={can('users.manage') && can('roles.manage') && <button className="btn btn--primary" onClick={() => setCreating(true)}><Icon name="plus" /> {t('Nouveau membre du personnel')}</button>}>
      <div className="toolbar">
        <input className="input input--s" placeholder={t('Nom, email ou WhatsApp')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <label className="check"><input type="checkbox" checked={staff} onChange={(e) => setStaff(e.target.checked)} /><span className="small">{t('Personnel uniquement')}</span></label>
      </div>
      <ErrorNote error={error} onRetry={reload} />
      <DataTable
        rows={data?.items}
        rowKey={(u) => u.id}
        empty={t('Aucun utilisateur ne correspond.')}
        columns={[
          { head: t('Utilisateur'), cell: (u) => <><span className="strong">{u.firstName} {u.lastName}</span><br /><span className="tiny muted">{u.email}</span></> },
          { head: t('Pays'), cell: (u) => u.country.name },
          { head: t('Rôles'), cell: (u) => <span className="row row--wrap" style={{ gap: 4 }}>{u.roles.filter((r: string) => r !== 'CUSTOMER' || u.roles.length === 1).map((r: string) => <Pill key={r} tone={r === 'CUSTOMER' ? undefined : 'navy'}>{t(ROLE_LABEL[r] ?? r)}</Pill>)}{u.offices.map((o: any) => <span key={o.id} className="tiny muted">{o.name}</span>)}</span> },
          { head: t('2FA'), cell: (u) => (u.twoFactorEnabled ? <Pill tone="green">{t('Active')}</Pill> : u.roles.length > 1 ? <Pill tone="amber">{t('À activer')}</Pill> : <span className="muted">—</span>) },
          { head: t('Commandes payées'), right: true, cell: (u) => u.paidOrders },
          { head: t('Dernière connexion'), cell: (u) => formatDate(u.lastLoginAt, lang, true) },
          { head: t('État'), cell: (u) => (u.status === 'ACTIVE' ? <Pill tone="green">{t('Actif')}</Pill> : <Pill tone="red">{t('Suspendu')}</Pill>) },
          { head: '', cell: (u) => (
            <RowActions>
              {can('roles.manage') && <button className="btn btn--ghost btn--s" onClick={() => { setRoles(u); setPicked(u.roles.filter((r: string) => STAFF_ROLES.includes(r))); }}>{t('Rôles')}</button>}
              {can('users.manage') && u.id !== me?.id && <button className="btn btn--ghost btn--s" onClick={() => setSuspending(u)}>{u.status === 'ACTIVE' ? t('Suspendre') : t('Réactiver')}</button>}
            </RowActions>
          ) },
        ]}
      />

      {roles && (
        <Modal title={t('Rôles de {name}', { name: `${roles.firstName} ${roles.lastName}` })} onClose={() => setRoles(null)}>
          <div className="stack">
            {STAFF_ROLES.map((r) => (
              <label className="check" key={r}>
                <input type="checkbox" checked={picked.includes(r)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r] : p.filter((x) => x !== r)))} />
                <span>{t(ROLE_LABEL[r])}</span>
              </label>
            ))}
            <p className="small muted">{t('Les rôles de bureau (responsable, agent) s’attribuent depuis la fiche du bureau. Sans rôle coché, le compte redevient un simple client.')}</p>
            <ErrorNote error={saveRoles.error} />
            <button className="btn btn--primary" disabled={saveRoles.busy} onClick={() => saveRoles.run()}>{t('Enregistrer les rôles')}</button>
          </div>
        </Modal>
      )}
      {creating && (
        <Modal title={t('Nouveau membre du personnel')} onClose={() => setCreating(false)}>
          <Form onSubmit={() => create.run()}>
            <div className="form-grid form-grid--2">
              <Input label={t('Prénom')} value={form.firstName} onChange={set('firstName')} />
              <Input label={t('Nom')} value={form.lastName} onChange={set('lastName')} />
            </div>
            <Input label={t('Adresse email')} type="email" value={form.email} onChange={set('email')} />
            <div className="form-grid form-grid--2">
              <Select label={t('Pays')} value={form.countryCode} onChange={set('countryCode')}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
              <Input label={t('Numéro WhatsApp')} value={form.whatsapp} onChange={set('whatsapp')} placeholder="+237…" />
            </div>
            <Select label={t('Rôle')} value={form.role} onChange={set('role')}>{STAFF_ROLES.map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>)}</Select>
            <ErrorNote error={create.error} />
            <button className="btn btn--primary" disabled={create.busy}>{t('Créer le compte')}</button>
          </Form>
        </Modal>
      )}
      {created && (
        <Modal title={t('Compte créé')} onClose={() => setCreated(null)}>
          <div className="stack">
            <p>{t('Transmettez ce mot de passe provisoire à {email}. Il ne sera plus affiché.', { email: created.email })}</p>
            <div className="pre num" style={{ fontSize: '1.1rem' }}>{created.password}</div>
            <p className="small muted">{t('À la première connexion, la personne devra activer la double authentification puis changer son mot de passe.')}</p>
            <button className="btn btn--navy" onClick={() => setCreated(null)}>{t('J’ai noté le mot de passe')}</button>
          </div>
        </Modal>
      )}
      {suspending && (
        <Confirm title={suspending.status === 'ACTIVE' ? t('Suspendre ce compte ?') : t('Réactiver ce compte ?')} confirmLabel={suspending.status === 'ACTIVE' ? t('Suspendre') : t('Réactiver')} danger={suspending.status === 'ACTIVE'} onClose={() => setSuspending(null)}
          onConfirm={async () => { await patch(`/admin/users/${suspending.id}`, { status: suspending.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }); reload(); }}>
          <p>{suspending.status === 'ACTIVE' ? t('{name} sera déconnecté et ne pourra plus se connecter.', { name: `${suspending.firstName} ${suspending.lastName}` }) : t('{name} pourra de nouveau se connecter.', { name: `${suspending.firstName} ${suspending.lastName}` })}</p>
        </Confirm>
      )}
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Bureaux locaux                                                              */
/* -------------------------------------------------------------------------- */

const DAYS: [string, string][] = [['mon', N_('Lundi')], ['tue', N_('Mardi')], ['wed', N_('Mercredi')], ['thu', N_('Jeudi')], ['fri', N_('Vendredi')], ['sat', N_('Samedi')], ['sun', N_('Dimanche')]];

function OfficeForm({ office, onDone, onClose }: { office: any | null; onDone: () => void; onClose: () => void }) {
  const t = useT();
  const { countries } = useAuth();
  const [f, setF] = useState({
    countryCode: office?.countryCode ?? 'CM', name: office?.name ?? '', city: office?.city ?? '', address: office?.address ?? '',
    phone: office?.phone ?? '', whatsapp: office?.whatsapp ?? '', email: office?.email ?? '', timezone: office?.timezone ?? 'Africa/Douala',
    latitude: office?.latitude?.toString() ?? '', longitude: office?.longitude?.toString() ?? '',
    acceptsPayments: office?.acceptsPayments ?? true, isPickupPoint: office?.isPickupPoint ?? true, isActive: office?.isActive ?? true,
    hours: Object.fromEntries(DAYS.map(([k]) => [k, (office?.openingHours?.[k]?.[0] ?? []).join('-')])) as Record<string, string>,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(async () => {
    const openingHours: Record<string, [string, string][]> = {};
    for (const [day, value] of Object.entries(f.hours)) {
      const m = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(value.trim());
      if (m) openingHours[day] = [[m[1], m[2]]];
    }
    const body = {
      countryCode: f.countryCode, name: f.name, city: f.city, address: f.address, phone: f.phone || null, whatsapp: f.whatsapp || null, email: f.email || null,
      timezone: f.timezone, latitude: f.latitude ? Number(f.latitude) : null, longitude: f.longitude ? Number(f.longitude) : null,
      acceptsPayments: f.acceptsPayments, isPickupPoint: f.isPickupPoint, isActive: f.isActive, openingHours,
    };
    await (office ? put(`/admin/offices/${office.id}`, body) : post('/admin/offices', body));
    onDone();
    onClose();
  });
  return (
    <Modal title={office ? t('Modifier le bureau') : t('Nouveau bureau')} onClose={onClose} wide>
      <Form onSubmit={() => save.run()}>
        <div className="form-grid form-grid--2">
          <Input label={t('Nom du bureau')} value={f.name} onChange={set('name')} />
          <Select label={t('Pays')} value={f.countryCode} onChange={set('countryCode')}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
          <Input label={t('Ville')} value={f.city} onChange={set('city')} />
          <Input label={t('Adresse')} value={f.address} onChange={set('address')} />
          <Input label={t('Téléphone')} value={f.phone} onChange={set('phone')} />
          <Input label="WhatsApp" value={f.whatsapp} onChange={set('whatsapp')} />
          <Input label={t('Email')} type="email" value={f.email} onChange={set('email')} />
          <Input label={t('Fuseau horaire')} value={f.timezone} onChange={set('timezone')} hint={t('Ex. : Africa/Douala, Africa/Dakar, Africa/Nairobi.')} />
          <Input label={t('Latitude (GPS)')} inputMode="decimal" value={f.latitude} onChange={set('latitude')} />
          <Input label={t('Longitude (GPS)')} inputMode="decimal" value={f.longitude} onChange={set('longitude')} />
        </div>
        <div>
          <div className="field__label">{t('Horaires')}</div>
          <div className="form-grid form-grid--3">
            {DAYS.map(([k, label]) => <Input key={k} label={t(label)} placeholder="08:00-17:30" value={f.hours[k]} onChange={(e) => setF({ ...f, hours: { ...f.hours, [k]: e.target.value } })} />)}
          </div>
          <p className="field__hint">{t('Laissez vide les jours de fermeture.')}</p>
        </div>
        <div className="row row--wrap">
          <label className="check"><input type="checkbox" checked={f.acceptsPayments} onChange={(e) => setF({ ...f, acceptsPayments: e.target.checked })} /><span>{t('Encaisse les paiements')}</span></label>
          <label className="check"><input type="checkbox" checked={f.isPickupPoint} onChange={(e) => setF({ ...f, isPickupPoint: e.target.checked })} /><span>{t('Point de retrait')}</span></label>
          <label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /><span>{t('Ouvert')}</span></label>
        </div>
        <ErrorNote error={save.error} />
        <button className="btn btn--primary" disabled={save.busy}>{t('Enregistrer')}</button>
      </Form>
    </Modal>
  );
}

function AgentsModal({ office, onDone, onClose }: { office: any; onDone: () => void; onClose: () => void }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [position, setPosition] = useState<'AGENT' | 'MANAGER'>('AGENT');
  const add = useAction(async () => {
    const found = await get<{ items: any[] }>(`/admin/users${qs({ q: email.trim() })}`);
    const user = found.items.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) throw new Error(t('Aucun compte avec cette adresse email. La personne doit d’abord créer son compte.'));
    await put(`/admin/offices/${office.id}/agents/${user.id}`, { position });
    setEmail('');
    onDone();
  });
  const remove = useAction(async (userId: string) => {
    await del(`/admin/offices/${office.id}/agents/${userId}`);
    onDone();
  });
  return (
    <Modal title={t('Équipe de {name}', { name: office.name })} onClose={onClose}>
      <div className="stack">
        {office.agents.length === 0 && <p className="muted">{t('Aucun agent rattaché à ce bureau.')}</p>}
        {office.agents.map((a: any) => (
          <div key={a.userId} className="row row--between">
            <span><span className="strong">{a.name}</span> <Pill tone="navy">{a.position === 'MANAGER' ? t('Responsable') : t('Agent')}</Pill><br /><span className="tiny muted">{a.email}</span></span>
            <button className="btn btn--ghost btn--s" onClick={() => remove.run(a.userId)} disabled={remove.busy}>{t('Retirer')}</button>
          </div>
        ))}
        <Form onSubmit={() => add.run()} className="panel panel--mist stack">
          <div className="strong">{t('Rattacher une personne')}</div>
          <Input label={t('Adresse email de son compte')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select label={t('Fonction')} value={position} onChange={(e) => setPosition(e.target.value as 'AGENT' | 'MANAGER')}>
            <option value="AGENT">{t('Agent : encaisse et remet les colis')}</option>
            <option value="MANAGER">{t('Responsable : en plus, clôture la caisse')}</option>
          </Select>
          <ErrorNote error={add.error ?? remove.error} />
          <button className="btn btn--navy btn--s" disabled={add.busy || !email.trim()}>{t('Rattacher')}</button>
        </Form>
      </div>
    </Modal>
  );
}

export function OfficesPage() {
  const t = useT();
  const { can } = useAuth();
  const { data, error, reload } = useApi<{ offices: any[] }>('/admin/offices');
  const [editing, setEditing] = useState<any | null | 'new'>(null);
  const [team, setTeam] = useState<string | null>(null);
  const manage = can('offices.manage');
  const teamOffice = data?.offices.find((o) => o.id === team);
  return (
    <Page title={t('Bureaux locaux')} actions={manage && <button className="btn btn--primary" onClick={() => setEditing('new')}><Icon name="plus" /> {t('Nouveau bureau')}</button>}>
      <p className="small muted" style={{ marginBottom: 12 }}>{t('Les bureaux actifs sont publiés sur le site, dans la page « Partenaires locaux » de leur pays.')}</p>
      <ErrorNote error={error} onRetry={reload} />
      <DataTable
        rows={data?.offices}
        rowKey={(o) => o.id}
        empty={t('Aucun bureau. Sans bureau dans un pays, seul le paiement en ligne y est proposé.')}
        columns={[
          { head: t('Bureau'), cell: (o) => <><span className="strong">{o.name}</span><br /><span className="tiny muted">{o.address}</span></> },
          { head: t('Ville'), cell: (o) => `${o.city}, ${o.countryName}` },
          { head: t('Contact'), cell: (o) => <span className="small num">{o.phone ?? '—'}</span> },
          { head: t('Services'), cell: (o) => <span className="row row--wrap" style={{ gap: 4 }}>{o.acceptsPayments && <Pill>{t('Paiement')}</Pill>}{o.isPickupPoint && <Pill>{t('Retrait')}</Pill>}</span> },
          { head: t('Équipe'), cell: (o) => (manage ? <button className="link small" onClick={() => setTeam(o.id)}>{t('{n} personnes', { n: o.agents.length })}</button> : o.agents.length) },
          { head: t('État'), cell: (o) => (o.isActive ? <Pill tone="green">{t('Ouvert')}</Pill> : <Pill tone="red">{t('Fermé')}</Pill>) },
          { head: '', cell: (o) => manage && <RowActions><IconButton icon="edit" label={t('Modifier')} onClick={() => setEditing(o)} /></RowActions> },
        ]}
      />
      {editing && <OfficeForm office={editing === 'new' ? null : editing} onDone={reload} onClose={() => setEditing(null)} />}
      {teamOffice && <AgentsModal office={teamOffice} onDone={reload} onClose={() => setTeam(null)} />}
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

export function MatchingAdminPage() {
  const t = useT();
  const { lang } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { search } = useLocation();
  const status = search.get('status') ?? '';
  const { data, error, reload } = useApi<{ items: any[]; counts: Record<string, number>; threshold: number }>(`/admin/matching${qs({ status, pageSize: 100 })}`);
  const deals = useApi<{ items: any[] }>(can('matching.convert') ? '/admin/deals?pageSize=100' : null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [converting, setConverting] = useState<any | null>(null);
  const [dealId, setDealId] = useState('');
  const moderate = useAction(async (id: string, decision: 'PUBLISH' | 'CLOSE') => {
    await post(`/admin/matching/${id}/moderate`, { decision });
    reload();
  });
  const convert = useAction(async () => {
    await post(`/admin/matching/${converting.id}/convert`, { dealId });
    setConverting(null);
    toast(t('Demande rattachée. Les membres intéressés sont prévenus.'));
    reload();
  });
  const labels: Record<string, string> = { PENDING_REVIEW: t('À vérifier'), PUBLISHED: t('Publiée'), REJECTED: t('Refusée'), CONVERTED: t('Devenue une offre'), CLOSED: t('Clôturée') };

  return (
    <Page title={t('Matching')} intro={data ? t('Une demande qui atteint {n} intérêts est signalée ici. Elle ne crée rien toute seule : c’est vous qui décidez d’en faire une campagne.', { n: data.threshold }) : undefined}>
      <div style={{ marginBottom: 12 }}>
        <Tabs value={status} onChange={(v) => navigate(`/admin/matching${qs({ status: v })}`)}
          items={[{ value: '', label: t('Toutes') }, { value: 'PENDING_REVIEW', label: t('À vérifier'), count: data?.counts.PENDING_REVIEW }, { value: 'PUBLISHED', label: t('Publiées'), count: data?.counts.PUBLISHED }, { value: 'CONVERTED', label: t('Devenues des offres') }, { value: 'REJECTED', label: t('Refusées') }]} />
      </div>
      <ErrorNote error={error ?? moderate.error} onRetry={reload} />
      <DataTable
        rows={data?.items}
        rowKey={(m) => m.id}
        empty={t('Aucune demande dans cette vue.')}
        columns={[
          { head: t('Demande'), cell: (m) => <><span className="strong">{m.title}</span>{m.thresholdReached && m.status === 'PUBLISHED' && <> <Pill tone="pink">{t('Seuil atteint')}</Pill></>}<br /><span className="tiny muted">{m.description.slice(0, 110)}</span></> },
          { head: t('Auteur'), cell: (m) => <>{m.author}<br /><span className="tiny muted">{m.country.name}, {formatDate(m.createdAt, lang)}</span></> },
          { head: t('Intérêts'), right: true, cell: (m) => m.interestCount },
          { head: t('Quantité souhaitée'), right: true, cell: (m) => m.totalQuantity + (m.desiredQuantity ?? 0) },
          { head: t('État'), cell: (m) => <Pill tone={m.status === 'PENDING_REVIEW' ? 'amber' : m.status === 'PUBLISHED' ? 'green' : m.status === 'REJECTED' ? 'red' : 'navy'}>{labels[m.status]}</Pill> },
          { head: '', cell: (m) => (
            <RowActions>
              {m.status === 'PENDING_REVIEW' && can('matching.moderate') && <><button className="btn btn--primary btn--s" onClick={() => moderate.run(m.id, 'PUBLISH')}>{t('Publier')}</button><button className="btn btn--ghost btn--s" onClick={() => setRejecting(m)}>{t('Refuser')}</button></>}
              {m.status === 'PUBLISHED' && can('matching.convert') && <button className="btn btn--navy btn--s" onClick={() => { setConverting(m); setDealId(''); }}>{t('Rattacher à une campagne')}</button>}
              {m.status === 'PUBLISHED' && can('matching.moderate') && <button className="btn btn--ghost btn--s" onClick={() => moderate.run(m.id, 'CLOSE')}>{t('Clôturer')}</button>}
              {m.status === 'CONVERTED' && m.dealSlug && <Link to={`/deals/${m.dealSlug}`} className="link small">{t('Voir l’offre')}</Link>}
            </RowActions>
          ) },
        ]}
      />
      {rejecting && (
        <Confirm title={t('Refuser cette demande ?')} confirmLabel={t('Refuser la demande')} danger reason={t('Motif (communiqué à l’auteur)')} onClose={() => setRejecting(null)}
          onConfirm={async (reason) => { await post(`/admin/matching/${rejecting.id}/moderate`, { decision: 'REJECT', reason }); reload(); }}>
          <p className="strong">{rejecting.title}</p>
        </Confirm>
      )}
      {converting && (
        <Modal title={t('Rattacher à une campagne')} onClose={() => setConverting(null)}>
          <div className="stack">
            <p>{t('Créez d’abord la campagne dans « Campagnes », puis choisissez-la ici. Les {n} membres intéressés recevront un lien vers l’offre.', { n: converting.interestCount })}</p>
            <Select label={t('Campagne')} value={dealId} onChange={(e) => setDealId(e.target.value)}>
              <option value="">{t('Choisir une campagne')}</option>
              {deals.data?.items.filter((d) => ['DRAFT', 'PUBLISHED'].includes(d.storedStatus)).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </Select>
            <ErrorNote error={convert.error} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Link to="/admin/deals" className="btn btn--ghost">{t('Créer une campagne')}</Link>
              <button className="btn btn--primary" disabled={!dealId || convert.busy} onClick={() => convert.run()}>{t('Rattacher')}</button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
