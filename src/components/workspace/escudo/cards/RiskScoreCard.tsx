'use client';

/**
 * RiskScoreCard — Módulo 3: Score de Riesgo DIAN (0-100).
 *
 * SVG semicircle gauge + interpretación textual + top 3 factores.
 * Si score > 60: banner "Modo Supervivencia activable".
 */

import { ShieldAlert, Zap } from 'lucide-react';
import Link from 'next/link';
import { NormaCitation } from '@/components/workspace/cards/SurvivalCard';
import { cn } from '@/lib/utils';
import type { RiskScoreModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';

type RiskNivel = NonNullable<RiskScoreModuleResult['data']['nivel']>;
import type { FiscalRiskScoreT } from '../types';

// ---------------------------------------------------------------------------
// SVG semicircle gauge — 180° arc, r=40, stroke-dasharray
// ---------------------------------------------------------------------------

function RiskScoreGauge({
  score,
  nivel,
  language,
}: {
  score: number;
  nivel: RiskNivel;
  language: 'es' | 'en';
}) {
  // Arc: 180° semicircle. Circumference of half-circle (radius 40) = π*40 ≈ 125.66
  const R = 40;
  const CIRC = Math.PI * R;
  const clampedScore = Math.max(0, Math.min(100, score));
  const filled = (clampedScore / 100) * CIRC;
  const gap = CIRC - filled;

  const COLOR: Record<RiskNivel, string> = {
    bajo: 'var(--color-success, #22c55e)',
    medio: 'var(--color-warning, #eab308)',
    alto: '#f97316',
    muy_alto: '#ef4444',
    critico: '#dc2626',
  };

  const LABEL: Record<RiskNivel, { es: string; en: string }> = {
    bajo: { es: 'BAJO', en: 'LOW' },
    medio: { es: 'MEDIO', en: 'MEDIUM' },
    alto: { es: 'ALTO', en: 'HIGH' },
    muy_alto: { es: 'MUY ALTO', en: 'VERY HIGH' },
    critico: { es: 'CRÍTICO', en: 'CRITICAL' },
  };

  const color = COLOR[nivel];
  const label = LABEL[nivel][language];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-[120px] h-[64px] overflow-hidden">
        <svg
          viewBox="-5 -5 110 60"
          width="120"
          height="64"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={score}
          aria-valuetext={`${score} — ${label}`}
          aria-label={language === 'es' ? `Score riesgo DIAN: ${score} de 100` : `DIAN risk score: ${score} out of 100`}
        >
          {/* Track */}
          <path
            d="M 0 50 A 40 40 0 0 1 80 50"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            className="text-n-200/50"
          />
          {/* Filled arc */}
          <path
            d="M 0 50 A 40 40 0 0 1 80 50"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${gap}`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
          {/* Score label */}
          <text
            x="40"
            y="44"
            textAnchor="middle"
            dominantBaseline="auto"
            fontSize="18"
            fontWeight="700"
            fill={color}
            className="tabular-nums"
            style={{ fontFamily: 'var(--font-geist-sans, sans-serif)' }}
          >
            {score}
          </text>
        </svg>
      </div>
      <span
        className="text-xs font-bold uppercase tracking-wider"
        style={{ color }}
      >
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shimmer
// ---------------------------------------------------------------------------

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded animate-pulse bg-n-300/30', className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RiskScoreCardProps {
  data?: RiskScoreModuleResult;
  loading?: boolean;
  error?: string;
  t: FiscalRiskScoreT;
  language?: 'es' | 'en';
}

const NIVEL_RING: Record<RiskNivel, string> = {
  bajo: 'ring-[rgb(34_197_94_/_0.25)]',
  medio: 'ring-[rgb(234_179_8_/_0.28)]',
  alto: 'ring-[rgb(249_115_22_/_0.35)]',
  muy_alto: 'ring-[rgb(239_68_68_/_0.4)]',
  critico: 'ring-[rgb(220_38_38_/_0.5)]',
};

export function RiskScoreCard({ data, loading, error, t, language = 'es' }: RiskScoreCardProps) {
  const nivel = data?.data.nivel ?? 'bajo';
  const showSurvivalBanner = (data?.data.score ?? 0) > 60;

  return (
    <article
      className={cn(
        'relative flex flex-col gap-5 p-6 rounded-xl h-full',
        'glass-elite-elevated ring-1',
        NIVEL_RING[nivel],
      )}
      aria-labelledby="risk-score-title"
      aria-busy={loading}
    >
      {/* Ambient glow */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -left-12 w-[180px] h-[180px] rounded-full blur-[64px] opacity-20"
        style={{ background: 'radial-gradient(circle, rgb(168 56 56 / 0.6) 0%, transparent 70%)' }}
      />

      {/* Header */}
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span
            aria-hidden="true"
            className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[rgb(168_56_56_/_0.18)] text-area-escudo"
          >
            {loading ? <Shimmer className="h-5 w-5 rounded" /> : <ShieldAlert className="h-5 w-5" strokeWidth={1.75} />}
          </span>
          <h3 id="risk-score-title" className="font-serif-elite text-lg leading-tight font-medium tracking-tight text-n-1000 truncate">
            {t.title}
          </h3>
        </div>
      </div>

      {/* Body */}
      {error ? (
        <div className="flex items-start gap-2 rounded-md p-3 bg-[rgb(239_68_68_/_0.10)] ring-1 ring-[rgb(239_68_68_/_0.25)]" role="alert">
          <p className="text-sm text-danger leading-relaxed">{error}</p>
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center gap-4" aria-busy="true">
          <Shimmer className="w-[120px] h-[64px] rounded-full" />
          <Shimmer className="h-4 w-2/3" />
          <Shimmer className="h-4 w-full" />
          <Shimmer className="h-4 w-5/6" />
        </div>
      ) : data ? (
        <div className="flex flex-col gap-4">
          {/* Gauge */}
          <div className="flex justify-center">
            <RiskScoreGauge score={data.data.score} nivel={data.data.nivel} language={language} />
          </div>

          {/* Interpretación */}
          <p className="text-sm leading-relaxed text-n-700">
            {data.data.interpretacion}
          </p>

          {/* Top 3 factores */}
          {data.data.factores.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-eyebrow text-n-500 font-medium mb-2">
                {t.topFactores}
              </p>
              <ul role="list" className="flex flex-col gap-2">
                {data.data.factores.slice(0, 3).map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span
                      aria-hidden="true"
                      className="shrink-0 mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[rgb(168_56_56_/_0.2)] text-area-escudo text-[10px] font-bold"
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-n-800">{f.descripcion}</span>
                      <span className="ml-1.5 text-area-escudo font-semibold tabular-nums">
                        +{f.puntos}pts
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Survival mode banner */}
          {showSurvivalBanner && (
            <div
              className={cn(
                'rounded-md p-3 text-xs leading-relaxed',
                'bg-[rgb(239_68_68_/_0.10)] ring-1 ring-[rgb(239_68_68_/_0.35)]',
                'flex items-start gap-2',
              )}
              role="status"
              aria-live="polite"
            >
              <Zap className="h-3.5 w-3.5 text-danger shrink-0 mt-0.5" strokeWidth={2} aria-hidden="true" />
              <span className="text-n-700">
                {t.survivalBanner}{' '}
                <Link
                  href="/workspace/escudo/supervivencia"
                  className="font-semibold text-danger hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger"
                >
                  {t.survivalCta}
                </Link>
              </span>
            </div>
          )}
        </div>
      ) : null}

      {/* Footer */}
      {!loading && !error && (
        <div className="mt-auto pt-2 border-t border-n-200/40">
          <NormaCitation norma="Art. 240 E.T." />
        </div>
      )}
    </article>
  );
}
