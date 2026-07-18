'use client';

import Link from 'next/link';
import { RotateCcw, ArrowLeft, FileCheck } from 'lucide-react';

const ACCENT = '#A83838';

const stats = [
  { label: 'Saldo total', value: '$1.240M', accent: true },
  { label: 'Radicadas', value: '1', accent: false },
  { label: 'En preparación', value: '2', accent: false },
];

type BadgeVariant = 'warning' | 'success' | 'default';

const rows: {
  concepto: string;
  periodo: string;
  monto: string;
  estado: string;
  badge: BadgeVariant;
}[] = [
  {
    concepto: 'Renta — saldo a favor',
    periodo: 'Dic 2025',
    monto: '$890.000.000',
    estado: 'En revisión',
    badge: 'warning',
  },
  {
    concepto: 'IVA — saldo a favor',
    periodo: 'Feb 2026',
    monto: '$245.000.000',
    estado: 'Radicada',
    badge: 'success',
  },
  {
    concepto: 'Retenciones en exceso',
    periodo: 'Mar 2026',
    monto: '$105.000.000',
    estado: 'En preparación',
    badge: 'default',
  },
];

const badgeStyles: Record<BadgeVariant, string> = {
  warning:
    'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30',
  success:
    'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30',
  default:
    'bg-n-200/60 text-n-600 border border-n-300/50',
};

export default function DevolucionesPage() {
  return (
    <div className="relative w-full min-h-full overflow-y-auto">
      <div className="relative z-[1] max-w-[1100px] mx-auto px-6 md:px-10 pt-6 pb-24">

        {/* Back link */}
        <div className="mb-6">
          <Link
            href="/workspace/escudo"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-n-500 hover:text-n-800 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            El Escudo
          </Link>
        </div>

        {/* Heading */}
        <div className="mb-8 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: `${ACCENT}22` }}
          >
            <RotateCcw className="h-5 w-5" strokeWidth={1.75} style={{ color: ACCENT }} />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-n-500 mb-0.5">
              El Escudo — Devoluciones
            </p>
            <h1 className="text-2xl md:text-3xl font-semibold text-n-1000 leading-tight">
              Devoluciones
            </h1>
          </div>
        </div>

        <p className="max-w-2xl text-sm leading-relaxed text-n-700 mb-10">
          Recupere su caja. Preparamos expedientes técnicos de saldos a favor en renta e IVA
          y acompañamos la radicación ante la DIAN.
        </p>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-n-200/60 bg-n-100/50 backdrop-blur-sm px-5 py-4"
            >
              <p className="text-xs font-medium text-n-500 mb-1">{s.label}</p>
              <p
                className="text-2xl font-bold"
                style={s.accent ? { color: ACCENT } : undefined}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>

        {/* Table section */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-n-600 mb-3">
            Solicitudes
          </h2>
          <div className="rounded-xl border border-n-200/60 bg-n-100/40 backdrop-blur-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-n-200/60">
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-n-500">
                      Concepto
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-n-500">
                      Período
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-n-500">
                      Monto
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-n-500">
                      Estado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={row.concepto}
                      className={
                        i < rows.length - 1 ? 'border-b border-n-200/40' : ''
                      }
                    >
                      <td className="px-4 py-3 font-medium text-n-1000">
                        {row.concepto}
                      </td>
                      <td className="px-4 py-3 text-n-700">{row.periodo}</td>
                      <td className="px-4 py-3 text-right font-mono text-n-1000">
                        {row.monto}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeStyles[row.badge]}`}
                        >
                          {row.estado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Callout note */}
        <div
          className="rounded-xl border px-5 py-4 flex gap-3 items-start"
          style={{
            background: `${ACCENT}0d`,
            borderColor: `${ACCENT}33`,
          }}
        >
          <FileCheck
            className="h-4 w-4 mt-0.5 shrink-0"
            strokeWidth={1.75}
            style={{ color: ACCENT }}
            aria-hidden="true"
          />
          <p className="text-sm leading-relaxed text-n-700">
            <span className="font-semibold text-n-1000">Requisito clave — </span>
            Integridad del expediente es determinante para el plazo de devolución
            (Art. 855 E.T.).
          </p>
        </div>

      </div>
    </div>
  );
}
