'use client';

/**
 * /workspace/contabilidad/periodos — Gestión de Períodos Contables
 *
 * Página self-contained con:
 *  - Back link a /workspace/contabilidad
 *  - Banner del período actual (Junio 2026 · Abierto)
 *  - Tabla de períodos: Ene–Jun 2026 con estados Cerrado/Abierto
 *  - Callout de advertencia: conciliación bancaria requerida para cierre
 */

import Link from 'next/link';
import { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Tipos ──────────────────────────────────────────────────────────────────

type PeriodStatus = 'closed' | 'open' | 'future';

interface Period {
  id: string;
  label: string;       // "Ene 2026"
  status: PeriodStatus;
  closedAt: string | null; // "2 feb 2026" | null
}

// ─── Datos estáticos (mock) ─────────────────────────────────────────────────

const PERIODS: Period[] = [
  { id: 'ene-2026', label: 'Ene 2026', status: 'closed', closedAt: '2 feb 2026' },
  { id: 'feb-2026', label: 'Feb 2026', status: 'closed', closedAt: '3 mar 2026' },
  { id: 'mar-2026', label: 'Mar 2026', status: 'closed', closedAt: '2 abr 2026' },
  { id: 'abr-2026', label: 'Abr 2026', status: 'closed', closedAt: '5 may 2026' },
  { id: 'may-2026', label: 'May 2026', status: 'closed', closedAt: '2 jun 2026' },
  { id: 'jun-2026', label: 'Jun 2026', status: 'open',   closedAt: null },
];

// ─── Status helpers ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PeriodStatus }) {
  if (status === 'closed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        Cerrado
      </span>
    );
  }
  if (status === 'open') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
        <Circle className="h-3 w-3 fill-current" aria-hidden="true" />
        Abierto
      </span>
    );
  }
  // future
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-n-100 px-2.5 py-0.5 text-xs font-medium text-n-500">
      <Circle className="h-3 w-3" aria-hidden="true" />
      Futuro
    </span>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────────

export default function PeriodosPage() {
  const [periods, setPeriods] = useState<Period[]>(PERIODS);
  const [closingId, setClosingId] = useState<string | null>(null);

  function handleClose(id: string) {
    setClosingId(id);
    // Optimistic update — en producción haría POST /api/accounting/periods/close
    setTimeout(() => {
      setPeriods((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, status: 'closed' as PeriodStatus, closedAt: 'Hoy' }
            : p,
        ),
      );
      setClosingId(null);
    }, 900);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 md:py-10">

      {/* Back link */}
      <Link
        href="/workspace/contabilidad"
        className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-n-700 hover:text-n-1000 mb-8 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A] rounded"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Contabilidad
      </Link>

      {/* Heading */}
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="h-5 w-5 text-[#B8934A]" aria-hidden="true" />
          <span className="text-xs font-mono uppercase tracking-widest text-[#B8934A] font-semibold">
            Contabilidad
          </span>
        </div>
        <h1 className="text-3xl font-bold text-n-1000 tracking-tight">
          Períodos Contables
        </h1>
        <p className="mt-1.5 text-sm text-n-700 max-w-2xl">
          Abra y cierre los períodos del año. Un período cerrado no admite
          nuevos asientos.
        </p>
      </header>

      {/* Current period banner */}
      <div
        className={cn(
          'flex items-center gap-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 mb-8',
        )}
        role="status"
        aria-label="Período actual"
      >
        <span
          className="h-3 w-3 rounded-full bg-emerald-500 shrink-0 ring-4 ring-emerald-500/20"
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-semibold text-n-1000">
            Período actual: Junio 2026
          </p>
          <p className="text-xs text-n-600 mt-0.5">
            Abierto desde 01 jun 2026
          </p>
        </div>
      </div>

      {/* Periods table */}
      <div className="rounded-xl border border-n-200 bg-n-0 overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-n-200 bg-n-50">
                <Th>Período</Th>
                <Th>Estado</Th>
                <Th>Fecha cierre</Th>
                <Th align="right">Acción</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-n-100">
              {periods.map((period) => (
                <tr
                  key={period.id}
                  className="hover:bg-[#B8934A]/4 transition-colors"
                >
                  <Td>
                    <span className="font-mono font-semibold text-n-1000 tabular-nums">
                      {period.label}
                    </span>
                  </Td>
                  <Td>
                    <StatusBadge status={period.status} />
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-n-600 tabular-nums">
                      {period.closedAt ?? '—'}
                    </span>
                  </Td>
                  <Td align="right">
                    {period.status === 'closed' && (
                      <button
                        type="button"
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md border border-n-200 bg-n-0',
                          'px-3 py-1 text-xs font-medium text-n-700 hover:bg-n-100 hover:text-n-1000',
                          'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]',
                        )}
                      >
                        Ver
                      </button>
                    )}
                    {period.status === 'open' && (
                      <button
                        type="button"
                        disabled={closingId === period.id}
                        onClick={() => handleClose(period.id)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md border border-amber-500/40',
                          'bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700',
                          'dark:text-amber-400 hover:bg-amber-500/20 transition-colors',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
                          'disabled:opacity-60 disabled:cursor-not-allowed',
                        )}
                        aria-label={`Cerrar período ${period.label}`}
                      >
                        {closingId === period.id ? 'Cerrando…' : 'Cerrar período'}
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Warning callout */}
      <div
        role="note"
        className={cn(
          'flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5',
          'px-5 py-4',
        )}
      >
        <AlertTriangle
          className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <p className="text-sm text-n-800">
          <span className="font-semibold text-amber-700 dark:text-amber-400">
            Atención:{' '}
          </span>
          El cierre de período requiere conciliación bancaria completa.
        </p>
      </div>
    </div>
  );
}

// ─── Table helpers ───────────────────────────────────────────────────────────

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-3 text-xs font-mono uppercase tracking-widest text-n-600 font-semibold',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <td
      className={cn(
        'px-4 py-3',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </td>
  );
}
