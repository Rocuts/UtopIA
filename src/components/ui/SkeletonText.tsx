'use client';

/**
 * SkeletonText — multi-line text placeholder.
 *
 * Last line is shorter (~70%) to mimic natural text wrap. Heights match the
 * common text-sm (14px) / text-base (16px) line heights in the workspace.
 */

import type { HTMLAttributes } from 'react';
import { Skeleton } from './Skeleton';
import { cn } from '@/lib/utils';

export interface SkeletonTextProps extends HTMLAttributes<HTMLDivElement> {
  /** Number of shimmer lines to render. Defaults to 3. */
  lines?: number;
  /** Line height. Defaults to "sm" (12px). */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to shorten the last line. Defaults to true. */
  lastShort?: boolean;
}

const SIZE_HEIGHT: Record<NonNullable<SkeletonTextProps['size']>, string> = {
  sm: 'h-3',
  md: 'h-3.5',
  lg: 'h-4',
};

export function SkeletonText({
  lines = 3,
  size = 'sm',
  lastShort = true,
  className,
  ...rest
}: SkeletonTextProps) {
  const count = Math.max(1, Math.floor(lines));
  const heightCls = SIZE_HEIGHT[size];

  return (
    <div className={cn('flex flex-col gap-2', className)} {...rest}>
      {Array.from({ length: count }).map((_, i) => {
        const isLast = i === count - 1;
        const shorten = lastShort && isLast && count > 1;
        return (
          <Skeleton
            key={i}
            className={cn(heightCls, shorten ? 'w-2/3' : 'w-full')}
          />
        );
      })}
    </div>
  );
}
