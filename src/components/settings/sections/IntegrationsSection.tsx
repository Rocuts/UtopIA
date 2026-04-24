'use client';

/**
 * IntegrationsSection — Wraps ERPConnector unchanged (A2 owns). Provides just
 * the section framing so the visual rhythm matches other sections.
 */

import { EliteCard } from '@/components/ui/EliteCard';
import { useLanguage } from '@/context/LanguageContext';
import { ERPConnector } from '@/components/workspace/ERPConnector';

export function IntegrationsSection() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-4">
      <EliteCard variant="glass" padding="md">
        <div className="flex flex-col gap-1.5">
          <h2 className="font-serif-elite text-xl leading-tight font-medium tracking-tight text-n-100">
            {t.settings.sections.integrations}
          </h2>
          <p className="text-sm text-n-400 leading-relaxed">
            {t.settings.integrations.description}
          </p>
        </div>
      </EliteCard>
      <ERPConnector />
    </div>
  );
}
