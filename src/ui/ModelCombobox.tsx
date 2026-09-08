import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { filterModels, type CatalogModel } from '../llm/modelsDev.ts';
import { fmt, useT } from '../i18n/index.ts';
import { ChevronDown, SearchIcon } from './icons.tsx';

type Props = {
  id: string;
  value: string;
  models: CatalogModel[];
  loading?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function ModelCombobox({ id, value, models, loading, disabled, onChange }: Props) {
  const { t } = useT();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(0);

  const filtered = typed ? filterModels(models, value) : models;
  const safeActive = filtered.length === 0 ? 0 : Math.min(active, filtered.length - 1);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${safeActive}`)?.scrollIntoView({ block: 'nearest' });
  }, [safeActive, open, listId]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setTyped(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const select = (idValue: string) => {
    onChange(idValue);
    setTyped(false);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setTyped(false);
        return;
      }
      setActive((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setTyped(false);
        return;
      }
      setActive((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
    } else if (e.key === 'Enter') {
      if (open && filtered[safeActive]) {
        e.preventDefault();
        select(filtered[safeActive]!.id);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setTyped(false);
    }
  };

  const priceLabel = (m: CatalogModel) => {
    if (m.inputPerMillion === 0 && m.outputPerMillion === 0) return t.costFree;
    if (m.inputPerMillion != null && m.outputPerMillion != null) {
      return fmt(t.modelPer, { in: m.inputPerMillion, out: m.outputPerMillion });
    }
    return '';
  };

  return (
    <div className="model-combo" ref={rootRef}>
      <span className="model-combo-search">
        <SearchIcon />
      </span>
      <input
        ref={inputRef}
        id={id}
        className="model-combo-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[safeActive] ? `${listId}-${safeActive}` : undefined}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          setOpen(true);
          setTyped(false);
          inputRef.current?.select();
        }}
        onChange={(e) => {
          setTyped(true);
          setOpen(true);
          onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      <button
        className="model-combo-chevron"
        type="button"
        tabIndex={-1}
        disabled={disabled || (!loading && models.length === 0)}
        aria-label={t.model}
        onMouseDown={(e) => {
          e.preventDefault();
          if (disabled || (!loading && models.length === 0)) return;
          setOpen((was) => {
            const next = !was;
            if (next) setTyped(false);
            return next;
          });
          inputRef.current?.focus();
        }}
      >
        <ChevronDown />
      </button>
      {open && (loading || models.length > 0) && (
        <ul className="model-combo-menu" id={listId} role="listbox">
          {loading && models.length === 0 ? (
            <li className="model-combo-empty">{t.modelLoading}</li>
          ) : filtered.length === 0 ? (
            <li className="model-combo-empty">{t.modelNoMatches}</li>
          ) : (
            filtered.map((m, i) => (
              <li
                key={m.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={m.id === value}
                className={
                  'model-combo-option' +
                  (i === safeActive ? ' is-active' : '') +
                  (m.id === value ? ' is-selected' : '')
                }
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(m.id);
                }}
              >
                <span className="model-combo-id">{m.id}</span>
                <span className="model-combo-price">{priceLabel(m)}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
