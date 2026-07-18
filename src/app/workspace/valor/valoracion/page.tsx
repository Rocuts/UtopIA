'use client';

import Link from 'next/link';
import { ChevronLeft, DollarSign, TrendingUp, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Area accent ──────────────────────────────────────────────────────────────
const ACCENT = '#B8934A';

// ─── Stats ────────────────────────────────────────────────────────────────────
const STATS = [
  { label: 'Valor de salida', value: '$4.820M', accent: true },
  { label: 'EV/EBITDA', value: '5,4×', accent: false },
  { label: 'WACC', value: '13,2%', accent: false },
  { label: 'g terminal', value: '3,0%', accent: false },
];

// ─── Pipeline steps ───────────────────────────────────────────────────────────
type StepStatus = 'done' | 'active' | 'pending';

const STEPS: Array<{ label: string; description: string; status: StepStatus }> = [
  {
    label: 'Normalización de EBITDA',
    description: 'Ajuste de partidas no recurrentes.',
    status: 'done',
  },
  {
    label: 'Proyección a 5 años',
    description: 'Ingresos, costos y capex bajo escenario base.',
    status: 'done',
  },
  {
    label: 'Descuento de flujos (DCF)',
    description: 'Tasa WACC 13,2% y valor terminal Gordon.',
    status: 'done',
  },
  {
    label: 'Contraste por múltiplos',
    description: 'Comparables de transacciones del sector.',
    status: 'active',
  },
  {
    label: 'Reporte para inversionistas',
    description: 'Narrativa y rango de valoración.',
    status: 'pending',
  },
];

// ─── Value drivers ────────────────────────────────────────────────────────────
const DRIVERS = [
  { name: 'Crecimiento ingresos', delta: '+$640M', positive: true, confidence: 88 },
  { name: 'Margen EBITDA', delta: '+$410M', positive: true, confidence: 72 },
  { name: 'Múltiplo de salida', delta: '+$300M', positive: true, confidence: 58 },
  { name: 'WACC', delta: '−$210M', positive: false, confidence: 40 },
];

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ValoracionPage() {
  return (
    <div className="relative w-full min-h-full overflow-y-auto">
      {/* Ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[15%] -right-[10%] w-[520px] h-[520px] rounded-full blur-[130px] opacity-25"
          style={{
            background: `radial-gradient(circle, ${ACCENT}55 0%, transparent 70%)`,
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[960px] mx-auto px-6 md:px-10 pt-8 pb-24 space-y-10">

        {/* Back link */}
        <nav aria-label="breadcrumb">
          <Link
            href="/workspace/valor"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-n-500 hover:text-n-1000 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Volver a El Valor
          </Link>
        </nav>

        {/* Heading */}
        <div>
          <div
            className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-widest mb-3"
            style={{ color: ACCENT }}
          >
            <DollarSign className="h-4 w-4" strokeWidth={2} />
            El Valor — Valoración DCF
          </div>
          <h1 className="font-serif-elite text-3xl md:text-4xl text-n-1000 leading-tight mb-3">
            Valoración
          </h1>
          <p className="text-n-700 text-base max-w-2xl leading-relaxed">
            ¿Cuánto vale su empresa hoy? Pipeline de valoración por flujo de caja descontado y múltiplos de mercado.
          </p>
        </div>

        {/* Stats row */}
        <section aria-label="Resultados de valoración">
          <div className="mb-3 text-xs font-medium uppercase tracking-widest text-n-500">
            Resultado
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {STATS.map((s) => (
              <div
                key={s.label}
                className={cn(
                  'rounded-xl p-5 border',
                  'bg-n-50/60 dark:bg-[rgba(10,10,10,0.55)]',
                  s.accent
                    ? 'border-[rgba(184,147,74,0.45)]'
                    : 'border-n-200/60 dark:border-[rgba(255,255,255,0.06)]',
                )}
              >
                <p className="text-xs text-n-500 mb-2 leading-none">{s.label}</p>
                <p
                  className="font-serif-elite text-2xl tabular-nums leading-none"
                  style={s.accent ? { color: ACCENT } : undefined}
                >
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Pipeline */}
        <section aria-label="Pipeline de valoración">
          <div
            className={cn(
              'rounded-xl border p-6 md:p-8',
              'bg-n-50/60 dark:bg-[rgba(10,10,10,0.55)]',
              'border-n-200/60 dark:border-[rgba(255,255,255,0.06)]',
            )}
          >
            <div className="mb-5 text-xs font-medium uppercase tracking-widest text-n-500">
              Pipeline de valoración
            </div>

            <ol className="relative space-y-0">
              {STEPS.map((step, i) => {
                const isLast = i === STEPS.length - 1;
                return (
                  <li key={step.label} className="relative flex gap-4">
                    {/* Connector line */}
                    {!isLast && (
                      <div
                        className="absolute left-[15px] top-[30px] bottom-0 w-px"
                        style={{
                          background:
                            step.status === 'done'
                              ? `${ACCENT}55`
                              : 'rgba(255,255,255,0.07)',
                        }}
                      />
                    )}

                    {/* Step indicator */}
                    <div className="shrink-0 flex items-start pt-1 z-[1]">
                      {step.status === 'done' ? (
                        <CheckCircle2
                          className="h-[30px] w-[30px]"
                          strokeWidth={1.75}
                          style={{ color: ACCENT }}
                        />
                      ) : step.status === 'active' ? (
                        <div
                          className="h-[30px] w-[30px] rounded-full border-2 flex items-center justify-center"
                          style={{ borderColor: ACCENT }}
                        >
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            strokeWidth={2}
                            style={{ color: ACCENT }}
                          />
                        </div>
                      ) : (
                        <Circle
                          className="h-[30px] w-[30px] text-n-400"
                          strokeWidth={1.5}
                        />
                      )}
                    </div>

                    {/* Step content */}
                    <div className={cn('pb-6', isLast && 'pb-0')}>
                      <p
                        className={cn(
                          'text-sm font-semibold leading-snug',
                          step.status === 'done' && 'text-n-1000',
                          step.status === 'active' && 'text-n-1000',
                          step.status === 'pending' && 'text-n-500',
                        )}
                      >
                        {step.label}
                      </p>
                      <p
                        className={cn(
                          'text-xs mt-0.5',
                          step.status === 'pending' ? 'text-n-400' : 'text-n-600',
                        )}
                      >
                        {step.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* Value drivers */}
        <section aria-label="Factores de valor">
          <div
            className={cn(
              'rounded-xl border p-6 md:p-8',
              'bg-n-50/60 dark:bg-[rgba(10,10,10,0.55)]',
              'border-n-200/60 dark:border-[rgba(255,255,255,0.06)]',
            )}
          >
            <div className="mb-5 text-xs font-medium uppercase tracking-widest text-n-500">
              Factores de valor
            </div>

            <div className="space-y-5">
              {DRIVERS.map((d) => (
                <div key={d.name}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-n-800">{d.name}</span>
                    <span
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: d.positive ? ACCENT : '#e05252' }}
                    >
                      {d.delta}
                    </span>
                  </div>
                  {/* Confidence bar */}
                  <div className="relative h-1.5 rounded-full bg-n-200/60 dark:bg-[rgba(255,255,255,0.07)] overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                      style={{
                        width: `${d.confidence}%`,
                        background: d.positive
                          ? `linear-gradient(90deg, ${ACCENT}99, ${ACCENT})`
                          : 'linear-gradient(90deg, #e0525299, #e05252)',
                      }}
                    />
                  </div>
                  <p className="text-xs text-n-500 mt-1">{d.confidence}% confianza</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer info */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-n-600">
          <span className="inline-flex items-center gap-1.5">
            <DollarSign className="h-3 w-3" strokeWidth={2} />
            Cifras en COP corrientes
          </span>
          <span className="inline-flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" strokeWidth={2} />
            Múltiplos actualizados CO 2026
          </span>
        </div>

      </div>
    </div>
  );
}
