'use client';

/**
 * PageSkeleton — page-level loading placeholder for pillar workspace routes.
 *
 * Mimics the structure of a pillar page:
 *   - Header zone: eyebrow + title + description
 *   - Hero text zone: 3 body lines
 *   - Cards grid: 4 SkeletonCards in a responsive 2-column grid
 *
 * Uses only tokenized colors (`bg-n-*`, `border-gold-*`) so it renders
 * correctly in both light and dark themes via the n-0..n-1000 adaptive scale.
 *
 * Reduced-motion behaviour is inherited from the underlying Skeleton primitive
 * (via `useReducedMotion` in motion/react). No manual `motion-safe:` rules needed.
 *
 * Accessibility:
 *   - Outer wrapper carries `role="status"` + `aria-label` for screen readers.
 *   - Inner Skeleton blocks are already individually aria-annotated.
 */

import { Skeleton } from './Skeleton';
import { SkeletonCard } from './SkeletonCard';
import { SkeletonText } from './SkeletonText';
import { cn } from '@/lib/utils';

export interface PageSkeletonProps {
  /** Accessible label announced by screen readers. */
  srLabel?: string;
  /** Additional classes for the outer wrapper. */
  className?: string;
}

export function PageSkeleton({
  srLabel = 'Cargando página…',
  className,
}: PageSkeletonProps) {
  return (
    <div
      role="status"
      aria-label={srLabel}
      className={cn('p-6 md:p-8 flex flex-col gap-8', className)}
    >
      {/* ── Header zone ── */}
      <div className="flex flex-col gap-3">
        {/* Eyebrow: small label above the title */}
        <Skeleton className="h-3 w-28" srLabel="" />
        {/* Title: large heading */}
        <Skeleton className="h-7 w-2/5" srLabel="" />
        {/* Description: medium subtitle */}
        <Skeleton className="h-4 w-3/5" srLabel="" />
      </div>

      {/* ── Hero text zone: 3 body lines ── */}
      <SkeletonText lines={3} size="md" lastShort />

      {/* ── Cards grid: 4 card placeholders ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SkeletonCard lines={2} showEyebrow showFooter={false} />
        <SkeletonCard lines={2} showEyebrow showFooter={false} />
        <SkeletonCard lines={2} showEyebrow showFooter={false} />
        <SkeletonCard lines={2} showEyebrow showFooter={false} />
      </div>

      {/* SR-only node so the outermost status role has a text fallback */}
      <span className="sr-only">{srLabel}</span>
    </div>
  );
}

export default PageSkeleton;
