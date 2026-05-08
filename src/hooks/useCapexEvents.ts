'use client';

/**
 * useCapexEvents — Persistencia de Eventos de Futuro en localStorage.
 *
 * Almacena la lista de CapexEvent bajo la clave
 * `utopia:capex-events:<workspaceId>`. SSR-safe: lee localStorage solo
 * después del primer montaje.
 */

import { useState, useEffect, useCallback } from 'react';
import { z } from 'zod';
import type { CapexEvent } from '@/lib/pillars/futuro-bars';

const CapexEventSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  monthOffset: z.number().int().min(1).max(12),
  amountCop: z.number().nonnegative(),
});
const CapexEventsArraySchema = z.array(CapexEventSchema);

function storageKey(workspaceId: string): string {
  return `utopia:capex-events:${workspaceId}`;
}

function readFromStorage(workspaceId: string): CapexEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId));
    if (!raw) return [];
    const parsed = CapexEventsArraySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    return parsed.data;
  } catch {
    return [];
  }
}

function writeToStorage(workspaceId: string, events: CapexEvent[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(events));
  } catch {
    // quota exceeded — fail silently
  }
}

export interface UseCapexEventsReturn {
  events: CapexEvent[];
  addEvent: (event: Omit<CapexEvent, 'id'>) => void;
  removeEvent: (id: string) => void;
  clearAll: () => void;
}

export function useCapexEvents(workspaceId: string): UseCapexEventsReturn {
  // Initialize with empty array (SSR-safe). Real values load after mount.
  const [events, setEvents] = useState<CapexEvent[]>([]);

  // Read from localStorage after first mount.
  useEffect(() => {
    setEvents(readFromStorage(workspaceId));
  }, [workspaceId]);

  // Persist to localStorage on every change (after mount).
  useEffect(() => {
    writeToStorage(workspaceId, events);
  }, [workspaceId, events]);

  const addEvent = useCallback((event: Omit<CapexEvent, 'id'>) => {
    // Validate: monthOffset must be 1-12, amountCop must be >= 0.
    const month = Math.round(event.monthOffset);
    const amount = event.amountCop;
    if (month < 1 || month > 12 || amount < 0 || !Number.isFinite(amount)) return;

    const newEvent: CapexEvent = {
      id: crypto.randomUUID(),
      name: event.name.trim() || 'Evento',
      monthOffset: Math.min(12, Math.max(1, month)),
      amountCop: amount,
    };

    setEvents((prev) => [...prev, newEvent]);
  }, []);

  const removeEvent = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setEvents([]);
  }, []);

  return { events, addEvent, removeEvent, clearAll };
}
