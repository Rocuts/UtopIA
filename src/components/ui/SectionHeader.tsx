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
  gold: 'text-[#D4A017]',
  wine: 'text-[#C46A76]',
};

const DIVIDER_GRADIENT: Record<SectionHeaderAccent, string> = {
  gold:
    'linear-gradient(90deg, rgba(212,160,23,0) 0%, rgba(212,160,23,0.6) 50%, rgba(212,160,23,0) 100%)',
  wine:
    'linear-gradient(90deg, rgba(114,47,55,0) 0%, rgba(196,106,118,0.6) 50%, rgba(114,47,55,0) 100%)',
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
                'uppercase tracking-[0.22em] text-[11px] font-medium',
                ACCENT_TEXT[accent],
              )}
            >
              {eyebrow}
            </span>
          )}
          <TitleTag
            className={cn(
              'font-serif-elite font-normal leading-tight',
              'text-[32px] sm:text-[40px] md:text-[44px]',
              'text-[#F5F5F5]',
            )}
          >
            {title}
          </TitleTag>
          {subtitle != null && (
            <p
              className={cn(
                'font-light text-[15px] leading-relaxed mt-0.5',
                'text-[#A8A8A8] max-w-2xl',
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
