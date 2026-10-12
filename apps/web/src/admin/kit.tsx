/**
 * Outils communs aux écrans du back-office.
 */

import { ReactNode, useMemo, useState } from 'react';
import { ErrorNote, Icon, Loading, Modal, useAction, useApi } from '../components/ui';
import { useT } from '../lib/i18n';

/* ------------------------------ Mise en page ------------------------------ */

export function Page({ title, actions, children, intro }: { title: string; actions?: ReactNode; children: ReactNode; intro?: ReactNode }) {
  return (
    <>
      <div className="bo__title">
        <div>
          <h1 className="h1" style={{ fontSize: '1.6rem' }}>{title}</h1>
          {intro && <p className="muted small" style={{ marginTop: 4, maxWidth: '70ch' }}>{intro}</p>}
        </div>
        {actions && <div className="row row--wrap">{actions}</div>}
      </div>
      {children}
    </>
  );
}

export interface Column<T> {
  head: string;
  cell: (row: T) => ReactNode;
  right?: boolean;
  width?: number | string;
}

export function DataTable<T>({ rows, columns, empty, rowKey }: { rows: T[] | undefined; columns: Column<T>[]; empty: string; rowKey: (row: T) => string | number }) {
  if (!rows) return <Loading />;
  if (rows.length === 0) return <div className="card muted">{empty}</div>;
  return (
    <div className="tablewrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.head} className={c.right ? 'r' : undefined} style={{ width: c.width }}>{c.head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.head} className={c.right ? 'r num' : undefined}>{c.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Demande une confirmation, avec un motif si nécessaire, avant une action sensible. */
export function Confirm({
  title, children, confirmLabel, danger, reason, onConfirm, onClose,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Libellé du champ « motif » ; le motif devient alors obligatoire. */
  reason?: string;
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const action = useAction(async () => {
    await onConfirm(text.trim());
    onClose();
  });
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        {children}
        {reason && (
          <label className="field">
            <span className="field__label">{reason}</span>
            <textarea className="textarea" style={{ minHeight: 80 }} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        )}
        <ErrorNote error={action.error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn--ghost" onClick={onClose}>{t('Annuler')}</button>
          <button className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} disabled={action.busy || (!!reason && text.trim().length < 3)} onClick={() => action.run()}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* --------------------------------- Montants --------------------------------- */

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

/** Devises connues, pour convertir entre la saisie (12,50) et le stockage (1250). */
export function useCurrencies(): { list: CurrencyInfo[]; decimals: (code: string) => number } {
  const { data } = useApi<{ currencies: CurrencyInfo[] }>('/currencies');
  return useMemo(() => {
    const list = data?.currencies ?? [];
    const map = new Map(list.map((c) => [c.code, c.decimals]));
    return { list, decimals: (code: string) => map.get(code) ?? 0 };
  }, [data]);
}

/** "12,50" -> 1250 (2 décimales) ; "10 000" -> 10000 (0 décimale). null si la saisie est vide ou invalide. */
export function toMinor(text: string, decimals: number): number | null {
  const clean = text.replace(/[\s  ]/g, '').replace(',', '.');
  if (clean === '' || !/^\d+(\.\d+)?$/.test(clean)) return null;
  const [int, frac = ''] = clean.split('.');
  if (frac.length > decimals && Number(frac.slice(decimals)) > 0) return null;
  return Number(int) * 10 ** decimals + Number(frac.slice(0, decimals).padEnd(decimals, '0') || 0);
}

export function fromMinor(amount: number | null | undefined, decimals: number): string {
  if (amount === null || amount === undefined) return '';
  return decimals === 0 ? String(amount) : (amount / 10 ** decimals).toFixed(decimals);
}

export function MoneyField({
  label, amount, currency, onChange, currencies, hint, allowEmpty, fixedCurrency,
}: {
  label: string;
  amount: string;
  currency: string;
  onChange: (amount: string, currency: string) => void;
  currencies: CurrencyInfo[];
  hint?: ReactNode;
  allowEmpty?: boolean;
  fixedCurrency?: boolean;
}) {
  const dec = currencies.find((c) => c.code === currency)?.decimals ?? 0;
  const invalid = amount.trim() === '' ? !allowEmpty : toMinor(amount, dec) === null;
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="row" style={{ gap: 6 }}>
        <input className="input num" inputMode="decimal" value={amount} aria-invalid={invalid && amount !== '' ? true : undefined} onChange={(e) => onChange(e.target.value, currency)} />
        {fixedCurrency ? (
          <span className="strong" style={{ minWidth: 44 }}>{currency}</span>
        ) : (
          <select className="select" style={{ width: 96 }} value={currency} onChange={(e) => onChange(amount, e.target.value)} aria-label="Devise">
            {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
        )}
      </span>
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

/* ---------------------------------- Dates ---------------------------------- */

/** ISO -> valeur d'un champ datetime-local (heure locale du navigateur). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (value: string): string | null => (value ? new Date(value).toISOString() : null);

export function Pill({ tone, children }: { tone?: 'green' | 'amber' | 'red' | 'navy' | 'pink'; children: ReactNode }) {
  return <span className={`badge ${tone ? `badge--${tone}` : ''}`}>{children}</span>;
}

export function RowActions({ children }: { children: ReactNode }) {
  return <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{children}</div>;
}

export function IconButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="iconbtn" style={{ width: 34, height: 34 }} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={17} />
    </button>
  );
}
