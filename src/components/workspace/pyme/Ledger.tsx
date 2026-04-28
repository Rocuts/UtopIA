'use client';

/**
 * Ledger — vista de libro contable confirmado.
 *
 * Filtros: mes (selector), tipo (toggle ingreso/egreso/todos), busqueda
 * por descripcion. Pagina con limit=100 + offset progresivo (load more).
 *
 * Footer agrega: total ingresos, total egresos, margen del filtro
 * actual (calculado client-side sobre los entries cargados).
 *
 * Lenis: contenedor con scroll lleva `data-lenis-prevent`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  LineChart,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import type { PymeEntry, PymeEntryKind } from './types';

interface LedgerProps {
  bookId: string;
  /** ISO 4217 — para formatear los montos con la moneda correcta. */
  currency?: string;
}

const PAGE_SIZE = 100;

interface MonthOption {
  value: string; // 'YYYY-MM'
  label: string;
}

/** Genera selector de los ultimos 12 meses incluyendo "todos". */
function buildMonthOptions(language: 'es' | 'en'): MonthOption[] {
  const now = new Date();
  const options: MonthOption[] = [
    { value: 'all', label: language === 'es' ? 'Todos los meses' : 'All months' },
  ];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const value = `${y}-${m}`;
    const label = d.toLocaleDateString(language === 'es' ? 'es-CO' : 'en-US', {
      month: 'long',
      year: 'numeric',
    });
    options.push({ value, label });
  }
  return options;
}

/**
 * Calcula bounds de un mes 'YYYY-MM' como rango half-open [from, to):
 *   from = primer dia del mes seleccionado (`YYYY-MM-01`)
 *   to   = primer dia del mes SIGUIENTE
 *
 * El servidor filtra con `lt(entryDate, toDate)` (exclusivo). Si `to` fuese
 * el ultimo dia del mes, el dia 31 quedaria fuera. Con `to` apuntando al
 * primer dia del mes siguiente y `lt`, todos los dias del mes seleccionado
 * quedan incluidos sin importar la longitud (28/29/30/31 dias).
 */
function monthBounds(monthVal: string): { from: string; to: string } | null {
  if (monthVal === 'all') return null;
  const [yStr, mStr] = monthVal.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  // `Date.UTC(y, m, 1)` con m en base 0 en realidad apunta al mes (m+1) base 1.
  // Como nuestro `m` viene en base 1 (1..12), pasarlo directo a Date.UTC sin
  // restar 1 nos da el primer dia del mes SIGUIENTE — exactamente lo que
  // necesitamos como `to` exclusivo.
  const next = new Date(Date.UTC(y, m, 1));
  return {
    from: `${monthVal}-01`,
    to: next.toISOString().slice(0, 10),
  };
}

export function Ledger({ bookId, currency = 'COP' }: LedgerProps) {
  const { t, language } = useLanguage();
  const tt = t.pyme.ledger;

  const monthOptions = useMemo(() => buildMonthOptions(language), [language]);
  const [month, setMonth] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<'all' | PymeEntryKind>('all');
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<PymeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const loadPage = useCallback(
    async (opts: {
      month: string;
      kind: 'all' | PymeEntryKind;
      offset: number;
      append: boolean;
    }) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          bookId,
          status: 'confirmed',
          limit: String(PAGE_SIZE),
          offset: String(opts.offset),
        });
        if (opts.kind !== 'all') params.set('kind', opts.kind);
        const bounds = monthBounds(opts.month);
        if (bounds) {
          params.set('fromDate', bounds.from);
          params.set('toDate', bounds.to);
        }
        const res = await fetch(`/api/pyme/entries?${params.toString()}`);
        const json = (await res.json()) as { ok: boolean; entries?: PymeEntry[] };
        if (!res.ok || !json.ok || !json.entries) throw new Error('load_failed');
        setEntries((prev) =>
          opts.append ? [...prev, ...json.entries!] : json.entries!,
        );
        setHasMore(json.entries.length === PAGE_SIZE);
      } catch {
        if (!opts.append) setEntries([]);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [bookId],
  );

  // Re-fetch when filters change (search is client-side only).
  useEffect(() => {
    setOffset(0);
    void loadPage({ month, kind: kindFilter, offset: 0, append: false });
  }, [month, kindFilter, loadPage]);

  // Client-side text filter (search not pushed to API to keep it cheap).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      (e.description ?? '').toLowerCase().includes(q),
    );
  }, [entries, search]);

  // Totals on the filtered view.
  const totals = useMemo(() => {
    let ingresos = 0;
    let egresos = 0;
    filtered.forEach((e) => {
      const amt = Number(e.amount) || 0;
      if (e.kind === 'ingreso') ingresos += amt;
      else egresos += amt;
    });
    return { ingresos, egresos, margen: ingresos - egresos };
  }, [filtered]);

  const fmt = useMemo(() => {
    try {
      return new Intl.NumberFormat(language === 'es' ? 'es-CO' : 'en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      });
    } catch {
      return new Intl.NumberFormat(language === 'es' ? 'es-CO' : 'en-US', {
        maximumFractionDigits: 0,
      });
    }
  }, [language, currency]);

  const handleLoadMore = useCallback(() => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    void loadPage({ month, kind: kindFilter, offset: nextOffset, append: true });
  }, [offset, month, kindFilter, loadPage]);

  return (
    <div className="space-y-5">
      {/* Header + filters */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-serif-elite text-xl font-medium tracking-tight text-n-1000 inline-flex items-center gap-2">
            <LineChart className="h-5 w-5 text-area-escudo" strokeWidth={1.75} aria-hidden="true" />
            {tt.title}
          </h3>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {/* Month selector */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-eyebrow text-n-600">
            {tt.filter_month}
          </span>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 rounded-md bg-n-0 text-n-1000 border border-n-300 focus-visible:border-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30"
          >
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {/* Kind toggle (chips) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-eyebrow text-n-600">
            {tt.filter_kind}
          </span>
          <div role="radiogroup" className="inline-flex rounded-md border border-n-300 bg-n-0 p-0.5 self-start">
            <KindChip
              active={kindFilter === 'all'}
              label={tt.filter_kind_all}
              onClick={() => setKindFilter('all')}
            />
            <KindChip
              active={kindFilter === 'ingreso'}
              label={t.pyme.review.ingreso}
              onClick={() => setKindFilter('ingreso')}
              tone="success"
              icon={<TrendingUp className="h-3 w-3" strokeWidth={2} aria-hidden="true" />}
            />
            <KindChip
              active={kindFilter === 'egreso'}
              label={t.pyme.review.egreso}
              onClick={() => setKindFilter('egreso')}
              tone="wine"
              icon={<TrendingDown className="h-3 w-3" strokeWidth={2} aria-hidden="true" />}
            />
          </div>
        </div>

        {/* Search */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-eyebrow text-n-600">
            {tt.col_description}
          </span>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-n-500 pointer-events-none"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tt.search_placeholder}
              className="w-full pl-9 pr-3 py-2 rounded-md bg-n-0 text-n-1000 placeholder:text-n-500 border border-n-300 focus-visible:border-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30"
            />
          </div>
        </label>
      </div>

      {/* Table */}
      <div
        data-lenis-prevent
        className="relative max-h-[60vh] overflow-y-auto overflow-x-auto styled-scrollbar rounded-xl glass-elite"
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-n-0/95 backdrop-blur">
            <tr className="text-left text-xs font-medium uppercase tracking-eyebrow text-n-600">
              <th scope="col" className="px-4 py-2.5 font-medium">{tt.col_date}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{tt.col_description}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{tt.col_category}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{tt.col_kind}</th>
              <th scope="col" className="px-4 py-2.5 font-medium text-right">
                {tt.col_amount}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-n-600">
                  {tt.empty}
                </td>
              </tr>
            )}
            {filtered.map((e) => {
              const date = (e.entryDate ?? '').slice(0, 10);
              const amount = Number(e.amount) || 0;
              return (
                <tr key={e.id} className="border-t border-n-200 hover:bg-n-100 transition-colors">
                  <td className="px-4 py-2.5 align-top text-n-800 num whitespace-nowrap">
                    {date}
                  </td>
                  <td className="px-4 py-2.5 align-top text-n-1000">
                    {e.description}
                  </td>
                  <td className="px-4 py-2.5 align-top text-n-600">
                    {e.category ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    {e.kind === 'ingreso' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                        <TrendingUp className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                        {t.pyme.review.ingreso}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-area-escudo">
                        <TrendingDown className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                        {t.pyme.review.egreso}
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2.5 align-top text-right num font-medium whitespace-nowrap',
                      e.kind === 'ingreso' ? 'text-success' : 'text-area-escudo',
                    )}
                  >
                    {e.kind === 'egreso' ? '-' : ''}
                    {fmt.format(amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer + load more */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <Total label={tt.total_ingresos} value={fmt.format(totals.ingresos)} tone="success" />
          <Total label={tt.total_egresos} value={fmt.format(totals.egresos)} tone="wine" />
          <Total
            label={tt.margin}
            value={fmt.format(totals.margen)}
            tone={totals.margen >= 0 ? 'success' : 'wine'}
          />
        </div>

        {hasMore && (
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loading}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium',
              'bg-n-100 text-n-1000 hover:bg-n-200 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
              'disabled:opacity-50',
            )}
          >
            {loading ? tt.loading : tt.load_more}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function KindChip({
  active,
  label,
  onClick,
  tone,
  icon,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  tone?: 'success' | 'wine';
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
        active
          ? 'bg-n-100 text-n-1000'
          : 'text-n-600 hover:text-n-1000',
        active && tone === 'success' && 'text-success',
        active && tone === 'wine' && 'text-area-escudo',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Total({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'success' | 'wine';
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium uppercase tracking-eyebrow text-n-600">
        {label}
      </span>
      <span
        className={cn(
          'font-medium num text-base',
          tone === 'success' ? 'text-success' : 'text-area-escudo',
        )}
      >
        {value}
      </span>
    </div>
  );
}
