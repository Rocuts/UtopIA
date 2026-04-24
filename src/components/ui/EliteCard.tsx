'use client';

import { cn } from '@/lib/utils';
import { motion, useReducedMotion } from 'motion/react';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

/**
 * EliteCard — Versatile container for the elite dashboard.
 *
 *   <EliteCard variant="glass" interactive hover="lift" padding="md">
 *     <EliteCard.Header>...</EliteCard.Header>
 *     <EliteCard.Body>...</EliteCard.Body>
 *     <EliteCard.Footer>...</EliteCard.Footer>
 *   </EliteCard>
 *
 * Variants:
 *  - glass: subtle transparency + blur + soft gold border (`.glass-elite`)
 *  - solid: opaque near-black with hairline border
 *  - bordered: transparent bg with gradient gold→wine ring
 *
 * Interactivity:
 *  - interactive=true enables hover effects. Pick "lift" (translate+glow),
 *    "glow" (only ambient glow), or "none".
 *  - A card with onClick automatically toggles interactive on.
 *
 * Padding unified against design-system spacing tokens:
 *  - none → p-0
 *  - sm   → p-5 (20px, --spacing-5)
 *  - md   → p-7 (28px, --spacing-7)
 *  - lg   → p-9 (36px, --spacing-9)
 */

export type EliteCardVariant = 'glass' | 'solid' | 'bordered';
export type EliteCardHover = 'lift' | 'glow' | 'none';
export type EliteCardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface EliteCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: EliteCardVariant;
  interactive?: boolean;
  hover?: EliteCardHover;
  padding?: EliteCardPadding;
  children?: ReactNode;
}

const VARIANT_CLASSES: Record<EliteCardVariant, string> = {
  glass: 'glass-elite text-n-100',
  solid:
    'bg-n-900 border border-gold-500/20 rounded-lg text-n-100',
  bordered:
    'bg-transparent border-elite-gold rounded-lg text-n-100',
};

const PADDING_CLASSES: Record<EliteCardPadding, string> = {
  none: 'p-0',
  sm: 'p-5',
  md: 'p-7',
  lg: 'p-9',
};

const EliteCardRoot = forwardRef<HTMLDivElement, EliteCardProps>(
  (
    {
      variant = 'glass',
      interactive = false,
      hover = 'lift',
      padding = 'md',
      className,
      children,
      onClick,
      ...rest
    },
    ref,
  ) => {
    const shouldReduce = useReducedMotion();
    const isInteractive = interactive || Boolean(onClick);
    const effectiveHover = isInteractive ? hover : 'none';

    const hoverClasses = (() => {
      if (effectiveHover === 'none' || shouldReduce) return '';
      if (effectiveHover === 'lift') {
        return cn(
          'transition-[transform,box-shadow,border-color] duration-300 ease-out',
          'hover:-translate-y-0.5',
          'hover:shadow-e4',
        );
      }
      return cn(
        'transition-[box-shadow,border-color] duration-300 ease-out',
        'hover:shadow-e4',
      );
    })();

    const interactiveClasses = isInteractive
      ? cn(
          'cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-1000',
        )
      : '';

    const motionProps =
      isInteractive && !shouldReduce && effectiveHover !== 'none'
        ? { whileTap: onClick ? { scale: 0.995 } : undefined }
        : {};

    if (isInteractive) {
      return (
        <motion.div
          ref={ref}
          role={onClick ? 'button' : undefined}
          tabIndex={onClick ? 0 : undefined}
          onClick={onClick}
          onKeyDown={(e) => {
            if (!onClick) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              (onClick as () => void)();
            }
          }}
          className={cn(
            'relative',
            VARIANT_CLASSES[variant],
            PADDING_CLASSES[padding],
            hoverClasses,
            interactiveClasses,
            className,
          )}
          {...motionProps}
          // motion + HTMLAttributes mismatch on event handlers is fine here
          {...(rest as Record<string, unknown>)}
        >
          {children}
        </motion.div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(
          'relative',
          VARIANT_CLASSES[variant],
          PADDING_CLASSES[padding],
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
EliteCardRoot.displayName = 'EliteCard';

const EliteCardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'pb-4 mb-4 border-b border-gold-500/15',
        'font-serif-elite text-xl leading-tight font-normal text-n-100',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  ),
);
EliteCardHeader.displayName = 'EliteCard.Header';

const EliteCardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn('text-base leading-relaxed text-n-300', className)}
      {...rest}
    >
      {children}
    </div>
  ),
);
EliteCardBody.displayName = 'EliteCard.Body';

const EliteCardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'pt-4 mt-4 border-t border-gold-500/15',
        'flex items-center justify-end gap-2',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  ),
);
EliteCardFooter.displayName = 'EliteCard.Footer';

const EliteCard = Object.assign(EliteCardRoot, {
  Header: EliteCardHeader,
  Body: EliteCardBody,
  Footer: EliteCardFooter,
});

export { EliteCard };
