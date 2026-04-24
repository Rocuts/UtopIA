'use client';

/**
 * SkeletonKpi — KPI-tile-shaped placeholder.
 *
 * Mirrors the AreaCard / PremiumKpiCard layout:
 *   Row 1: status dot + area label + icon
 *   Row 2: title + short subtitle
 *   Row 3: hero number + sparkline stub + delta chip
 *
 * The sparkline stub is a flat rounded strip so users get a sense of the
 * eventual shape without any animation distraction while data loads.
 */

import type { HTMLAttributes } from 'react';
import { Skeleton } from './Skeleton';
import { cn } from '@/lib/utils';

export interface SkeletonKpiProps extends HTMLAttributes<HTMLDivElement> {
  /** Hide the sparkline strip (defaults to visible). */
  hideSparkline?: boolean;
  /** Hide the right-side trend chip (defaults to visible). */
  hideTrend?: boolean;
}

export function SkeletonKpi({
  hideSparkline = false,
  hideTrend = false,
  className,
  ...rest
}: SkeletonKpiProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-3 rounded-md border border-n-200/60 bg-n-0/40 p-5',
        'min-h-[180px]',
        className,
      )}
      {...rest}
    >
      {/* Row 1: dot + eyebrow + icon slot */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-5 w-5 rounded" />
      </div>

      {/* Row 2: title + subtitle */}
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>

      {/* Row 3: hero number + sparkline + trend chip */}
      <div className="mt-auto flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-3 w-14" />
        </div>
        {!hideSparkline && <Skeleton className="h-6 w-16 rounded" />}
        {!hideTrend && <Skeleton className="h-5 w-12 rounded-full" />}
      </div>
    </div>
  );
}
