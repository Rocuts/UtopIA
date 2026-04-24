'use client';

import { useLanguage } from '@/context/LanguageContext';
import {
  mockTefExplicit,
  mockExitValue,
  mockCompliance,
  mockRoiProbabilistic,
} from '@/lib/kpis';
import type { KpiResult } from '@/lib/kpis';
import { AreaCard, type AreaKey, type AreaAccent, type AreaKpi, type AreaSubmodule } from './AreaCard';
import { ExecutiveNarrative } from './ExecutiveNarrative';
import {
  Shield,
  TrendingUp,
  Scale,
  Compass,
  FileText,
  Calculator,
  Globe,
  ArrowRightLeft,
  Banknote,
  FileSearch,
  BarChart3,
  ClipboardCheck,
  GitCompareArrows,
  BadgeCheck,
  Lightbulb,
  LineChart,
  Layers,
  type LucideIcon,
} from 'lucide-react';

/**
 * ExecutiveDashboard — Home of `/workspace` when no case is active.
 *
 * A 4-window premium dashboard: the narrative hero sets the "Directorio
 * Ejecutivo Digital" positioning, then 4 AreaCards (Escudo / Valor / Verdad
 * / Futuro) give a KPI-hero glance + direct entry into each pillar.
 *
 * This component is intentionally self-contained for Agent C's scope:
 *  - No mutation of ChatWorkspace / PipelineWorkspace flows — `page.tsx`
 *    still owns the decision to render this dashboard vs. one of those.
 *  - No kpi engines yet — mock data is inlined (see `MOCK_KPIS`). Agent D
 *    will expose `@/lib/kpis/mocks` so Agent I can swap the import.
 *  - No import of `@/types/kpis` — a local minimal type lives in AreaCard
 *    and Agent I aligns the final type at polish time.
 *
 * Vertical rhythm (from top):
 *  1. Hero (narrativeHero — big gradient serif + word-by-word stagger)
 *  2. Intro (narrativeIntro — essay paragraph, italic serif)
 *  3. 4-window grid (2×2 on lg+, 1 col on mobile)
 *  4. Perspective (narrativePerspective — closing framed block)
 */

// ─── KPI mocks (sourced from Agent D's engines) ─────────────────────────────
// The engines return a richer `KpiResult` shape; we project onto the minimal
// `AreaKpi` shape the card consumes. Spanish labels stay owned by the dashboard
// (per the note in `src/types/kpis.ts`: "UI may override with t.elite.*").

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
  escudo: 'Tasa de Eficiencia Fiscal',
  valor: 'Valor de Salida Estimado',
  verdad: 'Score de Salud Normativa',
  futuro: 'ROI Probabilístico',
};

const KPI_LABELS_EN: Record<AreaKey, string> = {
  escudo: 'Tax Efficiency Rate',
  valor: 'Estimated Exit Value',
  verdad: 'Regulatory Health Score',
  futuro: 'Probabilistic ROI',
};

// ─── Area configuration ─────────────────────────────────────────────────────

interface AreaDef {
  key: AreaKey;
  href: string;
  accent: AreaAccent;
  icon: LucideIcon;
  /** Roman-numeral eyebrow: "I. Resiliencia", "II. Valor", etc. */
  eyebrowEs: string;
  eyebrowEn: string;
  /** Dict path prefix under `t.elite.areas.<key>`. */
  /** Lucide icons for the 4 submodules rendered inside the card. */
  submoduleIcons: LucideIcon[];
  /**
   * Submodule titles live in the dictionary under
   * `t.elite.areas.<key>.submodules.*.title`; we index by sub-key.
   */
  submoduleKeys: ReadonlyArray<string>;
}

const AREAS: readonly AreaDef[] = [
  {
    key: 'escudo',
    href: '/workspace/escudo',
    accent: 'wine',
    icon: Shield,
    eyebrowEs: 'I. Resiliencia',
    eyebrowEn: 'I. Resilience',
    submoduleIcons: [FileText, Calculator, Globe, Banknote],
    submoduleKeys: ['defensaDian', 'planeacionTributaria', 'preciosTransferencia', 'devoluciones'],
  },
  {
    key: 'valor',
    href: '/workspace/valor',
    accent: 'gold',
    icon: TrendingUp,
    eyebrowEs: 'II. Valor',
    eyebrowEn: 'II. Value',
    submoduleIcons: [LineChart, FileSearch, BarChart3, ArrowRightLeft],
    submoduleKeys: ['valoracion', 'dueDiligence', 'inteligenciaFinanciera'],
  },
  {
    key: 'verdad',
    href: '/workspace/verdad',
    accent: 'gold',
    icon: Scale,
    eyebrowEs: 'III. Integridad',
    eyebrowEn: 'III. Integrity',
    submoduleIcons: [ClipboardCheck, GitCompareArrows, BadgeCheck],
    submoduleKeys: ['revisoriaFiscal', 'conciliacionFiscal', 'dictamenes'],
  },
  {
    key: 'futuro',
    href: '/workspace/futuro',
    accent: 'wine',
    icon: Compass,
    eyebrowEs: 'IV. Futuro',
    eyebrowEn: 'IV. Future',
    submoduleIcons: [Lightbulb, Layers, BarChart3],
    submoduleKeys: ['factibilidad', 'macroeconomia', 'escenarios'],
  },
] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export function ExecutiveDashboard() {
  const { t, language } = useLanguage();
  const elite = t.elite;
  const isEs = language === 'es';

  const ctaPrefix = isEs ? 'Entrar a' : 'Enter';
  const perspectiveEyebrow = isEs ? 'La Perspectiva 1+1' : 'The 1+1 Perspective';
  const heroEyebrow = elite.tagline; // "Directorio Ejecutivo Digital"

  return (
    <div className="h-full w-full overflow-y-auto styled-scrollbar">
      <div className="max-w-7xl mx-auto px-6 md:px-10 lg:px-16 pt-12 md:pt-16 lg:pt-20 pb-20 md:pb-28 flex flex-col gap-16 md:gap-20 lg:gap-24">
        <h1 className="sr-only">
          {isEs
            ? '1+1 — Directorio Ejecutivo Digital'
            : '1+1 — Digital Executive Board'}
        </h1>

        {/* ── 1. Hero narrativa ─────────────────────────────────────────── */}
        <ExecutiveNarrative
          variant="hero"
          eyebrow={heroEyebrow}
          heading={elite.narrativeHero}
          align="center"
        />

        {/* ── 2. Intro narrativa ────────────────────────────────────────── */}
        <ExecutiveNarrative
          variant="intro"
          body={elite.narrativeIntro}
          align="left"
          className="mx-auto"
          delay={0.1}
        />

        {/* ── 3. 4 áreas grid ──────────────────────────────────────────── */}
        <section
          aria-label={isEs ? 'Pilares ejecutivos' : 'Executive pillars'}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8"
        >
          {AREAS.map((area, idx) => {
            const areaDict = elite.areas[area.key];
            const submodulesRaw = areaDict.submodules as Record<
              string,
              { title: string; description?: string }
            >;

            const submodules: AreaSubmodule[] = [];
            area.submoduleKeys.forEach((subKey, subIdx) => {
              const entry = submodulesRaw[subKey];
              if (!entry) return;
              const Icon =
                area.submoduleIcons[subIdx] ??
                area.submoduleIcons[area.submoduleIcons.length - 1];
              const sub: AreaSubmodule = {
                title: entry.title,
                icon: Icon,
              };
              if (entry.description) {
                sub.description = entry.description;
              }
              submodules.push(sub);
            });

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
                submodules={submodules}
                ctaLabel={ctaLabel}
                href={area.href}
                accent={area.accent}
                icon={area.icon}
                delay={0.08 + idx * 0.08}
              />
            );
          })}
        </section>

        {/* ── 4. Perspective cierre ─────────────────────────────────────── */}
        <ExecutiveNarrative
          variant="perspective"
          eyebrow={perspectiveEyebrow}
          body={elite.narrativePerspective}
          align="center"
          delay={0.1}
        />
      </div>
    </div>
  );
}
