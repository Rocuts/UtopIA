'use client';

/**
 * AdminConsole — orquestador del panel /admin.
 *
 * El boundary de seguridad real es el endpoint (header `x-admin-token` vs
 * `UTOPIA_ADMIN_TOKEN`). Aquí sólo gestionamos el token en sessionStorage:
 * sin token válido se muestra el gate; con token, el visor de logs.
 *
 * sessionStorage (no localStorage): el token se descarta al cerrar la pestaña.
 *
 * Se usa `useSyncExternalStore` en vez de useState+useEffect para leer un store
 * externo client-only sin disparar setState en efecto (react-hooks) y sin
 * mismatch de hidratación (el snapshot del servidor es siempre `null`).
 */

import { useCallback, useSyncExternalStore } from 'react';
import { AdminGate } from './AdminGate';
import { ActivityLogViewer } from './ActivityLogViewer';

const TOKEN_KEY = 'utopia.admin.token';

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === TOKEN_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function setStoredToken(token: string | null): void {
  try {
    if (token === null) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* sessionStorage no disponible */
  }
  listeners.forEach((l) => l());
}

export function AdminConsole() {
  // Snapshot del servidor siempre null → SSR muestra el gate y la transición a
  // cliente la maneja useSyncExternalStore sin warnings de hidratación.
  const token = useSyncExternalStore(subscribe, readToken, () => null);

  const handleAuth = useCallback((t: string) => setStoredToken(t), []);
  const handleLogout = useCallback(() => setStoredToken(null), []);

  if (!token) return <AdminGate onAuth={handleAuth} />;

  return <ActivityLogViewer token={token} onLogout={handleLogout} />;
}
