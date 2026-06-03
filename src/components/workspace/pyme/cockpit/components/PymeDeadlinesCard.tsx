'use client';

import { AlertTriangle, CalendarClock } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import type { PymeAlert, Tone } from '../types';

const ICON_TONE: Record<Tone, string> = {
  neutral: 'text-n-500',
  positive: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** Vencimientos próximos — tarjeta glass con lista de obligaciones. */
export function PymeDeadlinesCard({ alerts }: { alerts: PymeAlert[] }) {
  const { t } = useLanguage();
  const c = t.pyme.cockpit;

  return (
    <section className="rounded-xl glass-elite-elevated border-elite-gold p-6 sm:p-7">
      <header className="mb-4 flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[rgb(196_138_46_/_0.14)] text-warning"
        >
          <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <h2 className="font-serif-elite text-xl font-normal tracking-tight text-n-1000">
          {c.deadlines_title}
        </h2>
      </header>

      {alerts.length === 0 ? (
        <p className="text-sm text-n-600">{c.deadlines_empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-n-200/70">
          {alerts.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <CalendarClock
                className={cn('h-4 w-4 shrink-0', ICON_TONE[a.tone])}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-n-800">
                {a.text}
              </span>
              <span className="shrink-0 font-mono text-xs-mono uppercase tracking-eyebrow text-n-600 tabular-nums">
                {a.dueLabel}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
