'use client';

/**
 * /workspace/contabilidad/asientos — Libro de Asientos (Journal).
 *
 * Lista paginada de asientos con filtros de búsqueda, período, tipo y estado.
 * Datos estáticos de demostración (8 filas) — integración real vía
 * GET /api/accounting/journal con los mismos parámetros de query.
 */

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BookText,
  Eye,
  Pencil,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPesos } from '@/lib/format/cop';

// ─── Types ──────────────────────────────────────────────────────────────────

type EntryStatus = 'posted' | 'review' | 'draft';
type EntryType = 'manual' | 'ajuste' | 'cierre';

interface JournalEntry {
  id: string;
  number: string;
  date: string;
  concept: string;
  type: EntryType;
  debit: string;
  credit: string;
  status: EntryStatus;
}

// ─── Static demo data (8 rows) ──────────────────────────────────────────────

const DEMO_ENTRIES: JournalEntry[] = [
  {
    id: '1',
    number: '000142',
    date: '2026-06-07',
    concept: 'Venta de mercancía — Factura 1042',
    type: 'manual',
    debit: '238000000',
    credit: '238000000',
    status: 'posted',
  },
  {
    id: '2',
    number: '000141',
    date: '2026-06-07',
    concept: 'Pago proveedor — Distribuidora Andina',
    type: 'manual',
    debit: '115000000',
    credit: '115000000',
    status: 'posted',
  },
  {
    id: '3',
    number: '000140',
    date: '2026-06-06',
    concept: 'Nómina quincena',
    type: 'manual',
    debit: '421000000',
    credit: '421000000',
    status: 'review',
  },
  {
    id: '4',
    number: '000139',
    date: '2026-06-05',
    concept: 'Recaudo cartera — 2tres S.A.S.',
    type: 'manual',
    debit: '306000000',
    credit: '306000000',
    status: 'posted',
  },
  {
    id: '5',
    number: '000138',
    date: '2026-06-04',
    concept: 'Pago arriendo local',
    type: 'manual',
    debit: '280000000',
    credit: '280000000',
    status: 'posted',
  },
  {
    id: '6',
    number: '000137',
    date: '2026-06-03',
    concept: 'Ajuste diferencia en cambio — USD',
    type: 'ajuste',
    debit: '58000000',
    credit: '58000000',
    status: 'review',
  },
  {
    id: '7',
    number: '000136',
    date: '2026-06-02',
    concept: 'Provisión imporrenta 2026',
    type: 'ajuste',
    debit: '192000000',
    credit: '192000000',
    status: 'draft',
  },
  {
    id: '8',
    number: '000135',
    date: '2026-06-01',
    concept: 'Cierre ingresos mayo 2026',
    type: 'cierre',
    debit: '870000000',
    credit: '870000000',
    status: 'draft',
  },
];

const TOTAL_ENTRIES = 124;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_META: Record<
  EntryStatus,
  { label: string; classes: string }
> = {
  posted: {
    label: 'Contabilizado',
    classes:
      'bg-success/10 text-success border-success/30',
  },
  review: {
    label: 'Por revisar',
    classes:
      'bg-warning/10 text-warning border-warning/30',
  },
  draft: {
    label: 'Borrador',
    classes:
      'bg-n-100 text-n-700 border-n-300',
  },
};

const TYPE_LABEL: Record<EntryType, string> = {
  manual: 'Manual',
  ajuste: 'Ajuste',
  cierre: 'Cierre',
};

const PERIODS = [
  'Junio 2026',
  'Mayo 2026',
  'Abril 2026',
  'Marzo 2026',
  'Febrero 2026',
  'Enero 2026',
];

const TYPE_FILTERS = ['Todos', 'Manual', 'Ajuste', 'Cierre'] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

const STATUS_FILTERS = ['Todos', 'Contabilizado', 'Por revisar', 'Borrador'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function formatDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AsientosPage() {
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('Junio 2026');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('Todos');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Todos');
  const [page] = useState(1);

  const filtered = useMemo(() => {
    return DEMO_ENTRIES.filter((e) => {
      const matchSearch =
        !search ||
        e.concept.toLowerCase().includes(search.toLowerCase()) ||
        e.number.includes(search);
      const matchType =
        typeFilter === 'Todos' ||
        TYPE_LABEL[e.type] === typeFilter;
      const matchStatus =
        statusFilter === 'Todos' ||
        STATUS_META[e.status].label === statusFilter;
      return matchSearch && matchType && matchStatus;
    });
  }, [search, typeFilter, statusFilter]);

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 md:py-10">
      {/* Back link */}
      <Link
        href="/workspace/contabilidad"
        className={cn(
          'inline-flex items-center gap-1.5 mb-6',
          'font-mono text-xs-mono uppercase tracking-eyebrow',
          'text-n-700 hover:text-n-1000 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A] rounded',
        )}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Contabilidad
      </Link>

      {/* Page header */}
      <header className="mb-8 flex flex-col gap-1">
        <p className="font-mono text-xs-mono uppercase tracking-eyebrow text-[#B8934A] font-medium">
          Contabilidad · Asientos
        </p>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#B8934A]/10 text-[#B8934A]"
            >
              <BookText className="h-5 w-5" strokeWidth={1.6} />
            </span>
            <div>
              <h1 className="font-serif-elite text-2xl md:text-3xl text-n-1000 tracking-tight leading-none">
                Libro de Asientos
              </h1>
              <p className="text-sm text-n-700 mt-0.5">
                Todos los asientos del período con su estado de contabilización.
              </p>
            </div>
          </div>

          <Link
            href="/workspace/contabilidad/asientos/nuevo"
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 rounded-lg',
              'bg-[#B8934A] text-n-0 hover:bg-[#a07d3e] active:bg-[#8c6c34]',
              'transition-colors text-sm font-semibold shrink-0',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]',
              'focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
            )}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nuevo asiento
          </Link>
        </div>
      </header>

      {/* Filter bar */}
      <div
        role="search"
        aria-label="Filtros de asientos"
        className={cn(
          'mb-6 flex flex-wrap items-center gap-3',
          'rounded-xl border border-[#B8934A]/20 bg-n-0 px-4 py-3',
        )}
      >
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-n-500"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Buscar concepto o Nº…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(
              'w-full h-9 pl-9 pr-3 rounded-lg text-sm',
              'border border-n-200 bg-n-50 text-n-1000',
              'placeholder:text-n-500',
              'focus:outline-none focus:ring-2 focus:ring-[#B8934A]/40 focus:border-[#B8934A]/60',
              'transition-colors',
            )}
          />
        </div>

        {/* Period select */}
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          aria-label="Período"
          className={cn(
            'h-9 px-3 rounded-lg text-sm border border-n-200 bg-n-50 text-n-1000',
            'focus:outline-none focus:ring-2 focus:ring-[#B8934A]/40 focus:border-[#B8934A]/60',
            'transition-colors cursor-pointer',
          )}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          aria-label="Tipo de asiento"
          className={cn(
            'h-9 px-3 rounded-lg text-sm border border-n-200 bg-n-50 text-n-1000',
            'focus:outline-none focus:ring-2 focus:ring-[#B8934A]/40 focus:border-[#B8934A]/60',
            'transition-colors cursor-pointer',
          )}
        >
          {TYPE_FILTERS.map((f) => (
            <option key={f} value={f}>
              {f === 'Todos' ? 'Tipo: Todos' : f}
            </option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="Estado"
          className={cn(
            'h-9 px-3 rounded-lg text-sm border border-n-200 bg-n-50 text-n-1000',
            'focus:outline-none focus:ring-2 focus:ring-[#B8934A]/40 focus:border-[#B8934A]/60',
            'transition-colors cursor-pointer',
          )}
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f} value={f}>
              {f === 'Todos' ? 'Estado: Todos' : f}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div
        className={cn(
          'rounded-xl border border-[#B8934A]/20 bg-n-0 overflow-hidden',
          'mb-4',
        )}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Asientos de diario">
            <thead>
              <tr className="border-b border-[#B8934A]/15 bg-[#B8934A]/5">
                <th
                  scope="col"
                  className="px-4 py-3 text-left font-mono text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium w-[90px]"
                >
                  Nº
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left font-mono text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium w-[80px]"
                >
                  Fecha
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left font-mono text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium"
                >
                  Concepto
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left font-mono text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium w-[80px]"
                >
                  Tipo
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right font-mono text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium w-[140px]"
                >
                  Débito
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right font-mono text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium w-[140px]"
                >
                  Crédito
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left font-mono text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium w-[130px]"
                >
                  Estado
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-center font-mono text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium w-[90px]"
                >
                  Acción
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#B8934A]/10">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-sm text-n-500"
                  >
                    No se encontraron asientos con los filtros aplicados.
                  </td>
                </tr>
              ) : (
                filtered.map((entry) => {
                  const status = STATUS_META[entry.status];
                  return (
                    <tr
                      key={entry.id}
                      className="even:bg-n-50 hover:bg-[#B8934A]/5 transition-colors"
                    >
                      {/* Nº */}
                      <td className="px-4 py-3 font-mono text-sm text-n-1000 font-semibold tabular-nums whitespace-nowrap">
                        {entry.number}
                      </td>
                      {/* Fecha */}
                      <td className="px-4 py-3 font-mono text-sm text-n-700 tabular-nums whitespace-nowrap">
                        {formatDate(entry.date)}
                      </td>
                      {/* Concepto */}
                      <td className="px-4 py-3 text-sm text-n-1000 max-w-xs">
                        <span className="block truncate">{entry.concept}</span>
                      </td>
                      {/* Tipo */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs-mono text-n-600 uppercase tracking-eyebrow">
                          {TYPE_LABEL[entry.type]}
                        </span>
                      </td>
                      {/* Débito */}
                      <td className="px-4 py-3 text-right font-mono text-sm text-n-1000 tabular-nums whitespace-nowrap">
                        {formatPesos(entry.debit)}
                      </td>
                      {/* Crédito */}
                      <td className="px-4 py-3 text-right font-mono text-sm text-n-1000 tabular-nums whitespace-nowrap">
                        {formatPesos(entry.credit)}
                      </td>
                      {/* Estado */}
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full',
                            'font-mono text-[10px] uppercase tracking-eyebrow border',
                            status.classes,
                          )}
                        >
                          {status.label}
                        </span>
                      </td>
                      {/* Acciones */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`Ver asiento ${entry.number}`}
                            title="Ver"
                            className={cn(
                              'flex h-7 w-7 items-center justify-center rounded-md',
                              'text-n-600 hover:text-[#B8934A] hover:bg-[#B8934A]/10',
                              'transition-colors focus:outline-none focus-visible:ring-2',
                              'focus-visible:ring-[#B8934A]',
                            )}
                          >
                            <Eye className="h-3.5 w-3.5" strokeWidth={1.6} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Editar asiento ${entry.number}`}
                            title="Editar"
                            className={cn(
                              'flex h-7 w-7 items-center justify-center rounded-md',
                              'text-n-600 hover:text-[#B8934A] hover:bg-[#B8934A]/10',
                              'transition-colors focus:outline-none focus-visible:ring-2',
                              'focus-visible:ring-[#B8934A]',
                            )}
                          >
                            <Pencil className="h-3.5 w-3.5" strokeWidth={1.6} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div
        className="flex items-center justify-between flex-wrap gap-3"
        aria-label="Paginación"
      >
        <p className="font-mono text-xs-mono text-n-600 uppercase tracking-eyebrow">
          Mostrando{' '}
          <span className="text-n-1000 font-semibold">
            {(page - 1) * 8 + 1}–{Math.min(page * 8, TOTAL_ENTRIES)}
          </span>{' '}
          de{' '}
          <span className="text-n-1000 font-semibold">{TOTAL_ENTRIES}</span>{' '}
          asientos
        </p>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled
            aria-label="Página anterior"
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md',
              'border border-n-200 text-n-500',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              'hover:not-disabled:bg-[#B8934A]/10 hover:not-disabled:text-[#B8934A]',
              'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]',
            )}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>

          {[1, 2, 3, '…', 16].map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={typeof p === 'number' ? `Página ${p}` : undefined}
              aria-current={p === page ? 'page' : undefined}
              disabled={p === '…'}
              className={cn(
                'flex h-8 min-w-[32px] items-center justify-center rounded-md px-2',
                'font-mono text-xs-mono transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]',
                p === page
                  ? 'bg-[#B8934A] text-n-0 font-semibold'
                  : p === '…'
                    ? 'text-n-500 cursor-default'
                    : 'border border-n-200 text-n-700 hover:bg-[#B8934A]/10 hover:text-[#B8934A]',
              )}
            >
              {p}
            </button>
          ))}

          <button
            type="button"
            aria-label="Página siguiente"
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md',
              'border border-n-200 text-n-700',
              'hover:bg-[#B8934A]/10 hover:text-[#B8934A]',
              'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]',
            )}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
