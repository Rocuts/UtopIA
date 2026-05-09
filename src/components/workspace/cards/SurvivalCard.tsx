'use client';

/**
 * SurvivalCard — Base card for the Modo Supervivencia Élite grid.
 * Provides: header (icon + title + AlertIndicator), primary metric (large),
 * description, children slot, footer (norma chip).
 *
 * Never calculates anything — only formats and displays.
 * Visual language: wine area theme (#A83838 derivatives, glass-elite surfaces).
 */

import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react';
import type { AlertLevel } from '@/lib/agents/financial/escudo-survival/types';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// AlertIndicator — pill badge (rojo/amarillo/verde)
// ---------------------------------------------------------------------------

const ALERT_CONFIG: Record<
  AlertLevel,
  { label: string; labelEn: string; bg: string; text: string; ring: string; dot: string; Icon: LucideIcon }
> = {
  rojo: {
    label: 'Crítico',
    labelEn: 'Critical',
    bg: 'bg-[rgb(239_68_68_/_0.14)]',
    text: 'text-danger',
    ring: 'ring-1 ring-[rgb(239_68_68_/_0.4)]',
    dot: 'bg-danger',
    Icon: AlertTriangle,
  },
  amarillo: {
    label: 'Atención',
    labelEn: 'Attention',
    bg: 'bg-[rgb(234_179_8_/_0.14)]',
    text: 'text-warning',
    ring: 'ring-1 ring-[rgb(234_179_8_/_0.35)]',
    dot: 'bg-warning',
    Icon: AlertCircle,
  },
  verde: {
    label: 'Óptimo',
    labelEn: 'Optimal',
    bg: 'bg-[rgb(34_197_94_/_0.12)]',
    text: 'text-success',
    ring: 'ring-1 ring-[rgb(34_197_94_/_0.3)]',
    dot: 'bg-success',
    Icon: CheckCircle2,
  },
};

interface AlertIndicatorProps {
  level: AlertLevel;
  language?: 'es' | 'en';
}

export function AlertIndicator({ level, language = 'es' }: AlertIndicatorProps) {
  const cfg = ALERT_CONFIG[level];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full',
        'text-xs font-medium uppercase tracking-label',
        cfg.bg,
        cfg.text,
        cfg.ring,
      )}
      aria-label={language === 'es' ? cfg.label : cfg.labelEn}
    >
      <span aria-hidden="true" className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', cfg.dot)} />
      {language === 'es' ? cfg.label : cfg.labelEn}
    </span>
  );
}

// ---------------------------------------------------------------------------
// NormaCitation — chip that cites the legal norm
// ---------------------------------------------------------------------------

interface NormaCitationProps {
  norma: string;
  className?: string;
}

export function NormaCitation({ norma, className }: NormaCitationProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded',
        'bg-[rgb(168_56_56_/_0.12)] text-area-escudo',
        'text-[11px] font-medium font-[family-name:var(--font-geist-mono,monospace)]',
        'ring-1 ring-[rgb(168_56_56_/_0.28)]',
        className,
      )}
      title={norma}
    >
      {norma}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeleton shimmer — loading state
// ---------------------------------------------------------------------------

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block rounded animate-pulse bg-n-300/30 dark:bg-n-700/30',
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// SurvivalCard
// ---------------------------------------------------------------------------

export interface SurvivalCardProps {
  title: string;
  subtitle?: string;
  alertLevel: AlertLevel;
  primaryMetric: { label: string; value: string };
  description?: string;
  actions?: ReactNode;
  norma?: string;
  loading?: boolean;
  error?: string;
  icon?: LucideIcon;
  language?: 'es' | 'en';
  className?: string;
  children?: ReactNode;
}

export function SurvivalCard({
  title,
  subtitle,
  alertLevel,
  primaryMetric,
  description,
  actions,
  norma,
  loading = false,
  error,
  icon: Icon,
  language = 'es',
  className,
  children,
}: SurvivalCardProps) {
  const alertCfg = ALERT_CONFIG[alertLevel];
  const HeaderIcon = Icon ?? alertCfg.Icon;

  // Border accent color per alert level
  const accentBorder: Record<AlertLevel, string> = {
    rojo: 'ring-[rgb(239_68_68_/_0.3)]',
    amarillo: 'ring-[rgb(234_179_8_/_0.28)]',
    verde: 'ring-[rgb(34_197_94_/_0.25)]',
  };

  return (
    <article
      className={cn(
        'relative flex flex-col gap-5 p-6 rounded-xl h-full',
        'glass-elite-elevated',
        'ring-1',
        accentBorder[alertLevel],
        className,
      )}
      aria-label={title}
    >
      {/* Ambient glow — subtle wine tint top-left */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -left-12 w-[180px] h-[180px] rounded-full blur-[64px] opacity-20"
        style={{
          background: 'radial-gradient(circle, rgb(168 56 56 / 0.6) 0%, transparent 70%)',
        }}
      />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {/* Icon */}
          <span
            aria-hidden="true"
            className={cn(
              'shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg',
              'bg-[rgb(168_56_56_/_0.18)] text-area-escudo',
            )}
          >
            {loading ? (
              <Shimmer className="h-5 w-5 rounded" />
            ) : (
              <HeaderIcon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            )}
          </span>

          {/* Title + subtitle */}
          <div className="min-w-0">
            <h3 className="font-serif-elite text-lg leading-tight font-medium tracking-tight text-n-1000 truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-n-500 mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
        </div>

        {/* Alert pill */}
        {!loading && !error && (
          <AlertIndicator level={alertLevel} language={language} />
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {error ? (
        <div className="flex items-start gap-2 rounded-md p-3 bg-[rgb(239_68_68_/_0.10)] ring-1 ring-[rgb(239_68_68_/_0.25)]">
          <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-danger leading-relaxed">{error}</p>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando...">
          <Shimmer className="h-10 w-32" />
          <Shimmer className="h-4 w-full" />
          <Shimmer className="h-4 w-3/4" />
        </div>
      ) : (
        <>
          {/* Primary metric */}
          <div>
            <span className="block text-xs uppercase tracking-eyebrow text-n-500 mb-1">
              {primaryMetric.label}
            </span>
            <span className={cn('font-serif-elite font-normal num leading-[1]', 'text-4xl md:text-5xl', alertCfg.text)}>
              {primaryMetric.value}
            </span>
          </div>

          {/* Description */}
          {description && (
            <p className="text-sm leading-relaxed text-n-700 dark:text-n-400 line-clamp-4">
              {description}
            </p>
          )}

          {/* Extra slot (card-specific content) */}
          {children}
        </>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      {!loading && !error && (norma || actions) && (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-n-200/40 dark:border-n-800/40">
          {norma && <NormaCitation norma={norma} />}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
    </article>
  );
}
