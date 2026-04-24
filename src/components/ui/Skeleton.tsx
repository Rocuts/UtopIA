'use client';

/**
 * Skeleton — base skeleton primitive for the 1+1 Centro de Comando.
 *
 * Design notes:
 *   - Uses tokenized colors (`bg-n-200/60`) so it renders correctly in both
 *     light and dark themes via Tailwind v4 @theme variables in globals.css.
 *   - Respects `prefers-reduced-motion` by dropping the pulse animation and
 *     rendering a static semi-opaque block (WCAG 2.3.3).
 *   - For the heavier gold-shimmer aesthetic see `ShimmerLoader`; this
 *     primitive is the quieter, workspace-level skeleton.
 *
 * Accessibility:
 *   - `role="status"`, `aria-busy`, `aria-live="polite"` so screen readers
 *     announce load state once.
 *   - Includes a `<span class="sr-only">Cargando…</span>` fallback.
 */

import { useReducedMotion } from 'motion/react';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional aria-label override (default: "Cargando"). */
  srLabel?: string;
}

/**
 * Base skeleton block. Default shape is a rounded rectangle; pass `rounded-*`
 * or explicit width/height utilities via `className` to compose.
 */
export function Skeleton({
  className,
  srLabel = 'Cargando…',
  ...rest
}: SkeletonProps) {
  const reduced = useReducedMotion();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn(
        'rounded-sm',
        'bg-n-200/60',
        reduced ? 'opacity-70' : 'animate-pulse',
        className,
      )}
      {...rest}
    >
      <span className="sr-only">{srLabel}</span>
    </div>
  );
}
