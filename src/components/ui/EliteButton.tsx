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
    'text-black font-semibold',
    'bg-[linear-gradient(135deg,#D4A017_0%,#E8B42C_100%)]',
    'hover:bg-[linear-gradient(135deg,#E8B42C_0%,#F5C63F_100%)]',
    'focus-visible:ring-[#D4A017]',
    'border border-[rgba(0,0,0,0.12)]',
  ),
  secondary: cn(
    'text-[#D4A017]',
    'bg-transparent',
    'border-elite-gold',
    'hover:text-[#E8B42C] hover:bg-[rgba(212,160,23,0.08)]',
    'focus-visible:ring-[#D4A017]',
  ),
  ghost: cn(
    'text-[#A8A8A8]',
    'bg-transparent',
    'hover:text-[#F5F5F5] hover:bg-[rgba(255,255,255,0.05)]',
    'focus-visible:ring-[#F5F5F5]',
  ),
  wine: cn(
    'text-white font-medium',
    'bg-[linear-gradient(135deg,#722F37_0%,#8B3A45_100%)]',
    'hover:bg-[linear-gradient(135deg,#8B3A45_0%,#9E4452_100%)]',
    'focus-visible:ring-[#722F37]',
    'border border-[rgba(255,255,255,0.08)]',
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
          'rounded-[10px]',
          'transition-[background,color,box-shadow,border-color] duration-200 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#030303]',
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
