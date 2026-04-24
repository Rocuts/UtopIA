'use client';

/**
 * LanguageSection — Wraps the same ES/EN toggle used in EliteHeader (mirror of
 * EliteHeader.tsx:154-175). Imported inline rather than from a shared module
 * because LanguageToggle lives inside EliteHeader.tsx (A1 owns) and we must
 * not modify that file.
 */

import { Globe } from 'lucide-react';
import { EliteCard } from '@/components/ui/EliteCard';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  const next = language === 'es' ? 'en' : 'es';
  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-2 rounded-md',
        'font-mono text-xs-mono font-medium uppercase',
        'text-n-200 hover:text-n-100 transition-colors',
        'border border-gold-500/25 hover:border-gold-500/60',
        'bg-n-900/40',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-1000',
      )}
      aria-label={language === 'es' ? 'Switch to English' : 'Cambiar a Español'}
      title={next.toUpperCase()}
    >
      <Globe className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{language.toUpperCase()}</span>
      <span className="text-n-500">→</span>
      <span className="text-gold-500">{next.toUpperCase()}</span>
    </button>
  );
}

export function LanguageSection() {
  const { t } = useLanguage();
  return (
    <EliteCard variant="glass" padding="lg">
      <EliteCard.Header>
        <h2 className="font-serif-elite text-xl leading-tight font-medium tracking-tight text-n-100">
          {t.settings.sections.language}
        </h2>
      </EliteCard.Header>
      <EliteCard.Body>
        <div className="flex flex-col gap-5">
          <LanguageToggle />
          <p className="text-sm text-n-400 leading-relaxed">
            {t.settings.languageSection.description}
          </p>
        </div>
      </EliteCard.Body>
    </EliteCard>
  );
}
