'use client';

import Link from 'next/link';
import { BarChart3, ArrowLeft, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Stats row ────────────────────────────────────────────────────────────────

interface StatCard {
  label: string;
  value: string;
  accent?: boolean;
}

const STATS: StatCard[] = [
  { label: 'Margen EBITDA', value: '23,4%', accent: true },
  { label: 'Flujo de caja', value: '$680M' },
  { label: 'ROE', value: '18,2%' },
  { label: 'Razón corriente', value: '1,8×' },
];

// ─── Sector comparison table ──────────────────────────────────────────────────

type BrechaColor = 'green' | 'amber' | 'neutral';

interface TableRow {
  indicador: string;
  empresa: string;
  mediana: string;
  brecha: string;
  color: BrechaColor;
}

const TABLE_ROWS: TableRow[] = [
  {
    indicador: 'Margen bruto',
    empresa: '42,1%',
    mediana: '38,4%',
    brecha: '+3,7 pts',
    color: 'green',
  },
  {
    indicador: 'Margen EBITDA',
    empresa: '23,4%',
    mediana: '19,8%',
    brecha: '+3,6 pts',
    color: 'green',
  },
  {
    indicador: 'Rotación de cartera',
    empresa: '87 días',
    mediana: '62 días',
    brecha: '+25 d',
    color: 'amber',
  },
  {
    indicador: 'Endeudamiento',
    empresa: '34,2%',
    mediana: '41,7%',
    brecha: '−7,5 pts',
    color: 'green',
  },
];

function BrechaCell({ row }: { row: TableRow }) {
  const colors: Record<BrechaColor, string> = {
    green: 'text-emerald-400',
    amber: 'text-amber-400',
    neutral: 'text-n-600',
  };

  const Icon =
    row.color === 'green'
      ? TrendingUp
      : row.color === 'amber'
        ? TrendingDown
        : Minus;

  return (
    <span className={cn('inline-flex items-center gap-1 font-mono text-xs font-semibold', colors[row.color])}>
      <Icon className="h-3 w-3 shrink-0" strokeWidth={2.5} />
      {row.brecha}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InteligenciaFinancieraPage() {
  return (
    <div className="relative w-full min-h-full overflow-y-auto">
      {/* Ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[8%] -right-[8%] w-[480px] h-[480px] rounded-full blur-[130px] opacity-25"
          style={{
            background:
              'radial-gradient(circle, #B8934A44 0%, transparent 70%)',
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1100px] mx-auto px-6 md:px-10 pt-8 pb-24 space-y-10">

        {/* Back link */}
        <nav aria-label="breadcrumb">
          <Link
            href="/workspace/valor"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-n-500 hover:text-n-800 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Volver a El Valor
          </Link>
        </nav>

        {/* Subhead */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest font-medium text-n-500">
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded"
              style={{ color: '#B8934A' }}
            >
              <TrendingUp className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            El Valor — Inteligencia Financiera
          </div>
          <h1 className="font-serif-elite text-3xl sm:text-4xl font-normal text-n-1000 leading-tight flex items-center gap-3">
            <BarChart3
              className="h-7 w-7 shrink-0"
              strokeWidth={1.75}
              style={{ color: '#B8934A' }}
            />
            Inteligencia Financiera
          </h1>
          <p className="text-base text-n-700 max-w-2xl leading-relaxed">
            Convertimos su contabilidad en decisiones: rentabilidad, estructura de costos, flujo de caja y escenarios de crecimiento.
          </p>
        </div>

        {/* Stats row */}
        <section aria-label="Indicadores clave">
          <div className="mb-3">
            <span className="text-xs uppercase tracking-widest font-semibold text-n-600">
              Indicadores clave
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="rounded-xl border p-4 flex flex-col gap-1.5"
                style={{
                  background: 'rgba(10,10,10,0.55)',
                  borderColor: s.accent ? '#B8934A66' : 'rgb(255 255 255 / 0.07)',
                }}
              >
                <span className="text-2xs uppercase tracking-wider text-n-600 leading-none">
                  {s.label}
                </span>
                <span
                  className="font-mono text-2xl font-semibold leading-none tabular-nums"
                  style={{ color: s.accent ? '#B8934A' : 'var(--n-1000, #f5f5f5)' }}
                >
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Sector comparison table */}
        <section aria-label="Comparativo sectorial">
          <div className="mb-3">
            <span className="text-xs uppercase tracking-widest font-semibold text-n-600">
              Comparativo sectorial
            </span>
          </div>
          <div
            className="rounded-xl border overflow-hidden"
            style={{
              background: 'rgba(10,10,10,0.55)',
              borderColor: 'rgb(255 255 255 / 0.08)',
            }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-2xs uppercase tracking-wider text-n-600"
                    style={{ borderBottom: '1px solid rgb(255 255 255 / 0.07)' }}
                  >
                    <th className="px-4 py-3 font-semibold">Indicador</th>
                    <th className="px-4 py-3 font-semibold text-right">Su empresa</th>
                    <th className="px-4 py-3 font-semibold text-right">Mediana sector</th>
                    <th className="px-4 py-3 font-semibold text-right">Brecha</th>
                  </tr>
                </thead>
                <tbody>
                  {TABLE_ROWS.map((row, i) => (
                    <tr
                      key={row.indicador}
                      className="transition-colors hover:bg-white/[0.03]"
                      style={{
                        borderBottom:
                          i < TABLE_ROWS.length - 1
                            ? '1px solid rgb(255 255 255 / 0.05)'
                            : 'none',
                      }}
                    >
                      <td className="px-4 py-3 font-semibold text-n-800">
                        {row.indicador}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-n-1000 font-bold tabular-nums">
                        {row.empresa}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-n-700 tabular-nums">
                        {row.mediana}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <BrechaCell row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
