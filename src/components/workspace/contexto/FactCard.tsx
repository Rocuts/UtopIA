'use client';

import { cn } from '@/lib/utils';
import { Pencil, Ban } from 'lucide-react';
import type { FactDTO } from '@/lib/facts/dto';
import { donationSummary } from '@/lib/facts/panel-helpers';

const KIND_LABEL: Record<string, { es: string; en: string }> = {
  narrative: { es: 'Narrativo', en: 'Narrative' },
  donation: { es: 'Donación', en: 'Donation' },
  leasing: { es: 'Leasing', en: 'Leasing' },
  loss_carryforward: { es: 'Pérdida fiscal', en: 'Loss carryforward' },
};

export function FactCard({
  fact,
  language,
  onEdit,
  onRevoke,
  onToggleHistory,
  historyCount,
  historyOpen,
}: {
  fact: FactDTO;
  language: 'es' | 'en';
  onEdit: (fact: FactDTO) => void;
  onRevoke: (fact: FactDTO) => void;
  onToggleHistory: (fact: FactDTO) => void;
  historyCount: number;
  historyOpen: boolean;
}) {
  const t = (es: string, en: string) => (language === 'es' ? es : en);
  const isActive = fact.status === 'active';
  const isPilotKind = fact.kind === 'narrative' || fact.kind === 'donation';
  const summary = donationSummary(fact.structured, language);
  const kindLabel = (KIND_LABEL[fact.kind] ?? KIND_LABEL.narrative)[language];
  const created = new Date(fact.createdAt).toLocaleDateString(language === 'es' ? 'es-CO' : 'en-US');

  return (
    <article className={cn('rounded-xl border p-4', isActive ? 'border-n-200 bg-n-0' : 'border-n-200 bg-n-50/60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-widest text-n-600">{kindLabel}</span>
            {fact.fiscalPeriod && (
              <span className="text-[10px] font-mono text-n-600">· {fact.fiscalPeriod}</span>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full',
                isActive ? 'bg-gold-500/10 text-n-900' : 'bg-n-100 text-n-700',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', isActive ? 'bg-gold-500' : 'bg-n-500')} />
              {isActive ? t('activo', 'active') : t('revocado', 'revoked')}
            </span>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-n-1000 truncate">{fact.title}</h3>
          {summary && <p className="mt-0.5 text-xs text-n-800">{summary}</p>}
          <p className="mt-1 text-xs text-n-700 line-clamp-2">{fact.body}</p>
          <p className="mt-1.5 text-[10px] font-mono text-n-500">
            {fact.source === 'chat' ? 'chat' : t('manual', 'manual')} · {created}
          </p>
          {isActive && fact.fiscalPeriod && (
            <p className="mt-1 text-[10px] text-n-600">
              {t(
                `Se incluirá en tus reportes de ${fact.fiscalPeriod}.`,
                `Will be included in your ${fact.fiscalPeriod} reports.`,
              )}
            </p>
          )}
        </div>

        {isActive && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onEdit(fact)}
              disabled={!isPilotKind}
              title={t('Editar (nueva versión)', 'Edit (new version)')}
              aria-label={t('Editar', 'Edit')}
              className="p-1.5 rounded-md text-n-700 hover:text-n-1000 hover:bg-gold-500/6 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onRevoke(fact)}
              title={t('Revocar', 'Revoke')}
              aria-label={t('Revocar', 'Revoke')}
              className="p-1.5 rounded-md text-n-700 hover:text-danger hover:bg-danger/6 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
            >
              <Ban className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {historyCount > 0 && (
        <button
          type="button"
          onClick={() => onToggleHistory(fact)}
          className="mt-2 text-[10px] font-mono uppercase tracking-wider text-n-600 hover:text-n-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded"
          aria-expanded={historyOpen}
        >
          {historyOpen ? '▾' : '▸'} {t('Historial de versiones', 'Version history')} ({historyCount})
        </button>
      )}
    </article>
  );
}
