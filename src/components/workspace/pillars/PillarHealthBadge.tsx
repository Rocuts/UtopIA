'use client';

/**
 * PillarHealthBadge — chip visual con score 0-100 + status traffic-light.
 *
 * Variants:
 *   - 'badge' (default): chip compacto en línea con icono
 *   - 'card':            tarjeta grande (KPI hero) con score gigante
 *   - 'inline':          score inline para tablas
 */

import { cn } from '@/lib/utils';
import type { PillarId, PillarStatus } from '@/lib/pillars/types';

const STATUS_COLOR: Record<PillarStatus, { fg: string; bg: string; ring: string }> = {
  healthy: { fg: 'text-success', bg: 'bg-success/10', ring: 'ring-success/30' },
  watch: { fg: 'text-gold-500', bg: 'bg-gold-500/10', ring: 'ring-gold-500/30' },
  warning: { fg: 'text-warning', bg: 'bg-warning/10', ring: 'ring-warning/30' },
  critical: { fg: 'text-danger', bg: 'bg-danger/10', ring: 'ring-danger/30' },
};

const PILLAR_ACCENT: Record<PillarId, string> = {
  verdad: 'text-area-verdad',
  escudo: 'text-area-escudo',
  valor: 'text-area-valor',
  futuro: 'text-area-futuro',
};

const PILLAR_LABEL_ES: Record<PillarId, string> = {
  verdad: 'Verdad',
  escudo: 'Escudo',
  valor: 'Valor',
  futuro: 'Futuro',
};

const PILLAR_LABEL_EN: Record<PillarId, string> = {
  verdad: 'Truth',
  escudo: 'Shield',
  valor: 'Value',
  futuro: 'Future',
};

export interface PillarHealthBadgeProps {
  pillar: PillarId;
  score: number;
  status: PillarStatus;
  language?: 'es' | 'en';
  variant?: 'badge' | 'card' | 'inline';
  className?: string;
}

export function PillarHealthBadge({
  pillar,
  score,
  status,
  language = 'es',
  variant = 'badge',
  className,
}: PillarHealthBadgeProps) {
  const colors = STATUS_COLOR[status];
  const accent = PILLAR_ACCENT[pillar];
  const label = (language === 'es' ? PILLAR_LABEL_ES : PILLAR_LABEL_EN)[pillar];

  if (variant === 'card') {
    return (
      <div
        className={cn(
          'flex flex-col rounded-2xl p-5 border',
          'bg-n-0 border-gold-500/15',
          'shadow-e1',
          className,
        )}
        data-testid={`pillar-health-card-${pillar}`}
      >
        <header className="flex items-center justify-between mb-3">
          <span className={cn('font-mono text-xs-mono uppercase tracking-eyebrow font-medium', accent)}>
            {label}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
              'text-[10px] font-mono uppercase tracking-eyebrow',
              colors.bg,
              colors.fg,
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', colors.fg.replace('text', 'bg'))} aria-hidden="true" />
            {status}
          </span>
        </header>
        <div className={cn('font-mono text-5xl tabular-nums font-semibold', colors.fg)}>
          {score}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-n-500 mt-0.5">
          {language === 'es' ? 'Health Score' : 'Health Score'}
        </span>
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 font-mono tabular-nums text-sm font-semibold',
          colors.fg,
          className,
        )}
      >
        {score}
        <span className="text-[10px] uppercase tracking-eyebrow text-n-500 font-normal">/100</span>
      </span>
    );
  }

  // badge (default)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5',
        'text-xs-mono uppercase tracking-eyebrow font-medium',
        'border',
        colors.bg,
        colors.fg,
        colors.ring.replace('ring', 'border'),
        className,
      )}
      data-testid={`pillar-health-badge-${pillar}`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', colors.fg.replace('text', 'bg'))} aria-hidden="true" />
      {label} · {score}
    </span>
  );
}

export default PillarHealthBadge;
