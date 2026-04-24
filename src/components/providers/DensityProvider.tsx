'use client';

/**
 * DensityProvider — 2-way density switcher (comfortable | compact).
 *
 * Mechanism: toggles `data-density="comfortable|compact"` on <html>. CSS
 * tokens appended at the end of globals.css react to this attribute to
 * tighten spacing/typography when compact is selected.
 *
 * SSR/FOUC: DENSITY_INIT_SCRIPT runs synchronously before hydration (placed
 * as an early child of <body> in app/layout.tsx alongside THEME_INIT_SCRIPT)
 * so the correct data-density is set before any paint. React state syncs on
 * mount via useLayoutEffect.
 *
 * Interop with DensitySection: the section already writes to
 * localStorage['utopia-density'] and mirrors to document.documentElement.
 * This provider reads the same key and exposes { density, setDensity } for
 * any consumer that needs programmatic access.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';

export const DENSITY_STORAGE_KEY = 'utopia-density';

export type Density = 'comfortable' | 'compact';

interface DensityContextValue {
  density: Density;
  setDensity: (d: Density) => void;
}

// Inline pre-hydration script — synchronous, no-throw. Sets data-density on
// <html> based on localStorage. Defaults to 'comfortable'. Runs before React
// hydrates, preventing FOUC when compact was previously selected.
export const DENSITY_INIT_SCRIPT = `(function(){try{
  var k='${DENSITY_STORAGE_KEY}';
  var stored = localStorage.getItem(k);
  var d = (stored==='compact'||stored==='comfortable') ? stored : 'comfortable';
  document.documentElement.setAttribute('data-density', d);
}catch(e){}})();`;

const DensityContext = createContext<DensityContextValue | null>(null);

const useIsoLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function DensityProvider({ children }: { children: React.ReactNode }) {
  const [density, setDensityState] = useState<Density>('comfortable');

  // Sync React state from localStorage on mount. The init script has already
  // applied data-density to <html>; this ensures consumers see the right
  // value in state too.
  useIsoLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(DENSITY_STORAGE_KEY);
      if (stored === 'comfortable' || stored === 'compact') {
        setDensityState(stored);
      }
    } catch {
      // Private mode or disabled storage — keep default.
    }
  }, []);

  // Mirror React state to <html>. Covers programmatic setDensity calls as
  // well as any external mutation we want to keep in sync.
  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

  const setDensity = useCallback((d: Density) => {
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, d);
    } catch {
      // Ignore storage errors.
    }
    setDensityState(d);
  }, []);

  return (
    <DensityContext.Provider value={{ density, setDensity }}>
      {children}
    </DensityContext.Provider>
  );
}

export function useDensity(): DensityContextValue {
  const ctx = useContext(DensityContext);
  if (!ctx) throw new Error('useDensity must be used within DensityProvider');
  return ctx;
}
