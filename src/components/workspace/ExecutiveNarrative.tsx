'use client';

import { motion, useInView, useReducedMotion, type Variants } from 'motion/react';
import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * ExecutiveNarrative — Premium narrative blocks for the Executive Dashboard
 * home (/workspace with no active case). Three flavors:
 *
 *   <ExecutiveNarrative variant="hero"        heading="..." body="..." />
 *   <ExecutiveNarrative variant="intro"       heading="..." body="..." />
 *   <ExecutiveNarrative variant="perspective" heading="..." body="..." />
 *
 *  - hero: oversized serif heading (~56px), word-by-word stagger, gentle
 *    gradient-text (gold → wine) treatment. Centered by default.
 *  - intro: sans eyebrow + serif body. Max 3xl width, subdued palette.
 *  - perspective: similar to intro but framed by thin gradient dividers,
 *    reads like a closing essay paragraph.
 *
 * All variants fade-in on scroll (`useInView` once-only) and respect
 * `prefers-reduced-motion`. Copy comes from the parent via props so
 * i18n stays in the dictionaries.
 */

export type ExecutiveNarrativeVariant = 'hero' | 'intro' | 'perspective';
export type ExecutiveNarrativeAlign = 'center' | 'left';

export interface ExecutiveNarrativeProps {
  variant?: ExecutiveNarrativeVariant;
  eyebrow?: ReactNode;
  heading?: ReactNode;
  body?: ReactNode;
  align?: ExecutiveNarrativeAlign;
  className?: string;
  /**
   * Incremental delay (seconds) added to the variant's own entrance so that
   * the dashboard can chain the hero → intro → grid → perspective reveal.
   */
  delay?: number;
}

// ─── Motion variants ──────────────────────────────────────────────────────────

const WORD_CONTAINER: Variants = {
  hidden: {},
  visible: (custom: number = 0) => ({
    transition: {
      delayChildren: custom,
      staggerChildren: 0.035,
    },
  }),
};

const WORD_CHILD: Variants = {
  hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring', stiffness: 260, damping: 26 },
  },
};

const FADE_UP: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: (custom: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 240,
      damping: 28,
      delay: custom,
    },
  }),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitWords(value: ReactNode): string[] | null {
  if (typeof value !== 'string') return null;
  return value.trim().split(/\s+/);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExecutiveNarrative({
  variant = 'intro',
  eyebrow,
  heading,
  body,
  align,
  className,
  delay = 0,
}: ExecutiveNarrativeProps) {
  const ref = useRef<HTMLElement | null>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -15% 0px' });
  const shouldReduce = useReducedMotion();

  const resolvedAlign: ExecutiveNarrativeAlign =
    align ?? (variant === 'hero' ? 'center' : variant === 'perspective' ? 'center' : 'left');
  const isCenter = resolvedAlign === 'center';

  const animate = shouldReduce || inView ? 'visible' : 'hidden';

  // ─── Hero ───────────────────────────────────────────────────────────────────
  if (variant === 'hero') {
    const headingWords = splitWords(heading);

    return (
      <motion.section
        ref={ref}
        aria-label={typeof heading === 'string' ? heading : undefined}
        initial="hidden"
        animate={animate}
        variants={WORD_CONTAINER}
        custom={delay}
        className={cn(
          'w-full flex flex-col gap-6',
          isCenter ? 'items-center text-center' : 'items-start text-left',
          className,
        )}
      >
        {eyebrow != null && (
          <motion.span
            variants={FADE_UP}
            custom={delay}
            className="uppercase tracking-[0.28em] text-[11px] font-medium text-[#D4A017]"
          >
            {eyebrow}
          </motion.span>
        )}

        {heading != null && (
          <h1
            className={cn(
              'font-serif-elite font-normal leading-[1.08]',
              'text-[36px] sm:text-[44px] md:text-[52px] lg:text-[56px] xl:text-[64px]',
              'max-w-[22ch]',
              isCenter && 'mx-auto',
              // Gentle gold→wine gradient text treatment
              'bg-clip-text text-transparent',
              '[background-image:linear-gradient(135deg,#F5F5F5_0%,#E8B42C_45%,#C46A76_100%)]',
            )}
          >
            {headingWords && !shouldReduce ? (
              <span className="inline-block" style={{ lineHeight: 'inherit' }}>
                {headingWords.map((word, i) => (
                  <motion.span
                    key={`${word}-${i}`}
                    variants={WORD_CHILD}
                    className="inline-block"
                    style={{ marginRight: '0.28em' }}
                  >
                    {word}
                  </motion.span>
                ))}
              </span>
            ) : (
              heading
            )}
          </h1>
        )}

        {body != null && (
          <motion.p
            variants={FADE_UP}
            custom={delay + 0.18}
            className={cn(
              'text-[15px] sm:text-[16px] md:text-[17px] leading-relaxed',
              'text-[#A8A8A8] font-light',
              'max-w-3xl',
              isCenter && 'mx-auto',
            )}
          >
            {body}
          </motion.p>
        )}
      </motion.section>
    );
  }

  // ─── Intro ──────────────────────────────────────────────────────────────────
  if (variant === 'intro') {
    return (
      <motion.section
        ref={ref}
        initial="hidden"
        animate={animate}
        variants={FADE_UP}
        custom={delay}
        className={cn(
          'w-full flex flex-col gap-4',
          'max-w-3xl',
          isCenter ? 'items-center text-center mx-auto' : 'items-start text-left',
          className,
        )}
      >
        {eyebrow != null && (
          <span className="uppercase tracking-[0.24em] text-[11px] font-medium text-[#D4A017]">
            {eyebrow}
          </span>
        )}
        {heading != null && (
          <h2
            className={cn(
              'font-serif-elite font-normal leading-tight',
              'text-[24px] sm:text-[28px] md:text-[32px]',
              'text-[#F5F5F5]',
            )}
          >
            {heading}
          </h2>
        )}
        {body != null && (
          <p
            className={cn(
              'text-[14px] sm:text-[15px] md:text-[16px] leading-[1.75]',
              'text-[#A8A8A8] font-light',
              'font-serif-elite italic',
            )}
          >
            {body}
          </p>
        )}
      </motion.section>
    );
  }

  // ─── Perspective ────────────────────────────────────────────────────────────
  // Framed by thin gradient dividers top + bottom.
  return (
    <motion.section
      ref={ref}
      initial="hidden"
      animate={animate}
      variants={FADE_UP}
      custom={delay}
      className={cn(
        'w-full flex flex-col gap-6',
        isCenter ? 'items-center text-center' : 'items-start text-left',
        'py-10',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'block h-px w-full max-w-[340px]',
          isCenter && 'mx-auto',
        )}
        style={{
          background:
            'linear-gradient(90deg, rgba(212,160,23,0) 0%, rgba(212,160,23,0.45) 50%, rgba(212,160,23,0) 100%)',
        }}
      />

      {eyebrow != null && (
        <span className="uppercase tracking-[0.28em] text-[11px] font-medium text-[#C46A76]">
          {eyebrow}
        </span>
      )}

      {heading != null && (
        <h2
          className={cn(
            'font-serif-elite font-normal leading-tight',
            'text-[22px] sm:text-[26px] md:text-[30px]',
            'text-[#F5F5F5] max-w-3xl',
            isCenter && 'mx-auto',
          )}
        >
          {heading}
        </h2>
      )}

      {body != null && (
        <p
          className={cn(
            'text-[14px] sm:text-[15px] md:text-[16px] leading-[1.8]',
            'text-[#A8A8A8] font-light italic font-serif-elite',
            'max-w-3xl',
            isCenter && 'mx-auto',
          )}
        >
          {body}
        </p>
      )}

      <span
        aria-hidden="true"
        className={cn(
          'block h-px w-full max-w-[340px]',
          isCenter && 'mx-auto',
        )}
        style={{
          background:
            'linear-gradient(90deg, rgba(114,47,55,0) 0%, rgba(196,106,118,0.45) 50%, rgba(114,47,55,0) 100%)',
        }}
      />
    </motion.section>
  );
}
