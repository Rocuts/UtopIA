'use client';

/**
 * ThemeToggle — 3-button segmented control (Light / System / Dark).
 *
 * Visual: mirrors `LanguageToggle` in `EliteHeader.tsx` — mono font, uppercase
 * eyebrow tracking, transparent border that lifts to gold-500/25 on hover.
 * Uses `aria-pressed` on each button so screen readers announce selection
 * state (radiogroup semantics would require hidden native inputs and more
 * markup for no perceptible gain here).
 *
 * Labels are inline ES/EN (not via dictionaries) because agent A3 owns
 * `src/lib/i18n/dictionaries.ts` concurrently and editing it would race.
 */
import { Sun, Moon, Monitor } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme, type Theme } from '@/components/providers/ThemeProvider';
import { cn } from '@/lib/utils';

interface Option {
  value: Theme;
  Icon: typeof Sun;
  labelEs: string;
  labelEn: string;
}

const OPTIONS: readonly Option[] = [
  { value: 'light', Icon: Sun, labelEs: 'Claro', labelEn: 'Light' },
  { value: 'system', Icon: Monitor, labelEs: 'Sistema', labelEn: 'System' },
  { value: 'dark', Icon: Moon, labelEs: 'Oscuro', labelEn: 'Dark' },
] as const;

export function ThemeToggle() {
  const { language } = useLanguage();
  const { theme, setTheme } = useTheme();
  const isEs = language === 'es';

  return (
    <div
      role="group"
      aria-label={isEs ? 'Selector de tema' : 'Theme selector'}
      className={cn(
        'inline-flex items-center gap-0.5 p-0.5 rounded-md',
        'border border-transparent hover:border-gold-500/25',
        'transition-colors',
      )}
    >
      {OPTIONS.map(({ value, Icon, labelEs, labelEn }) => {
        const label = isEs ? labelEs : labelEn;
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={selected}
            aria-label={label}
            title={label}
            className={cn(
              'inline-flex items-center justify-center rounded-xs',
              'h-7 w-7',
              'font-mono text-xs-mono font-medium',
              'transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
              selected
                ? 'bg-gold-500/12 text-n-900'
                : 'text-n-500 hover:text-n-900',
            )}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export default ThemeToggle;
