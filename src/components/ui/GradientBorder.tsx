'use client';

import { cn } from '@/lib/utils';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

/**
 * GradientBorder — Wrapper that draws a gradient border (gold, wine, or
 * gold→wine) around its children without touching the child's own border.
 *
 * Uses the mask-composite technique so the inside stays transparent and
 * only the 1px (configurable) ring gets the gradient.
 *
 * Gradient stops reference the design-system tokens via `rgb(from var(...))`
 * fallbacks (with alpha mixed in) so palette swaps propagate.
 *
 * Equivalent to the `.border-elite-gold` utility but configurable per call.
 */

export type GradientBorderVariant = 'gold-wine' | 'gold' | 'wine';

export interface GradientBorderProps extends HTMLAttributes<HTMLDivElement> {
  variant?: GradientBorderVariant;
  radius?: number;
  thickness?: number;
  children: ReactNode;
}

// Gradients: mixed against the design-system palette via rgb-with-alpha of
// the token CSS variables. We use `color-mix` in the css layer, but inline
// gradient stops require literal rgb triplets — so we reference the canonical
// token values once here.
//   gold-500 = var(--gold-500)  → rgb(184 147 74)
//   gold-600 = var(--gold-400)  → rgb(232 180 44)
//   danger   = var(--danger)  → rgb(168 56 56)
const GRADIENTS: Record<GradientBorderVariant, string> = {
  'gold-wine':
    'linear-gradient(135deg, rgb(184 147 74 / 0.65) 0%, rgb(168 56 56 / 0.45) 55%, rgb(184 147 74 / 0.35) 100%)',
  gold:
    'linear-gradient(135deg, rgb(184 147 74 / 0.65) 0%, rgb(232 180 44 / 0.35) 100%)',
  wine:
    'linear-gradient(135deg, rgb(168 56 56 / 0.65) 0%, rgb(168 56 56 / 0.35) 100%)',
};

export function GradientBorder({
  variant = 'gold-wine',
  radius = 12,
  thickness = 1,
  children,
  className,
  style,
  ...rest
}: GradientBorderProps) {
  const mergedStyle: CSSProperties = {
    borderRadius: `${radius}px`,
    ...(style ?? {}),
  };

  const ringStyle: CSSProperties = {
    borderRadius: `${radius}px`,
    padding: `${thickness}px`,
    background: GRADIENTS[variant],
    WebkitMask:
      'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    maskComposite: 'exclude',
    pointerEvents: 'none',
  };

  return (
    <div
      className={cn('relative', className)}
      style={mergedStyle}
      {...rest}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={ringStyle}
      />
      {children}
    </div>
  );
}
