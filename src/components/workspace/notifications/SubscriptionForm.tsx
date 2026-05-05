'use client';

import { useState, type FormEvent } from 'react';
import type { NotificationSubscriptionRow } from '@/lib/notifications/types';

// ---------------------------------------------------------------------------
// SubscriptionForm — form to create or upsert a notification subscription.
//
// MVP: email channel only. Other channels show a disabled state with tooltip.
// Events: all 5 supported events shown as checkboxes.
// On success, calls onSuccess(row) so AlertDashboard can refresh its list.
// ---------------------------------------------------------------------------

const ALL_EVENTS: Array<{ value: string; label: string }> = [
  { value: 'period.locked', label: 'Cierre de mes exitoso' },
  { value: 'period.locked.with_warnings', label: 'Cierre con salvedades' },
  { value: 'reconciliation.broken', label: 'Conciliación bancaria rota' },
  { value: 'health_check.failed', label: 'Health check fallido' },
  { value: 'anomaly.detected', label: 'Anomalía detectada' },
];

interface Props {
  onSuccess: (row: NotificationSubscriptionRow) => void;
  onCancel: () => void;
}

export function SubscriptionForm({ onSuccess, onCancel }: Props) {
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    'period.locked',
    'period.locked.with_warnings',
    'anomaly.detected',
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleEvent(value: string) {
    setSelectedEvents((prev) =>
      prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value],
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (selectedEvents.length === 0) {
      setError('Selecciona al menos un tipo de evento.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/notifications/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'email',
          email: email.trim(),
          events: selectedEvents,
          label: label.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // D3 channel disabled message
        if (body.error === 'channel_disabled_in_mvp') {
          setError(
            'Solo el canal email está disponible por ahora. Web Push y WhatsApp próximamente.',
          );
        } else if (body.error === 'validation_error') {
          const fieldErrors = body.details?.fieldErrors ?? {};
          const firstMsg = Object.values(fieldErrors).flat()[0];
          setError(typeof firstMsg === 'string' ? firstMsg : 'Error de validación.');
        } else {
          setError(body.message ?? 'Error al guardar la suscripción.');
        }
        return;
      }

      const row = (await res.json()) as NotificationSubscriptionRow;
      onSuccess(row);
    } catch {
      setError('Error de conexión. Por favor intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-xl border border-zinc-700 bg-zinc-900/70 p-5"
    >
      <h3 className="text-sm font-semibold text-zinc-200">Nueva suscripción</h3>

      {/* Email */}
      <div className="space-y-1.5">
        <label htmlFor="notif-email" className="block text-xs font-medium text-zinc-400">
          Correo electrónico <span className="text-red-400">*</span>
        </label>
        <input
          id="notif-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="hola@empresa.co"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        />
      </div>

      {/* Label (optional) */}
      <div className="space-y-1.5">
        <label htmlFor="notif-label" className="block text-xs font-medium text-zinc-400">
          Etiqueta <span className="text-zinc-600">(opcional)</span>
        </label>
        <input
          id="notif-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Ej: Contadora principal"
          maxLength={128}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        />
      </div>

      {/* Events */}
      <div className="space-y-2">
        <span className="block text-xs font-medium text-zinc-400">
          Recibir notificaciones de <span className="text-red-400">*</span>
        </span>
        <div className="space-y-2">
          {ALL_EVENTS.map((ev) => (
            <label key={ev.value} className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={selectedEvents.includes(ev.value)}
                onChange={() => toggleEvent(ev.value)}
                className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 accent-amber-500"
              />
              <span className="text-sm text-zinc-300">{ev.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
        >
          {loading ? 'Guardando…' : 'Guardar suscripción'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
