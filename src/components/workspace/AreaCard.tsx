'use client';

import { cn } from '@/lib/utils';
import { motion, useReducedMotion, type Variants } from 'motion/react';
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
 * AreaCard — One of the 4 premium area tiles of the Executive Dashboard.
 *
 *   <AreaCard
 *     area="escudo"
 *     eyebrow="I. Resiliencia"
 *     concept="El Escudo"
 *     subtitle="Estrategia Tributaria y Legal"
 *     tagline="Protección del patrimonio y cumplimiento optimizado"
 *     kpi={{ value: 22.4, formatted: '22.4%', label: 'Tasa de Eficiencia Fiscal',
 *            trend: { direction: 'up', delta: 12.3 }, severity: 'good' }}
 *     submodules={[{ title: 'Defensa DIAN', icon: Shield }, ...]}
 *     ctaLabel="Entrar a El Escudo"
 *     href="/workspace/escudo"
 *     accent="wine"
 *     icon={Shield}
 *   />
 *
 * Visual contract:
 *  - glass-elite-elevated surface + border-elite-gold ring.
 *  - Eyebrow (roman numeral + pillar name) at top.
 *  - Giant serif concept title ("El Escudo"), sans subtitle below.
 *  - Inline hero KPI (moderate size, not full-card protagonism).
 *  - Mini grid of 4 submodules w/ tiny lucide icons.
 *  - Footer CTA link-button → hover lifts +1px and intensifies glow.
 *  - Entire card is a single <Link> for accessibility and hover framing.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Local minimal KPI contract — matches the shape exposed by Agent D's
 * `src/types/kpis.ts` (`KpiResult`). Kept local so this file compiles even
 * if the types module lands later. Agent I will align imports at polish time.
 */
export type AreaKpiDirection = 'up' | 'down' | 'flat';
export type AreaKpiSeverity = 'good' | 'neutral' | 'warn' | 'critical';

export interface AreaKpi {
  value: number;
  formatted: string;
  label: string;
  trend?: { direction: AreaKpiDirection; delta: number };
  severity?: AreaKpiSeverity;
}

export interface AreaSubmodule {
  title: string;
  icon: LucideIcon;
  description?: string;
}

export type AreaKey = 'escudo' | 'valor' | 'verdad' | 'futuro';
export type AreaAccent = 'gold' | 'wine';

export interface AreaCardProps {
  area: AreaKey;
  eyebrow: ReactNode;
  concept: ReactNode;
  subtitle?: ReactNode;
  tagline?: ReactNode;
  kpi?: AreaKpi;
  submodules?: AreaSubmodule[];
  ctaLabel: ReactNode;
  href: string;
  accent?: AreaAccent;
  icon: LucideIcon;
  /**
   * Incremental entrance delay so the dashboard can reveal the 2×2 grid
   * one card after another.
   */
  delay?: number;
  className?: string;
}

// ─── Visual constants ────────────────────────────────────────────────────────

const ACCENT_TEXT: Record<AreaAccent, string> = {
  gold: 'text-[#E8B42C]',
  wine: 'text-[#C46A76]',
};

const ACCENT_ICON_BG: Record<AreaAccent, string> = {
  gold: 'bg-[rgba(212,160,23,0.14)] text-[#E8B42C]',
  wine: 'bg-[rgba(114,47,55,0.20)] text-[#C46A76]',
};

const ACCENT_EYEBROW: Record<AreaAccent, string> = {
  gold: 'text-[#D4A017]',
  wine: 'text-[#C46A76]',
};

const ACCENT_HOVER_GLOW: Record<AreaAccent, string> = {
  gold: 'hover:shadow-[0_0_48px_rgba(212,160,23,0.32)]',
  wine: 'hover:shadow-[0_0_48px_rgba(114,47,55,0.40)]',
};

const TREND_COLOR: Record<AreaKpiDirection, string> = {
  up: 'text-[#86EFAC]',
  down: 'text-[#FCA5A5]',
  flat: 'text-[#A8A8A8]',
};

const TREND_ICON: Record<AreaKpiDirection, LucideIcon> = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
};

const SEVERITY_DOT: Record<AreaKpiSeverity, string> = {
  good: '#22C55E',
  neutral: '#D4A017',
  warn: '#EAB308',
  critical: '#722F37',
};

// ─── Motion ──────────────────────────────────────────────────────────────────

const CARD_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: (custom: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 240,
      damping: 28,
      delay: custom,
    },
  }),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDelta(delta: number): string {
  if (delta === 0) return '0.0%';
  const prefix = delta > 0 ? '+' : '';
  return `${prefix}${delta.toFixed(1)}%`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AreaCard({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- retained in the public API for parent routing / analytics
  area,
  eyebrow,
  concept,
  subtitle,
  tagline,
  kpi,
  submodules,
  ctaLabel,
  href,
  accent = 'gold',
  icon: Icon,
  delay = 0,
  className,
}: AreaCardProps) {
  const shouldReduce = useReducedMotion();

  const severity = kpi?.severity ?? 'neutral';
  const TrendIconCmp = kpi?.trend ? TREND_ICON[kpi.trend.direction] : null;

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      variants={CARD_VARIANTS}
      custom={delay}
      whileHover={shouldReduce ? undefined : { y: -4 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      className={cn('h-full', className)}
    >
      <Link
        href={href}
        aria-label={typeof concept === 'string' ? `${concept} — ${href}` : undefined}
        className={cn(
          'group relative flex h-full min-h-[380px] flex-col',
          'p-7 md:p-8',
          'rounded-[16px]',
          'glass-elite-elevated',
          'border-elite-gold',
          'transition-[box-shadow,border-color,transform] duration-300 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017] focus-visible:ring-offset-2 focus-visible:ring-offset-[#030303]',
          ACCENT_HOVER_GLOW[accent],
        )}
      >
        {/* ── Top row: eyebrow + accent icon ───────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <span
            className={cn(
              'uppercase tracking-[0.26em] text-[11px] font-medium',
              ACCENT_EYEBROW[accent],
            )}
          >
            {eyebrow}
          </span>

          <div
            aria-hidden="true"
            className={cn(
              'shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-[12px]',
              'transition-transform duration-300 ease-out',
              'group-hover:scale-105',
              ACCENT_ICON_BG[accent],
            )}
          >
            <Icon className="h-[22px] w-[22px]" strokeWidth={1.6} />
          </div>
        </div>

        {/* ── Title block ──────────────────────────────────────────────────── */}
        <div className="mt-5 flex flex-col gap-1.5">
          <h3
            className={cn(
              'font-serif-elite font-normal leading-[1.05]',
              'text-[32px] sm:text-[36px] md:text-[40px]',
              'text-[#F5F5F5]',
            )}
          >
            {concept}
          </h3>
          {subtitle != null && (
            <p className="text-[13px] sm:text-[14px] font-medium text-[#D4D4D4] tracking-wide">
              {subtitle}
            </p>
          )}
          {tagline != null && (
            <p className="mt-1 text-[13px] leading-relaxed text-[#A8A8A8] font-light max-w-[38ch]">
              {tagline}
            </p>
          )}
        </div>

        {/* ── KPI hero (inline) ────────────────────────────────────────────── */}
        {kpi && (
          <div className="mt-6 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                style={{ backgroundColor: SEVERITY_DOT[severity] }}
              />
              <span className="uppercase tracking-[0.18em] text-[10px] font-medium text-[#A8A8A8] truncate">
                {kpi.label}
              </span>
            </div>

            <div className="flex items-baseline gap-3 flex-wrap">
              <span
                className={cn(
                  'font-serif-elite font-normal text-[#F5F5F5] leading-[1.02] tabular-nums',
                  'text-[36px] sm:text-[42px] md:text-[44px]',
                )}
              >
                {kpi.formatted}
              </span>
              {kpi.trend && TrendIconCmp && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-[13px] font-medium tabular-nums',
                    TREND_COLOR[kpi.trend.direction],
                  )}
                >
                  <TrendIconCmp className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                  <span>{formatDelta(kpi.trend.delta)}</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Submodules mini-list ─────────────────────────────────────────── */}
        {submodules && submodules.length > 0 && (
          <ul
            className={cn(
              'mt-6 grid gap-x-4 gap-y-2.5',
              submodules.length > 2 ? 'grid-cols-2' : 'grid-cols-1',
            )}
          >
            {submodules.slice(0, 4).map((m) => {
              const MIcon = m.icon;
              return (
                <li
                  key={typeof m.title === 'string' ? m.title : undefined}
                  className="flex items-center gap-2 min-w-0"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'inline-flex h-6 w-6 items-center justify-center rounded-[7px] shrink-0',
                      'bg-[rgba(212,160,23,0.08)] text-[#A8A8A8]',
                      'transition-colors duration-200',
                      'group-hover:text-[#E8B42C]',
                    )}
                  >
                    <MIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </span>
                  <span className="text-[12.5px] text-[#D4D4D4] truncate">
                    {m.title}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* ── Footer CTA ───────────────────────────────────────────────────── */}
        <div className="mt-auto pt-7 flex items-center justify-between gap-3 border-t border-[rgba(212,160,23,0.14)]">
          <span
            className={cn(
              'text-[13px] font-medium tracking-wide',
              ACCENT_TEXT[accent],
              'transition-colors duration-200',
            )}
          >
            {ctaLabel}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-full',
              'border border-[rgba(212,160,23,0.22)]',
              'text-[#A8A8A8]',
              'transition-[transform,color,border-color,background-color] duration-300 ease-out',
              'group-hover:translate-x-0.5',
              accent === 'wine'
                ? 'group-hover:text-[#C46A76] group-hover:border-[rgba(196,106,118,0.55)] group-hover:bg-[rgba(114,47,55,0.18)]'
                : 'group-hover:text-[#E8B42C] group-hover:border-[rgba(232,180,44,0.55)] group-hover:bg-[rgba(212,160,23,0.12)]',
            )}
          >
            <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
          </span>
        </div>
      </Link>
    </motion.div>
  );
}
