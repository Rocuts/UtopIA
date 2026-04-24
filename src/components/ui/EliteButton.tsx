'use client';

import { cn } from '@/lib/utils';
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { forwardRef, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * EliteButton — Premium button primitive for the 1+1 Elite Command Center.
 *
 * Variants:
 *  - primary: gold gradient, black text (main CTA)
 *  - secondary: transparent with gold gradient border, gold text
 *  - ghost: no bg, subtle text, hover illuminates
 *  - wine: wine gradient, white text (destructive / alternate CTA)
 *
 * Flags:
 *  - elevated: adds a premium glow (gold or wine depending on variant)
 *  - glow: same as elevated, kept for ergonomic naming
 *  - loading: shows spinner, disables click
 *
 * Consumable in both light and elite subtrees — it ships its own colors so
 * it never depends on CSS vars that may or may not be themed.
 */

export type EliteButtonVariant = 'primary' | 'secondary' | 'ghost' | 'wine';
export type EliteButtonSize = 'sm' | 'md' | 'lg';

export interface EliteButtonProps
  extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: EliteButtonVariant;
  size?: EliteButtonSize;
  elevated?: boolean;
  glow?: boolean;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children?: ReactNode;
}

const VARIANT_CLASSES: Record<EliteButtonVariant, string> = {
  primary: cn(
    'text-n-1000 font-semibold',
    'bg-gold-500 hover:bg-gold-600',
    'focus-visible:ring-gold-500',
    'border border-n-1000/10',
  ),
  secondary: cn(
    'text-gold-500',
    'bg-transparent',
    'border-elite-gold',
    'hover:text-gold-600 hover:bg-gold-500/10',
    'focus-visible:ring-gold-500',
  ),
  ghost: cn(
    'text-n-400',
    'bg-transparent',
    'hover:text-n-100 hover:bg-n-0/5',
    'focus-visible:ring-n-100',
  ),
  wine: cn(
    'text-n-0 font-medium',
    'bg-danger hover:bg-danger/90',
    'focus-visible:ring-danger',
    'border border-n-0/10',
  ),
};

const SIZE_CLASSES: Record<EliteButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-12 px-7 text-base gap-2.5',
};

const EliteButton = forwardRef<HTMLButtonElement, EliteButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      elevated = false,
      glow = false,
      loading = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const shouldReduce = useReducedMotion();
    const isGlowing = elevated || glow;
    const glowClass = isGlowing
      ? variant === 'wine'
        ? 'glow-wine'
        : 'glow-gold-soft'
      : '';

    const isDisabled = disabled || loading;

    return (
      <motion.button
        ref={ref}
        whileHover={shouldReduce || isDisabled ? undefined : { y: -1 }}
        whileTap={shouldReduce || isDisabled ? undefined : { scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={cn(
          'relative inline-flex items-center justify-center whitespace-nowrap',
          'rounded-lg',
          'transition-[background,color,box-shadow,border-color] duration-200 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-n-1000',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          glowClass,
          className,
        )}
        {...props}
      >
        {loading ? (
          <Loader2
            className="h-4 w-4 animate-spin"
            aria-hidden="true"
          />
        ) : (
          leftIcon && (
            <span className="shrink-0 inline-flex items-center" aria-hidden="true">
              {leftIcon}
            </span>
          )
        )}
        {children != null && <span className="truncate">{children}</span>}
        {!loading && rightIcon && (
          <span className="shrink-0 inline-flex items-center" aria-hidden="true">
            {rightIcon}
          </span>
        )}
      </motion.button>
    );
  },
);
EliteButton.displayName = 'EliteButton';

export { EliteButton };
