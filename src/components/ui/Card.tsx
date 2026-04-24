'use client';

import { cn } from '@/lib/utils';
import {
  createContext,
  forwardRef,
  useContext,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { GlassPanel } from './GlassPanel';

/**
 * Card — unified container covering both the landing-page GlassPanel look and
 * the elite dashboard surfaces previously in `EliteCard`.
 *
 *   <Card hoverEffect elevated>…</Card>                     // legacy base API
 *   <Card variant="glass" padding="lg">…</Card>             // elite: gold border glass
 *   <Card variant="bordered" interactive onClick={…}>…</Card>
 *
 * Variants:
 *  - `default`: landing GlassPanel (white/light panel, optional hover tint).
 *  - `glass`: translucent dark glass + gold border (`.glass-elite`).
 *  - `solid`: opaque near-black + subtle gold border.
 *  - `bordered`: transparent bg + gradient gold→wine ring.
 *
 * Subcomponents pick their styling from parent `variant` via context, so
 * `<Card.Header>` emits the warm light-theme border inside a `default` Card
 * and the serif-elite header inside a `glass/solid/bordered` Card.
 */
export type CardVariant = 'default' | 'glass' | 'solid' | 'bordered';
export type CardHover = 'lift' | 'glow' | 'none';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  /** Base variant only: enables hover tint on the GlassPanel */
  hoverEffect?: boolean;
  /** Base variant only: renders with shadow-sm */
  elevated?: boolean;
  /** Elite variants only: toggles pointer/keyboard affordance */
  interactive?: boolean;
  /** Elite variants only: hover behavior (lift/glow/none) */
  hover?: CardHover;
  /** Elite variants only: padding scale (none/sm/md/lg). Base uses fixed padding. */
  padding?: CardPadding;
  children?: ReactNode;
}

const ELITE_VARIANT_CLASSES: Record<Exclude<CardVariant, 'default'>, string> = {
  glass: 'glass-elite text-n-100',
  solid: 'bg-n-900 border border-gold-500/20 rounded-lg text-n-100',
  bordered: 'bg-transparent border-elite-gold rounded-lg text-n-100',
};

const ELITE_PADDING_CLASSES: Record<CardPadding, string> = {
  none: 'p-0',
  sm: 'p-5',
  md: 'p-7',
  lg: 'p-9',
};

const CardVariantContext = createContext<CardVariant>('default');

const CardBase = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      children,
      variant = 'default',
      hoverEffect = true,
      elevated = false,
      interactive = false,
      hover = 'lift',
      padding = 'md',
      onClick,
      ...props
    },
    ref,
  ) => {
    const shouldReduce = useReducedMotion();

    // Base (landing) path — identical to the pre-merge Card.tsx wrapping GlassPanel.
    if (variant === 'default') {
      return (
        <CardVariantContext.Provider value={variant}>
          <GlassPanel
            ref={ref}
            hoverEffect={hoverEffect}
            elevated={elevated}
            onClick={onClick}
            className={cn('p-5 sm:p-7 flex flex-col gap-4', className)}
            {...props}
          >
            {children}
          </GlassPanel>
        </CardVariantContext.Provider>
      );
    }

    // Elite path — visuals ported from EliteCard, including the motion affordance
    // when interactive or onClick is wired.
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
      return cn('transition-[box-shadow,border-color] duration-300 ease-out', 'hover:shadow-e4');
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
        <CardVariantContext.Provider value={variant}>
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
              ELITE_VARIANT_CLASSES[variant],
              ELITE_PADDING_CLASSES[padding],
              hoverClasses,
              interactiveClasses,
              className,
            )}
            {...motionProps}
            // motion + HTMLAttributes mismatch on event handlers is intentional here;
            // preserved from the pre-merge EliteCard implementation.
            {...(props as Record<string, unknown>)}
          >
            {children}
          </motion.div>
        </CardVariantContext.Provider>
      );
    }

    return (
      <CardVariantContext.Provider value={variant}>
        <div
          ref={ref}
          className={cn(
            'relative',
            ELITE_VARIANT_CLASSES[variant],
            ELITE_PADDING_CLASSES[padding],
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </CardVariantContext.Provider>
    );
  },
);
CardBase.displayName = 'Card';

// Subcomponents adapt their styling based on the parent Card's variant.
const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...rest }, ref) => {
    const variant = useContext(CardVariantContext);
    if (variant === 'default') {
      return (
        <div ref={ref} className={cn('pb-4 border-b border-n-200', className)} {...rest}>
          {children}
        </div>
      );
    }
    return (
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
    );
  },
);
CardHeader.displayName = 'Card.Header';

const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...rest }, ref) => {
    const variant = useContext(CardVariantContext);
    if (variant === 'default') {
      return (
        <div ref={ref} className={cn('py-4', className)} {...rest}>
          {children}
        </div>
      );
    }
    return (
      <div ref={ref} className={cn('text-base leading-relaxed text-n-300', className)} {...rest}>
        {children}
      </div>
    );
  },
);
CardBody.displayName = 'Card.Body';

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...rest }, ref) => {
    const variant = useContext(CardVariantContext);
    if (variant === 'default') {
      return (
        <div ref={ref} className={cn('pt-4 border-t border-n-200', className)} {...rest}>
          {children}
        </div>
      );
    }
    return (
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
    );
  },
);
CardFooter.displayName = 'Card.Footer';

const Card = Object.assign(CardBase, {
  Header: CardHeader,
  Body: CardBody,
  Footer: CardFooter,
});

export { Card };
