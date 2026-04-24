'use client';

/**
 * ResetSection — Danger-zone card with two destructive actions.
 *
 *  - Full reset: clears all UtopIA localStorage keys + reloads.
 *  - UI-only reset: preserves ERP connections and conversation history.
 *
 * Both actions flow through a GlassModal confirmation so they can't be fired
 * by an accidental tap.
 */

import { useCallback, useState } from 'react';
import { AlertTriangle, RotateCcw, Eraser } from 'lucide-react';
import { EliteCard } from '@/components/ui/EliteCard';
import { EliteButton } from '@/components/ui/EliteButton';
import { GlassModal } from '@/components/ui/GlassModal';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

type ResetScope = 'all' | 'ui-only' | null;

const UI_KEYS = ['utopia-theme', 'utopia-density', 'language'];
const FULL_KEYS = [
  'utopia-theme',
  'utopia-density',
  'language',
  'utopia_erp_connections',
  'utopia_conversations',
];

export function ResetSection() {
  const { t } = useLanguage();
  const [pending, setPending] = useState<ResetScope>(null);
  const [executing, setExecuting] = useState(false);

  const handleConfirm = useCallback(() => {
    if (!pending || typeof window === 'undefined') return;
    setExecuting(true);
    const keys = pending === 'all' ? FULL_KEYS : UI_KEYS;
    try {
      for (const key of keys) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Quota exceptions and private-mode lockouts are non-fatal; reload anyway
      // so the user at least sees a fresh app state.
    }
    // Full reload so every provider reads fresh defaults on mount.
    window.location.reload();
  }, [pending]);

  const cancel = useCallback(() => {
    if (executing) return;
    setPending(null);
  }, [executing]);

  return (
    <>
      <EliteCard
        variant="glass"
        padding="lg"
        className={cn('border-danger/40')}
      >
        <EliteCard.Header className="border-danger/25">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-danger" aria-hidden="true" />
            <h2 className="font-serif-elite text-xl leading-tight font-medium tracking-tight text-n-100">
              {t.settings.reset.title}
            </h2>
          </div>
        </EliteCard.Header>
        <EliteCard.Body>
          <div className="flex flex-col gap-5">
            <p className="text-sm text-n-300 leading-relaxed">
              {t.settings.reset.description}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <EliteButton
                variant="wine"
                leftIcon={<RotateCcw className="w-4 h-4" />}
                onClick={() => setPending('all')}
              >
                {t.settings.reset.resetAll}
              </EliteButton>
              <EliteButton
                variant="secondary"
                leftIcon={<Eraser className="w-4 h-4" />}
                onClick={() => setPending('ui-only')}
              >
                {t.settings.reset.resetUIOnly}
              </EliteButton>
            </div>
          </div>
        </EliteCard.Body>
      </EliteCard>

      <GlassModal
        open={pending !== null}
        onClose={cancel}
        title={t.settings.reset.confirmTitle}
        description={t.settings.reset.confirmBody}
        size="md"
        footer={
          <>
            <EliteButton variant="ghost" onClick={cancel} disabled={executing}>
              {t.settings.reset.cancel}
            </EliteButton>
            <EliteButton
              variant="wine"
              onClick={handleConfirm}
              loading={executing}
              leftIcon={<RotateCcw className="w-4 h-4" />}
            >
              {executing ? t.settings.reset.done : t.settings.reset.confirmAction}
            </EliteButton>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
            {t.settings.security.keysLabel}
          </p>
          <ul className="flex flex-col gap-1">
            {(pending === 'all' ? FULL_KEYS : UI_KEYS).map((key) => (
              <li
                key={key}
                className="font-mono text-xs-mono text-n-400 px-3 py-1.5 rounded-md bg-n-900/60 border border-gold-500/10"
              >
                {key}
              </li>
            ))}
          </ul>
        </div>
      </GlassModal>
    </>
  );
}
