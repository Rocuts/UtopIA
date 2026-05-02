'use client';

/**
 * AccountAutocomplete — typeahead picker for postable accounts.
 *
 * Why a dedicated component (not a generic Combobox):
 *   - Accounting search needs to match BOTH `code` and `name` so the user can
 *     start with either ("11" → 1105 Caja, or "Caja" → 1105 Caja).
 *   - Only postable (auxiliary) accounts can receive journal lines, so we
 *     pin `?postable=1` to the API call.
 *   - The selected account's metadata (`requiresThirdParty`,
 *     `requiresCostCenter`) is surfaced back via `onSelect` so the parent
 *     form can adapt validation per line.
 *
 * Network behavior:
 *   - Debounced (200 ms) calls to `GET /api/accounting/accounts?postable=1&search=<q>`
 *   - The first focus also fires a "load default" call so users see the most
 *     common accounts before typing anything (`?postable=1&limit=15`).
 *   - All fetch lifecycles are bound to the latest input via an in-flight
 *     ref so an old slow response can't overwrite a newer suggestion list.
 *
 * Accessibility:
 *   - Implements the WAI-ARIA 1.2 combobox pattern with role="listbox" +
 *     role="option", `aria-activedescendant`, and arrow-key navigation.
 *   - Selected option is announced to screen readers via the input's value.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Search, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AccountType =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'revenue'
  | 'expense'
  | 'contra';

export interface AccountSuggestion {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  isPostable: boolean;
  requiresThirdParty: boolean;
  requiresCostCenter: boolean;
}

export interface AccountAutocompleteProps {
  /** Currently selected account, if any. Pass null when none. */
  value: AccountSuggestion | null;
  /** Called when the user picks (or clears) an account. */
  onSelect: (account: AccountSuggestion | null) => void;
  /** Optional label rendered above the input (visually hidden if not provided). */
  label?: string;
  /** Placeholder for the input. */
  placeholder?: string;
  /** Disable interaction (e.g., when a journal entry is locked). */
  disabled?: boolean;
  /** className passthrough for the wrapper. */
  className?: string;
  /** Locale-aware empty-state copy. */
  emptyText?: string;
  /** Used for sizing inside dense table rows. */
  size?: 'sm' | 'md';
}

const TYPE_BADGE: Record<AccountType, string> = {
  asset: 'bg-success/10 text-success border-success/30',
  liability: 'bg-danger/10 text-danger border-danger/30',
  equity: 'bg-gold-500/10 text-gold-600 border-gold-500/30',
  revenue: 'bg-success/10 text-success border-success/30',
  expense: 'bg-warning/10 text-warning border-warning/30',
  contra: 'bg-n-100 text-n-700 border-n-300',
};

const DEBOUNCE_MS = 200;

export function AccountAutocomplete({
  value,
  onSelect,
  label,
  placeholder,
  disabled,
  className,
  emptyText,
  size = 'md',
}: AccountAutocompleteProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const requestSeqRef = useRef(0);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AccountSuggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);

  // Sync the visible input with the controlled `value`. While the listbox is
  // open we let the user edit freely (their typed query); once they pick or
  // close, we re-snap the input to the chosen account's display string.
  const valueLabel = useMemo(
    () => (value ? `${value.code} — ${value.name}` : ''),
    [value],
  );

  useEffect(() => {
    if (!open) setQuery(valueLabel);
  }, [open, valueLabel]);

  // ─── Fetch ────────────────────────────────────────────────────────────────
  const fetchSuggestions = useCallback(async (q: string) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ postable: '1' });
      if (q.trim()) params.set('search', q.trim());
      else params.set('limit', '15');
      const res = await fetch(`/api/accounting/accounts?${params.toString()}`);
      if (!res.ok) {
        if (seq === requestSeqRef.current) setSuggestions([]);
        return;
      }
      const json = (await res.json()) as
        | { ok: true; accounts: AccountSuggestion[] }
        | { ok: false }
        | AccountSuggestion[];
      // Tolerate either shape — agents B/C/D haven't shipped yet, and we
      // don't want a key rename to silently break the UI.
      const list: AccountSuggestion[] = Array.isArray(json)
        ? json
        : 'accounts' in json && Array.isArray(json.accounts)
          ? json.accounts
          : [];
      if (seq === requestSeqRef.current) {
        setSuggestions(list);
        setHighlight(0);
      }
    } catch {
      if (seq === requestSeqRef.current) setSuggestions([]);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      void fetchSuggestions(query);
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [open, query, fetchSuggestions]);

  // ─── Outside-click close ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const w = wrapperRef.current;
      if (w && !w.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleSelect = useCallback(
    (acc: AccountSuggestion) => {
      onSelect(acc);
      setQuery(`${acc.code} — ${acc.name}`);
      setOpen(false);
      inputRef.current?.blur();
    },
    [onSelect],
  );

  const handleClear = useCallback(() => {
    onSelect(null);
    setQuery('');
    inputRef.current?.focus();
  }, [onSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
        setOpen(true);
        return;
      }
      if (!open) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) =>
          suggestions.length === 0 ? 0 : Math.min(h + 1, suggestions.length - 1),
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const acc = suggestions[highlight];
        if (acc) handleSelect(acc);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    },
    [open, suggestions, highlight, handleSelect],
  );

  const inputHeight = size === 'sm' ? 'h-8 text-xs px-2' : 'h-9 text-sm px-3';

  return (
    <div ref={wrapperRef} className={cn('relative w-full', className)}>
      {label && (
        <label className="block text-xs-mono uppercase tracking-eyebrow text-n-700 font-medium mb-1">
          {label}
        </label>
      )}
      <div
        className={cn(
          'flex items-center gap-1 rounded-md border bg-n-0',
          'border-gold-500/25 focus-within:border-gold-500/60',
          'transition-colors',
          disabled ? 'opacity-50' : '',
        )}
      >
        <Search
          className="ml-2 h-3.5 w-3.5 text-n-500 shrink-0"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            open && suggestions[highlight]
              ? `${listboxId}-opt-${suggestions[highlight].id}`
              : undefined
          }
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            'flex-1 min-w-0 bg-transparent border-none outline-none',
            'text-n-1000 placeholder:text-n-500 tabular-nums',
            'focus-visible:ring-0',
            inputHeight,
          )}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className={cn(
              'p-1 rounded text-n-500 hover:text-n-1000 hover:bg-gold-500/8',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
            aria-label="Limpiar selección"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (disabled) return;
            setOpen((o) => !o);
            if (!open) inputRef.current?.focus();
          }}
          disabled={disabled}
          className={cn(
            'p-1 mr-1 rounded text-n-500 hover:text-n-1000 hover:bg-gold-500/8',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
          )}
          aria-label={open ? 'Cerrar opciones' : 'Abrir opciones'}
          tabIndex={-1}
        >
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform',
              open ? 'rotate-180' : '',
            )}
          />
        </button>
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className={cn(
            'absolute z-50 left-0 right-0 mt-1 max-h-72 overflow-y-auto',
            'rounded-md border border-gold-500/30 bg-n-0 shadow-e3',
            'styled-scrollbar',
          )}
        >
          {loading && suggestions.length === 0 && (
            <li className="px-3 py-2 text-xs text-n-500" role="status">
              Buscando…
            </li>
          )}
          {!loading && suggestions.length === 0 && (
            <li className="px-3 py-2 text-xs text-n-500" role="status">
              {emptyText ?? 'Sin resultados'}
            </li>
          )}
          {suggestions.map((acc, i) => {
            const isHi = i === highlight;
            return (
              <li
                key={acc.id}
                id={`${listboxId}-opt-${acc.id}`}
                role="option"
                aria-selected={isHi}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  // mousedown so the input doesn't blur first
                  e.preventDefault();
                  handleSelect(acc);
                }}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 cursor-pointer',
                  'border-b last:border-b-0 border-gold-500/10',
                  isHi ? 'bg-gold-500/8' : 'hover:bg-gold-500/8',
                )}
              >
                <span className="font-mono text-xs-mono text-n-1000 tabular-nums shrink-0">
                  {acc.code}
                </span>
                <span className="flex-1 min-w-0 text-sm text-n-700 truncate">
                  {acc.name}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-[10px] font-mono uppercase tracking-eyebrow',
                    'rounded border px-1.5 py-0.5',
                    TYPE_BADGE[acc.type] ?? 'bg-n-100 text-n-700 border-n-300',
                  )}
                >
                  {acc.type}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default AccountAutocomplete;
