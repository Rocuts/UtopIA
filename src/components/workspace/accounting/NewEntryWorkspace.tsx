'use client';

/**
 * NewEntryWorkspace — Client wrapper para el flujo de "nuevo asiento".
 *
 * Resuelve los periodos disponibles antes de montar `<JournalEntryForm />`
 * para que el selector salga ya con el periodo abierto seleccionado por
 * defecto. Esa fetch es ligera (un select por workspace) y centraliza
 * la lógica de "hay periodos creados / no hay periodos".
 */

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import {
  JournalEntryForm,
  type PeriodOption,
} from './JournalEntryForm';

export function NewEntryWorkspace() {
  const { t, language } = useLanguage();
  const ac = t.accounting;

  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [defaultPeriodId, setDefaultPeriodId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const year = new Date().getFullYear();
        const res = await fetch(`/api/accounting/periods?year=${year}`);
        if (!res.ok) throw new Error('periods_failed');
        const json = (await res.json()) as
          | { ok: true; periods: PeriodOption[] }
          | PeriodOption[];
        const list: PeriodOption[] = Array.isArray(json)
          ? json
          : 'periods' in json && Array.isArray(json.periods)
            ? json.periods
            : [];
        if (cancelled) return;
        setPeriods(list);
        const open = list.find((p) => p.status === 'open');
        setDefaultPeriodId(open?.id ?? list[0]?.id ?? null);
      } catch {
        if (!cancelled) setError(ac.errorGeneric);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ac.errorGeneric]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="font-mono text-xs-mono uppercase tracking-eyebrow text-gold-600 font-medium">
          {ac.title}
        </p>
        <h1 className="mt-1 font-serif-elite text-3xl text-n-1000 tracking-tight">
          {ac.newEntry}
        </h1>
        <p className="mt-1.5 text-sm text-n-700">{ac.newEntryDesc}</p>
      </header>

      {loading ? (
        <div
          role="status"
          aria-busy="true"
          className="flex items-center gap-2 px-4 py-12 text-n-500 justify-center"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span className="text-sm">{ac.loading}</span>
        </div>
      ) : error ? (
        <div
          role="alert"
          className={cn(
            'rounded-md border border-danger/30 bg-danger/8 px-3 py-2',
            'text-sm text-danger flex items-center gap-2',
          )}
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : periods.length === 0 ? (
        <div
          className={cn(
            'rounded-xl border border-dashed border-gold-500/30 bg-n-0',
            'p-10 text-center text-sm text-n-700',
          )}
        >
          {language === 'es'
            ? 'Aún no hay periodos contables creados. Solicita la apertura de un periodo antes de registrar asientos.'
            : 'No accounting periods yet. Open one before registering entries.'}
        </div>
      ) : (
        <JournalEntryForm
          periods={periods}
          defaultPeriodId={defaultPeriodId}
        />
      )}
    </div>
  );
}

export default NewEntryWorkspace;
