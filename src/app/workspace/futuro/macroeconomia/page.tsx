'use client';

import Link from 'next/link';
import { ArrowLeft, Globe, Landmark } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StatCard {
  label: string;
  value: string;
  accent?: boolean;
}

interface ProjectionRow {
  indicator: string;
  current: string;
  projection: string;
  trend: 'up' | 'down';
  trendLabel: string;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const STATS: StatCard[] = [
  { label: 'TRM', value: '$4.120' },
  { label: 'Inflación (IPC)', value: '5,2%', accent: true },
  { label: 'Tasa BanRep', value: '9,25%' },
  { label: 'PIB', value: '+1,8%' },
];

const PROJECTIONS: ProjectionRow[] = [
  {
    indicator: 'Inflación (IPC)',
    current: '5,2%',
    projection: '4,8%',
    trend: 'down',
    trendLabel: '↓ Baja',
  },
  {
    indicator: 'Tasa de intervención',
    current: '9,25%',
    projection: '8,75%',
    trend: 'down',
    trendLabel: '↓ Baja',
  },
  {
    indicator: 'TRM (COP/USD)',
    current: '$4.120',
    projection: '$4.340',
    trend: 'up',
    trendLabel: '↑ Sube',
  },
  {
    indicator: 'PIB',
    current: '+1,8%',
    projection: '+2,4%',
    trend: 'up',
    trendLabel: '↑ Sube',
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function MacroeconomiaPage() {
  return (
    <div className="relative w-full min-h-full overflow-y-auto" data-lenis-prevent>
      <div className="max-w-[900px] mx-auto px-5 md:px-8 pt-8 pb-24">

        {/* Back link */}
        <Link
          href="/workspace/futuro"
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-xs text-n-500 hover:text-n-800 transition-colors mb-8"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Volver a El Futuro
        </Link>

        {/* Page heading */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-md"
              style={{ background: 'rgba(90,127,122,0.15)' }}
            >
              <Globe className="h-4 w-4" style={{ color: '#5A7F7A' }} strokeWidth={1.8} />
            </span>
            <span className="text-xs font-medium text-n-600">El Futuro — Macroeconomía</span>
          </div>
          <h1 className="text-3xl font-semibold text-n-1000 mb-2">Macroeconomía</h1>
          <p className="text-sm text-n-700 max-w-xl">
            El contexto que mueve su negocio. Indicadores macro de Colombia y su proyección para el año.
          </p>
        </div>

        {/* ── Section: Indicadores ─────────────────────────────────────── */}
        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-n-600 mb-4">
            Indicadores
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-n-200 bg-n-50 dark:bg-n-950 dark:border-n-800 px-4 py-4"
              >
                <div className="text-xs text-n-600 mb-1">{s.label}</div>
                <div
                  className="text-xl font-semibold tabular-nums"
                  style={s.accent ? { color: '#5A7F7A' } : undefined}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Section: Proyección 2026 ──────────────────────────────────── */}
        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-n-600 mb-4">
            Proyección 2026
          </h2>
          <div className="rounded-xl border border-n-200 dark:border-n-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-n-100 dark:bg-n-900 border-b border-n-200 dark:border-n-800">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-n-700">Indicador</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-n-700">Actual</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-n-700">
                    Proyección dic&nbsp;2026
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-n-700">Tendencia</th>
                </tr>
              </thead>
              <tbody>
                {PROJECTIONS.map((row, i) => (
                  <tr
                    key={row.indicator}
                    className={
                      i < PROJECTIONS.length - 1
                        ? 'border-b border-n-200 dark:border-n-800'
                        : ''
                    }
                  >
                    <td className="px-4 py-3 font-medium text-n-1000">{row.indicator}</td>
                    <td className="px-4 py-3 text-right font-mono text-n-800">{row.current}</td>
                    <td className="px-4 py-3 text-right font-mono text-n-800">{row.projection}</td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className="text-xs font-semibold"
                        style={{
                          color:
                            row.indicator === 'TRM (COP/USD)'
                              ? '#D97706'
                              : row.trend === 'down'
                                ? '#16A34A'
                                : '#16A34A',
                        }}
                      >
                        {row.trendLabel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Callout ────────────────────────────────────────────────────── */}
        <div
          className="rounded-xl border p-5"
          style={{
            background: 'rgba(90,127,122,0.07)',
            borderColor: 'rgba(90,127,122,0.30)',
          }}
        >
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ background: 'rgba(90,127,122,0.15)' }}
            >
              <Landmark className="h-4 w-4" style={{ color: '#5A7F7A' }} strokeWidth={1.8} />
            </span>
            <p className="text-sm text-n-700 leading-relaxed">
              <span className="font-semibold text-n-1000">
                Fuente: Banco de la República, DANE — Actualizado 9 jun 2026.
              </span>{' '}
              Una refinanciación en este trimestre reduce el costo de deuda en ~84bps.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
