'use client';

import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

/**
 * SectionHeader — Premium section header with eyebrow + serif title +
 * optional subtitle + optional gradient divider. Used across the
 * Executive Dashboard and the four Windows (Escudo, Valor, Verdad, Futuro).
 *
 *   <SectionHeader
 *     eyebrow="Resiliencia"
 *     title="El Escudo"
 *     subtitle="Estrategia Tributaria y Legal"
 *     align="left"
 *     accent="gold"
 *   />
 *
 * Typography lock-in (Phase Mercury+Aladdin):
 *  - eyebrow: 11px uppercase tracking-eyebrow
 *  - H1/H2 title: Fraunces variable with opsz=144 at display sizes
 *  - subtitle: 15px (text-md) relaxed leading
 *  - H3 consumer variant: text-xl fixed
 */

export type SectionHeaderAccent = 'gold' | 'wine';
export type SectionHeaderAlign = 'left' | 'center';

export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: SectionHeaderAlign;
  accent?: SectionHeaderAccent;
  divider?: boolean;
  actions?: ReactNode;
  titleAs?: 'h1' | 'h2' | 'h3';
}

const ACCENT_TEXT: Record<SectionHeaderAccent, string> = {
  gold: 'text-gold-500',
  wine: 'text-area-escudo',
};

const DIVIDER_GRADIENT: Record<SectionHeaderAccent, string> = {
  gold:
    'linear-gradient(90deg, rgb(184 147 74 / 0) 0%, rgb(184 147 74 / 0.6) 50%, rgb(184 147 74 / 0) 100%)',
  wine:
    'linear-gradient(90deg, rgb(168 56 56 / 0) 0%, rgb(168 56 56 / 0.6) 50%, rgb(168 56 56 / 0) 100%)',
};

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = 'left',
  accent = 'gold',
  divider = false,
  actions,
  titleAs = 'h2',
  className,
  ...rest
}: SectionHeaderProps) {
  const TitleTag = titleAs;
  const isCenter = align === 'center';
  const isDisplay = titleAs === 'h1' || titleAs === 'h2';

  return (
    <header
      className={cn(
        'flex flex-col gap-3',
        isCenter ? 'items-center text-center' : 'items-start text-left',
        className,
      )}
      {...rest}
    >
      <div
        className={cn(
          'w-full flex',
          isCenter ? 'flex-col items-center gap-2' : 'items-start justify-between gap-6',
        )}
      >
        <div className={cn('flex flex-col', isCenter ? 'items-center' : 'items-start', 'gap-1.5')}>
          {eyebrow != null && (
            <span
              className={cn(
                'uppercase tracking-eyebrow text-xs font-medium',
                ACCENT_TEXT[accent],
              )}
            >
              {eyebrow}
            </span>
          )}
          <TitleTag
            className={cn(
              'font-serif-elite font-medium leading-display tracking-tight',
              isDisplay ? 'text-4xl md:text-5xl' : 'text-xl',
              'text-n-100',
            )}
            style={
              isDisplay
                ? { fontVariationSettings: '"opsz" 144, "SOFT" 0, "WONK" 0' }
                : undefined
            }
          >
            {title}
          </TitleTag>
          {subtitle != null && (
            <p
              className={cn(
                'font-light text-md leading-relaxed mt-0.5',
                'text-n-500 max-w-2xl',
              )}
            >
              {subtitle}
            </p>
          )}
        </div>
        {actions && !isCenter && (
          <div className="shrink-0 inline-flex items-center gap-2">{actions}</div>
        )}
      </div>

      {divider && (
        <span
          aria-hidden="true"
          className="block h-px w-full max-w-[360px] mt-2"
          style={{ background: DIVIDER_GRADIENT[accent] }}
        />
      )}
    </header>
  );
}
