'use client';

import { useSyncExternalStore } from 'react';

export type GreetingSlot = 'morning' | 'afternoon' | 'evening';

function currentSlot(): GreetingSlot {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 19) return 'afternoon';
  return 'evening';
}

/** Re-evalúa cada minuto para cruzar fronteras de tramo (p.ej. 11:59 → 12:00). */
function subscribe(callback: () => void): () => void {
  const id = setInterval(callback, 60_000);
  return () => clearInterval(id);
}

/**
 * Devuelve el tramo del día actual ('morning' | 'afternoon' | 'evening').
 *
 * Usa `useSyncExternalStore`: el snapshot de servidor es 'morning' (estable,
 * sin hydration mismatch — React re-renderiza con el valor real tras hidratar)
 * y el del cliente computa la hora local. El getSnapshot devuelve un primitivo,
 * así que `Object.is` evita renders innecesarios cuando el tramo no cambia.
 * La localización (texto) la resuelve el componente vía i18n.
 */
export function useGreeting(): GreetingSlot {
  return useSyncExternalStore(subscribe, currentSlot, () => 'morning');
}
