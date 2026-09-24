'use client';

/**
 * /workspace/alertas — Sentinel · Centro de Alertas.
 *
 * Re-auditoría e2e-niif-15 (2026-09): la versión anterior era una maqueta con
 * seis alertas fijas «detectadas por la IA» (saldos a favor, tasa efectiva,
 * TRM, vencimientos por dígito del NIT) presentadas como datos del cliente y
 * sin rótulo de demostración. Ahora carga las alertas reales del workspace
 * desde `/api/sentinel/alerts` (la misma fuente de la Bandeja Insight) y, sin
 * datos, muestra un estado vacío o de error rotulado. Nunca cifras de relleno.
 */

import { useEffect, useState } from 'react';

import {
  AlertCenterView,
  type AlertCenterFilter,
  type AlertCenterItem,
} from './AlertCenterView';

type LoadStatus = 'loading' | 'ready' | 'error';

const PILLARS = new Set(['escudo', 'valor', 'verdad', 'futuro']);
const SEVERITIES = new Set(['critico', 'advertencia', 'informativo']);
const STATUSES = new Set(['pending', 'snoozed', 'resolved', 'escalated']);

/** Filas del API → ítems de la vista; descarta filas sin los campos mínimos. */
function toItems(raw: unknown): AlertCenterItem[] {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { alerts?: unknown })?.alerts)
      ? (raw as { alerts: unknown[] }).alerts
      : [];
  const out: AlertCenterItem[] = [];
  for (const r of rows) {
    const row = r as Record<string, unknown>;
    if (
      typeof row.id !== 'string' ||
      typeof row.subject !== 'string' ||
      !PILLARS.has(String(row.pillar)) ||
      !SEVERITIES.has(String(row.severity))
    ) {
      continue;
    }
    out.push({
      id: row.id,
      pillar: row.pillar as AlertCenterItem['pillar'],
      severity: row.severity as AlertCenterItem['severity'],
      status: STATUSES.has(String(row.status)) ? (row.status as AlertCenterItem['status']) : 'pending',
      subject: row.subject,
      hallazgo: typeof row.hallazgo === 'string' ? row.hallazgo : null,
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
    });
  }
  return out;
}

export default function AlertasPage() {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [alerts, setAlerts] = useState<AlertCenterItem[]>([]);
  const [filter, setFilter] = useState<AlertCenterFilter>('todas');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/sentinel/alerts?status=pending,snoozed,escalated', {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const items = toItems(await res.json());
        if (!cancelled) {
          setAlerts(items);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <AlertCenterView status={status} alerts={alerts} filter={filter} onFilter={setFilter} />;
}
