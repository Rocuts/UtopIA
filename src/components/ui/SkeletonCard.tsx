'use client';

/**
 * SkeletonCard — card-shaped placeholder matching EliteCard dimensions.
 *
 * Mimics the common EliteCard layout:
 *   ┌──────────────────────────────────┐
 *   │  eyebrow                         │
 *   │  title title title               │
 *   │  description text spanning wide  │
 *   │  description text shorter        │
 *   │                                  │
 *   │  [footer row]                    │
 *   └──────────────────────────────────┘
 *
 * Styled to echo EliteCard's outer chrome (rounded corners, subtle border)
 * without requiring the EliteCard component itself (avoids circular imports
 * during skeleton rendering inside EliteCard children).
 */

import type { HTMLAttributes } from 'react';
import { Skeleton } from './Skeleton';
import { SkeletonText } from './SkeletonText';
import { cn } from '@/lib/utils';

export interface SkeletonCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Number of body description lines. */
  lines?: number;
  /** Render a short label/eyebrow row above the title. */
  showEyebrow?: boolean;
  /** Render a footer row (used for metric cards / chips). */
  showFooter?: boolean;
  /** Minimum height (matches AreaCard/EliteCard defaults). */
  minH?: string;
}

export function SkeletonCard({
  lines = 2,
  showEyebrow = true,
  showFooter = false,
  minH = 'min-h-[160px]',
  className,
  ...rest
}: SkeletonCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-md border border-n-200/60 bg-n-0/40 p-5',
        minH,
        className,
      )}
      {...rest}
    >
      {showEyebrow && <Skeleton className="h-3 w-24" />}
      <Skeleton className="h-5 w-3/5" />
      <SkeletonText lines={lines} size="sm" />
      {showFooter && (
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      )}
    </div>
  );
}
