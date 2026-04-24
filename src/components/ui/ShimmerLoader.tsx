'use client';

import { cn } from '@/lib/utils';
import { useReducedMotion } from 'motion/react';
import type { CSSProperties, HTMLAttributes } from 'react';

/**
 * ShimmerLoader — Skeleton with subtle gold shimmer for the elite theme.
 *
 * The shimmer keyframe is inlined so it works without requiring changes to
 * globals.css (which is locked for this agent). In reduced-motion it stays
 * static with a soft gradient background.
 *
 * Variants:
 *  - text: small rounded block, line-height friendly
 *  - block: generic rectangle
 *  - circle: avatar / dot shape (width === height)
 */

export type ShimmerVariant = 'text' | 'block' | 'circle';

export interface ShimmerLoaderProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  width?: number | string;
  height?: number | string;
  variant?: ShimmerVariant;
  radius?: number | string;
}

const KEYFRAME_STYLE = `
@keyframes elite-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
`;

export function ShimmerLoader({
  width = '100%',
  height = 16,
  variant = 'block',
  radius,
  className,
  style,
  ...rest
}: ShimmerLoaderProps) {
  const shouldReduce = useReducedMotion();

  const resolvedRadius =
    radius ??
    (variant === 'circle' ? '9999px' : variant === 'text' ? '4px' : '6px');

  const baseStyle: CSSProperties = {
    width,
    height: variant === 'circle' ? width : height,
    borderRadius: resolvedRadius,
    background: shouldReduce
      ? 'linear-gradient(90deg, rgba(212, 160, 23, 0.08), rgba(212, 160, 23, 0.14), rgba(212, 160, 23, 0.08))'
      : 'linear-gradient(90deg, rgba(18, 18, 18, 0.6) 0%, rgba(212, 160, 23, 0.12) 45%, rgba(212, 160, 23, 0.22) 50%, rgba(212, 160, 23, 0.12) 55%, rgba(18, 18, 18, 0.6) 100%)',
    backgroundSize: shouldReduce ? '100% 100%' : '200% 100%',
    animation: shouldReduce ? undefined : 'elite-shimmer 1.8s ease-in-out infinite',
    ...(style ?? {}),
  };

  return (
    <>
      {!shouldReduce && (
        <style dangerouslySetInnerHTML={{ __html: KEYFRAME_STYLE }} />
      )}
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className={cn(
          'inline-block overflow-hidden',
          'border border-[rgba(212,160,23,0.12)]',
          className,
        )}
        style={baseStyle}
        {...rest}
      >
        <span className="sr-only">Cargando…</span>
      </div>
    </>
  );
}
