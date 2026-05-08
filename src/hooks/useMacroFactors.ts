/**
 * Hook cliente — Factores macro Colombia (IPC, TRM, Tasa BanRep).
 *
 * Hace fetch a /api/macro/current (cache-aware, 1h CDN + 24h stale).
 * Retorna { macro, loading, error }.
 *
 * Uso:
 *   const { macro, loading } = useMacroFactors();
 *   if (macro) console.log(macro.trm); // e.g. 4215.12
 */

'use client';

import { useEffect, useState } from 'react';
import type { MacroFactors } from '@/lib/pillars/types';

export interface UseMacroFactorsResult {
  macro: MacroFactors | null;
  loading: boolean;
  error: string | null;
}

export function useMacroFactors(): UseMacroFactorsResult {
  const [macro, setMacro] = useState<MacroFactors | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/macro/current');
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as MacroFactors;
        if (!cancelled) setMacro(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error desconocido');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { macro, loading, error };
}
