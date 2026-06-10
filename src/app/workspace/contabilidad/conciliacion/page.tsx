'use client';

/**
 * /workspace/contabilidad/conciliacion — Conciliación Bancaria.
 *
 * Página completa (Client Component) que muestra:
 *  1. Stats row — Saldo libro, Saldo banco, Diferencia
 *  2. Tabla de dos columnas — Movimientos en libro vs Extracto bancario
 *  3. Tarjeta de resumen — Partidas en conciliación ($280.000)
 */

import Link from 'next/link';
import { ArrowLeft, ArrowLeftRight, CheckCircle2, Clock, AlertCircle, WandSparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

function fmt(n: number): string {
  return COP.format(n);
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const SALDO_LIBRO   = 12_400_000;
const SALDO_BANCO   = 12_680_000;
const DIFERENCIA    = SALDO_BANCO - SALDO_LIBRO; // 280_000

type ItemStatus = 'conciliado' | 'pendiente' | 'falta';

interface ReconRow {
  fecha:    string;
  concepto: string;
  monto:    number;
  status:   ItemStatus;
}

const LIBRO_ROWS: ReconRow[] = [
  { fecha: '02/06', concepto: 'Cheque 0451 pendiente de cobro',     monto: -120_000,  status: 'pendiente'  },
  { fecha: '04/06', concepto: 'Transferencia saliente registrada',   monto: -350_000,  status: 'conciliado' },
  { fecha: '05/06', concepto: 'Débito automático servicios',         monto:  -85_000,  status: 'conciliado' },
  { fecha: '07/06', concepto: 'Comisión bancaria no registrada',     monto:  -35_000,  status: 'falta'      },
];

const BANCO_ROWS: ReconRow[] = [
  { fecha: '02/06', concepto: 'Cheque 0451 — sin cobrar',            monto: -120_000,  status: 'pendiente'  },
  { fecha: '04/06', concepto: 'Transferencia saliente procesada',    monto: -350_000,  status: 'conciliado' },
  { fecha: '05/06', concepto: 'Débito automático servicios',         monto:  -85_000,  status: 'conciliado' },
  { fecha: '07/06', concepto: 'Comisión bancaria cargada',           monto:  -35_000,  status: 'falta'      },
];

const PARTIDAS: Array<{ concepto: string; monto: number; nota: string }> = [
  {
    concepto: 'Cheque 0451 pendiente de cobro',
    monto:    -120_000,
    nota:     'Emitido el 02/06 — se concilia cuando el banco lo procese.',
  },
  {
    concepto: 'Comisión bancaria no registrada en libros',
    monto:    -35_000,
    nota:     'Registrar en debe cuenta 5305 / haber 111005.',
  },
  {
    concepto: 'Diferencia de redondeo acumulada',
    monto:   -125_000,
    nota:    'Revisar asientos de notas de contabilidad del mes.',
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const STATUS_CFG: Record<ItemStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  conciliado: { label: 'Conciliado',        color: 'text-emerald-500',  icon: CheckCircle2 },
  pendiente:  { label: 'Pdte. en banco',    color: 'text-amber-500',    icon: Clock        },
  falta:      { label: 'Falta en libros',   color: 'text-red-500',      icon: AlertCircle  },
};

function StatusBadge({ status }: { status: ItemStatus }) {
  const cfg = STATUS_CFG[status];
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', cfg.color)}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {cfg.label}
    </span>
  );
}

function ReconTable({ rows, title }: { rows: ReconRow[]; title: string }) {
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-n-200 bg-n-0 overflow-hidden">
      <div className="border-b border-n-200 px-5 py-3">
        <p className="text-xs font-mono uppercase tracking-widest text-n-600 font-semibold">
          {title}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-n-100">
            <th className="px-5 py-2.5 text-left text-xs text-n-500 font-semibold uppercase tracking-wider w-16">
              Fecha
            </th>
            <th className="px-5 py-2.5 text-left text-xs text-n-500 font-semibold uppercase tracking-wider">
              Concepto
            </th>
            <th className="px-5 py-2.5 text-right text-xs text-n-500 font-semibold uppercase tracking-wider w-32">
              Monto
            </th>
            <th className="px-5 py-2.5 text-left text-xs text-n-500 font-semibold uppercase tracking-wider w-36 hidden sm:table-cell">
              Estado
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-n-100">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-n-50 transition-colors">
              <td className="px-5 py-3 font-mono text-xs text-n-600 whitespace-nowrap">
                {row.fecha}
              </td>
              <td className="px-5 py-3 text-n-800">
                {row.concepto}
              </td>
              <td className="px-5 py-3 text-right font-mono text-sm text-n-900 whitespace-nowrap">
                <span className={row.monto < 0 ? 'text-red-600' : 'text-emerald-600'}>
                  {row.monto < 0 ? '−' : '+'}{fmt(Math.abs(row.monto))}
                </span>
              </td>
              <td className="px-5 py-3 hidden sm:table-cell">
                <StatusBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ConciliacionPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 md:py-10">

      {/* ── Back link ─────────────────────────────────────────────────────── */}
      <Link
        href="/workspace/contabilidad"
        className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-n-700 hover:text-n-1000 mb-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A] rounded transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Contabilidad
      </Link>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 mb-1">
          <ArrowLeftRight className="h-5 w-5 text-[#B8934A]" aria-hidden="true" />
          <p className="font-mono text-xs uppercase tracking-widest text-[#B8934A] font-semibold">
            Conciliación Bancaria
          </p>
        </div>
        <h1 className="mt-1 text-3xl font-bold text-n-1000 tracking-tight">
          Conciliación bancaria
        </h1>
        <p className="mt-1.5 text-sm text-n-700 max-w-2xl">
          Cruzamos su extracto bancario con los movimientos del libro para detectar
          diferencias. La conciliación debe estar en cero para cerrar el período.
        </p>
      </header>

      {/* ── Stats row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {/* Saldo libro */}
        <div className="rounded-xl border border-n-200 bg-n-0 px-6 py-5">
          <p className="text-xs font-mono uppercase tracking-widest text-n-500 font-semibold mb-2">
            Saldo libro
          </p>
          <p className="text-2xl font-bold text-n-1000 tabular-nums">
            {fmt(SALDO_LIBRO)}
          </p>
          <p className="mt-1 text-xs text-n-600">Según registros contables</p>
        </div>

        {/* Saldo banco */}
        <div className="rounded-xl border border-n-200 bg-n-0 px-6 py-5">
          <p className="text-xs font-mono uppercase tracking-widest text-n-500 font-semibold mb-2">
            Saldo banco
          </p>
          <p className="text-2xl font-bold text-n-1000 tabular-nums">
            {fmt(SALDO_BANCO)}
          </p>
          <p className="mt-1 text-xs text-n-600">Según extracto bancario</p>
        </div>

        {/* Diferencia */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-5">
          <p className="text-xs font-mono uppercase tracking-widest text-amber-600 font-semibold mb-2">
            Diferencia
          </p>
          <p className="text-2xl font-bold text-amber-700 tabular-nums">
            {fmt(DIFERENCIA)}
          </p>
          <p className="mt-1 text-xs text-amber-600 font-medium">
            Requiere 3 partidas de ajuste
          </p>
        </div>
      </div>

      {/* ── Two-column reconciliation table ───────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-n-1000 mb-4">
          Movimientos en conciliación
        </h2>
        <div className="flex flex-col lg:flex-row gap-4">
          <ReconTable rows={LIBRO_ROWS}  title="Movimientos en libro" />
          <ReconTable rows={BANCO_ROWS}  title="Extracto bancario"    />
        </div>
      </section>

      {/* ── Reconciliation summary card ────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-n-1000 mb-4">
          Partidas en conciliación
        </h2>
        <div className="rounded-xl border border-n-200 bg-n-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-n-100 bg-n-50">
            <div>
              <p className="text-sm font-semibold text-n-900">
                Diferencia total:{' '}
                <span className="font-mono text-amber-700">{fmt(DIFERENCIA)}</span>
              </p>
              <p className="text-xs text-n-600 mt-0.5">
                {PARTIDAS.length} partidas pendientes de ajuste
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
              <Clock className="h-3 w-3" aria-hidden="true" />
              En proceso
            </span>
          </div>

          {/* Rows */}
          <ul className="divide-y divide-n-100">
            {PARTIDAS.map((p, i) => (
              <li key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 px-6 py-4 hover:bg-n-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-n-900 truncate">{p.concepto}</p>
                  <p className="text-xs text-n-600 mt-0.5">{p.nota}</p>
                </div>
                <p className="font-mono text-sm font-semibold text-red-600 shrink-0">
                  −{fmt(Math.abs(p.monto))}
                </p>
              </li>
            ))}
          </ul>

          {/* Footer total */}
          <div className="flex items-center justify-between px-6 py-4 border-t-2 border-n-200 bg-n-50">
            <p className="text-sm font-bold text-n-900 font-mono uppercase tracking-wider">
              Total diferencia
            </p>
            <p className="font-mono text-lg font-bold text-amber-700">
              {fmt(DIFERENCIA)}
            </p>
          </div>
        </div>
      </section>

      {/* ── AI suggestion note ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#B8934A]/30 bg-[#B8934A]/5 px-6 py-5">
        <div className="flex items-start gap-3">
          <WandSparkles className="h-5 w-5 text-[#B8934A] mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-n-900 mb-1">Acción sugerida</p>
            <p className="text-sm text-n-700">
              Registre la comisión bancaria (
              <span className="font-mono text-n-900">$35.000</span>) en el debe de la
              cuenta{' '}
              <span className="font-mono text-n-900">5305</span> y en el haber de la{' '}
              <span className="font-mono text-n-900">111005</span> para cerrar esa
              partida. El cheque 0451 se concilia automáticamente cuando el banco lo
              cobre. Las demás partidas requieren revisión de los asientos de
              notas del mes.
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
