'use client';

/**
 * SettingsNav — Vertical section selector for the settings page.
 *
 * Mirrors the gold-accented active state used in EliteHeader's LanguageToggle,
 * exposes aria-current for screen readers, and supports keyboard navigation.
 * On small viewports the parent collapses this into a <select> dropdown.
 */

import { motion, useReducedMotion } from 'motion/react';
import {
  Palette,
  Layout,
  Languages,
  Plug,
  Shield,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';

export type SettingsSectionId =
  | 'theme'
  | 'density'
  | 'language'
  | 'integrations'
  | 'security'
  | 'reset';

const SECTION_ICONS: Record<SettingsSectionId, LucideIcon> = {
  theme: Palette,
  density: Layout,
  language: Languages,
  integrations: Plug,
  security: Shield,
  reset: RotateCcw,
};

const SECTION_ORDER: SettingsSectionId[] = [
  'theme',
  'density',
  'language',
  'integrations',
  'security',
  'reset',
];

interface SettingsNavProps {
  active: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
}

export function SettingsNav({ active, onSelect }: SettingsNavProps) {
  const { t } = useLanguage();
  const reduce = useReducedMotion();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = SECTION_ORDER[(index + 1) % SECTION_ORDER.length];
      onSelect(next);
      const el = document.getElementById(`settings-nav-${next}`);
      el?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev =
        SECTION_ORDER[(index - 1 + SECTION_ORDER.length) % SECTION_ORDER.length];
      onSelect(prev);
      const el = document.getElementById(`settings-nav-${prev}`);
      el?.focus();
    }
  };

  return (
    <nav
      aria-label={t.settings.title}
      className="flex flex-col gap-0.5"
    >
      {SECTION_ORDER.map((id, index) => {
        const Icon = SECTION_ICONS[id];
        const label = t.settings.sections[id];
        const isActive = active === id;
        return (
          <button
            key={id}
            id={`settings-nav-${id}`}
            type="button"
            onClick={() => onSelect(id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'group relative flex items-center gap-3 px-3 py-2.5 rounded-md',
              'text-sm transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-1000',
              isActive
                ? 'text-n-100 bg-gold-500/10 border border-gold-500/25'
                : 'text-n-400 hover:text-n-100 hover:bg-n-0/5 border border-transparent',
            )}
          >
            {isActive && !reduce && (
              <motion.span
                layoutId="settings-nav-indicator"
                aria-hidden="true"
                className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 bg-gold-500 rounded-r-full"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <Icon
              className={cn(
                'w-4 h-4 shrink-0',
                isActive ? 'text-gold-500' : 'text-n-500 group-hover:text-n-300',
              )}
            />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export const SETTINGS_SECTION_ORDER = SECTION_ORDER;
