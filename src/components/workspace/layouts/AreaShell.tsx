'use client';

/**
 * AreaShell — shared scroll/ambient-glow wrapper for the 4 pillar pages
 * (Escudo, Valor, Verdad, Futuro).
 *
 * Consolidates what used to live per-page (ambient radial gradients, the
 * `max-w-[1240px]` centered content column, `bg-n-1000` / `text-n-100`
 * dark-only classes). Theme is now owned by `<ThemeProvider>` on <html>;
 * this component does NOT set `data-theme`.
 *
 * Palette note: tint values mirror `AREA_PALETTES` in AreaCard.tsx; they
 * reference the same CSS tokens (gold-500 for valor, area-{escudo,verdad,
 * futuro} for the others). Duplicated inline because AreaCard does not
 * export the constant.
 */
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type AreaAccent = 'escudo' | 'valor' | 'verdad' | 'futuro';

// Two-orb compositions — primary glow (top-right), secondary glow (mid-left).
// Colors expressed via CSS vars so light/dark modes resolve the same brand
// palette (dark surfaces amplify glow; light surfaces keep orbs subtle).
interface AmbientTint {
  primary: string;
  secondary: string;
  primaryOpacity: string;
  secondaryOpacity: string;
}

const AREA_AMBIENT: Record<AreaAccent, AmbientTint> = {
  escudo: {
    primary:
      'radial-gradient(circle, rgba(114,47,55,0.40) 0%, rgba(114,47,55,0) 70%)',
    secondary:
      'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.30) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
    primaryOpacity: '0.30',
    secondaryOpacity: '0.20',
  },
  valor: {
    primary:
      'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.45) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
    secondary:
      'radial-gradient(circle, rgba(232,180,44,0.35) 0%, rgba(232,180,44,0) 70%)',
    primaryOpacity: '0.35',
    secondaryOpacity: '0.25',
  },
  verdad: {
    primary:
      'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.35) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
    secondary:
      'radial-gradient(circle, rgba(114,47,55,0.30) 0%, rgba(114,47,55,0) 70%)',
    primaryOpacity: '0.28',
    secondaryOpacity: '0.20',
  },
  futuro: {
    primary:
      'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.40) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
    secondary:
      'radial-gradient(circle, rgba(114,47,55,0.30) 0%, rgba(114,47,55,0) 70%)',
    primaryOpacity: '0.30',
    secondaryOpacity: '0.20',
  },
};

interface AreaShellProps {
  areaAccent: AreaAccent;
  children: ReactNode;
  className?: string;
  /** When true, render the full 1240px column. Keep true for overview pages. */
  contained?: boolean;
}

export function AreaShell({
  areaAccent,
  children,
  className,
  contained = true,
}: AreaShellProps) {
  const tint = AREA_AMBIENT[areaAccent];

  const primaryStyle: CSSProperties = {
    background: tint.primary,
    opacity: tint.primaryOpacity,
  };
  const secondaryStyle: CSSProperties = {
    background: tint.secondary,
    opacity: tint.secondaryOpacity,
  };

  return (
    <div
      className={cn(
        'relative w-full min-h-full overflow-y-auto',
        'bg-n-0 text-n-900',
        className,
      )}
    >
      {/* Ambient orbs — purely decorative, pointer-events-none so they don't
          block interaction with content above. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[20%] -right-[10%] w-[620px] h-[620px] rounded-full blur-[130px]"
          style={primaryStyle}
        />
        <div
          className="absolute top-[35%] -left-[12%] w-[520px] h-[520px] rounded-full blur-[140px]"
          style={secondaryStyle}
        />
      </div>

      {contained ? (
        <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-8 pb-24">
          {children}
        </div>
      ) : (
        <div className="relative z-[1]">{children}</div>
      )}
    </div>
  );
}

export default AreaShell;
