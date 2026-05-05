'use client';

import { useEffect, useState } from 'react';
import { Bell, Plus, Trash2, RefreshCw } from 'lucide-react';
import type { NotificationLogRow, NotificationSubscriptionRow } from '@/lib/notifications/types';
import { SubscriptionForm } from './notifications/SubscriptionForm';
import { NotificationLogList } from './notifications/NotificationLogList';

// ---------------------------------------------------------------------------
// AlertDashboard — workspace panel for notification subscriptions + log.
//
// Layout:
//   Section 1: "Suscripciones activas" — list + "Agregar" button that mounts
//              SubscriptionForm inline (no modal).
//   Section 2: "Notificaciones recientes" — NotificationLogList.
//
// Dark theme consistent with workspace shell. Typography/spacing mirrors
// AreaCard conventions (rounded-xl border border-zinc-800 bg-zinc-900/50).
// ---------------------------------------------------------------------------

export function AlertDashboard() {
  const [subscriptions, setSubscriptions] = useState<NotificationSubscriptionRow[]>([]);
  const [logItems, setLogItems] = useState<NotificationLogRow[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [loadingLog, setLoadingLog] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function fetchSubscriptions() {
    setLoadingSubs(true);
    try {
      const res = await fetch('/api/notifications/subscriptions');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { items: NotificationSubscriptionRow[] };
      setSubscriptions(data.items ?? []);
    } catch {
      setFetchError('No se pudieron cargar las suscripciones.');
    } finally {
      setLoadingSubs(false);
    }
  }

  async function fetchLog() {
    setLoadingLog(true);
    try {
      const res = await fetch('/api/notifications/log');
      if (!res.ok) {
        // Route may not exist yet — fail silently with empty list.
        setLogItems([]);
        return;
      }
      const data = (await res.json()) as { items: NotificationLogRow[] };
      setLogItems(data.items ?? []);
    } catch {
      setLogItems([]);
    } finally {
      setLoadingLog(false);
    }
  }

  useEffect(() => {
    void fetchSubscriptions();
    void fetchLog();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm('¿Cancelar esta suscripción? Ya no recibirás notificaciones en este correo.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/notifications/subscriptions/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setSubscriptions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      alert('Error al eliminar la suscripción. Por favor intenta de nuevo.');
    } finally {
      setDeletingId(null);
    }
  }

  function handleFormSuccess(row: NotificationSubscriptionRow) {
    setSubscriptions((prev) => {
      const exists = prev.findIndex((s) => s.id === row.id);
      if (exists >= 0) {
        return prev.map((s) => (s.id === row.id ? row : s));
      }
      return [row, ...prev];
    });
    setShowForm(false);
  }

  const activeSubs = subscriptions.filter((s) => s.active);

  return (
    <div className="space-y-8">
      {/* ── Section 1: Subscriptions ─────────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Bell className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-200">Suscripciones activas</h2>
            {!loadingSubs && (
              <span className="rounded-full bg-zinc-700/60 px-2 py-0.5 text-xs text-zinc-400">
                {activeSubs.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { void fetchSubscriptions(); void fetchLog(); }}
              title="Actualizar"
              className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 transition hover:bg-amber-500/20"
              >
                <Plus className="h-3.5 w-3.5" />
                Agregar
              </button>
            )}
          </div>
        </div>

        {fetchError && (
          <p className="mb-4 rounded-lg border border-red-800/40 bg-red-950/20 px-3 py-2 text-xs text-red-400">
            {fetchError}
          </p>
        )}

        {/* Inline form */}
        {showForm && (
          <div className="mb-5">
            <SubscriptionForm
              onSuccess={handleFormSuccess}
              onCancel={() => setShowForm(false)}
            />
          </div>
        )}

        {/* Subscriptions list */}
        {loadingSubs ? (
          <div className="space-y-2.5">
            {[1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-zinc-800/60" />
            ))}
          </div>
        ) : activeSubs.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-600">
            Sin suscripciones activas. Agrega una para recibir alertas por email.
          </p>
        ) : (
          <ul className="space-y-2">
            {activeSubs.map((sub) => (
              <li
                key={sub.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/60 bg-zinc-800/30 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-200">{sub.recipientId}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {sub.label ? `${sub.label} · ` : ''}
                    {((sub.events ?? []) as string[]).length} eventos ·{' '}
                    <span className="capitalize">{sub.channel}</span>
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(sub.id)}
                  disabled={deletingId === sub.id}
                  title="Eliminar suscripción"
                  className="shrink-0 rounded-lg p-1.5 text-zinc-600 transition hover:bg-red-950/40 hover:text-red-400 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Section 2: Recent log ─────────────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <h2 className="text-sm font-semibold text-zinc-200">Notificaciones recientes</h2>
          <span className="text-xs text-zinc-600">(últimos 30 días)</span>
        </div>

        {loadingLog ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-zinc-800/60" />
            ))}
          </div>
        ) : (
          <NotificationLogList items={logItems} />
        )}
      </section>
    </div>
  );
}
