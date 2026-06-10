'use client';

/**
 * PlaneacionCard — Módulo 4: Planeación Tributaria.
 *
 * 3 columnas (conservador / base / agresivo) con tarjetas comparables.
 * Resalta la opción "recomendada". Impacto $, % ahorro, nivel riesgo, arts.
 */

import { TrendingDown, CheckCircle2 } from 'lucide-react';
import { NormaCitation } from '@/components/workspace/cards/SurvivalCard';
import { cn } from '@/lib/utils';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import type { PlaneacionModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';

type PlaneacionEscenario = NonNullable<PlaneacionModuleResult['data']['escenarios']['conservador']>;
import type { FiscalPlaneacionT } from '../types';

function fmtCop(cents: string): string {
  try {
    return formatCopFromCents(BigInt(cents));
  } catch {
    return cents;
  }
}

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded animate-pulse bg-n-300/30 dark:bg-n-700/30', className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Single scenario card
// ---------------------------------------------------------------------------

interface ScenarioCardProps {
  escenario: PlaneacionEscenario;
  isRecommended: boolean;
  language: 'es' | 'en';
}

const RIESGO_CONFIG: Record<
  PlaneacionEscenario['riesgo'],
  { label: { es: string; en: string }; bg: string; text: string; ring: string }
> = {
  baja: {
    label: { es: 'Bajo', en: 'Low' },
    bg: 'bg-[rgb(34_197_94_/_0.12)]',
    text: 'text-success',
    ring: 'ring-1 ring-[rgb(34_197_94_/_0.3)]',
  },
  media: {
    label: { es: 'Medio', en: 'Medium' },
    bg: 'bg-[rgb(234_179_8_/_0.14)]',
    text: 'text-warning',
    ring: 'ring-1 ring-[rgb(234_179_8_/_0.35)]',
  },
  alta: {
    label: { es: 'Alto', en: 'High' },
    bg: 'bg-[rgb(239_68_68_/_0.14)]',
    text: 'text-danger',
    ring: 'ring-1 ring-[rgb(239_68_68_/_0.4)]',
  },
};

const SCENARIO_LABEL: Record<PlaneacionEscenario['nombre'], { es: string; en: string }> = {
  conservador: { es: 'Conservador', en: 'Conservative' },
  base: { es: 'Base', en: 'Base' },
  agresivo: { es: 'Agresivo', en: 'Aggressive' },
};

function ScenarioCard({ escenario, isRecommended, language }: ScenarioCardProps) {
  const riesgo = RIESGO_CONFIG[escenario.riesgo];

  return (
    <div
      className={cn(
        'relative flex flex-col gap-3 p-4 rounded-lg',
        isRecommended
          ? 'ring-2 ring-gold-500 bg-[rgb(var(--color-gold-500-rgb)_/_0.06)]'
          : 'ring-1 ring-n-200/40 dark:ring-n-800/40 bg-n-50/30 dark:bg-n-900/20',
      )}
      aria-label={SCENARIO_LABEL[escenario.nombre][language]}
    >
      {/* Recommended badge */}
      {isRecommended && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gold-500 text-n-1000 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
          <CheckCircle2 className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden="true" />
          {language === 'es' ? 'Recomendado' : 'Recommended'}
        </span>
      )}

      {/* Scenario name */}
      <h4 className="font-serif-elite text-base font-medium text-n-1000">
        {SCENARIO_LABEL[escenario.nombre][language]}
      </h4>

      {/* Ahorro hero */}
      <div>
        <span className="block text-xs uppercase tracking-eyebrow text-n-500 mb-0.5">
          {language === 'es' ? 'Ahorro estimado' : 'Est. savings'}
        </span>
        <span className="font-serif-elite text-2xl font-bold num text-success">
          {fmtCop(escenario.ahorroEstimado)}
        </span>
        <span className="ml-1.5 text-xs text-success tabular-nums">
          ({escenario.ahorroPct.toFixed(1)}%)
        </span>
      </div>

      {/* Impuesto escenario */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-n-500">{language === 'es' ? 'Impuesto final' : 'Final tax'}</span>
        <span className="font-medium text-n-800 tabular-nums">{fmtCop(escenario.impuestoEscenario)}</span>
      </div>

      {/* Riesgo badge */}
      <span
        className={cn(
          'inline-flex self-start items-center gap-1 px-2 py-0.5 rounded text-xs font-medium uppercase tracking-label',
          riesgo.bg, riesgo.text, riesgo.ring,
        )}
      >
        {language === 'es' ? `Riesgo ${riesgo.label.es}` : `${riesgo.label.en} Risk`}
      </span>

      {/* Artículos */}
      {escenario.articulosAplicables.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {escenario.articulosAplicables.slice(0, 3).map((a: string, i: number) => (
            <NormaCitation key={i} norma={a} />
          ))}
        </div>
      )}

      {/* Justificación */}
      <p className="text-xs leading-relaxed text-n-700 dark:text-n-600 line-clamp-3">
        {escenario.justificacion}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PlaneacionCardProps {
  data?: PlaneacionModuleResult;
  loading?: boolean;
  error?: string;
  t: FiscalPlaneacionT;
  language?: 'es' | 'en';
}

export function PlaneacionCard({ data, loading, error, t, language = 'es' }: PlaneacionCardProps) {
  return (
    <article
      className={cn(
        'relative flex flex-col gap-5 p-6 rounded-xl h-full',
        'glass-elite-elevated ring-1 ring-[rgb(168_56_56_/_0.3)]',
      )}
      aria-labelledby="planeacion-title"
      aria-busy={loading}
    >
      {/* Ambient glow */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -left-12 w-[180px] h-[180px] rounded-full blur-[64px] opacity-20"
        style={{ background: 'radial-gradient(circle, rgb(168 56 56 / 0.6) 0%, transparent 70%)' }}
      />

      {/* Header */}
      <div className="relative flex items-start gap-3">
        <span
          aria-hidden="true"
          className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[rgb(168_56_56_/_0.18)] text-area-escudo"
        >
          {loading ? <Shimmer className="h-5 w-5 rounded" /> : <TrendingDown className="h-5 w-5" strokeWidth={1.75} />}
        </span>
        <div className="min-w-0">
          <h3 id="planeacion-title" className="font-serif-elite text-lg leading-tight font-medium tracking-tight text-n-1000">
            {t.title}
          </h3>
          <p className="text-xs text-n-500 mt-0.5">{t.subtitle}</p>
        </div>
      </div>

      {/* Body */}
      {error ? (
        <div className="rounded-md p-3 bg-[rgb(239_68_68_/_0.10)] ring-1 ring-[rgb(239_68_68_/_0.25)]" role="alert">
          <p className="text-sm text-danger leading-relaxed">{error}</p>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2 p-4 rounded-lg ring-1 ring-n-200/40">
              <Shimmer className="h-5 w-24" />
              <Shimmer className="h-8 w-32" />
              <Shimmer className="h-4 w-full" />
              <Shimmer className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      ) : data ? (
        <div className="flex flex-col gap-4">
          {/* 3-column scenarios */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            {(['conservador', 'base', 'agresivo'] as const).map((nombre) => (
              <ScenarioCard
                key={nombre}
                escenario={data.data.escenarios[nombre]}
                isRecommended={data.data.recomendacion === nombre}
                language={language}
              />
            ))}
          </div>

          {/* Reason for recommendation */}
          {data.data.razonRecomendacion && (
            <div className="rounded-md p-3 bg-[rgb(var(--color-gold-500-rgb)_/_0.08)] ring-1 ring-[rgb(var(--color-gold-500-rgb)_/_0.2)]">
              <p className="text-xs text-n-500 uppercase tracking-eyebrow font-medium mb-1">
                {t.razonRecomendacion}
              </p>
              <p className="text-sm leading-relaxed text-n-800">
                {data.data.razonRecomendacion}
              </p>
            </div>
          )}

          {/* Warnings */}
          {data.warnings.length > 0 && (
            <ul role="list" className="flex flex-col gap-1.5">
              {data.warnings.map((w, i) => (
                <li key={i} className="text-xs text-n-700 dark:text-n-600 flex items-start gap-1.5">
                  <span aria-hidden="true" className="shrink-0 mt-1 h-1 w-1 rounded-full bg-warning" />
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* Footer */}
      {!loading && !error && (
        <div className="mt-auto pt-2 border-t border-n-200/40 dark:border-n-800/40">
          <NormaCitation norma="Arts. 254-260 E.T." />
        </div>
      )}
    </article>
  );
}
