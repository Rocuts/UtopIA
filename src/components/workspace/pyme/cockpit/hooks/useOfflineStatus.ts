'use client';

import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/**
 * `true` cuando el navegador está online.
 *
 * Usa `useSyncExternalStore` (idiomático React 19 + SSR-safe): el snapshot de
 * servidor es `true` (optimista, sin hydration mismatch) y el del cliente lee
 * `navigator.onLine`, suscribiéndose a los eventos online/offline. El spec
 * original hacía `useState(navigator.onLine)`, que rompe en SSR porque
 * `navigator` no existe en el servidor.
 */
export function useOfflineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
