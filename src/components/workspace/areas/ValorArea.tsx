'use client';

/**
 * ValorArea — Ventana II: El Valor (Ingeniería Financiera y Valoración).
 *
 * Encapsula el dashboard principal de la Ventana II:
 *  - KPI Hero monumental "Valor de Salida Estimado" con breakdown expandible
 *  - Sparkline de valor a través del tiempo (SVG inline puro)
 *  - Sub-KPIs (EBITDA ajustado, WACC, D/E, FCF)
 *  - Grid 3 submódulos navegables (Valoración, Due Diligence, Inteligencia)
 *
 * Se consume desde `/workspace/valor/page.tsx`. Puede usarse como preview
 * compacto en el ExecutiveDashboard pasando `compact`.
 *
 * No depende de `[data-theme='elite']` del layout padre — las utilidades
 * `.glass-elite*` son globales, pero el wrapper lo setea por robustez.
 */

import Link from 'next/link';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  TrendingUp,
  LineChart,
  FileSearch,
  Activity,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Percent,
  Scale,
  Wallet,
  ArrowRight,
  Sparkles,
  Diamond,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import { EliteCard } from '@/components/ui/EliteCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { calculateExitValue, formatCop } from '@/lib/kpis/exit-value';
import { mockExitValue } from '@/lib/kpis/mocks';
import type { KpiResult } from '@/types/kpis';

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export interface TrendPoint {
  /** Etiqueta del punto (mes/fecha) */
  date: string;
  /** Valor en COP */
  value: number;
}

export interface ValorAreaProps {
  /** KPI calculado (Equity/Exit Value). Si se omite, usa `mockExitValue`. */
  kpi?: KpiResult;
  /** Serie histórica (hasta 12 puntos) para el sparkline. Si se omite, mock. */
  trend?: TrendPoint[];
  /** Versión compacta (sin hero ni narrativa). */
  compact?: boolean;
  className?: string;
}

// ─── Submódulos de El Valor ──────────────────────────────────────────────────

type SubmoduleKey = 'valoracion' | 'dueDiligence' | 'inteligenciaFinanciera';

interface SubmoduleDef {
  key: SubmoduleKey;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** "listo" = endpoint activo o flujo via chat. */
  status: 'listo' | 'pronto';
}

const SUBMODULES: SubmoduleDef[] = [
  {
    key: 'valoracion',
    href: '/workspace/valor/valoracion',
    icon: LineChart,
    status: 'listo',
  },
  {
    key: 'dueDiligence',
    href: '/workspace/valor/due-diligence',
    icon: FileSearch,
    status: 'listo',
  },
  {
    key: 'inteligenciaFinanciera',
    href: '/workspace/valor/inteligencia-financiera',
    icon: Activity,
    status: 'listo',
  },
];

// ─── Mock trend (serie de 12 meses, tendencia creciente) ─────────────────────

function buildMockTrend(finalValue: number): TrendPoint[] {
  // 12 puntos hacia atrás desde hoy (t0 = hace 11 meses → actual)
  // Genera serie crecimiento 22% aprox con leve ruido determinístico.
  const months = [
    'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct',
    'Nov', 'Dic', 'Ene', 'Feb', 'Mar', 'Abr',
  ];
  const startFactor = 0.78; // inicia 78% del valor actual → crecimiento 22%
  const noise = [0, 0.015, -0.02, 0.01, 0.025, -0.01, 0.02, 0.005, -0.015, 0.02, 0.01, 0];
  return months.map((m, i) => {
    const progress = i / (months.length - 1);
    const base = startFactor + (1 - startFactor) * progress;
    const factor = base + (noise[i] ?? 0);
    return {
      date: m,
      value: Math.round(finalValue * factor),
    };
  });
}

// ─── Sparkline SVG (puro, sin libs) ──────────────────────────────────────────

interface SparklineProps {
  points: TrendPoint[];
  language: 'es' | 'en';
  reduced: boolean | null;
}

function Sparkline({ points, language, reduced }: SparklineProps) {
  const w = 720;
  const h = 140;
  const padX = 8;
  const padY = 16;

  if (points.length === 0) return null;

  const values = points.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = maxV - minV || 1;

  const xStep = (w - padX * 2) / (points.length - 1);
  const toX = (i: number) => padX + i * xStep;
  const toY = (v: number) => padY + (h - padY * 2) * (1 - (v - minV) / span);

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(2)} ${toY(p.value).toFixed(2)}`)
    .join(' ');

  const areaPath =
    `M${toX(0).toFixed(2)} ${h - padY}` +
    ' L' +
    points.map((p, i) => `${toX(i).toFixed(2)} ${toY(p.value).toFixed(2)}`).join(' L') +
    ` L${toX(points.length - 1).toFixed(2)} ${h - padY} Z`;

  const first = points[0].value;
  const last = points[points.length - 1].value;
  const delta = last - first;
  const deltaPct = first === 0 ? 0 : (delta / first) * 100;

  return (
    <div className="relative">
      <div className="flex items-end justify-between mb-2">
        <div>
          <p className="uppercase tracking-label text-xs font-medium text-n-500">
            {language === 'es' ? 'Valor a través del tiempo' : 'Value over time'}
          </p>
          <p className="text-xs text-n-600 mt-0.5">
            {language === 'es' ? 'Últimos 12 meses' : 'Last 12 months'}
          </p>
        </div>
        <div className="text-right">
          <p
            className={cn(
              'text-sm font-medium tabular-nums',
              delta >= 0 ? 'text-success' : 'text-danger',
            )}
          >
            {delta >= 0 ? '+' : ''}
            {formatCop(delta)}
          </p>
          <p className="text-xs text-n-500">
            {deltaPct >= 0 ? '+' : ''}
            {deltaPct.toFixed(1)}%{' '}
            <span className="text-n-600">
              {language === 'es' ? 'desde t0' : 'since t0'}
            </span>
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="w-full h-[140px]"
        role="img"
        aria-label={
          language === 'es'
            ? `Gráfico del valor de salida estimado en los últimos 12 meses, variación ${deltaPct.toFixed(1)}%.`
            : `Estimated exit value chart for the last 12 months, variation ${deltaPct.toFixed(1)}%.`
        }
      >
        <defs>
          <linearGradient id="sparkline-gold-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold-500)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--gold-500)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sparkline-gold-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--gold-500)" />
            <stop offset="50%" stopColor="var(--gold-400)" />
            <stop offset="100%" stopColor="var(--gold-300)" />
          </linearGradient>
        </defs>

        {/* baseline grid (3 lines) */}
        {[0.25, 0.5, 0.75].map((r) => (
          <line
            key={r}
            x1={padX}
            x2={w - padX}
            y1={padY + (h - padY * 2) * r}
            y2={padY + (h - padY * 2) * r}
            stroke="rgb(var(--color-gold-500-rgb) / 0.08)"
            strokeWidth={1}
          />
        ))}

        {/* area */}
        <path d={areaPath} fill="url(#sparkline-gold-area)" />

        {/* line */}
        <motion.path
          d={linePath}
          fill="none"
          stroke="url(#sparkline-gold-line)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduced ? false : { pathLength: 0 }}
          animate={reduced ? {} : { pathLength: 1 }}
          transition={reduced ? undefined : { duration: 1.2, ease: 'easeOut' }}
        />

        {/* last point emphasized */}
        <circle
          cx={toX(points.length - 1)}
          cy={toY(last)}
          r={3.5}
          fill="var(--gold-400)"
        />
        <circle
          cx={toX(points.length - 1)}
          cy={toY(last)}
          r={7}
          fill="var(--gold-400)"
          opacity="0.18"
        />
      </svg>

      {/* X-axis labels */}
      <div className="flex justify-between text-xs text-n-600 mt-1 px-2">
        {points
          .filter((_, i) => i % 2 === 0 || i === points.length - 1)
          .map((p) => (
            <span key={p.date} className="tabular-nums">
              {p.date}
            </span>
          ))}
      </div>
    </div>
  );
}

// ─── Sub-KPI card (mini) ─────────────────────────────────────────────────────

interface MiniKpiProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  accent?: 'gold' | 'neutral';
  delta?: string;
  deltaDir?: 'up' | 'down' | 'flat';
}

function MiniKpi({ label, value, icon: Icon, accent = 'gold', delta, deltaDir }: MiniKpiProps) {
  const dotColor = accent === 'gold' ? 'var(--gold-500)' : 'var(--n-500)';
  const iconBg =
    accent === 'gold'
      ? 'bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600'
      : 'bg-[rgba(255,255,255,0.06)] text-n-500';
  const deltaColor =
    deltaDir === 'up'
      ? 'text-success'
      : deltaDir === 'down'
        ? 'text-danger'
        : 'text-n-500';

  return (
    <div className="relative flex flex-col gap-2.5 p-5 rounded-lg glass-elite border border-[rgb(var(--color-gold-500-rgb)_/_0.2)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
            style={{ backgroundColor: dotColor }}
          />
          <span className="uppercase tracking-label text-xs font-medium text-n-500 truncate">
            {label}
          </span>
        </div>
        <div
          aria-hidden="true"
          className={cn(
            'shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md',
            iconBg,
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </div>
      </div>

      <div className="font-mono font-semibold text-n-100 leading-tight text-2xl md:text-3xl num">
        {value}
      </div>

      {delta && (
        <p className={cn('text-xs font-medium tabular-nums', deltaColor)}>{delta}</p>
      )}
    </div>
  );
}

// ─── Expandable breakdown ────────────────────────────────────────────────────

interface ExitValueBreakdownProps {
  kpi: KpiResult;
  open: boolean;
  onToggle: () => void;
  language: 'es' | 'en';
}

function ExitValueBreakdown({ kpi, open, onToggle, language }: ExitValueBreakdownProps) {
  const label =
    language === 'es' ? 'Descomposición del valor' : 'Value breakdown';
  const closeLabel = language === 'es' ? 'Cerrar' : 'Close';
  const openLabel = language === 'es' ? 'Ver detalle' : 'Show detail';

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider',
          'text-gold-500 hover:text-gold-600 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-1000 rounded',
        )}
      >
        <span>{open ? closeLabel : openLabel}</span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="breakdown"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-4 p-4 rounded-md bg-[rgba(10,10,10,0.55)] border border-[rgb(var(--color-gold-500-rgb)_/_0.16)]">
              <p className="uppercase tracking-label text-xs font-medium text-n-500 mb-3">
                {label}
              </p>
              <dl className="flex flex-col gap-2">
                {(kpi.breakdown ?? []).map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <dt className="text-n-500">{item.label}</dt>
                    <dd className="text-n-100 font-medium tabular-nums">
                      {item.formatted ?? item.value.toLocaleString('es-CO')}
                    </dd>
                  </div>
                ))}
              </dl>
              {kpi.assumptions && kpi.assumptions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[rgb(var(--color-gold-500-rgb)_/_0.12)]">
                  <p className="uppercase tracking-label text-xs font-medium text-n-600 mb-1.5">
                    {language === 'es' ? 'Supuestos' : 'Assumptions'}
                  </p>
                  <ul className="flex flex-col gap-1 text-xs text-n-500 leading-relaxed">
                    {kpi.assumptions.map((a) => (
                      <li key={a} className="pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-gold-500">
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Component principal ─────────────────────────────────────────────────────

export function ValorArea({ kpi, trend, compact = false, className }: ValorAreaProps) {
  const { t, language } = useLanguage();
  const valor = t.elite.areas.valor;
  const reduced = useReducedMotion();

  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const kpiData = useMemo<KpiResult>(() => kpi ?? mockExitValue, [kpi]);
  const trendData = useMemo<TrendPoint[]>(
    () => trend ?? buildMockTrend(kpiData.value),
    [trend, kpiData.value],
  );

  // Delta over the trend series
  const first = trendData[0]?.value ?? kpiData.value;
  const last = trendData[trendData.length - 1]?.value ?? kpiData.value;
  const trendDelta = first === 0 ? 0 : ((last - first) / first) * 100;

  // Sub-KPI mocks — derivados del KPI principal por coherencia visual.
  const ebitdaAdjustedStr = useMemo(() => {
    const b = kpiData.breakdown?.find((x) => x.label.toLowerCase().includes('ebitda'));
    return b?.formatted ?? formatCop(675_000_000);
  }, [kpiData]);

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
      data-theme="elite"
      className={cn(
        'relative w-full',
        compact ? '' : 'min-h-full',
        className,
      )}
    >
      {!compact && (
        <>
          {/* Hero */}
          <motion.div {...fadeItem(0)} className="mb-10">
            <SectionHeader
              eyebrow={language === 'es' ? 'II. Valor' : 'II. Value'}
              title={valor.concept}
              subtitle={valor.subtitle}
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
              'text-n-300 max-w-3xl mb-12',
            )}
          >
            {valor.narrative}
          </motion.p>
        </>
      )}

      {/* KPI Hero — Exit Value */}
      <motion.div
        {...fadeItem(2)}
        className={cn('mb-5', compact ? '' : '')}
      >
        <div className="relative p-7 md:p-8 rounded-xl glass-elite-elevated border-elite-gold glow-gold overflow-hidden">
          {/* Ambient glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 -right-20 w-[280px] h-[280px] rounded-full blur-[100px] opacity-40"
            style={{
              background:
                'radial-gradient(circle, rgba(232,180,44,0.45) 0%, rgba(232,180,44,0) 70%)',
            }}
          />

          <div className="relative z-[1] flex flex-col gap-6">
            {/* Header strip */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full shrink-0 bg-success shadow-[0_0_8px_rgba(34,197,94,0.8)]"
                />
                <span className="uppercase tracking-eyebrow text-xs font-medium text-gold-500 truncate">
                  {valor.kpiPrimary}
                </span>
              </div>
              <div
                aria-hidden="true"
                className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[rgb(var(--color-gold-500-rgb)_/_0.16)] text-gold-600"
              >
                <Diamond className="h-5 w-5" strokeWidth={1.6} />
              </div>
            </div>

            {/* Mega valor + delta */}
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-4 flex-wrap">
                <motion.span
                  key={kpiData.formatted}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={reduced ? {} : { opacity: 1, y: 0 }}
                  transition={reduced ? undefined : { duration: 0.5, ease: 'easeOut' }}
                  className={cn(
                    'font-serif-elite font-medium text-n-100 leading-display tracking-tight num',
                    'text-5xl sm:text-6xl',
                    'bg-clip-text text-transparent',
                    '[background-image:linear-gradient(135deg,#F5F5F5_0%,var(--gold-400)_50%,var(--gold-500)_100%)]',
                  )}
                  style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0, "WONK" 0' }}
                >
                  {kpiData.formatted}
                </motion.span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[rgba(34,197,94,0.12)] border border-[rgba(34,197,94,0.3)]">
                  <TrendingUp className="h-3.5 w-3.5 text-success" strokeWidth={2.2} />
                  <span className="text-sm font-semibold tabular-nums text-success">
                    +{Math.abs(trendDelta).toFixed(1)}%
                  </span>
                  <span className="text-xs text-n-500">
                    {language === 'es' ? 'vs t0' : 'vs t0'}
                  </span>
                </span>
              </div>
              <p className="text-sm text-n-500 max-w-xl">
                {language === 'es'
                  ? 'Equity Value estimado con múltiplos de transacciones CO 2024-2026 y ajuste por crecimiento esperado.'
                  : 'Equity value estimated using CO 2024-2026 transaction multiples with expected growth adjustment.'}
              </p>
            </div>

            {/* Sparkline */}
            <Sparkline points={trendData} language={language} reduced={reduced ?? null} />

            {/* Breakdown expandible */}
            <ExitValueBreakdown
              kpi={kpiData}
              open={breakdownOpen}
              onToggle={() => setBreakdownOpen((v) => !v)}
              language={language}
            />
          </div>
        </div>
      </motion.div>

      {/* Sub-KPIs grid (4 cards) */}
      <motion.div
        {...fadeItem(3)}
        className={cn(
          'grid gap-4',
          'grid-cols-2 md:grid-cols-4',
          compact ? 'mb-8' : 'mb-14',
        )}
      >
        <MiniKpi
          label={language === 'es' ? 'EBITDA Ajustado' : 'Adjusted EBITDA'}
          value={ebitdaAdjustedStr}
          icon={DollarSign}
          accent="gold"
          delta={language === 'es' ? '+12.8% YoY' : '+12.8% YoY'}
          deltaDir="up"
        />
        <MiniKpi
          label={language === 'es' ? 'WACC Actual' : 'Current WACC'}
          value="13.5%"
          icon={Percent}
          accent="neutral"
          delta={language === 'es' ? 'CO 2026 — servicios' : 'CO 2026 — services'}
          deltaDir="flat"
        />
        <MiniKpi
          label={language === 'es' ? 'Ratio D/E' : 'D/E Ratio'}
          value="0.58"
          icon={Scale}
          accent="neutral"
          delta={language === 'es' ? 'Saludable < 1.0' : 'Healthy < 1.0'}
          deltaDir="flat"
        />
        <MiniKpi
          label={language === 'es' ? 'Free Cash Flow' : 'Free Cash Flow'}
          value={formatCop(420_000_000)}
          icon={Wallet}
          accent="gold"
          delta={language === 'es' ? '+18.5% vs LY' : '+18.5% vs LY'}
          deltaDir="up"
        />
      </motion.div>

      {/* Grid submódulos */}
      <motion.div {...fadeItem(4)} className="grid gap-5 grid-cols-1 md:grid-cols-3">
        {SUBMODULES.map((sub, i) => (
          <SubmoduleCard
            key={sub.key}
            submodule={sub}
            title={valor.submodules[sub.key].title}
            description={valor.submodules[sub.key].description}
            ctaLabel={language === 'es' ? 'Entrar' : 'Enter'}
            readyLabel={language === 'es' ? 'Listo' : 'Ready'}
            upcomingLabel={language === 'es' ? 'Próximamente' : 'Coming soon'}
            delay={i}
            reduced={reduced}
          />
        ))}
      </motion.div>
    </div>
  );
}

// ─── Submódulo card (grande, ícono destacado) ────────────────────────────────

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
          delay: 0.3 + delay * 0.08,
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
          className="h-full min-h-[220px] flex flex-col gap-5 focus-within:ring-2 focus-within:ring-gold-500 focus-within:ring-offset-2 focus-within:ring-offset-n-1000"
        >
          <div className="flex items-start justify-between gap-4">
            <div
              aria-hidden="true"
              className="shrink-0 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600 group-hover:bg-[rgb(var(--color-gold-500-rgb)_/_0.22)] group-hover:text-gold-400 transition-colors"
            >
              <Icon className="h-7 w-7" strokeWidth={1.6} />
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
            <h3 className="font-serif-elite text-xl leading-tight font-medium tracking-tight text-n-100">
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

// Re-export helpers to avoid unused imports and for consumer convenience
export { calculateExitValue, formatCop };
export default ValorArea;
