'use client';

import { cn } from '@/lib/utils';
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { Loader2 } from 'lucide-react';

/**
 * Button — unified primitive covering both the landing (light) variants and
 * the elite command-center variants previously in `EliteButton`.
 *
 *   <Button variant="primary">…</Button>          // light CTA
 *   <Button variant="elite" loading>…</Button>    // premium gold, motion + spinner
 *   <Button variant="wine" rightIcon={<X />}>…</Button>
 *
 * The component picks its rendering path based on `variant`:
 *  - `elite` / `wine`: motion.button with hover/tap springs, gated by
 *    `useReducedMotion`. Adds optional loading state and left/right icons.
 *  - everything else: plain <button> (no motion), identical to the original
 *    landing-page Button. Loading + icons still work on the plain path for
 *    consumer ergonomics, but `elevated`/`glow` only render on motion variants.
 *
 * Alias `EliteButton` in ./EliteButton re-exports this component unchanged.
 */
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'accent'
  | 'danger'
  | 'elite'
  | 'wine';
export type ButtonSize = 'sm' | 'md' | 'lg';

type PlainButtonAttrs = ButtonHTMLAttributes<HTMLButtonElement>;
type MotionButtonAttrs = Omit<HTMLMotionProps<'button'>, 'children'>;

// Shared prop surface covers the union of both call sites. Specific rendering
// path narrows the spread type at the boundary.
export interface ButtonProps
  extends Omit<PlainButtonAttrs, 'children'>,
    Omit<MotionButtonAttrs, keyof PlainButtonAttrs> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Elite/wine only: show ambient gold / wine glow */
  elevated?: boolean;
  /** Elite/wine only: alias for `elevated`, kept for ergonomic naming */
  glow?: boolean;
  /** Show spinner and block interactions */
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children?: ReactNode;
}

const ELITE_VARIANT_CLASSES: Record<'elite' | 'wine' | 'secondary' | 'ghost', string> = {
  // Elite/wine/secondary/ghost behaviors ported verbatim from EliteButton so
  // visuals match the premium command-center look when used inside
  // data-theme="elite" subtrees.
  elite: cn(
    'text-n-1000 font-semibold',
    'bg-gold-500 hover:bg-gold-600',
    'focus-visible:ring-gold-500',
    'border border-n-1000/10',
  ),
  wine: cn(
    'text-n-0 font-medium',
    'bg-danger hover:bg-danger/90',
    'focus-visible:ring-danger',
    'border border-n-0/10',
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
};

const ELITE_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-12 px-7 text-base gap-2.5',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
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
    const isDisabled = disabled || loading;

    // Elite family: render the motion button with the EliteButton visual contract.
    if (variant === 'elite' || variant === 'wine') {
      const eliteKey = variant; // narrow
      const isGlowing = elevated || glow;
      const glowClass = isGlowing
        ? eliteKey === 'wine'
          ? 'glow-wine'
          : 'glow-gold-soft'
        : '';

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
            ELITE_VARIANT_CLASSES[eliteKey],
            ELITE_SIZE_CLASSES[size],
            glowClass,
            className,
          )}
          {...(props as MotionButtonAttrs)}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
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
    }

    // Elite-styled secondary/ghost (used by modal/wine family in revisoría, dictámenes, etc.
    // but invoked via EliteButton — so they still route here). The base Button
    // variants below cover landing/marketing pages unchanged.
    if (
      (variant === 'secondary' || variant === 'ghost') &&
      (loading || leftIcon || rightIcon || elevated || glow)
    ) {
      const eliteKey = variant; // secondary | ghost
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
            ELITE_VARIANT_CLASSES[eliteKey],
            ELITE_SIZE_CLASSES[size],
            className,
          )}
          {...(props as MotionButtonAttrs)}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
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
    }

    // Plain variants (landing light theme). Preserves original Button visuals
    // byte-for-byte so Hero/CTA/Services do not regress.
    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-sm text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-n-900 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-n-900 text-n-0 hover:bg-n-700': variant === 'primary',
            'bg-n-0 text-n-900 border border-n-200 hover:bg-n-50 hover:border-n-300':
              variant === 'secondary',
            'bg-transparent text-n-600 hover:bg-n-50 hover:text-n-900': variant === 'ghost',
            'bg-gold-500 text-n-0 hover:bg-gold-600 focus-visible:ring-gold-500':
              variant === 'accent',
            'bg-danger text-n-0 hover:bg-danger/90 focus-visible:ring-danger':
              variant === 'danger',
            'h-8 px-3 text-xs': size === 'sm',
            'h-10 px-5': size === 'md',
            'h-12 px-8 text-base': size === 'lg',
          },
          className,
        )}
        {...(props as PlainButtonAttrs)}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          leftIcon && (
            <span className="mr-2 shrink-0 inline-flex items-center" aria-hidden="true">
              {leftIcon}
            </span>
          )
        )}
        {children}
        {!loading && rightIcon && (
          <span className="ml-2 shrink-0 inline-flex items-center" aria-hidden="true">
            {rightIcon}
          </span>
        )}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button };
