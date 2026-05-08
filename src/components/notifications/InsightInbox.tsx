'use client';

/**
 * InsightInbox — bandeja de Insights persistentes del Sentinel.
 *
 * Modal con tabs por pilar + listado scrollable. Cada item muestra
 * pillar dot + subject + tiempo relativo + acciones [Resolver, Snooze 7d].
 *
 * Hace fetch a `/api/sentinel/alerts` (P6 está creando ese endpoint en
 * paralelo). Si el endpoint no existe aún, mostramos placeholder
 * (`alerts.length === 0` → empty state) y comentamos el wiring.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, Clock, Inbox, Loader2 } from 'lucide-react';

import { GlassModal } from '@/components/ui/GlassModal';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

import type { Insight } from '@/lib/notifications/insight-types';
import type { PillarId } from '@/lib/pillars/types';

interface InboxAlert extends Insight {
  id: string;
  status: 'pending' | 'snoozed' | 'resolved' | 'escalated';
  createdAt: string;
  snoozedUntil?: string | null;
  resolvedAt?: string | null;
}

const PILLAR_DOT: Record<PillarId, string> = {
  verdad: 'bg-area-verdad',
  escudo: 'bg-area-escudo',
  valor: 'bg-area-valor',
  futuro: 'bg-area-futuro',
};

interface Props {
  open: boolean;
  onClose: () => void;
}

type FilterKey = 'all' | 'critical' | PillarId;

export function InsightInbox({ open, onClose }: Props) {
  const { language } = useLanguage();
  const isEs = language === 'es';
  const [alerts, setAlerts] = useState<InboxAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [actionId, setActionId] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      // TODO: una vez P6 publique /api/sentinel/alerts, este fetch funcionará.
      const res = await fetch('/api/sentinel/alerts?status=pending,snoozed,escalated', {
        cache: 'no-store',
      });
      if (!res.ok) {
        setAlerts([]);
        return;
      }
      const json = (await res.json()) as { alerts?: InboxAlert[] } | InboxAlert[];
      setAlerts(Array.isArray(json) ? json : json.alerts ?? []);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchAlerts();
  }, [open, fetchAlerts]);

  const visible = useMemo(() => {
    if (filter === 'all') return alerts;
    if (filter === 'critical') return alerts.filter((a) => a.severity === 'critico');
    return alerts.filter((a) => a.pillar === filter);
  }, [alerts, filter]);

  async function patchAlert(id: string, action: 'resolve' | 'snooze') {
    setActionId(id);
    try {
      await fetch('/api/sentinel/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId: id, action }),
      });
      await fetchAlerts();
    } finally {
      setActionId(null);
    }
  }

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <Inbox className="h-5 w-5 text-gold-500" aria-hidden="true" />
          {isEs ? 'Bandeja Insight' : 'Insight Inbox'}
        </span>
      }
      description={
        isEs
          ? 'Alertas activas del Centinela 1+1, agrupadas por pilar.'
          : '1+1 Sentinel active alerts, grouped by pillar.'
      }
      size="lg"
    >
      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {([
          { id: 'all', es: 'Todas', en: 'All' },
          { id: 'critical', es: 'Críticas', en: 'Critical' },
          { id: 'verdad', es: 'Verdad', en: 'Truth' },
          { id: 'escudo', es: 'Escudo', en: 'Shield' },
          { id: 'valor', es: 'Valor', en: 'Value' },
          { id: 'futuro', es: 'Futuro', en: 'Future' },
        ] as Array<{ id: FilterKey; es: string; en: string }>).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={cn(
              'rounded-full px-3 py-1 text-xs-mono uppercase tracking-eyebrow',
              'border transition-colors',
              filter === tab.id
                ? 'bg-gold-500/15 border-gold-500/40 text-gold-500'
                : 'border-gold-500/15 text-n-500 hover:bg-gold-500/8',
            )}
          >
            {isEs ? tab.es : tab.en}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-n-500">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gold-500/25 p-10 text-center text-sm text-n-500">
          {isEs ? 'Sin alertas pendientes en este filtro.' : 'No pending alerts for this filter.'}
        </div>
      ) : (
        <ul className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1" data-lenis-prevent="">
          {visible.map((a) => (
            <li
              key={a.id}
              className="flex items-start gap-3 rounded-lg border border-gold-500/15 bg-n-0/60 p-3"
            >
              <span className={cn('mt-1.5 h-2.5 w-2.5 rounded-full shrink-0', PILLAR_DOT[a.pillar])} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <header className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-mono text-[10px] uppercase tracking-eyebrow text-n-600 font-semibold">
                    {capitalize(a.pillar)} · {a.severity}
                  </span>
                  <time className="text-[10px] text-n-500 font-mono">{formatRelative(a.createdAt, isEs)}</time>
                </header>
                <p className="text-sm font-medium text-n-1000 leading-snug">{a.subject}</p>
                <p className="text-xs text-n-700 leading-relaxed mt-0.5">{a.hallazgo}</p>
                <footer className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => patchAlert(a.id, 'resolve')}
                    disabled={actionId === a.id}
                    className="inline-flex items-center gap-1 rounded-md border border-success/30 px-2.5 py-1 text-[11px] text-success hover:bg-success/10 disabled:opacity-50"
                  >
                    <CheckCircle className="h-3 w-3" aria-hidden="true" />
                    {isEs ? 'Resolver' : 'Resolve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => patchAlert(a.id, 'snooze')}
                    disabled={actionId === a.id}
                    className="inline-flex items-center gap-1 rounded-md border border-warning/30 px-2.5 py-1 text-[11px] text-warning hover:bg-warning/10 disabled:opacity-50"
                  >
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {isEs ? 'Posponer 7 días' : 'Snooze 7 days'}
                  </button>
                </footer>
              </div>
            </li>
          ))}
        </ul>
      )}
    </GlassModal>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatRelative(iso: string, isEs: boolean): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return isEs ? 'ahora' : 'now';
  if (min < 60) return isEs ? `hace ${min} min` : `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return isEs ? `hace ${hr} h` : `${hr}h ago`;
  const d = Math.round(hr / 24);
  return isEs ? `hace ${d} d` : `${d}d ago`;
}

export default InsightInbox;
