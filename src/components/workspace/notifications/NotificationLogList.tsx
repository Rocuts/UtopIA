'use client';

import type { NotificationLogRow } from '@/lib/notifications/types';

// ---------------------------------------------------------------------------
// NotificationLogList — renders a table of recent notification log entries.
//
// Accepts items by prop so the parent (AlertDashboard) controls fetching.
// Status badge colors: sent=green, failed=red, skipped=gray, pending=amber.
// ---------------------------------------------------------------------------

interface Props {
  items: NotificationLogRow[];
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; bg: string; text: string }> = {
    sent: { label: 'Enviado', bg: 'bg-emerald-900/30', text: 'text-emerald-400' },
    failed: { label: 'Fallido', bg: 'bg-red-900/30', text: 'text-red-400' },
    skipped: { label: 'Omitido', bg: 'bg-zinc-700/50', text: 'text-zinc-400' },
    pending: { label: 'Pendiente', bg: 'bg-amber-900/30', text: 'text-amber-400' },
    delivered: { label: 'Entregado', bg: 'bg-emerald-900/30', text: 'text-emerald-300' },
  };
  const c = config[status] ?? { label: status, bg: 'bg-zinc-700/50', text: 'text-zinc-400' };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}
    >
      {c.label}
    </span>
  );
}

function formatEvent(event: string): string {
  const labels: Record<string, string> = {
    'period.locked': 'Cierre de mes',
    'period.locked.with_warnings': 'Cierre con salvedades',
    'reconciliation.broken': 'Conciliación rota',
    'health_check.failed': 'Health check fallido',
    'anomaly.detected': 'Anomalía detectada',
  };
  return labels[event] ?? event;
}

function formatChannel(channel: string): string {
  const labels: Record<string, string> = {
    email: 'Email',
    web_push: 'Web Push',
    whatsapp: 'WhatsApp',
  };
  return labels[channel] ?? channel;
}

export function NotificationLogList({ items }: Props) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500">
        No hay notificaciones registradas en los últimos 30 días.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50">
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
              Fecha
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
              Evento
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
              Canal
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
              Destinatario
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
              Estado
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-zinc-800/30 transition-colors">
              <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                {item.sentAt
                  ? new Date(item.sentAt).toLocaleString('es-CO', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })
                  : '—'}
              </td>
              <td className="px-4 py-3 text-zinc-300">{formatEvent(item.event)}</td>
              <td className="px-4 py-3 text-zinc-400">{formatChannel(item.channel)}</td>
              <td className="max-w-[180px] truncate px-4 py-3 text-zinc-400" title={item.recipientId}>
                {item.recipientId}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={item.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
