'use client';

/**
 * FuturoArea — Ventana IV: El Futuro (Proyección Económica y Factibilidad).
 *
 * Dashboard reutilizable para "/workspace/futuro". Encapsula:
 *  - Narrativa Instrument Serif (The Future = calculated, not predicted)
 *  - KPI Hero — ROI Probabilístico con breakdown por proyecto (horizontal bars)
 *  - Macro snapshot widget (9 variables CO 2026 con delta)
 *  - Mini-widget de proyectos en evaluación (score)
 *  - Grid de submódulos: Factibilidad / Macro / Escenarios
 *
 * Stateless except for accepting optional overrides via props. If the caller
 * omits `kpi`, `macroSnapshot` o `activeProjects`, rendereamos mocks realistas.
 *
 * NO depende de que el layout padre aplique `[data-theme='elite']` — las
 * utilidades `.glass-elite*` son globales. Aun así, se renderiza envuelta
 * en `data-theme="elite"` por consistencia.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Compass,
  Telescope,
  TrendingUp,
  TrendingDown,
  Minus as MinusIcon,
  LineChart as LineChartIcon,
  BarChart3,
  Sparkles,
  Mountain,
  Route,
  Lightbulb,
  Layers,
  Target,
  ArrowRight,
  Globe,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import { EliteCard } from '@/components/ui/EliteCard';
import { PremiumKpiCard } from '@/components/ui/PremiumKpiCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
  calculateRoiProbabilistic,
  mockRoiProbabilistic,
} from '@/lib/kpis';
import type { KpiResult } from '@/types/kpis';

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export type MacroDirection = 'up' | 'down' | 'flat';

export interface MacroIndicator {
  key: string;
  /** Localized label (ES) — English variant resolved via `labelEn` if provided. */
  label: string;
  labelEn?: string;
  /** Pre-formatted value ("4.20%", "$4.120", "9.50%"). */
  value: string;
  /** Signed delta (percentage or bp vs previous). */
  delta: number;
  direction: MacroDirection;
  /** Ej. "vs mes previo", "vs mes previo bp". */
  deltaLabel?: string;
  deltaLabelEn?: string;
  /** Sparkline history (normalized 0-1 OR raw — we normalize internally). */
  history?: number[];
  /** Informative source, e.g. "BanRep", "DANE". */
  source?: string;
  /** Whether to treat "up" as positive (true = green) or negative (false = red).
   * Ej. IPC sube => malo ("down" bueno). Default true. */
  upIsPositive?: boolean;
}

export interface FuturoProject {
  /** Project label. */
  name: string;
  nameEn?: string;
  /** Score 0-100 — viability + risk-adjusted. */
  score: number;
  /** Inversión estimada en COP. */
  investment: number;
  /** Retorno esperado 0-1. */
  expectedReturn?: number;
  /** Status tag. "evaluating" | "green" | "hold". */
  status?: 'evaluating' | 'green' | 'hold';
}

export interface FuturoAreaProps {
  kpi?: KpiResult;
  macroSnapshot?: MacroIndicator[];
  activeProjects?: FuturoProject[];
  /** Si true, renderiza una versión compacta (sin hero ni narrativa larga). */
  compact?: boolean;
  className?: string;
}

// ─── Mocks realistas CO 2026 ─────────────────────────────────────────────────

const MOCK_MACRO_SNAPSHOT_ES: MacroIndicator[] = [
  {
    key: 'ipc',
    label: 'IPC (inflación YoY)',
    labelEn: 'CPI (YoY inflation)',
    value: '4.20%',
    delta: -0.12,
    direction: 'down',
    deltaLabel: 'vs mes previo',
    deltaLabelEn: 'vs prev. month',
    history: [6.4, 5.9, 5.5, 5.1, 4.8, 4.5, 4.3, 4.2],
    source: 'DANE',
    upIsPositive: false, // IPC alto = malo
  },
  {
    key: 'trm',
    label: 'TRM (COP/USD)',
    labelEn: 'USD/COP FX',
    value: '$4.120',
    delta: 0.58,
    direction: 'up',
    deltaLabel: 'vs mes previo',
    deltaLabelEn: 'vs prev. month',
    history: [4015, 4040, 4068, 4082, 4075, 4090, 4105, 4120],
    source: 'BanRep',
    upIsPositive: false, // TRM alta = devaluación
  },
  {
    key: 'repo',
    label: 'Tasa BR (repo)',
    labelEn: 'BanRep Rate (repo)',
    value: '9.50%',
    delta: -0.25,
    direction: 'down',
    deltaLabel: 'vs mes previo',
    deltaLabelEn: 'vs prev. month',
    history: [12.75, 12.25, 11.5, 11.0, 10.5, 10.25, 9.75, 9.5],
    source: 'BanRep',
    upIsPositive: false, // Repo alta = crédito caro
  },
  {
    key: 'pib',
    label: 'PIB YoY',
    labelEn: 'GDP YoY',
    value: '2.80%',
    delta: 0.3,
    direction: 'up',
    deltaLabel: 'vs trimestre previo',
    deltaLabelEn: 'vs prev. quarter',
    history: [1.2, 1.5, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8],
    source: 'DANE',
    upIsPositive: true,
  },
  {
    key: 'dtf',
    label: 'DTF 90 días',
    labelEn: 'DTF 90d',
    value: '10.32%',
    delta: -0.15,
    direction: 'down',
    deltaLabel: 'vs mes previo',
    deltaLabelEn: 'vs prev. month',
    history: [12.5, 12.1, 11.7, 11.3, 10.9, 10.7, 10.5, 10.32],
    source: 'BanRep',
    upIsPositive: false,
  },
  {
    key: 'tes10y',
    label: 'TES 10Y',
    labelEn: '10Y Bond',
    value: '10.90%',
    delta: 0.08,
    direction: 'up',
    deltaLabel: 'vs mes previo',
    deltaLabelEn: 'vs prev. month',
    history: [10.2, 10.3, 10.5, 10.7, 10.8, 10.85, 10.82, 10.9],
    source: 'BanRep',
    upIsPositive: false,
  },
  {
    key: 'embi',
    label: 'EMBI Colombia',
    labelEn: 'EMBI Colombia',
    value: '290 bps',
    delta: -12,
    direction: 'down',
    deltaLabel: 'vs mes previo (bp)',
    deltaLabelEn: 'vs prev. month (bp)',
    history: [340, 335, 325, 318, 310, 305, 298, 290],
    source: 'JP Morgan',
    upIsPositive: false,
  },
  {
    key: 'desempleo',
    label: 'Tasa de desempleo',
    labelEn: 'Unemployment rate',
    value: '10.10%',
    delta: -0.2,
    direction: 'down',
    deltaLabel: 'vs mes previo',
    deltaLabelEn: 'vs prev. month',
    history: [11.2, 11.0, 10.8, 10.6, 10.5, 10.4, 10.3, 10.1],
    source: 'DANE',
    upIsPositive: false,
  },
  {
    key: 'ied',
    label: 'IED (USD MM, trimestre)',
    labelEn: 'FDI (USD MM, quarter)',
    value: '$3,400',
    delta: 8.4,
    direction: 'up',
    deltaLabel: 'vs trimestre previo',
    deltaLabelEn: 'vs prev. quarter',
    history: [2800, 2900, 3000, 3050, 3100, 3200, 3300, 3400],
    source: 'BanRep',
    upIsPositive: true,
  },
];

const MOCK_PROJECTS: FuturoProject[] = [
  {
    name: 'Expansión bodega Cali',
    nameEn: 'Cali warehouse expansion',
    score: 82,
    investment: 1_200_000_000,
    expectedReturn: 0.24,
    status: 'green',
  },
  {
    name: 'Nueva línea de producto premium',
    nameEn: 'Premium product line launch',
    score: 74,
    investment: 600_000_000,
    expectedReturn: 0.31,
    status: 'evaluating',
  },
  {
    name: 'Implementación ERP + BI',
    nameEn: 'ERP + BI implementation',
    score: 68,
    investment: 420_000_000,
    expectedReturn: 0.18,
    status: 'evaluating',
  },
  {
    name: 'Adquisición competidor Medellín',
    nameEn: 'Medellín competitor acquisition',
    score: 55,
    investment: 2_800_000_000,
    expectedReturn: 0.22,
    status: 'hold',
  },
];

/**
 * Mock inline ROI — calcula con la misma función canonical; si el consumidor
 * no pasa kpi, usamos el mock compartido desde `@/lib/kpis`.
 */
function buildMockRoi(): KpiResult {
  return (
    mockRoiProbabilistic ??
    calculateRoiProbabilistic({
      projects: [
        {
          name: 'Expansión bodega Cali',
          expectedReturn: 0.24,
          probability: 0.78,
          investment: 1_200_000_000,
          riskScore: 22,
        },
        {
          name: 'Nueva línea premium',
          expectedReturn: 0.31,
          probability: 0.68,
          investment: 600_000_000,
          riskScore: 34,
        },
        {
          name: 'ERP + BI',
          expectedReturn: 0.18,
          probability: 0.82,
          investment: 420_000_000,
          riskScore: 18,
        },
      ],
      marketRisk: 0.24,
      discountRate: 0.135,
    })
  );
}

// ─── Submódulos ───────────────────────────────────────────────────────────────

type SubmoduleKey = 'factibilidad' | 'macroeconomia' | 'escenarios';

interface SubmoduleDef {
  key: SubmoduleKey;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  status: 'listo' | 'pronto';
}

const SUBMODULES: SubmoduleDef[] = [
  {
    key: 'factibilidad',
    href: '/workspace/futuro/factibilidad',
    icon: Lightbulb,
    status: 'listo',
  },
  {
    key: 'macroeconomia',
    href: '/workspace/futuro/macroeconomia',
    icon: Globe,
    status: 'listo',
  },
  {
    key: 'escenarios',
    href: '/workspace/futuro/escenarios',
    icon: Layers,
    status: 'listo',
  },
];

// ─── Helpers visuales ────────────────────────────────────────────────────────

function formatCopShort(n: number): string {
  if (!Number.isFinite(n)) return '$0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${Math.round(abs).toLocaleString('es-CO')}`;
}

/** Sparkline SVG inline — normaliza el array de history a [0..1] y pinta una polyline + relleno sutil. */
function Sparkline({
  points,
  color = 'var(--gold-500)',
  width = 72,
  height = 22,
}: {
  points: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(max - min, 1e-9);
  const step = width / (points.length - 1);
  const norm = points.map((p, i) => {
    const x = i * step;
    const y = height - ((p - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const pathPoints = norm.join(' ');
  const area = `M 0,${height} L ${pathPoints.replace(/ /g, ' L ')} L ${width},${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      aria-hidden="true"
    >
      <path d={area} fill={color} opacity={0.14} />
      <polyline
        points={pathPoints}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Resuelve color semántico para delta (verde/rojo/gris) según upIsPositive. */
function deltaColor(direction: MacroDirection, upIsPositive: boolean): string {
  if (direction === 'flat') return 'text-n-500';
  const isPositive =
    (direction === 'up' && upIsPositive) ||
    (direction === 'down' && !upIsPositive);
  return isPositive ? 'text-success' : 'text-danger';
}

const DIR_ICON: Record<MacroDirection, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: MinusIcon,
};

// ─── Component principal ──────────────────────────────────────────────────────

export function FuturoArea({
  kpi,
  macroSnapshot,
  activeProjects,
  compact = false,
  className,
}: FuturoAreaProps) {
  const { t, language } = useLanguage();
  const futuro = t.elite.areas.futuro;
  const reduced = useReducedMotion();
  const isEs = language === 'es';

  const kpiData = useMemo<KpiResult>(() => kpi ?? buildMockRoi(), [kpi]);
  const macro = useMemo<MacroIndicator[]>(
    () => macroSnapshot ?? MOCK_MACRO_SNAPSHOT_ES,
    [macroSnapshot],
  );
  const projects = useMemo<FuturoProject[]>(
    () => activeProjects ?? MOCK_PROJECTS,
    [activeProjects],
  );

  // Top 3 breakdown (contribuciones) — lo tomamos del breakdown del KPI.
  const topContribs = useMemo(() => {
    const entries =
      kpiData.breakdown?.filter((b) => b.label.startsWith('Top ')) ?? [];
    // Extrae el nombre del proyecto (todo lo que sigue al ": ")
    return entries.slice(0, 3).map((b) => {
      const name = b.label.replace(/^Top \d+:\s*/, '');
      const contribPct = typeof b.value === 'number' ? b.value : 0;
      return { name, contribPct, formatted: b.formatted ?? `${contribPct.toFixed(2)}%` };
    });
  }, [kpiData.breakdown]);

  const scenariosEvaluated = useMemo(() => {
    // Mock: 2.400 escenarios Monte Carlo por proyecto (4 proyectos)
    return 2400 * (projects.length || 1);
  }, [projects.length]);

  const fadeItem = (index: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay: 0.06 + index * 0.07,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        };

  return (
    <div
      className={cn('relative w-full', compact ? '' : 'min-h-full', className)}
    >
      {!compact && (
        <>
          {/* Hero */}
          <motion.div {...fadeItem(0)} className="mb-10">
            <SectionHeader
              eyebrow={isEs ? 'IV. Futuro' : 'IV. Future'}
              title={futuro.concept}
              subtitle={futuro.subtitle}
              align="left"
              accent="gold"
              divider
            />
          </motion.div>

          {/* Narrative */}
          <motion.p
            {...fadeItem(1)}
            className={cn(
              'font-serif-elite font-medium tracking-tight',
              'text-xl md:text-2xl leading-relaxed',
              'text-n-800 max-w-3xl mb-12',
            )}
          >
            {futuro.narrative}
          </motion.p>
        </>
      )}

      {/* KPI Hero — ROI Probabilístico + breakdown + scenarios side card */}
      <motion.div
        {...fadeItem(2)}
        className={cn(
          'grid gap-5',
          'grid-cols-1 md:grid-cols-5',
          compact ? 'mb-8' : 'mb-10',
        )}
      >
        {/* KPI principal */}
        <div className="md:col-span-3 flex">
          <PremiumKpiCard
            label={futuro.kpiPrimary}
            value={kpiData.formatted}
            subvalue={
              isEs
                ? `Riesgo mercado CO 2026: ${
                    kpiData.breakdown?.find((b) => b.label === 'Riesgo de mercado CO')
                      ?.formatted ?? '24%'
                  }`
                : `CO 2026 market risk: ${
                    kpiData.breakdown?.find((b) => b.label === 'Riesgo de mercado CO')
                      ?.formatted ?? '24%'
                  }`
            }
            trend={
              kpiData.trend
                ? {
                    direction: kpiData.trend.direction,
                    delta: kpiData.trend.delta,
                    label:
                      kpiData.trend.periodLabel ??
                      (isEs ? 'vs trimestre previo' : 'vs previous quarter'),
                  }
                : undefined
            }
            severity={kpiData.severity}
            accent="gold"
            icon={Compass}
            glow
            className="w-full"
          />
        </div>

        {/* Scenarios evaluated + Top contribs */}
        <ScenariosCard
          title={futuro.kpiSecondary}
          scenarios={scenariosEvaluated}
          topContribs={topContribs}
          isEs={isEs}
        />
      </motion.div>

      {/* Proyectos en evaluación */}
      <motion.div {...fadeItem(3)} className={compact ? 'mb-6' : 'mb-10'}>
        <ProjectsWidget projects={projects} isEs={isEs} />
      </motion.div>

      {/* Macro snapshot */}
      <motion.div {...fadeItem(4)} className={compact ? 'mb-6' : 'mb-12'}>
        <MacroSnapshot macro={macro} isEs={isEs} />
      </motion.div>

      {/* Grid submódulos (3) */}
      <motion.div
        {...fadeItem(5)}
        className="grid gap-5 grid-cols-1 md:grid-cols-3"
      >
        {SUBMODULES.map((sub, i) => (
          <SubmoduleCard
            key={sub.key}
            submodule={sub}
            title={futuro.submodules[sub.key].title}
            description={futuro.submodules[sub.key].description}
            ctaLabel={isEs ? 'Entrar' : 'Enter'}
            readyLabel={isEs ? 'Listo' : 'Ready'}
            upcomingLabel={isEs ? 'Próximamente IA' : 'Coming soon'}
            delay={i}
            reduced={reduced}
          />
        ))}
      </motion.div>
    </div>
  );
}

// ─── Scenarios evaluated card ─────────────────────────────────────────────────

interface ScenariosCardProps {
  title: string;
  scenarios: number;
  topContribs: Array<{ name: string; contribPct: number; formatted: string }>;
  isEs: boolean;
}

function ScenariosCard({ title, scenarios, topContribs, isEs }: ScenariosCardProps) {
  const maxPct = Math.max(...topContribs.map((t) => t.contribPct), 0.0001);

  return (
    <div className="md:col-span-2 relative flex flex-col gap-4 p-6 rounded-xl glass-elite-elevated border-elite-gold glow-gold-soft">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-xl"
        style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--color-gold-500-rgb) / 0.32)' }}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full shrink-0 bg-gold-500"
          />
          <span className="uppercase tracking-eyebrow text-xs font-medium text-n-500 truncate">
            {title}
          </span>
        </div>
        <div
          aria-hidden="true"
          className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600"
        >
          <Telescope className="h-4 w-4" strokeWidth={1.75} />
        </div>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-mono font-semibold text-n-1000 leading-tight text-3xl md:text-4xl num">
          {scenarios.toLocaleString('es-CO')}
        </span>
        <span className="text-sm text-n-500">
          {isEs ? 'escenarios simulados' : 'scenarios simulated'}
        </span>
      </div>

      {topContribs.length > 0 && (
        <div className="flex flex-col gap-2.5 mt-1">
          <div className="uppercase tracking-label text-xs font-medium text-n-500">
            {isEs ? 'Top proyectos' : 'Top projects'}
          </div>
          <ul role="list" className="flex flex-col gap-2">
            {topContribs.map((c) => {
              const pctFill = Math.max(6, (c.contribPct / maxPct) * 100);
              return (
                <li key={c.name} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-n-800 truncate">{c.name}</span>
                    <span className="text-gold-600 font-medium tabular-nums shrink-0">
                      {c.formatted}
                    </span>
                  </div>
                  <div
                    aria-hidden="true"
                    className="h-1.5 w-full rounded-full bg-[rgb(var(--color-gold-500-rgb)_/_0.12)] overflow-hidden"
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pctFill}%`,
                        background:
                          'linear-gradient(90deg, var(--gold-500) 0%, var(--gold-400) 100%)',
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Projects widget (mini) ───────────────────────────────────────────────────

interface ProjectsWidgetProps {
  projects: FuturoProject[];
  isEs: boolean;
}

function ProjectsWidget({ projects, isEs }: ProjectsWidgetProps) {
  return (
    <div className="relative p-6 md:p-7 rounded-xl glass-elite-elevated border-elite-gold">
      <div className="flex items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600"
          >
            <Target className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div>
            <div className="uppercase tracking-eyebrow text-xs font-medium text-gold-500">
              {isEs ? 'Proyectos en evaluación' : 'Projects under evaluation'}
            </div>
            <div className="font-serif-elite text-xl leading-tight tracking-tight text-n-1000 mt-0.5">
              {isEs
                ? `${projects.length} oportunidades activas`
                : `${projects.length} active opportunities`}
            </div>
          </div>
        </div>
      </div>

      <ul role="list" className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {projects.map((p) => {
          const displayName = !isEs && p.nameEn ? p.nameEn : p.name;
          const status = p.status ?? 'evaluating';
          const statusColor =
            status === 'green'
              ? 'bg-success'
              : status === 'hold'
                ? 'bg-area-escudo'
                : 'bg-gold-600';
          const statusLabel =
            status === 'green'
              ? isEs
                ? 'Viable'
                : 'Green-lit'
              : status === 'hold'
                ? isEs
                  ? 'En espera'
                  : 'On hold'
                : isEs
                  ? 'Evaluando'
                  : 'Evaluating';

          return (
            <li
              key={p.name}
              className="relative p-4 rounded-lg bg-[rgba(10,10,10,0.45)] border border-[rgb(var(--color-gold-500-rgb)_/_0.18)]"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    aria-hidden="true"
                    className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', statusColor)}
                  />
                  <span className="text-sm font-medium text-n-1000 truncate">
                    {displayName}
                  </span>
                </div>
                <span className="shrink-0 text-xs uppercase tracking-label text-n-500">
                  {statusLabel}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-n-500">
                  {isEs ? 'Inv.' : 'Inv.'}{' '}
                  <span className="text-n-800 tabular-nums">
                    {formatCopShort(p.investment)} COP
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-n-500">
                    {isEs ? 'Score' : 'Score'}
                  </span>
                  <span
                    className={cn(
                      'tabular-nums font-medium',
                      p.score >= 75
                        ? 'text-success'
                        : p.score >= 60
                          ? 'text-gold-600'
                          : 'text-danger',
                    )}
                  >
                    {p.score}/100
                  </span>
                </div>
              </div>

              <div
                aria-hidden="true"
                className="mt-2 h-1 w-full rounded-full bg-[rgb(var(--color-gold-500-rgb)_/_0.1)] overflow-hidden"
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(4, p.score))}%`,
                    background:
                      p.score >= 75
                        ? 'linear-gradient(90deg, var(--success) 0%, var(--color-success-light) 100%)'
                        : p.score >= 60
                          ? 'linear-gradient(90deg, var(--gold-500) 0%, var(--gold-400) 100%)'
                          : 'linear-gradient(90deg, var(--color-wine-700) 0%, var(--color-wine-400) 100%)',
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Macro snapshot widget ────────────────────────────────────────────────────

interface MacroSnapshotProps {
  macro: MacroIndicator[];
  isEs: boolean;
}

function MacroSnapshot({ macro, isEs }: MacroSnapshotProps) {
  return (
    <div className="relative p-6 md:p-7 rounded-xl glass-elite-elevated border-elite-gold">
      <div className="flex items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md bg-[rgba(114,47,55,0.16)] text-area-escudo"
          >
            <Globe className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div>
            <div className="uppercase tracking-eyebrow text-xs font-medium text-gold-500">
              {isEs ? 'Macro snapshot — Colombia 2026' : 'Macro snapshot — Colombia 2026'}
            </div>
            <div className="font-serif-elite text-xl leading-tight tracking-tight text-n-1000 mt-0.5">
              {isEs
                ? 'Indicadores que mueven su portafolio'
                : 'Indicators that move your portfolio'}
            </div>
          </div>
        </div>
        <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-n-500">
          <Sparkles className="h-3 w-3 text-gold-600" strokeWidth={2} aria-hidden="true" />
          {isEs ? 'Datos mock — 2026-04' : 'Mock data — 2026-04'}
        </span>
      </div>

      <ul
        role="list"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3"
      >
        {macro.map((m) => {
          const DirIcon = DIR_ICON[m.direction];
          const upPos = m.upIsPositive ?? true;
          const colorCls = deltaColor(m.direction, upPos);
          const deltaStr =
            typeof m.delta === 'number'
              ? `${m.delta > 0 ? '+' : ''}${
                  Math.abs(m.delta) < 1 ? m.delta.toFixed(2) : m.delta.toFixed(1)
                }`
              : String(m.delta);
          const label = !isEs && m.labelEn ? m.labelEn : m.label;
          const deltaLabel = !isEs && m.deltaLabelEn ? m.deltaLabelEn : m.deltaLabel;

          return (
            <li
              key={m.key}
              className="relative p-4 rounded-lg bg-[rgba(10,10,10,0.45)] border border-[rgb(var(--color-gold-500-rgb)_/_0.14)]"
            >
              <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
                <span className="uppercase tracking-label text-xs font-medium text-n-500 truncate">
                  {label}
                </span>
                {m.source && (
                  <span className="shrink-0 text-xs uppercase tracking-label text-n-600">
                    {m.source}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono font-semibold text-xl leading-tight text-n-1000 num">
                    {m.value}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 text-xs font-medium tabular-nums',
                      colorCls,
                    )}
                  >
                    <DirIcon className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
                    <span>{deltaStr}</span>
                    {deltaLabel && (
                      <span className="text-n-600 font-normal">{deltaLabel}</span>
                    )}
                  </span>
                </div>
                {m.history && m.history.length >= 2 && (
                  <Sparkline
                    points={m.history}
                    color={
                      m.direction === 'flat'
                        ? 'var(--n-500)'
                        : (m.direction === 'up' && upPos) ||
                            (m.direction === 'down' && !upPos)
                          ? 'var(--color-success-light)'
                          : 'var(--color-danger-light)'
                    }
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Submódulo card (grid entry) ──────────────────────────────────────────────

interface SubmoduleCardProps {
  submodule: SubmoduleDef;
  title: string;
  description: string;
  ctaLabel: string;
  readyLabel: string;
  upcomingLabel: string;
  delay: number;
  reduced: boolean | null;
}

function SubmoduleCard({
  submodule,
  title,
  description,
  ctaLabel,
  readyLabel,
  upcomingLabel,
  delay,
  reduced,
}: SubmoduleCardProps) {
  const { icon: Icon, href, status } = submodule;
  const isReady = status === 'listo';

  const motionProps = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        transition: {
          duration: 0.45,
          delay: 0.35 + delay * 0.08,
          ease: [0.16, 1, 0.3, 1] as const,
        },
      };

  return (
    <motion.div {...motionProps} className="h-full">
      <Link
        href={href}
        prefetch={false}
        className="block h-full group focus-visible:outline-none"
        aria-label={`${title}. ${description}`}
      >
        <EliteCard
          variant="glass"
          hover="lift"
          interactive
          padding="md"
          className="h-full min-h-[180px] flex flex-col gap-4 focus-within:ring-2 focus-within:ring-gold-500 focus-within:ring-offset-2 focus-within:ring-offset-n-1000"
        >
          <div className="flex items-start justify-between gap-4">
            <div
              aria-hidden="true"
              className="shrink-0 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600 group-hover:bg-[rgb(var(--color-gold-500-rgb)_/_0.24)] group-hover:text-gold-400 transition-colors"
            >
              <Icon className="h-6 w-6" strokeWidth={1.75} />
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium uppercase tracking-wider',
                isReady
                  ? 'bg-[rgba(34,197,94,0.12)] text-success border border-[rgba(34,197,94,0.3)]'
                  : 'bg-[rgb(var(--color-gold-500-rgb)_/_0.12)] text-gold-600 border border-[rgb(var(--color-gold-500-rgb)_/_0.3)]',
              )}
            >
              {isReady ? (
                <>
                  <span
                    aria-hidden="true"
                    className="inline-block h-1 w-1 rounded-full bg-success"
                  />
                  {readyLabel}
                </>
              ) : (
                <>
                  <Sparkles className="h-2.5 w-2.5" strokeWidth={2} aria-hidden="true" />
                  {upcomingLabel}
                </>
              )}
            </span>
          </div>

          <div className="flex-1 flex flex-col gap-1.5">
            <h3 className="font-serif-elite text-xl leading-tight font-medium tracking-tight text-n-1000">
              {title}
            </h3>
            <p className="text-base leading-relaxed text-n-500 max-w-md">
              {description}
            </p>
          </div>

          <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gold-500 group-hover:text-gold-600 transition-colors">
            <span>{ctaLabel}</span>
            <ArrowRight
              className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
              strokeWidth={2}
              aria-hidden="true"
            />
          </div>
        </EliteCard>
      </Link>
    </motion.div>
  );
}

export default FuturoArea;

// Keep unused imports referenced so lint doesn't flag them
void Route;
void Mountain;
void LineChartIcon;
void BarChart3;
