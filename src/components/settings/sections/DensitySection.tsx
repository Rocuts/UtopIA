'use client';

/**
 * DensitySection — Segmented control to choose Comfortable|Compact.
 *
 * Persists to `localStorage['utopia-density']`. Application of the density
 * CSS token is progressive (Sprint 2+); the selector itself is ship-ready
 * now so users can record their preference.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { EliteCard } from '@/components/ui/EliteCard';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

type Density = 'comfortable' | 'compact';

const STORAGE_KEY = 'utopia-density';
const OPTIONS: Density[] = ['comfortable', 'compact'];

function readDensity(): Density {
  if (typeof window === 'undefined') return 'comfortable';
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === 'compact' ? 'compact' : 'comfortable';
}

export function DensitySection() {
  const { t } = useLanguage();
  const reduce = useReducedMotion();
  const [density, setDensity] = useState<Density>('comfortable');

  useEffect(() => {
    setDensity(readDensity());
  }, []);

  const handleSelect = useCallback((next: Density) => {
    setDensity(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
      // Expose on <html> so future CSS tokens can pivot off it.
      document.documentElement.dataset.density = next;
    }
  }, []);

  return (
    <EliteCard variant="glass" padding="lg">
      <EliteCard.Header>
        <h2 className="font-serif-elite text-xl leading-tight font-medium tracking-tight text-n-100">
          {t.settings.sections.density}
        </h2>
      </EliteCard.Header>
      <EliteCard.Body>
        <div className="flex flex-col gap-5">
          <div
            role="radiogroup"
            aria-label={t.settings.sections.density}
            className="relative inline-flex items-center p-1 rounded-lg bg-n-900 border border-gold-500/15 w-fit"
          >
            {OPTIONS.map((opt) => {
              const selected = density === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => handleSelect(opt)}
                  className={cn(
                    'relative z-10 px-4 py-1.5 text-sm rounded-md transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-900',
                    selected ? 'text-n-1000 font-medium' : 'text-n-400 hover:text-n-200',
                  )}
                >
                  {selected && !reduce && (
                    <motion.span
                      layoutId="density-indicator"
                      className="absolute inset-0 -z-10 rounded-md bg-gold-500"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                  {selected && reduce && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 -z-10 rounded-md bg-gold-500"
                    />
                  )}
                  <span className="relative">{t.settings.density[opt]}</span>
                </button>
              );
            })}
          </div>
          <p className="text-sm text-n-400 leading-relaxed">
            {t.settings.density.description}
          </p>
        </div>
      </EliteCard.Body>
    </EliteCard>
  );
}
