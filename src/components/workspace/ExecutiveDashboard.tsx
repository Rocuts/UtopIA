'use client';

import { useLanguage } from '@/context/LanguageContext';
import {
  mockTefExplicit,
  mockExitValue,
  mockCompliance,
  mockRoiProbabilistic,
} from '@/lib/kpis';
import type { KpiResult } from '@/lib/kpis';
import { AreaCard, type AreaKey, type AreaKpi } from './AreaCard';
import {
  Shield,
  TrendingUp,
  Scale,
  Compass,
  type LucideIcon,
} from 'lucide-react';

/**
 * ExecutiveDashboard — Home of `/workspace` when no case is active.
 *
 * Design intent (post-audit):
 *  - This is a COCKPIT, not a landing page. Above-the-fold = status.
 *  - Compact header row (eyebrow + h1 + status chip) replaces the full
 *    narrative hero. ExecutiveNarrative is no longer rendered here — the
 *    tagline lives as a subtitle, everything else is signal.
 *  - 4 AreaCards laid out in a 4-column grid on xl, 2-column on lg, stacked
 *    on sm. Every card is a live tile (KPI + sparkline + alerts count).
 *
 * Agent C contract:
 *  - No mutation of ChatWorkspace / PipelineWorkspace flows — `page.tsx`
 *    still owns the decision to render this dashboard vs. one of those.
 *  - KPI mocks remain projected through `toAreaKpi` until Agent I wires real data.
 */

// ─── KPI mocks (sourced from Agent D's engines) ─────────────────────────────

function toAreaKpi(result: KpiResult, label: string): AreaKpi {
  const base: AreaKpi = {
    value: result.value,
    formatted: result.formatted,
    label,
    severity: result.severity,
  };
  if (result.trend) {
    base.trend = {
      direction: result.trend.direction,
      delta: result.trend.delta,
    };
  }
  return base;
}

const KPI_SOURCES: Record<AreaKey, KpiResult> = {
  escudo: mockTefExplicit,
  valor: mockExitValue,
  verdad: mockCompliance,
  futuro: mockRoiProbabilistic,
};

const KPI_LABELS_ES: Record<AreaKey, string> = {
  escudo: 'Eficiencia Fiscal',
  valor: 'Valor de Salida',
  verdad: 'Salud Normativa',
  futuro: 'ROI Probabilístico',
};

const KPI_LABELS_EN: Record<AreaKey, string> = {
  escudo: 'Tax Efficiency',
  valor: 'Exit Value',
  verdad: 'Regulatory Health',
  futuro: 'Probabilistic ROI',
};

// Lightweight mock of live alerts per area — Agent I will replace with real
// data from the WorkspaceContext / audit engines. Keeping a stable shape here
// so the card doesn't go dark when alerts = 0.
const ALERTS: Record<AreaKey, number> = {
  escudo: 3,
  valor: 1,
  verdad: 0,
  futuro: 2,
};

// ─── Area configuration ─────────────────────────────────────────────────────

interface AreaDef {
  key: AreaKey;
  href: string;
  icon: LucideIcon;
  /** Roman-numeral eyebrow: "I. Resiliencia", etc. */
  eyebrowEs: string;
  eyebrowEn: string;
}

const AREAS: readonly AreaDef[] = [
  {
    key: 'escudo',
    href: '/workspace/escudo',
    icon: Shield,
    eyebrowEs: 'I. Resiliencia',
    eyebrowEn: 'I. Resilience',
  },
  {
    key: 'valor',
    href: '/workspace/valor',
    icon: TrendingUp,
    eyebrowEs: 'II. Valor',
    eyebrowEn: 'II. Value',
  },
  {
    key: 'verdad',
    href: '/workspace/verdad',
    icon: Scale,
    eyebrowEs: 'III. Integridad',
    eyebrowEn: 'III. Integrity',
  },
  {
    key: 'futuro',
    href: '/workspace/futuro',
    icon: Compass,
    eyebrowEs: 'IV. Futuro',
    eyebrowEn: 'IV. Future',
  },
] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export function ExecutiveDashboard() {
  const { t, language } = useLanguage();
  const elite = t.elite;
  const isEs = language === 'es';

  const ctaPrefix = isEs ? 'Entrar a' : 'Enter';
  const heroEyebrow = elite.tagline; // "Directorio Ejecutivo Digital"

  // Current UTC hour → a neutral "Live" label. Kept trivial; the status chip
  // is a glanceable "system ok" signal, not a replacement for audit output.
  const statusLabel = isEs ? 'Operativo' : 'Live';

  return (
    <div className="h-full w-full overflow-y-auto styled-scrollbar">
      <div
        className={[
          'max-w-7xl mx-auto',
          'px-6 md:px-10 lg:px-12',
          'pt-6 md:pt-8 lg:pt-10 pb-12',
          'flex flex-col gap-8 md:gap-10',
        ].join(' ')}
      >
        {/* ── Header row — eyebrow · h1 · status chip ───────────────── */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2 min-w-0">
            <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-500 font-medium">
              {heroEyebrow}
            </span>
            <h1 className="text-2xl md:text-3xl font-serif-elite font-normal leading-tight tracking-tight text-n-900">
              {isEs
                ? 'Centro de Comando'
                : 'Command Center'}
            </h1>
            <p className="text-sm text-n-600 font-light max-w-[60ch]">
              {isEs
                ? '4 pilares. Telemetría en vivo. Una sola verdad.'
                : '4 pillars. Live telemetry. One source of truth.'}
            </p>
          </div>

          <span
            className={[
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-full',
              'border border-success/30 bg-success/10',
              'font-mono text-xs-mono uppercase tracking-eyebrow text-success font-medium',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-success"
            />
            {statusLabel}
          </span>
        </header>

        {/* ── 4-area cockpit grid (4 col xl / 2 col lg / 1 col sm) ──── */}
        <section
          aria-label={isEs ? 'Pilares ejecutivos' : 'Executive pillars'}
          className={[
            'grid gap-4 lg:gap-5',
            'grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4',
          ].join(' ')}
        >
          {AREAS.map((area, idx) => {
            const areaDict = elite.areas[area.key];
            const label = isEs ? KPI_LABELS_ES[area.key] : KPI_LABELS_EN[area.key];
            const kpi: AreaKpi = toAreaKpi(KPI_SOURCES[area.key], label);

            const conceptLabel = areaDict.concept;
            const ctaLabel = `${ctaPrefix} ${conceptLabel}`;

            return (
              <AreaCard
                key={area.key}
                area={area.key}
                eyebrow={isEs ? area.eyebrowEs : area.eyebrowEn}
                concept={conceptLabel}
                subtitle={areaDict.subtitle}
                tagline={areaDict.tagline}
                kpi={kpi}
                ctaLabel={ctaLabel}
                href={area.href}
                icon={area.icon}
                alertsCount={ALERTS[area.key]}
                delay={0.05 + idx * 0.05}
              />
            );
          })}
        </section>
      </div>
    </div>
  );
}
