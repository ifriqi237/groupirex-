/**
 * Menu déroulant de pays avec drapeaux.
 *
 * Un <select> natif ne peut pas afficher d'image, et les drapeaux en émoji ne s'affichent pas
 * sous Windows : la liste est donc dessinée ici, avec le comportement d'un menu déroulant
 * (clavier : flèches, Début, Fin, Entrée, Échap, et saisie des premières lettres du pays).
 */

import { KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { asset } from '../lib/env';
import { useT } from '../lib/i18n';
import { Icon } from './ui';

export interface PickerCountry {
  code: string;
  name: string;
  /** Nombre de partenaires, affiché dans la liste quand il est connu (page Partenaires). */
  partners?: number;
  served?: boolean;
}

export function Flag({ code, size = 28 }: { code: string; size?: number }) {
  // Image décorative : le nom du pays est toujours écrit à côté.
  return <img className="flag" src={asset(`/flags/${code.toLowerCase()}.png`)} alt="" width={size} height={Math.round(size * 0.75)} loading="lazy" />;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function CountryPicker({ id, countries, value, onChange, placeholder, label, variant, invalid }: { id: string; countries: PickerCountry[]; value: string; onChange: (code: string) => void; placeholder: string; label: string; variant?: 'pill'; invalid?: boolean }) {
  const t = useT();
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const selected = countries.find((c) => c.code === value) ?? null;

  // Un clic en dehors referme la liste.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  // À l'ouverture, le pays choisi est centré ; ensuite, le pays en surbrillance reste visible.
  const justOpened = useRef(false);
  useEffect(() => {
    if (!open || active < 0) return;
    list.current?.children[active]?.scrollIntoView({ block: justOpened.current ? 'center' : 'nearest' });
    justOpened.current = false;
  }, [open, active]);

  const show = () => {
    setActive(Math.max(0, countries.findIndex((c) => c.code === value)));
    justOpened.current = true;
    setOpen(true);
  };
  const pick = (index: number) => {
    const c = countries[index];
    if (!c) return;
    onChange(c.code);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = countries.length - 1;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === 'Escape' || e.key === 'Tab') return setOpen(false);
    if (e.key === 'ArrowDown') setActive((i) => Math.min(last, i + 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(last);
    else if (e.key === 'Enter' || e.key === ' ') pick(active);
    else if (e.key.length === 1) {
      // Saisie des premières lettres : « ca » mène au Cameroun.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 700 ? '' : typed.current.text) + fold(e.key), at: now };
      const hit = countries.findIndex((c) => fold(c.name).startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
      return;
    } else return;
    e.preventDefault();
  };

  return (
    <div className={variant === 'pill' ? 'picker picker--pill' : 'picker'} ref={root}>
      <button
        type="button"
        id={id}
        className="picker__btn"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${countries[active]?.code}` : undefined}
        aria-invalid={invalid || undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        {selected ? (
          <>
            <Flag code={selected.code} />
            <span className="picker__name">{selected.name}</span>
          </>
        ) : (
          <span className="picker__name picker__name--empty">{placeholder}</span>
        )}
        <span className="picker__chevron"><Icon name="down" size={18} /></span>
      </button>
      {open && (
        <ul className="picker__list" id={listId} ref={list} role="listbox" aria-label={label}>
          {countries.map((c, i) => (
            <li
              key={c.code}
              id={`${listId}-${c.code}`}
              role="option"
              data-code={c.code}
              aria-selected={c.code === value}
              className={`picker__option ${i === active ? 'is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
            >
              <Flag code={c.code} />
              <span className="picker__name">{c.name}</span>
              {!!c.partners && <span className="picker__count num">{c.partners === 1 ? t('1 partenaire') : t('{n} partenaires', { n: c.partners })}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
