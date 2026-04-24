'use client';

import { cn } from '@/lib/utils';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowUp, Minus, type LucideIcon } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';

/**
 * PremiumKpiCard — Hero KPI tile for the Executive Dashboard.
 *
 *   <PremiumKpiCard
 *     label="Tasa de Eficiencia Fiscal"
 *     value="22.4%"
 *     subvalue="+$47.2M ahorrados"
 *     trend={{ direction: 'up', delta: 12.3 }}
 *     severity="good"
 *     accent="gold"
 *     icon={Shield}
 *     glow
 *     onClick={...}
 *   />
 *
 * Design:
 *  - `value` is rendered in Instrument Serif at 48–64px for protagonism.
 *  - `label` is uppercase, spaced-out, small.
 *  - `subvalue` + `trend` live in a supporting row with an arrow glyph.
 *  - `severity="critical"` swaps the border+glow to wine for "alarm" KPIs.
 *  - `accent` picks gold (default) vs wine when severity is not critical.
 *  - `glow` adds a soft ambient glow (amplified on hover).
 *  - `onClick` makes the card an interactive <button>-styled surface with
 *    proper keyboard + role semantics.
 */

export type KpiSeverity = 'good' | 'neutral' | 'warn' | 'critical';
export type KpiAccent = 'gold' | 'wine';
export type KpiTrendDirection = 'up' | 'down' | 'flat';

export interface KpiTrend {
  direction: KpiTrendDirection;
  /** Delta in % or absolute. Rendered verbatim if a string, otherwise toFixed(1). */
  delta?: number | string;
  /** Optional label after the delta, e.g. "vs trimestre anterior". */
  label?: string;
}

export interface PremiumKpiCardProps {
  label: ReactNode;
  value: ReactNode;
  subvalue?: ReactNode;
  trend?: KpiTrend;
  severity?: KpiSeverity;
  accent?: KpiAccent;
  icon?: LucideIcon;
  glow?: boolean;
  loading?: boolean;
  /** If provided, the card becomes interactive (button-like). */
  onClick?: () => void;
  href?: string;
  className?: string;
  /** If the consumer wants a very compact variant (e.g. sidebar strip). */
  compact?: boolean;
  ariaLabel?: string;
}

const TREND_COLOR: Record<KpiTrendDirection, string> = {
  up: 'text-[#86EFAC]',
  down: 'text-[#FCA5A5]',
  flat: 'text-[#A8A8A8]',
};

const TREND_ICON: Record<KpiTrendDirection, LucideIcon> = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
};

const SEVERITY_BORDER: Record<KpiSeverity, string> = {
  good: 'rgba(34, 197, 94, 0.35)',
  neutral: 'rgba(212, 160, 23, 0.32)',
  warn: 'rgba(234, 179, 8, 0.38)',
  critical: 'rgba(114, 47, 55, 0.55)',
};

const SEVERITY_DOT: Record<KpiSeverity, string> = {
  good: '#22C55E',
  neutral: '#D4A017',
  warn: '#EAB308',
  critical: '#722F37',
};

function formatDelta(delta: number | string | undefined): string | null {
  if (delta == null) return null;
  if (typeof delta === 'string') return delta;
  const prefix = delta > 0 ? '+' : '';
  return `${prefix}${delta.toFixed(1)}%`;
}

const PremiumKpiCard = forwardRef<HTMLDivElement, PremiumKpiCardProps>(
  (
    {
      label,
      value,
      subvalue,
      trend,
      severity = 'neutral',
      accent = 'gold',
      icon: Icon,
      glow = false,
      loading = false,
      onClick,
      href,
      className,
      compact = false,
      ariaLabel,
    },
    ref,
  ) => {
    const shouldReduce = useReducedMotion();
    const isInteractive = Boolean(onClick ?? href);

    const isCritical = severity === 'critical';
    const borderColor = SEVERITY_BORDER[severity];
    const dotColor = SEVERITY_DOT[severity];

    const glowClass = glow
      ? isCritical || accent === 'wine'
        ? 'shadow-[0_0_28px_rgba(114,47,55,0.28)]'
        : 'shadow-[0_0_28px_rgba(212,160,23,0.22)]'
      : '';

    const hoverGlow = glow
      ? isCritical || accent === 'wine'
        ? 'hover:shadow-[0_0_44px_rgba(114,47,55,0.42)]'
        : 'hover:shadow-[0_0_44px_rgba(212,160,23,0.36)]'
      : '';

    const TrendIcon = trend ? TREND_ICON[trend.direction] : null;
    const deltaText = trend ? formatDelta(trend.delta) : null;

    const motionProps =
      shouldReduce || !isInteractive
        ? undefined
        : {
            whileHover: { y: -2 },
            transition: { type: 'spring' as const, stiffness: 380, damping: 28 },
          };

    const content = (
      <>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
              style={{ backgroundColor: dotColor }}
            />
            <span
              className={cn(
                'uppercase tracking-[0.18em] text-[11px] font-medium',
                'text-[#A8A8A8]',
                'truncate',
              )}
            >
              {label}
            </span>
          </div>
          {Icon && (
            <div
              aria-hidden="true"
              className={cn(
                'shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-[10px]',
                isCritical
                  ? 'bg-[rgba(114,47,55,0.18)] text-[#C46A76]'
                  : accent === 'wine'
                    ? 'bg-[rgba(114,47,55,0.16)] text-[#C46A76]'
                    : 'bg-[rgba(212,160,23,0.14)] text-[#E8B42C]',
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </div>
          )}
        </div>

        <div className={cn('flex flex-col', compact ? 'gap-1' : 'gap-1.5')}>
          <div
            className={cn(
              'font-serif-elite font-normal text-[#F5F5F5] leading-[1.02]',
              compact ? 'text-[36px]' : 'text-[48px] md:text-[56px] lg:text-[60px]',
              'tabular-nums',
            )}
          >
            {loading ? (
              <span className="inline-block h-[0.9em] w-[60%] rounded-[6px] bg-[rgba(212,160,23,0.14)] animate-pulse" />
            ) : (
              value
            )}
          </div>

          {(subvalue || trend) && (
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[13px]">
              {trend && TrendIcon && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 font-medium tabular-nums',
                    TREND_COLOR[trend.direction],
                  )}
                >
                  <TrendIcon className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                  {deltaText && <span>{deltaText}</span>}
                  {trend.label && (
                    <span className="text-[#A8A8A8] font-normal">{trend.label}</span>
                  )}
                </span>
              )}
              {subvalue && <span className="text-[#A8A8A8]">{subvalue}</span>}
            </div>
          )}
        </div>
      </>
    );

    const commonClasses = cn(
      'relative flex flex-col gap-4',
      compact ? 'p-5' : 'p-6 sm:p-7',
      'rounded-[14px]',
      'glass-elite-elevated',
      'border-elite-gold',
      'transition-[box-shadow,transform] duration-300 ease-out',
      'text-left',
      glowClass,
      hoverGlow,
      isInteractive &&
        'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017] focus-visible:ring-offset-2 focus-visible:ring-offset-[#030303]',
      className,
    );

    const borderOverlay = (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[14px]"
        style={{
          boxShadow: `inset 0 0 0 1px ${borderColor}`,
        }}
      />
    );

    if (isInteractive) {
      return (
        <motion.div
          ref={ref}
          role={onClick && !href ? 'button' : undefined}
          tabIndex={0}
          aria-label={typeof label === 'string' ? (ariaLabel ?? label) : ariaLabel}
          onClick={onClick}
          onKeyDown={(e) => {
            if (!onClick) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick();
            }
          }}
          className={commonClasses}
          {...motionProps}
        >
          {borderOverlay}
          {content}
        </motion.div>
      );
    }

    return (
      <div ref={ref} className={commonClasses} aria-label={ariaLabel}>
        {borderOverlay}
        {content}
      </div>
    );
  },
);
PremiumKpiCard.displayName = 'PremiumKpiCard';

export { PremiumKpiCard };
