'use client';

/**
 * AreaShell — shared scroll/ambient-glow wrapper for the 4 pillar pages
 * (Escudo, Valor, Verdad, Futuro).
 *
 * Background matches the handoff `assets/module.css` pattern:
 *   radial-gradient(1200px 700px at 84% -14%, color-mix(in srgb,var(--ac) 24%, transparent), transparent 58%),
 *   linear-gradient(180deg, color-mix(in srgb,var(--ac) 8%, var(--n-0)), var(--n-0) 320px),
 *   color-mix(in srgb, var(--ac) 9%, var(--n-0))
 *
 * FX layer (AreaFX) renders per-area particle behavior + accent blobs + cursor
 * spotlight, mirroring fx.js behaviors: escudo/valor/verdad/futuro.
 */
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { AreaFX } from '../AreaFX';

export type AreaAccent = 'escudo' | 'valor' | 'verdad' | 'futuro' | 'pyme';

// CSS variable per area — matching globals.css @theme tokens
const AREA_CSS_VAR: Record<AreaAccent, string> = {
  escudo: 'var(--color-area-escudo, #A83838)',
  valor:  'var(--color-gold-500, #B8934A)',
  verdad: 'var(--color-area-verdad, #3D6B7E)',
  futuro: 'var(--color-area-futuro, #5A7F7A)',
  pyme:   'var(--color-area-pyme, #357A28)',
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
  const ac = AREA_CSS_VAR[areaAccent];

  // Exact module.css pattern — pinkish/tinted base + radial accent gradient
  const bg: CSSProperties = {
    background: [
      `radial-gradient(1200px 700px at 84% -14%, color-mix(in srgb, ${ac} 24%, transparent), transparent 58%)`,
      `linear-gradient(180deg, color-mix(in srgb, ${ac} 8%, var(--color-n-0, #FCFBF8)), var(--color-n-0, #FCFBF8) 320px)`,
      `color-mix(in srgb, ${ac} 9%, var(--color-n-0, #FCFBF8))`,
    ].join(', '),
  };

  return (
    <div
      className={cn(
        'relative w-full min-h-full overflow-y-auto',
        'text-n-900',
        className,
      )}
      style={bg}
    >
      {/* Per-area FX: rising/floating particles + animated blobs + cursor spotlight */}
      <AreaFX area={areaAccent} />

      {contained ? (
        <div className="relative z-[2] max-w-[1240px] mx-auto px-6 md:px-10 pt-8 pb-24">
          {children}
        </div>
      ) : (
        <div className="relative z-[2]">{children}</div>
      )}
    </div>
  );
}

export default AreaShell;
