'use client';

// ---------------------------------------------------------------------------
// WindowBridge — puente NO destructivo entre el "diagnóstico de consola 1+1"
// (que asume APIs globales `window.sendPrompt` / `window.storage` y la clave
// `ancora_completo_2025`) y la realidad de UtopIA.
// ---------------------------------------------------------------------------
// Decisión de producto: el usuario quiere esas APIs LITERAL. El Team Lead exige
// respaldarlas con el orquestador y los datos REALES (no path muerto):
//
//   • window.sendPrompt(texto) → siembra `pendingChatSeed` en el WorkspaceContext
//     real y navega a /workspace; el ChatSidebar lo inyecta en su input.
//   • window.storage           → shim async sobre `localStorage` con shape `{ value }`.
//   • ancora_completo_2025     → espejo PLANO (en pesos) del âncora REAL que
//     expone `useAncoraView()` — JAMÁS cifras inventadas (defensa Art. 647 E.T.).
//
// Monta DENTRO de <WorkspaceProvider> (ahí vive el contexto). Retorna null.
// ---------------------------------------------------------------------------

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useWorkspace } from '@/context/WorkspaceContext';
import { useAncoraView } from '@/hooks/useAncoraView';

// ─── Tipado global no destructivo ───────────────────────────────────────────
// El shim `storage` es async para que el diagnóstico con `await` funcione.
interface WindowStorageShim {
  get(key: string): Promise<{ value: string } | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

declare global {
  interface Window {
    sendPrompt?: (texto: string) => void;
    storage?: WindowStorageShim;
  }
}

const ANCORA_MIRROR_KEY = 'ancora_completo_2025';

export function WindowBridge(): null {
  const { setPendingChatSeed } = useWorkspace();
  const router = useRouter();
  const { view } = useAncoraView();

  // ─── Effect A: instalar las globals (idempotente, una vez en montaje) ──────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // window.sendPrompt → orquestador REAL del chat.
    window.sendPrompt = (texto: string) => {
      try {
        setPendingChatSeed(String(texto ?? ''));
        router.push('/workspace');
      } catch {
        // Si por alguna razón el puente no puede enviar, no rompemos la página.
      }
    };

    // window.storage → shim async sobre localStorage con shape { value }.
    // Guarda NO destructiva: si otro proveedor ya lo definió, lo respetamos.
    if (!window.storage) {
      window.storage = {
        async get(key: string) {
          try {
            const raw = localStorage.getItem(key);
            return raw === null ? null : { value: raw };
          } catch {
            return null;
          }
        },
        async set(key: string, value: string) {
          try {
            localStorage.setItem(key, value);
          } catch { /* quota or SSR — best-effort */ }
        },
        async delete(key: string) {
          try {
            localStorage.removeItem(key);
          } catch { /* quota or SSR — best-effort */ }
        },
      };
    }

    // No removemos las globals en cleanup: son idempotentes y otros consumidores
    // (el diagnóstico) pueden invocarlas en cualquier momento de la sesión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Effect B: espejar el âncora REAL en localStorage (depende de `view`) ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Solo escribimos cuando hay datos reales. Si !hasData NO borramos ni
    // escribimos: dejamos intacto lo que ya hubiera (no destruimos, no inventamos).
    if (!view.hasData) return;

    try {
      // JSON PLANO en PESOS COP (números, no centavos). Campos tal cual del
      // view: pueden ser null si el âncora no los trae — NO inventamos valores.
      const mirror = {
        empresa: view.meta.empresa,
        nit: view.meta.nit,
        periodo: view.meta.periodoActual,
        A07: view.niif.ingresos,
        A08: view.niif.ingresosPrev,
        A11: view.niif.utilidadNeta,
        A19: view.niif.variacionCaja,
        F01: view.fiscal.f01,
        F10: view.fiscal.f10,
        scoreRiesgoDIAN: view.fiscal.scoreRiesgoDIAN,
        nivelRiesgo: view.fiscal.nivelRiesgo,
        crecimientoIngresosPct: view.derived.crecimientoIngresosPct,
      };
      localStorage.setItem(ANCORA_MIRROR_KEY, JSON.stringify(mirror));
    } catch {
      // SSR / quota / serialización: best-effort, nunca rompemos render.
    }
  }, [view]);

  return null;
}

export default WindowBridge;
