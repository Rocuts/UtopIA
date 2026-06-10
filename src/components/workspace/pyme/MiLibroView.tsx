'use client';

/**
 * MiLibroView — /workspace/pyme/libro ("Mi Libro").
 *
 * Diseño del handoff "Pyme - Mi Libro.html" cableado a datos REALES:
 * - Hero verde: totales del mes desde GET /api/pyme/summary
 * - Lista de movimientos desde GET /api/pyme/entries (badge "Factura leída"
 *   cuando el entry nació del OCR — uploadId presente)
 * - "Bajar a Excel" → endpoint real /api/pyme/books/{id}/export.xlsx
 * - CTA de foto → flujo OCR real /workspace/pyme/{id}/subir
 *
 * Sin libro o sin movimientos → estado vacío honesto (nunca datos inventados).
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Camera,
  Download,
  Droplet,
  Home,
  Receipt,
  ShoppingCart,
  Truck,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPesosInteger } from '@/lib/format/cop';
import { PymeSubpageShell } from '@/components/workspace/pyme/PymeSubpageShell';
import { PymeGreenHero } from '@/components/workspace/pyme/PymeGreenHero';
import {
  usePymeBook,
  usePymeEntries,
  usePymeSummary,
  type PymeEntryLite,
} from '@/components/workspace/pyme/usePymeData';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const cop = (n: number) => `$${formatPesosInteger(n)}`;

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'ingreso', label: 'Ingresos' },
  { id: 'egreso', label: 'Gastos' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

/** Icono por tipo + heurística de categoría (visual, sin inventar datos). */
function entryIcon(e: PymeEntryLite): LucideIcon {
  if (e.kind === 'ingreso') return ShoppingCart;
  const cat = `${e.category ?? ''} ${e.description}`.toLowerCase();
  if (/(luz|energ)/.test(cat)) return Zap;
  if (/agua/.test(cat)) return Droplet;
  if (/(arriendo|alquiler|local)/.test(cat)) return Home;
  if (/(proveedor|compra|mercanc|inventario)/.test(cat)) return Truck;
  return Receipt;
}

function entryMeta(e: PymeEntryLite): string {
  const d = new Date(e.entryDate);
  const date = Number.isNaN(d.getTime())
    ? ''
    : new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(d);
  return [date, e.category].filter(Boolean).join(' · ');
}

// ─── View ────────────────────────────────────────────────────────────────────

export function MiLibroView() {
  const [filter, setFilter] = useState<FilterId>('all');

  const now = new Date();
  const { book, loading: bookLoading } = usePymeBook();
  const { summary } = usePymeSummary(
    book?.id ?? null,
    now.getFullYear(),
    now.getMonth() + 1,
  );
  const { entries, loading: entriesLoading } = usePymeEntries(book?.id ?? null);

  const visible = entries.filter((e) => filter === 'all' || e.kind === filter);
  const totals = summary?.totals;
  const loading = bookLoading || (Boolean(book) && entriesLoading);

  // ── Sin libro: onboarding honesto ──────────────────────────────────────────
  if (!bookLoading && !book) {
    return (
      <PymeSubpageShell>
        <div className="mx-auto mt-10 max-w-md rounded-2xl border border-area-pyme/25 bg-n-0 px-8 py-10 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-area-pyme/12 text-area-pyme">
            <BookOpen className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <h1 className="font-serif-elite text-2xl font-medium text-n-1000">
            Aún no tiene un libro
          </h1>
          <p className="mx-auto mt-2 max-w-[38ch] text-sm leading-relaxed text-n-600">
            Su libro es donde anotamos todo lo que vende y gasta. Créelo en un
            minuto y empiece con la primera foto de factura.
          </p>
          <Link
            href="/workspace/pyme/libros"
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-md bg-area-pyme px-5 text-[15px] font-semibold text-white transition-all hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme"
          >
            Crear mi libro
          </Link>
        </div>
      </PymeSubpageShell>
    );
  }

  return (
    <PymeSubpageShell>
      <PymeGreenHero
        title="Mi Libro"
        subtitle="Todo lo que entró y salió este mes, ordenado por día."
        metrics={[
          { value: totals ? cop(totals.ingresos) : '—', label: 'Vendí' },
          { value: totals ? cop(totals.egresos) : '—', label: 'Gasté' },
          {
            value: totals ? cop(totals.margen) : '—',
            label: 'Me quedó',
            tone: 'green',
          },
        ]}
      >
        {book && (
          <Link
            href={`/workspace/pyme/${book.id}/subir`}
            className="mt-5 inline-flex h-12 items-center gap-2.5 rounded-md bg-[#7BC95B] px-5 text-[15px] font-bold text-[#0a1f06] shadow-[0_10px_24px_-10px_rgb(123_201_91_/_0.6)] transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Camera className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            Agregar foto de factura
          </Link>
        )}
      </PymeGreenHero>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar movimientos">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              'rounded-full border px-4 py-2 text-sm font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme',
              filter === f.id
                ? 'border-area-pyme bg-area-pyme text-white'
                : 'border-n-200 bg-n-0 text-n-700 hover:border-area-pyme/40',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Movimientos */}
      {loading ? (
        <div className="flex flex-col gap-2.5" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[76px] animate-pulse rounded-xl border border-n-200 bg-n-50"
            />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-area-pyme/30 bg-n-0 px-6 py-10 text-center">
          <p className="text-[15px] font-semibold text-n-1000">
            {entries.length === 0
              ? 'Su libro está vacío todavía'
              : 'Sin movimientos en este filtro'}
          </p>
          {entries.length === 0 && (
            <p className="mx-auto mt-1.5 max-w-[42ch] text-sm text-n-600">
              Tómele una foto a su primera factura y nosotros la anotamos por
              usted.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visible.map((e) => {
            const Icon = entryIcon(e);
            return (
              <div
                key={e.id}
                className="flex items-center gap-3.5 rounded-xl border border-n-200 bg-n-0 px-4 py-3.5"
              >
                <span className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-md bg-area-pyme/10 text-[#2A5E1F] dark:text-area-pyme">
                  <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-n-1000">
                    {e.description}
                    {e.uploadId && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-area-pyme/15 px-2 py-0.5 text-[10px] font-bold text-[#2A5E1F] dark:text-area-pyme">
                        <Camera className="h-[11px] w-[11px]" strokeWidth={2} aria-hidden="true" />
                        Factura leída
                      </span>
                    )}
                    {e.status === 'draft' && (
                      <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning">
                        Por confirmar
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-n-600">{entryMeta(e)}</div>
                </div>
                <span
                  className={cn(
                    'shrink-0 font-mono text-[15px] font-semibold tabular-nums',
                    e.kind === 'ingreso'
                      ? 'text-[#2A5E1F] dark:text-area-pyme'
                      : 'text-danger',
                  )}
                >
                  {e.kind === 'ingreso' ? '+' : '−'}
                  {formatPesosInteger(e.amount)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Balance */}
      {totals && entries.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-3.5 rounded-xl border border-area-pyme/30 bg-area-pyme/10 px-5 py-4">
          <Wallet className="h-[22px] w-[22px] shrink-0 text-[#2A5E1F] dark:text-area-pyme" strokeWidth={1.75} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-[#2A5E1F] dark:text-area-pyme">
              Le quedó {cop(totals.margen)}
            </div>
            <div className="mt-0.5 text-sm text-n-700">
              {summary?.previous
                ? totals.margen >= summary.previous.margen
                  ? 'Le fue mejor que el mes pasado.'
                  : 'Le fue más duro que el mes pasado — revisemos los gastos.'
                : 'Este es su primer mes con datos.'}
            </div>
          </div>
          {book && (
            <a
              href={`/api/pyme/books/${book.id}/export.xlsx`}
              download
              className="inline-flex h-10 items-center gap-2 rounded-md border border-gold-500/40 px-4 text-sm font-medium text-gold-600 transition-colors hover:bg-gold-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
            >
              <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              Bajar a Excel
            </a>
          )}
        </div>
      )}
    </PymeSubpageShell>
  );
}
