'use client';

/**
 * useSyncStatus — estado de conexión + cola offline de Contabilidad Pyme.
 *
 * Devuelve:
 *  - isOnline: bool (navigator.onLine actualizado en tiempo real)
 *  - pending: número de entradas pendientes de sync
 *  - syncing: bool durante la sincronización activa
 *  - sync(): dispara sync manual
 *  - label: string listo para mostrar al usuario
 */

import { useCallback, useEffect, useState } from 'react';
import { countPending } from '@/lib/pyme/localDB';
import { syncPendingEntries } from '@/lib/pyme/syncService';

export function useSyncStatus() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = useCallback(async () => {
    try {
      const n = await countPending();
      setPending(n);
    } catch {
      /* idb not available (SSR) */
    }
  }, []);

  const sync = useCallback(async () => {
    if (!isOnline || syncing) return;
    setSyncing(true);
    try {
      await syncPendingEntries();
      await refreshPending();
    } finally {
      setSyncing(false);
    }
  }, [isOnline, syncing, refreshPending]);

  useEffect(() => {
    refreshPending();

    const goOnline = async () => {
      setIsOnline(true);
      await sync();
    };
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-sync every 5 min when online + items pending
  useEffect(() => {
    if (!isOnline || pending === 0) return;
    const t = setInterval(() => { void sync(); }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [isOnline, pending, sync]);

  const label = (): string => {
    if (syncing) return 'Sincronizando…';
    if (!isOnline && pending > 0) return `Sin señal — ${pending} guardados`;
    if (!isOnline) return 'Sin señal';
    if (pending > 0) return `Sincronizando ${pending}…`;
    return 'Sincronizado';
  };

  return { isOnline, pending, syncing, sync, label };
}
