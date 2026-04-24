import { cn } from '@/lib/utils';
import { HTMLAttributes, forwardRef } from 'react';

/**
 * GlassPanel — Base surface that adapts to the active theme.
 *
 *  - In the default (light) theme: keeps the original white-panel look
 *    (bg: #fff, 1px neutral border, optional hover tint). Landing page
 *    components continue to render unchanged.
 *  - In the elite theme (subtree with `data-theme='elite'`): switches to
 *    a proper glass surface (backdrop-blur, translucent dark bg, subtle
 *    gold border) via the `.glass-elite` utility defined in globals.css.
 *
 * The `variant` prop lets a caller force one or the other regardless of
 * theme (`'light'` or `'elite'`). Default `'auto'` lets CSS pick based
 * on the `[data-theme='elite']` ancestor.
 */
export type GlassPanelVariant = 'auto' | 'light' | 'elite';

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  hoverEffect?: boolean;
  elevated?: boolean;
  variant?: GlassPanelVariant;
}

const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  (
    {
      className,
      hoverEffect = false,
      elevated = false,
      variant = 'auto',
      ...props
    },
    ref,
  ) => {
    // Force-elite path: always the glass look, independent of ancestor theme.
    if (variant === 'elite') {
      return (
        <div
          ref={ref}
          className={cn(
            'glass-elite rounded-[12px]',
            {
              'transition-[box-shadow,border-color] duration-200 hover:shadow-[0_0_32px_rgba(212,160,23,0.22)]':
                hoverEffect,
              'shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)]': elevated,
            },
            className,
          )}
          {...props}
        />
      );
    }

    // Force-light path: original landing behavior, ignores any elite ancestor.
    if (variant === 'light') {
      return (
        <div
          ref={ref}
          className={cn(
            'bg-white border border-[#e5e5e5] rounded-sm',
            {
              'transition-colors duration-100 hover:border-[#d4d4d4] hover:bg-[#fafafa]':
                hoverEffect,
              'shadow-sm': elevated,
            },
            className,
          )}
          {...props}
        />
      );
    }

    // Auto path (default):
    //   - Base classes match the original light panel so landing components
    //     look identical.
    //   - Inside `[data-theme='elite']`, the `.glass-panel` selector in
    //     globals.css overrides the surface with the dark glass look — so
    //     we tag the element with `glass-panel` as well. The CSS layering
    //     already handles priorities: the elite `.glass-panel` rule wins
    //     inside the scoped subtree.
    return (
      <div
        ref={ref}
        className={cn(
          'glass-panel bg-white border border-[#e5e5e5] rounded-sm',
          {
            'transition-colors duration-100 hover:border-[#d4d4d4] hover:bg-[#fafafa]':
              hoverEffect,
            'shadow-sm': elevated,
          },
          className,
        )}
        {...props}
      />
    );
  },
);
GlassPanel.displayName = 'GlassPanel';

export { GlassPanel };
