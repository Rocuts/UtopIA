'use client';

/**
 * SecuritySection — Amber advisory card explaining today's localStorage-based
 * persistence and the Sprint 3 encrypted vault plan. Read-only; no actions.
 */

import { Shield, KeyRound } from 'lucide-react';
import { EliteCard } from '@/components/ui/EliteCard';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

const STORAGE_KEYS = [
  { id: 'theme', key: 'utopia-theme' },
  { id: 'density', key: 'utopia-density' },
  { id: 'language', key: 'language' },
  { id: 'erp', key: 'utopia_erp_connections' },
  { id: 'conversations', key: 'utopia_conversations' },
] as const;

type KeyId = (typeof STORAGE_KEYS)[number]['id'];

export function SecuritySection() {
  const { t } = useLanguage();
  return (
    <EliteCard variant="glass" padding="lg">
      <EliteCard.Header>
        <div className="flex items-center gap-2.5">
          <Shield className="w-5 h-5 text-gold-500" aria-hidden="true" />
          <h2 className="font-serif-elite text-xl leading-tight font-medium tracking-tight text-n-100">
            {t.settings.sections.security}
          </h2>
        </div>
      </EliteCard.Header>
      <EliteCard.Body>
        <div className="flex flex-col gap-5">
          <div
            role="note"
            className={cn(
              'flex gap-3 p-4 rounded-lg',
              'bg-gold-500/8 border border-gold-500/30',
            )}
          >
            <KeyRound
              className="w-5 h-5 shrink-0 text-gold-500 mt-0.5"
              aria-hidden="true"
            />
            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold text-n-100">
                {t.settings.security.title}
              </h3>
              <p className="text-sm text-n-300 leading-relaxed">
                {t.settings.security.advisory}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-eyebrow text-n-500 font-medium mb-3">
              {t.settings.security.keysLabel}
            </p>
            <ul className="flex flex-col gap-1.5">
              {STORAGE_KEYS.map(({ id, key }) => (
                <li
                  key={id}
                  className={cn(
                    'flex items-center justify-between gap-3 px-3 py-2 rounded-md',
                    'bg-n-900/50 border border-gold-500/10',
                  )}
                >
                  <span className="text-sm text-n-200">
                    {t.settings.security.keys[id as KeyId]}
                  </span>
                  <code className="font-mono text-xs-mono text-n-500 truncate">
                    {key}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </EliteCard.Body>
    </EliteCard>
  );
}
