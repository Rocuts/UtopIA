'use client';

/**
 * ThemeSection — Renders the shared ThemeToggle (owned by A1) plus localized
 * description. A1 exports a named `ThemeToggle` with no required props.
 */

import { EliteCard } from '@/components/ui/EliteCard';
import { useLanguage } from '@/context/LanguageContext';
import { ThemeToggle } from '@/components/workspace/ThemeToggle';

export function ThemeSection() {
  const { t } = useLanguage();
  return (
    <EliteCard variant="glass" padding="lg">
      <EliteCard.Header>
        <h2 className="font-serif-elite text-xl leading-tight font-medium tracking-tight text-n-100">
          {t.settings.sections.theme}
        </h2>
      </EliteCard.Header>
      <EliteCard.Body>
        <div className="flex flex-col gap-5">
          <ThemeToggle />
          <p className="text-sm text-n-400 leading-relaxed">
            {t.settings.themeSection.description}
          </p>
        </div>
      </EliteCard.Body>
    </EliteCard>
  );
}
