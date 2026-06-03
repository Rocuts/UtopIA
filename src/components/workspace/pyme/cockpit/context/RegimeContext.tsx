'use client';

/**
 * RegimeContext — régimen tributario activo del cockpit (RST vs Ordinario).
 *
 * Pantallas y tarjetas condicionan su contenido según el régimen. Por ahora
 * arranca desde mockUser.regime; cuando se cablee /api/pyme/* el provider
 * recibirá el régimen real del workspace.
 */
import { createContext, useContext, useMemo, useState } from 'react';
import { mockUser } from '../mockData';
import type { Regime } from '../types';

interface RegimeContextValue {
  regime: Regime;
  setRegime: (r: Regime) => void;
  isRST: boolean;
  isOrdinario: boolean;
}

const RegimeContext = createContext<RegimeContextValue | null>(null);

export function RegimeProvider({ children }: { children: React.ReactNode }) {
  const [regime, setRegime] = useState<Regime>(mockUser.regime);

  const value = useMemo<RegimeContextValue>(
    () => ({
      regime,
      setRegime,
      isRST: regime === 'RST',
      isOrdinario: regime === 'ORDINARIO',
    }),
    [regime],
  );

  return <RegimeContext.Provider value={value}>{children}</RegimeContext.Provider>;
}

export function useRegime(): RegimeContextValue {
  const ctx = useContext(RegimeContext);
  if (!ctx) {
    throw new Error('useRegime debe usarse dentro de <RegimeProvider>');
  }
  return ctx;
}
