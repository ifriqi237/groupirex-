import { useEffect, useState } from 'react';
import { LOGISTICS_STEPS } from '@groupdeals/core';
import { ErrorNote, Form, Icon, Input, Loading, Modal, Select, useAction, useApi, useToast } from '../components/ui';
import { patch, post } from '../lib/api';
import { formatDate, formatNumber, useI18n, useT } from '../lib/i18n';
import { Link } from '../lib/router';
import { STEP_LABEL } from '../pages/orders';
import { Confirm, DataTable, Page, Pill, fromLocalInput, toLocalInput } from './kit';

interface Shipment {
  id: string;
  reference: string;
  deal: { id: string; slug: string; title: string };
  productName: string;
  country: { code: string; name: string };
  currentStep: number;
  transportMode: 'SEA' | 'AIR' | 'ROAD';
  vesselName: string | null;
  vesselImo: string | null;
  containerNumber: string | null;
  billOfLading: string | null;
  departurePort: string | null;
  arrivalPort: string | null;
  eta: string | null;
  vesselPosition: null | { latitude: number; longitude: number; progressPercent: number; updatedAt: string };
  ordersCount: number;
  units: number;
  readyCount: number;
  pickedCount: number;
}

function StepPill({ step }: { step: number }) {
  const t = useT();
  if (step === 0) return <Pill tone="amber">{t('À lancer')}</Pill>;
  return <Pill tone={step >= 7 ? 'green' : 'navy'}>{step}. {t(STEP_LABEL[LOGISTICS_STEPS[step - 1].code])}</Pill>;
}

export function ShipmentsPage() {
  const t = useT();
  const { lang } = useI18n();
  const { data, error, reload } = useApi<{ items: Shipment[] }>('/admin/shipments?pageSize=100');
  return (
    <Page title={t('Logistique')} intro={t('Une expédition regroupe les commandes payées d’une campagne pour un pays. Valider une étape met à jour toutes ses commandes et prévient leurs clients.')}>
      <ErrorNote error={error} onRetry={reload} />
      <DataTable
        rows={data?.items}
        rowKey={(s) => s.id}
        empty={t('Aucune expédition. Elles sont créées quand une campagne est confirmée.')}
        columns={[
          { head: t('Expédition'), cell: (s) => <Link to={`/admin/logistics/${s.id}`} className="num">{s.reference}</Link> },
          { head: t('Campagne'), cell: (s) => s.deal.title },
          { head: t('Destination'), cell: (s) => s.country.name },
          { head: t('Étape'), cell: (s) => <StepPill step={s.currentStep} /> },
          { head: t('Arrivée estimée'), cell: (s) => formatDate(s.eta, lang) },
          { head: t('Commandes'), right: true, cell: (s) => s.ordersCount },
          { head: t('Quantité'), right: true, cell: (s) => formatNumber(s.units, lang) },
          { head: t('Retirées'), right: true, cell: (s) => `${s.pickedCount} / ${s.ordersCount}` },
        ]}
      />
    </Page>
  );
}

function TransportForm({ shipment, onSaved }: { shipment: Shipment; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const [f, setF] = useState({
    transportMode: shipment.transportMode,
    vesselName: shipment.vesselName ?? '', vesselImo: shipment.vesselImo ?? '', containerNumber: shipment.containerNumber ?? '', billOfLading: shipment.billOfLading ?? '',
    departurePort: shipment.departurePort ?? '', arrivalPort: shipment.arrivalPort ?? '', eta: toLocalInput(shipment.eta),
    latitude: shipment.vesselPosition?.latitude?.toString() ?? '', longitude: shipment.vesselPosition?.longitude?.toString() ?? '', progress: shipment.vesselPosition?.progressPercent?.toString() ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(async () => {
    const hasPosition = f.latitude !== '' && f.longitude !== '';
    await patch(`/admin/shipments/${shipment.id}`, {
      transportMode: f.transportMode, vesselName: f.vesselName || null, vesselImo: f.vesselImo || null, containerNumber: f.containerNumber || null, billOfLading: f.billOfLading || null,
      departurePort: f.departurePort || null, arrivalPort: f.arrivalPort || null, eta: fromLocalInput(f.eta),
      position: hasPosition ? { latitude: Number(f.latitude), longitude: Number(f.longitude), progressPercent: Number(f.progress) || 0 } : null,
    });
    toast(t('Informations de transport enregistrées'));
    onSaved();
  });
  return (
    <Form onSubmit={() => save.run()} className="card stack">
      <h2 className="h3">{t('Transport et position du navire')}</h2>
      <div className="form-grid form-grid--2">
        <Select label={t('Mode de transport')} value={f.transportMode} onChange={set('transportMode')}>
          <option value="SEA">{t('Maritime')}</option><option value="AIR">{t('Aérien')}</option><option value="ROAD">{t('Routier')}</option>
        </Select>
        <Input label={t('Navire')} value={f.vesselName} onChange={set('vesselName')} />
        <Input label={t('Numéro IMO')} value={f.vesselImo} onChange={set('vesselImo')} />
        <Input label={t('Conteneur')} value={f.containerNumber} onChange={set('containerNumber')} />
        <Input label={t('Connaissement')} value={f.billOfLading} onChange={set('billOfLading')} />
        <Input label={t('Trajet effectué (%)')} type="number" min={0} max={100} value={f.progress} onChange={set('progress')} />
        <Input label={t('Port de départ')} value={f.departurePort} onChange={set('departurePort')} />
        <Input label={t('Port d’arrivée')} value={f.arrivalPort} onChange={set('arrivalPort')} />
        <Input label={t('Latitude')} inputMode="decimal" value={f.latitude} onChange={set('latitude')} />
        <Input label={t('Longitude')} inputMode="decimal" value={f.longitude} onChange={set('longitude')} />
        <div className="span-3"><Input label={t('Arrivée estimée')} type="datetime-local" value={f.eta} onChange={set('eta')} /></div>
      </div>
      <p className="small muted">{t('Ces informations apparaissent à l’étape 5 du suivi client. La position est saisie à la main ; un fournisseur de suivi maritime pourra l’alimenter automatiquement.')}</p>
      <ErrorNote error={save.error} />
      <div><button className="btn btn--navy btn--s" disabled={save.busy}>{t('Enregistrer')}</button></div>
    </Form>
  );
}

export function ShipmentPage({ id }: { id: string }) {
  const t = useT();
  const { lang } = useI18n();
  const toast = useToast();
  const { data, error, reload } = useApi<{ shipment: Shipment; history: any[]; orders: any[]; canOverride: boolean }>(`/admin/shipments/${id}`);
  const offices = useApi<{ offices: any[] }>('/admin/offices');
  const [note, setNote] = useState('');
  const [override, setOverride] = useState<number | null>(null);
  const [pickupOverride, setPickupOverride] = useState(false);
  useEffect(() => setNote(''), [data?.shipment.currentStep]);

  const advance = useAction(async (targetStep: number) => {
    await post(`/admin/shipments/${id}/advance`, { targetStep, note: note.trim() || undefined });
    toast(t('Étape validée. Les clients sont prévenus.'));
    reload();
  });
  const ready = useAction(async () => {
    const res = await post<{ ordersReady: number }>(`/admin/shipments/${id}/ready-for-pickup`, {});
    toast(t('{n} commandes disponibles au retrait', { n: res.ordersReady }));
    reload();
  });
  const assign = useAction(async (orderId: string, officeId: string) => {
    await post(`/admin/orders/${orderId}/pickup-office`, { officeId });
    reload();
  });

  if (!data) return error ? <ErrorNote error={error} onRetry={reload} /> : <Loading />;
  const s = data.shipment;
  const next = s.currentStep + 1;
  const pickupOffices = (offices.data?.offices ?? []).filter((o) => o.countryCode === s.country.code && o.isPickupPoint && o.isActive);
  const waiting = data.orders.filter((o) => o.pickupStep === 0).length;
  const lastByStep = new Map<number, any>();
  for (const h of data.history) lastByStep.set(h.step, h);

  return (
    <Page title={s.reference} actions={<StepPill step={s.currentStep} />}>
      <Link to="/admin/logistics" className="link small">{t('Toutes les expéditions')}</Link>
      <p className="muted" style={{ marginTop: 8 }}>{s.deal.title}, {s.country.name}. {t('{n} commandes, {units} unités.', { n: s.ordersCount, units: formatNumber(s.units, lang) })}</p>

      <div className="split split--aside" style={{ marginTop: 16 }}>
        <div className="stack">
          <div className="card">
            <h2 className="h3" style={{ marginBottom: 12 }}>{t('Étapes du lot')}</h2>
            <ol className="steps">
              {LOGISTICS_STEPS.filter((d) => d.scope === 'SHIPMENT').map((d) => {
                const h = lastByStep.get(d.step);
                const done = d.step <= s.currentStep && h && h.status !== 'REVERTED';
                const state = done ? (h.status === 'SKIPPED' ? 'skipped' : 'done') : d.step === next ? 'next' : 'pending';
                return (
                  <li key={d.step} data-state={state}>
                    <div>
                      <div className="steps__label">{t(STEP_LABEL[d.code])}</div>
                      {done && <div className="steps__meta">{h.status === 'SKIPPED' ? t('Étape sautée') : formatDate(h.occurredAt, lang, true)}{h.actor ? `, ${h.actor}` : ''}{h.isOverride ? `. ${t('Forçage')} : ${h.overrideReason}` : ''}</div>}
                      {done && h.note && <div className="steps__meta">{h.note}</div>}
                      {d.step === next && (
                        <div className="stack-s" style={{ marginTop: 8 }}>
                          <input className="input input--s" placeholder={t('Note visible du client (facultatif)')} value={note} onChange={(e) => setNote(e.target.value)} />
                          <button className="btn btn--primary btn--s" onClick={() => advance.run(d.step)} disabled={advance.busy}>{t('Valider cette étape')}</button>
                        </div>
                      )}
                      {/* Sauter une étape : réservé aux rôles autorisés, avec motif, et journalisé (§47). */}
                      {data.canOverride && d.step > next && <button className="link tiny" style={{ marginTop: 4 }} onClick={() => setOverride(d.step)}>{t('Forcer le passage à cette étape')}</button>}
                      {data.canOverride && done && d.step === s.currentStep && s.currentStep > 1 && <button className="link tiny" style={{ marginTop: 4 }} onClick={() => setOverride(d.step - 1)}>{t('Annuler cette étape (erreur de saisie)')}</button>}
                    </div>
                  </li>
                );
              })}
            </ol>
            <ErrorNote error={advance.error} />
          </div>

          <div className="card stack">
            <h2 className="h3">{t('Mise à disposition et retrait')}</h2>
            <p className="small muted">{t('Étape 8 : chaque commande reçoit un code de retrait à 6 chiffres. Étape 9 : l’agent du bureau confirme la remise avec ce code.')}</p>
            <DataTable
              rows={data.orders}
              rowKey={(o) => o.id}
              empty={t('Aucune commande payée dans ce lot.')}
              columns={[
                { head: t('Commande'), cell: (o) => <Link to={`/admin/orders/${o.id}`} className="num">{o.number}</Link> },
                { head: t('Client'), cell: (o) => o.customer },
                { head: t('Quantité'), right: true, cell: (o) => o.quantity },
                { head: t('Bureau de retrait'), cell: (o) => o.pickupStep === 9 ? (o.pickupOffice?.name ?? '—') : (
                  <select className="select select--s" value={o.pickupOffice?.id ?? ''} onChange={(e) => e.target.value && assign.run(o.id, e.target.value)} aria-label={t('Bureau de retrait')}>
                    <option value="">{t('À choisir')}</option>
                    {pickupOffices.map((f) => <option key={f.id} value={f.id}>{f.city}, {f.name}</option>)}
                  </select>
                ) },
                { head: t('Retrait'), cell: (o) => (o.pickupStep === 9 ? <Pill tone="green">{t('Retirée')}</Pill> : o.pickupStep === 8 ? <Pill tone="pink">{t('Disponible')}</Pill> : <Pill>{t('En route')}</Pill>) },
              ]}
            />
            <ErrorNote error={ready.error ?? assign.error} />
            {waiting > 0 && (
              <div className="row row--wrap">
                <button className="btn btn--primary btn--s" onClick={() => ready.run()} disabled={ready.busy || s.currentStep < 7}>{t('Rendre disponibles au retrait ({n})', { n: waiting })}</button>
                {s.currentStep < 7 && <span className="small muted">{t('Possible une fois le lot dédouané (étape 7).')}</span>}
                {s.currentStep < 7 && data.canOverride && <button className="link small" onClick={() => setPickupOverride(true)}>{t('Forcer')}</button>}
              </div>
            )}
          </div>
        </div>

        <TransportForm key={s.id} shipment={s} onSaved={reload} />
      </div>

      {override !== null && (
        <Confirm
          title={override > s.currentStep ? t('Forcer le passage à l’étape {n}', { n: override }) : t('Revenir à l’étape {n}', { n: override })}
          confirmLabel={t('Confirmer l’intervention')} danger reason={t('Motif (obligatoire, conservé au journal d’audit)')}
          onClose={() => setOverride(null)}
          onConfirm={async (reason) => { await post(`/admin/shipments/${id}/advance`, { targetStep: override, override: { reason } }); toast(t('Intervention enregistrée au journal d’audit')); reload(); }}
        >
          <p>{override > s.currentStep ? t('Les étapes intermédiaires seront marquées comme sautées.') : t('Les étapes au-delà seront annulées.')}</p>
        </Confirm>
      )}
      {pickupOverride && (
        <Confirm title={t('Rendre disponibles avant le dédouanement')} confirmLabel={t('Confirmer l’intervention')} danger reason={t('Motif (obligatoire, conservé au journal d’audit)')} onClose={() => setPickupOverride(false)}
          onConfirm={async (reason) => { await post(`/admin/shipments/${id}/ready-for-pickup`, { override: { reason } }); reload(); }} />
      )}
    </Page>
  );
}
