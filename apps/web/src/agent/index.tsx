/**
 * Espace bureau (§25) : l'agent retrouve une réservation, encaisse le montant
 * attendu, remet les colis et — s'il est responsable — clôture la caisse.
 * Il ne peut modifier ni un prix, ni une commande.
 */

import { useEffect, useRef, useState } from 'react';
import { DataTable, MoneyField, Pill, fromMinor, toMinor, useCurrencies } from '../admin/kit';
import { BackButton, Empty, ErrorNote, Form, Icon, Input, Loading, Modal, Select, Tabs, useAction, useApi, useToast } from '../components/ui';
import { ApiError, downloadDocument, get, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { N_, formatDate, useI18n, useT } from '../lib/i18n';
import { Link, navigate, useLocation } from '../lib/router';

const RESERVATION_STATUS: Record<string, [string, 'green' | 'amber' | 'red' | 'navy' | undefined]> = {
  PENDING_PAYMENT: [N_('À encaisser'), 'amber'],
  CONFIRMED: [N_('Client présent'), 'navy'],
  PAID: [N_('Encaissée'), 'green'],
  EXPIRED: [N_('Expirée'), 'red'],
  CANCELLED: [N_('Annulée'), undefined],
};

/* ------------------------------ Lecture du QR Code ------------------------------ */

/** Lit un QR Code avec la caméra quand le navigateur le permet ; sinon, saisie manuelle. */
function Scanner({ onToken, onClose }: { onToken: (token: string) => void; onClose: () => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [manual, setManual] = useState('');
  const [supported, setSupported] = useState(true);
  const extract = (text: string) => text.trim().split('/').pop()?.split('?')[0] ?? '';

  useEffect(() => {
    const Detector = (window as any).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setSupported(false);
      return;
    }
    let stream: MediaStream | null = null;
    let stopped = false;
    const detector = new Detector({ formats: ['qr_code'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s;
        if (stopped || !video.current) return s.getTracks().forEach((x) => x.stop());
        video.current.srcObject = s;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            if (codes[0]?.rawValue) return onToken(extract(codes[0].rawValue));
          } catch {
            /* image pas encore prête */
          }
          setTimeout(tick, 250);
        };
        tick();
      })
      .catch(() => setSupported(false));
    return () => {
      stopped = true;
      stream?.getTracks().forEach((x) => x.stop());
    };
  }, []);

  return (
    <Modal title={t('Lire le QR Code du client')} onClose={onClose}>
      <div className="stack">
        {supported ? (
          <video ref={video} muted playsInline style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 16, background: 'var(--navy)' }} />
        ) : (
          <div className="notice"><Icon name="info" /><span>{t('La lecture par caméra n’est pas disponible sur cet appareil. Saisissez le numéro de réservation, ou collez le lien du QR Code.')}</span></div>
        )}
        <Form onSubmit={() => manual.trim() && onToken(extract(manual))} className="row" >
          <div className="grow"><input className="input" placeholder={t('Lien ou code du QR Code')} value={manual} onChange={(e) => setManual(e.target.value)} aria-label={t('Lien ou code du QR Code')} /></div>
          <button className="btn btn--navy">{t('Ouvrir')}</button>
        </Form>
      </div>
    </Modal>
  );
}

/* --------------------------------- Encaissement --------------------------------- */

function ReservationPanel({ id, token, onChange, onClose }: { id?: string; token?: string; onChange: () => void; onClose: () => void }) {
  const t = useT();
  const { lang } = useI18n();
  const toast = useToast();
  const { data, error, reload, set } = useApi<{ reservation: any }>(token ? `/agent/reservations/scan/${token}` : `/agent/reservations/${id}`);
  const [channel, setChannel] = useState('CASH');
  const [confirming, setConfirming] = useState(false);
  const r = data?.reservation;

  const present = useAction(async () => {
    await post(`/agent/reservations/${r.id}/confirm`);
    reload();
    onChange();
  });
  const pay = useAction(async () => {
    const res = await post<{ outcome: string; reservation: any }>(`/agent/reservations/${r.id}/pay`, { channel });
    set({ reservation: res.reservation });
    setConfirming(false);
    toast(res.outcome === 'ALREADY_PROCESSED' ? t('Cette réservation était déjà encaissée') : t('Paiement enregistré'));
    onChange();
  });
  const doc = useAction((url: string) => downloadDocument(url));

  return (
    <Modal title={r ? r.number : t('Réservation')} onClose={onClose}>
      {!data && !error && <Loading />}
      <ErrorNote error={error} />
      {r && (
        <div className="stack">
          <div className="row row--between row--wrap">
            <Pill tone={RESERVATION_STATUS[r.status]?.[1]}>{t(RESERVATION_STATUS[r.status]?.[0] ?? r.status)}</Pill>
            <span className="small muted">{r.office.name}</span>
          </div>
          <div>
            <div className="small muted">{t('Montant à encaisser')}</div>
            <div className="price price--xl">{r.amount.formatted}</div>
            <p className="tiny muted">{t('Ce montant est celui de la commande. Il ne peut pas être modifié au bureau.')}</p>
          </div>
          <dl className="kv">
            <dt>{t('Client')}</dt><dd>{r.customer.name}</dd>
            <dt>WhatsApp</dt><dd className="num">{r.customer.whatsapp}</dd>
            <dt>{t('Commande')}</dt><dd className="num">{r.order.number}</dd>
            <dt>{r.status === 'PAID' ? t('Encaissée le') : t('À régler avant le')}</dt><dd>{formatDate(r.paidAt ?? r.expiresAt, lang, true)}</dd>
          </dl>
          <table className="recap">
            <thead><tr><th>{t('Produit')}</th><th className="r">{t('Prix unitaire')}</th><th className="r">{t('Quantité')}</th><th className="r">{t('Total')}</th></tr></thead>
            <tbody>
              {r.items.map((i: any, n: number) => (
                <tr key={n}><td><span className="strong">{i.productName}</span>{i.variantLabel && <><br /><span className="small muted">{i.variantLabel}</span></>}</td><td className="r num">{i.unitPrice.formatted}</td><td className="r num">{i.quantity}</td><td className="r num strong">{i.lineTotal.formatted}</td></tr>
              ))}
            </tbody>
          </table>

          <ErrorNote error={present.error ?? pay.error ?? doc.error} />
          {r.payable && !confirming && (
            <div className="row row--wrap">
              {r.status === 'PENDING_PAYMENT' && <button className="btn btn--ghost" onClick={() => present.run()} disabled={present.busy}>{t('Le client est présent')}</button>}
              <button className="btn btn--primary grow" onClick={() => setConfirming(true)}>{t('Encaisser {amount}', { amount: r.amount.formatted })}</button>
            </div>
          )}
          {r.payable && confirming && (
            <div className="panel panel--mist stack">
              <Select label={t('Moyen de paiement reçu')} value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="CASH">{t('Espèces')}</option>
                <option value="MOBILE_MONEY">{t('Mobile Money')}</option>
                <option value="BANK_TRANSFER">{t('Virement')}</option>
                <option value="CHEQUE">{t('Chèque')}</option>
              </Select>
              <p className="small">{t('Vous confirmez avoir reçu {amount} de {name}. Cette action est enregistrée à votre nom.', { amount: r.amount.formatted, name: r.customer.name })}</p>
              <div className="row">
                <button className="btn btn--ghost" onClick={() => setConfirming(false)}>{t('Annuler')}</button>
                <button className="btn btn--primary grow" onClick={() => pay.run()} disabled={pay.busy}>{t('Confirmer l’encaissement')}</button>
              </div>
            </div>
          )}
          {r.status === 'EXPIRED' && <div className="notice notice--error"><Icon name="alert" /><span>{t('Cette réservation a expiré : n’encaissez pas. Le client doit repasser commande.')}</span></div>}
          <div className="row row--wrap">
            {r.documents.receipt && <button className="btn btn--navy" onClick={() => doc.run(r.documents.receipt)}><Icon name="file" /> {t('Imprimer le reçu')}</button>}
            <button className="btn btn--ghost" onClick={() => doc.run(r.documents.proforma)}><Icon name="file" /> {t('Facture proforma')}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function PaymentsTab({ scanToken }: { scanToken?: string }) {
  const t = useT();
  const { lang } = useI18n();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const { data, error, reload } = useApi<{ reservations: any[] }>(`/agent/reservations${qs({ q, status })}`);
  const [open, setOpen] = useState<{ id?: string; token?: string } | null>(scanToken ? { token: scanToken } : null);
  const [scanning, setScanning] = useState(false);
  return (
    <div className="stack">
      <div className="row row--wrap">
        <button className="btn btn--primary" onClick={() => setScanning(true)}><Icon name="qr" /> {t('Lire un QR Code')}</button>
        <div className="grow" style={{ minWidth: 220 }}><input className="input" placeholder={t('Numéro de réservation, de commande, nom ou WhatsApp')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Rechercher une réservation')} /></div>
        <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('État')}>
          <option value="">{t('Toutes')}</option>
          {Object.entries(RESERVATION_STATUS).map(([k, [label]]) => <option key={k} value={k}>{t(label)}</option>)}
        </select>
      </div>
      <ErrorNote error={error} onRetry={reload} />
      <DataTable
        rows={data?.reservations}
        rowKey={(r) => r.id}
        empty={q ? t('Aucune réservation ne correspond à cette recherche dans votre bureau.') : t('Aucune réservation pour votre bureau.')}
        columns={[
          { head: t('Réservation'), cell: (r) => <button className="link num" onClick={() => setOpen({ id: r.id })}>{r.number}</button> },
          { head: t('Client'), cell: (r) => <>{r.customer.name}<br /><span className="tiny muted num">{r.customer.whatsapp}</span></> },
          { head: t('Produit'), cell: (r) => r.productName },
          { head: t('État'), cell: (r) => <Pill tone={RESERVATION_STATUS[r.status]?.[1]}>{t(RESERVATION_STATUS[r.status]?.[0] ?? r.status)}</Pill> },
          { head: t('Échéance'), cell: (r) => <span className="small">{formatDate(r.paidAt ?? r.expiresAt, lang, true)}</span> },
          { head: t('Montant'), right: true, cell: (r) => r.amount.formatted },
        ]}
      />
      {scanning && <Scanner onClose={() => setScanning(false)} onToken={(token) => { setScanning(false); setOpen({ token }); }} />}
      {open && <ReservationPanel {...open} onChange={reload} onClose={() => { setOpen(null); if (scanToken) navigate('/agent', { replace: true }); }} />}
    </div>
  );
}

/* ----------------------------------- Retraits ----------------------------------- */

function PickupsTab() {
  const t = useT();
  const { lang } = useI18n();
  const toast = useToast();
  const [q, setQ] = useState('');
  const { data, error, reload } = useApi<{ pickups: any[] }>(`/agent/pickups${qs({ q })}`);
  const [target, setTarget] = useState<any | null>(null);
  const [code, setCode] = useState('');
  const confirm = useAction(async () => {
    try {
      await post(`/agent/pickups/${target.orderId}/confirm`, { code });
    } catch (e) {
      if ((e as ApiError).code === 'VALIDATION_FAILED') throw new ApiError(400, 'VALIDATION_FAILED', N_('Code de retrait incorrect. Demandez au client le code affiché dans sa commande.'));
      throw e;
    }
    setTarget(null);
    setCode('');
    toast(t('Retrait confirmé'));
    reload();
  });
  return (
    <div className="stack">
      <input className="input" placeholder={t('Numéro de commande, nom ou WhatsApp')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Rechercher un retrait')} />
      <ErrorNote error={error} onRetry={reload} />
      <DataTable
        rows={data?.pickups}
        rowKey={(p) => p.orderId}
        empty={t('Aucun colis à remettre pour le moment.')}
        columns={[
          { head: t('Commande'), cell: (p) => <span className="num strong">{p.orderNumber}</span> },
          { head: t('Client'), cell: (p) => <>{p.customer.name}<br /><span className="tiny muted num">{p.customer.whatsapp}</span></> },
          { head: t('Produit'), cell: (p) => p.productName },
          { head: t('Quantité'), right: true, cell: (p) => p.quantity },
          { head: '', cell: (p) => (p.status === 'READY' ? <button className="btn btn--primary btn--s" onClick={() => { setTarget(p); setCode(''); confirm.clear(); }}>{t('Remettre le colis')}</button> : <span className="small"><Pill tone="green">{t('Remis')}</Pill> {formatDate(p.pickedUpAt, lang, true)}</span>) },
        ]}
      />
      {target && (
        <Modal title={t('Remise du colis')} onClose={() => setTarget(null)}>
          <Form onSubmit={() => confirm.run()}>
            <p>{t('Commande {number}, {name} : {n} unités de {product}.', { number: target.orderNumber, name: target.customer.name, n: target.quantity, product: target.productName })}</p>
            <Input label={t('Code de retrait du client')} hint={t('Le code à 6 chiffres affiché dans la commande du client.')} inputMode="numeric" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <ErrorNote error={confirm.error} />
            <button className="btn btn--primary btn--block" disabled={confirm.busy || code.length !== 6}>{t('Confirmer le retrait')}</button>
          </Form>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------ Caisse ------------------------------------ */

function CashTab({ offices }: { offices: any[] }) {
  const t = useT();
  const { lang } = useI18n();
  const cur = useCurrencies();
  const toast = useToast();
  const [officeId, setOfficeId] = useState(offices[0]?.id ?? '');
  const { data, error, reload } = useApi<any>(officeId ? `/agent/cash?officeId=${officeId}` : null);
  const [declared, setDeclared] = useState('');
  const [note, setNote] = useState('');
  const expected = data?.expected[0];
  const close = useAction(async () => {
    const amount = toMinor(declared, cur.decimals(expected.currency));
    if (amount === null) throw new ApiError(400, 'VALIDATION_FAILED', N_('Indiquez la somme comptée en caisse.'));
    await post('/agent/cash/close', { officeId, currency: expected.currency, declaredAmount: amount, note: note.trim() || undefined });
    setDeclared('');
    setNote('');
    toast(t('Caisse clôturée'));
    reload();
  });
  const CHANNEL: Record<string, string> = { CASH: t('Espèces'), MOBILE_MONEY: t('Mobile Money'), BANK_TRANSFER: t('Virement'), CHEQUE: t('Chèque') };
  if (!officeId) return <Empty title={t('Aucun bureau rattaché à votre compte')} />;
  return (
    <div className="stack">
      {offices.length > 1 && <Select label={t('Bureau')} value={officeId} onChange={(e) => setOfficeId(e.target.value)}>{offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}
      {!data && !error && <Loading />}
      <ErrorNote error={error} onRetry={reload} />
      {data && (
        <>
          <div>
            <h2 className="h3" style={{ marginBottom: 8 }}>{t('Encaissements depuis la dernière clôture')}</h2>
            <DataTable rows={data.open} rowKey={(p: any) => p.reservationNumber} empty={t('Aucun encaissement à clôturer.')}
              columns={[
                { head: t('Heure'), cell: (p: any) => formatDate(p.paidAt, lang, true) },
                { head: t('Réservation'), cell: (p: any) => <span className="num">{p.reservationNumber}</span> },
                { head: t('Moyen'), cell: (p: any) => CHANNEL[p.channel] ?? p.channel },
                { head: t('Agent'), cell: (p: any) => p.agentName },
                { head: t('Montant'), right: true, cell: (p: any) => p.amount.formatted },
              ]} />
          </div>
          {expected && (
            <div className="panel stack">
              <div className="row row--between"><span className="strong">{t('Total attendu')}</span><span className="price" style={{ fontSize: '1.5rem' }}>{expected.formatted}</span></div>
              {data.canClose ? (
                <Form onSubmit={() => close.run()}>
                  <MoneyField label={t('Somme comptée en caisse')} amount={declared} currency={expected.currency} currencies={cur.list} fixedCurrency onChange={(a) => setDeclared(a)} />
                  <Input label={t('Remarque (facultatif)')} value={note} onChange={(e) => setNote(e.target.value)} hint={t('Expliquez tout écart entre le compté et l’attendu.')} />
                  <ErrorNote error={close.error} />
                  <button className="btn btn--primary" disabled={close.busy || !declared.trim()}>{t('Clôturer la caisse')}</button>
                </Form>
              ) : (
                <p className="small muted">{t('La clôture de caisse est faite par le responsable du bureau.')}</p>
              )}
            </div>
          )}
          <div>
            <h2 className="h3" style={{ marginBottom: 8 }}>{t('Clôtures précédentes')}</h2>
            <DataTable rows={data.closings} rowKey={(c: any) => c.id} empty={t('Aucune clôture enregistrée.')}
              columns={[
                { head: t('Date'), cell: (c: any) => c.businessDate },
                { head: t('Encaissements'), right: true, cell: (c: any) => c.paymentsCount },
                { head: t('Attendu'), right: true, cell: (c: any) => c.expected.formatted },
                { head: t('Compté'), right: true, cell: (c: any) => c.declared.formatted },
                { head: t('Écart'), right: true, cell: (c: any) => (c.differenceSign === 0 ? <Pill tone="green">{t('Aucun')}</Pill> : <Pill tone="red">{c.differenceSign < 0 ? '−' : '+'}{c.difference.formatted}</Pill>) },
                { head: t('Par'), cell: (c: any) => c.closedBy },
              ]} />
          </div>
        </>
      )}
    </div>
  );
}

export default function AgentApp() {
  const t = useT();
  const { user, can, logout } = useAuth();
  const { path, search } = useLocation();
  const scanToken = path.startsWith('/agent/scan/') ? decodeURIComponent(path.slice('/agent/scan/'.length)) : undefined;
  const tab = (search.get('tab') ?? 'payments') as 'payments' | 'pickups' | 'cash';
  const overview = useApi<{ offices: any[]; canCloseCash: boolean }>(can('office.payments.record') ? '/agent/overview' : null);

  if (!user) return null;
  if (!can('office.payments.record')) {
    return (
      <div className="wrap wrap--form page">
        <h1 className="h1">{t('Accès réservé aux bureaux')}</h1>
        <p className="muted" style={{ marginTop: 8 }}>{t('Votre compte n’est rattaché à aucun bureau GROUPDEALS.')}</p>
        <Link to="/" className="btn btn--navy" style={{ marginTop: 20 }}>{t('Retour au site')}</Link>
      </div>
    );
  }
  const offices = overview.data?.offices ?? [];
  const pending = offices.reduce((s, o) => s + o.pendingReservations, 0);
  const pickups = offices.reduce((s, o) => s + o.pickupsWaiting, 0);
  const unclosed = offices.reduce((s, o) => s + o.unclosedPayments, 0);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--mist-2)' }}>
      <header className="header">
        <div className="wrap header__in">
          <Link to="/agent" className="logo">GROUP<b>DEALS</b></Link>
          <span className="badge badge--navy">{t('Espace bureau')}</span>
          <div className="header__actions">
            {can('dashboard.view') && <Link to="/admin" className="btn btn--ghost btn--s">{t('Back-office')}</Link>}
            <button className="iconbtn" onClick={async () => { await logout(); navigate('/'); }} aria-label={t('Se déconnecter')}><Icon name="logout" /></button>
          </div>
        </div>
      </header>
      <main className="wrap page" style={{ maxWidth: 980 }}>
        <div className="backbar"><BackButton /></div>
        <h1 className="h1" style={{ fontSize: '1.6rem' }}>{offices.length === 1 ? offices[0].name : t('Vos bureaux')}</h1>
        <p className="muted small" style={{ marginTop: 4 }}>{user.firstName} {user.lastName}{offices.length === 1 ? `, ${offices[0].city}` : ''}</p>
        <div style={{ marginBlock: 16 }}>
          <Tabs value={tab} onChange={(v) => navigate(`/agent?tab=${v}`)}
            items={[{ value: 'payments', label: t('Encaissements'), count: pending }, { value: 'pickups', label: t('Retraits'), count: pickups }, { value: 'cash', label: t('Caisse'), count: unclosed }]} />
        </div>
        {overview.loading && !overview.data ? <Loading /> : (
          <>
            {tab === 'payments' && <PaymentsTab scanToken={scanToken} />}
            {tab === 'pickups' && <PickupsTab />}
            {tab === 'cash' && <CashTab offices={offices} />}
          </>
        )}
      </main>
    </div>
  );
}
