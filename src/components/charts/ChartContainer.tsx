'use client';

/**
 * ChartContainer — wrapper común para todos los widgets ECharts del Command
 * Center. Provee:
 *   - shell visual consistente (Card variant glass + header)
 *   - estados loading / empty con esqueletos premium
 *   - control de altura
 *   - opción de density (compact reduce paddings y altura)
 *
 * El componente es server-safe (renderiza estructura) pero los widgets
 * descendientes deben ser client (`'use client'` en sus archivos propios).
 */

import { Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

export interface ChartContainerProps {
  title: string;
  subtitle?: string;
  height?: number | string;
  density?: 'comfortable' | 'compact';
  loading?: boolean;
  empty?: boolean;
  emptyLabel?: string;
  /** Indicador en la esquina sup-derecha (e.g. "Inferred", "Real-time"). */
  badge?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function ChartContainer({
  title,
  subtitle,
  height = 320,
  density = 'comfortable',
  loading = false,
  empty = false,
  emptyLabel,
  badge,
  className,
  children,
}: ChartContainerProps) {
  const padding = density === 'compact' ? 'sm' : 'md';
  const numericHeight = typeof height === 'number' ? `${height}px` : height;

  return (
    <Card variant="glass" padding={padding} className={cn('flex flex-col', className)}>
      <header className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-serif-elite text-base font-normal text-n-1000 tracking-tight">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-xs text-n-700 leading-relaxed">{subtitle}</p>
          )}
        </div>
        {badge && (
          <div className="shrink-0 font-mono text-xs-mono uppercase tracking-eyebrow text-gold-600">
            {badge}
          </div>
        )}
      </header>

      <div
        className="relative flex-1 min-h-0"
        style={{ height: numericHeight }}
        data-testid="chart-canvas-container"
      >
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-n-500">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </div>
        ) : empty ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-n-500">
            {emptyLabel ?? 'Sin datos para visualizar'}
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

export default ChartContainer;
