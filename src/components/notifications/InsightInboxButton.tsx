'use client';

/**
 * InsightInboxButton — botón con badge de contador para el header.
 * Abre el `<InsightInbox />` modal. Hace pull periódico al endpoint para
 * actualizar el contador (cada 60s).
 */

import { Bell } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

import { InsightInbox } from './InsightInbox';

interface CountResponse {
  pendingTotal: number;
  pendingCritical: number;
}

const POLL_INTERVAL_MS = 60_000;

export function InsightInboxButton({ className }: { className?: string }) {
  const { language } = useLanguage();
  const isEs = language === 'es';
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<CountResponse>({ pendingTotal: 0, pendingCritical: 0 });

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/sentinel/alerts?countOnly=1', { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as Partial<CountResponse>;
      setCounts({
        pendingTotal: json.pendingTotal ?? 0,
        pendingCritical: json.pendingCritical ?? 0,
      });
    } catch {
      /* silencio: si el endpoint aún no existe, mostramos contador 0 */
    }
  }, []);

  useEffect(() => {
    fetchCounts();
    const interval = setInterval(fetchCounts, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchCounts]);

  const hasCritical = counts.pendingCritical > 0;
  const total = counts.pendingTotal;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={isEs ? 'Bandeja Insight' : 'Insight inbox'}
        className={cn(
          'relative inline-flex h-9 w-9 items-center justify-center rounded-md',
          'text-n-700 hover:text-n-1000 hover:bg-gold-500/10 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
          className,
        )}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {total > 0 && (
          <span
            className={cn(
              'absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center',
              'rounded-full px-1 text-[10px] font-bold leading-none text-n-0',
              hasCritical ? 'bg-danger' : 'bg-gold-500',
            )}
            aria-label={isEs ? `${total} insights` : `${total} insights`}
          >
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>
      <InsightInbox open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export default InsightInboxButton;
