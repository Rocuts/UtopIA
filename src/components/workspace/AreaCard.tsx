'use client';

import { cn } from '@/lib/utils';
import { motion, type Variants } from 'motion/react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Minus,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * AreaCard — One of the 4 cockpit tiles of the Executive Dashboard.
 *
 * Cockpit contract (NOT a brochure):
 *   - Compact (min-h 240, not 380).
 *   - One live KPI (number + sparkline stub).
 *   - 4 distinct area accents (verdad / valor / futuro / escudo) — NOT
 *     the legacy 2-tone gold/wine split. Every pillar reads distinctly.
 *   - Directional hover: translate-y -2px + shadow-e4 + border intensifies.
 *   - Submodule list REMOVED — AreaNav already surfaces navigation; the
 *     cockpit tile shows the pulse, not the menu.
 *   - CTA footer shows a live alerts count, not a generic "Enter".
 *
 *   <AreaCard
 *     area="escudo"
 *     eyebrow="I. Resiliencia"
 *     concept="El Escudo"
 *     subtitle="Estrategia Tributaria y Legal"
 *     tagline="Protección del patrimonio…"
 *     kpi={{ value: 22.4, formatted: '22.4%', label: 'Eficiencia Fiscal',
 *            trend: { direction: 'up', delta: 12.3 }, severity: 'good' }}
 *     ctaLabel="Entrar a El Escudo"
 *     alertsCount={3}
 *     href="/workspace/escudo"
 *     icon={Shield}
 *   />
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type AreaKpiDirection = 'up' | 'down' | 'flat';
export type AreaKpiSeverity = 'good' | 'neutral' | 'warn' | 'critical';

export interface AreaKpi {
  value: number;
  formatted: string;
  label: string;
  trend?: { direction: AreaKpiDirection; delta: number };
  severity?: AreaKpiSeverity;
}

/**
 * @deprecated Kept only so the parent type check doesn't break if anyone still
 *   passes submodules. The card no longer renders them — AreaNav owns that.
 */
export interface AreaSubmodule {
  title: string;
  icon: LucideIcon;
  description?: string;
}

export type AreaKey = 'escudo' | 'valor' | 'verdad' | 'futuro';
/**
 * @deprecated — retained in the public API so the parent stays source-compatible.
 *   The card now derives its accent from `area` (4 distinct palettes).
 */
export type AreaAccent = 'gold' | 'wine';

export interface AreaCardProps {
  area: AreaKey;
  eyebrow: ReactNode;
  concept: ReactNode;
  subtitle?: ReactNode;
  tagline?: ReactNode;
  kpi?: AreaKpi;
  /** @deprecated — no longer rendered. */
  submodules?: AreaSubmodule[];
  ctaLabel: ReactNode;
  href: string;
  /** @deprecated — ignored. Accent is derived from `area`. */
  accent?: AreaAccent;
  icon: LucideIcon;
  /** Live alerts count surfaced in the footer. Defaults to 0 (hidden). */
  alertsCount?: number;
  /** Sparkline data points. If omitted, a deterministic stub is generated. */
  sparkline?: number[];
  /**
   * Incremental entrance delay so the dashboard can reveal the 2×2/4-col
   * grid one card after another.
   */
  delay?: number;
  className?: string;
}

// ─── Area palettes (4 distinct accents) ──────────────────────────────────────
// Using Tailwind utilities + CSS var tokens (bg-area-* comes from @theme via
// --color-area-*). Fractions (/10, /30, /60) use the Tailwind v4 alpha syntax.

interface AreaPalette {
  tint: string;            // bg-<area>/10
  border: string;          // border-<area>/30
  borderHover: string;     // group-hover border /60
  text: string;            // text-<area>
  groupHoverText: string;  // group-hover:text-<area>
  eyebrow: string;         // eyebrow text color
  sparkStroke: string;     // sparkline stroke (resolves through a CSS var)
  glow: string;            // var(--area-*-glow)
}

const AREA_PALETTES: Record<AreaKey, AreaPalette> = {
  verdad: {
    tint: 'bg-area-verdad/10',
    border: 'border-area-verdad/30',
    borderHover: 'group-hover:border-area-verdad/60',
    text: 'text-area-verdad',
    groupHoverText: 'group-hover:text-area-verdad',
    eyebrow: 'text-area-verdad',
    sparkStroke: 'var(--color-area-verdad)',
    glow: 'var(--area-verdad-glow)',
  },
  valor: {
    tint: 'bg-gold-500/10',
    border: 'border-gold-500/30',
    borderHover: 'group-hover:border-gold-500/60',
    text: 'text-gold-500',
    groupHoverText: 'group-hover:text-gold-500',
    eyebrow: 'text-gold-500',
    sparkStroke: 'var(--color-gold-500)',
    glow: 'var(--area-valor-glow)',
  },
  futuro: {
    tint: 'bg-area-futuro/10',
    border: 'border-area-futuro/30',
    borderHover: 'group-hover:border-area-futuro/60',
    text: 'text-area-futuro',
    groupHoverText: 'group-hover:text-area-futuro',
    eyebrow: 'text-area-futuro',
    sparkStroke: 'var(--color-area-futuro)',
    glow: 'var(--area-futuro-glow)',
  },
  escudo: {
    tint: 'bg-area-escudo/10',
    border: 'border-area-escudo/30',
    borderHover: 'group-hover:border-area-escudo/60',
    text: 'text-area-escudo',
    groupHoverText: 'group-hover:text-area-escudo',
    eyebrow: 'text-area-escudo',
    sparkStroke: 'var(--color-area-escudo)',
    glow: 'var(--area-escudo-glow)',
  },
};

const TREND_COLOR: Record<AreaKpiDirection, string> = {
  up: 'text-success',
  down: 'text-danger',
  flat: 'text-n-500',
};

const TREND_ICON: Record<AreaKpiDirection, LucideIcon> = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
};

const SEVERITY_DOT: Record<AreaKpiSeverity, string> = {
  good: 'bg-success',
  neutral: 'bg-gold-500',
  warn: 'bg-warning',
  critical: 'bg-danger',
};

// ─── Motion ──────────────────────────────────────────────────────────────────

const CARD_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: (custom: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 260,
      damping: 28,
      delay: custom,
    },
  }),
};

// ─── Sparkline stub ──────────────────────────────────────────────────────────
// Deterministic pseudo-random curve so cards don't re-shuffle on re-render.
// Real data will be wired by Agent I; this is the visual placeholder.

function deterministicCurve(seedString: string, points: number = 12): number[] {
  let h = 0;
  for (let i = 0; i < seedString.length; i += 1) {
    h = (h << 5) - h + seedString.charCodeAt(i);
    h |= 0;
  }
  const out: number[] = [];
  let last = 0.5;
  for (let i = 0; i < points; i += 1) {
    // LCG-ish step, scaled into [0, 1]
    h = (h * 9301 + 49297) & 0x7fffffff;
    const step = ((h % 1000) / 1000 - 0.5) * 0.32;
    last = Math.min(0.95, Math.max(0.05, last + step));
    out.push(last);
  }
  return out;
}

interface SparklineProps {
  values: number[];
  stroke: string;
  width?: number;
  height?: number;
}

function Sparkline({ values, stroke, width = 120, height = 28 }: SparklineProps) {
  if (values.length < 2) return null;
  const step = width / (values.length - 1);
  const path = values
    .map((v, i) => {
      const x = i * step;
      const y = height - v * height;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const last = values[values.length - 1] ?? 0;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      fill="none"
      stroke={stroke}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="opacity-90"
      aria-hidden="true"
    >
      <path d={path} />
      <circle
        cx={width}
        cy={height - last * height}
        r={2}
        fill={stroke}
      />
    </svg>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDelta(delta: number): string {
  if (delta === 0) return '0.0%';
  const prefix = delta > 0 ? '+' : '';
  return `${prefix}${delta.toFixed(1)}%`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AreaCard({
  area,
  eyebrow,
  concept,
  subtitle,
  tagline,
  kpi,
  ctaLabel,
  href,
  icon: Icon,
  alertsCount = 0,
  sparkline,
  delay = 0,
  className,
}: AreaCardProps) {
  const palette = AREA_PALETTES[area];
  const severity = kpi?.severity ?? 'neutral';
  const TrendIconCmp = kpi?.trend ? TREND_ICON[kpi.trend.direction] : null;

  const curve = sparkline ?? deterministicCurve(area);
  const seedKey = typeof concept === 'string' ? concept : area;

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      variants={CARD_VARIANTS}
      custom={delay}
      className={cn('h-full', className)}
    >
      <Link
        href={href}
        aria-label={typeof concept === 'string' ? `${concept} — ${href}` : undefined}
        className={cn(
          'group relative flex h-full min-h-[240px] flex-col',
          'px-5 pt-5 pb-4',
          'rounded-xl',
          'bg-n-50 border',
          palette.border,
          palette.borderHover,
          'shadow-e2 hover:shadow-e4',
          'transition-[transform,box-shadow,border-color] duration-200 ease-out',
          'hover:-translate-y-0.5',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
        )}
        style={{
          // Subtle ambient tint toward the area color, keyed off the card bg.
          backgroundImage: `linear-gradient(135deg, ${palette.glow} 0%, transparent 55%)`,
        }}
      >
        {/* ── Row 1: eyebrow + accent icon ────────────────────────────── */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="inline-flex h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: palette.sparkStroke }}
              aria-hidden="true"
            />
            <span
              className={cn(
                'font-mono text-xs-mono uppercase tracking-eyebrow font-medium truncate',
                palette.eyebrow,
              )}
            >
              {eyebrow}
            </span>
          </div>

          <div
            aria-hidden="true"
            className={cn(
              'shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg',
              'transition-transform duration-200 ease-out',
              'group-hover:scale-105',
              palette.tint,
              palette.text,
            )}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </div>
        </div>

        {/* ── Row 2: title + subtitle ─────────────────────────────────── */}
        <div className="mt-3 flex flex-col gap-0.5">
          <h3
            className={cn(
              'font-serif-elite font-normal leading-tight tracking-tight',
              'text-2xl',
              'text-n-900',
            )}
          >
            {concept}
          </h3>
          {subtitle != null && (
            <p className="text-sm font-medium text-n-700 truncate">
              {subtitle}
            </p>
          )}
        </div>

        {/* ── Row 3: live KPI + sparkline ─────────────────────────────── */}
        <div className="mt-4 flex items-end justify-between gap-4">
          {kpi ? (
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full shrink-0',
                    SEVERITY_DOT[severity],
                  )}
                />
                <span className="font-mono text-xs-mono uppercase tracking-eyebrow font-medium text-n-500 truncate">
                  {kpi.label}
                </span>
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className={cn(
                    'font-mono font-medium text-n-900 leading-none tabular-nums num',
                    'text-3xl',
                  )}
                >
                  {kpi.formatted}
                </span>
                {kpi.trend && TrendIconCmp && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-0.5 text-sm font-mono font-medium tabular-nums',
                      TREND_COLOR[kpi.trend.direction],
                    )}
                  >
                    <TrendIconCmp className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
                    <span>{formatDelta(kpi.trend.delta)}</span>
                  </span>
                )}
              </div>
            </div>
          ) : tagline != null ? (
            <p className="text-sm leading-snug text-n-600 font-light">
              {tagline}
            </p>
          ) : (
            <div />
          )}

          <div className="shrink-0 self-end opacity-80 group-hover:opacity-100 transition-opacity">
            <Sparkline
              key={seedKey}
              values={curve}
              stroke={palette.sparkStroke}
            />
          </div>
        </div>

        {/* ── Row 4: footer CTA + alerts ───────────────────────────────── */}
        <div
          className={cn(
            'mt-auto pt-6 flex items-center justify-between gap-3',
            'border-t border-n-200',
          )}
        >
          {alertsCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-n-500 group-hover:text-gold-600 transition-colors">
              <span
                aria-hidden="true"
                className="inline-flex h-1.5 w-1.5 rounded-full bg-warning"
              />
              <span className="font-mono tabular-nums">{alertsCount}</span>
              <span>
                {alertsCount === 1 ? 'alerta activa' : 'alertas activas'}
              </span>
            </span>
          ) : (
            <span className={cn('text-sm font-medium tracking-wide', palette.text)}>
              {ctaLabel}
            </span>
          )}
          <span
            aria-hidden="true"
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-full',
              'border border-n-200 text-n-500',
              'transition-[transform,color,border-color,background-color] duration-200 ease-out',
              'group-hover:translate-x-0.5',
              palette.borderHover,
              palette.groupHoverText,
            )}
          >
            <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
          </span>
        </div>
      </Link>
    </motion.div>
  );
}
