'use client';

/**
 * syncService — sube las entradas pendientes de la cola offline a Supabase
 * via /api/pyme/entries cuando hay conexión.
 */

import { getPendingEntries, markSynced } from './localDB';

interface SyncResult {
  synced: number;
  errors: number;
}

export async function syncPendingEntries(): Promise<SyncResult> {
  const pending = await getPendingEntries();
  let synced = 0;
  let errors = 0;

  for (const entry of pending) {
    try {
      const localId = entry.localId;
      const body = {
        bookId: entry.bookId,
        description: entry.description,
        kind: entry.kind,
        amount: entry.amount,
        category: entry.category,
        entryDate: entry.entryDate,
      };
      const res = await fetch('/api/pyme/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (localId !== undefined) await markSynced(localId);
      synced++;
    } catch {
      errors++;
    }
  }

  return { synced, errors };
}
