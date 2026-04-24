'use client';

/**
 * ThemeProvider — 3-way theme switcher (light | dark | system).
 *
 * Mechanism: toggles `data-theme="light|dark"` on <html>. The @custom-variant
 * in globals.css matches both `data-theme="dark"` and the legacy alias
 * `data-theme="elite"`, so resolving to "dark" here is sufficient for the
 * entire dark token cascade.
 *
 * SSR/FOUC: THEME_INIT_SCRIPT runs synchronously before hydration (placed as
 * the first child of <body> in app/layout.tsx) so the correct data-theme is
 * set before any paint. React state syncs on mount via useLayoutEffect.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';

export const THEME_STORAGE_KEY = 'utopia-theme';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
}

// Inline pre-hydration script — synchronous, no-throw. Sets data-theme on
// <html> based on localStorage (falls back to prefers-color-scheme). Runs
// before React hydrates, which prevents FOUC.
export const THEME_INIT_SCRIPT = `(function(){try{
  var k='${THEME_STORAGE_KEY}';
  var stored = localStorage.getItem(k);
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var t = (stored==='light'||stored==='dark'||stored==='system') ? stored : 'system';
  var resolved = t==='system' ? (prefersDark?'dark':'light') : t;
  document.documentElement.setAttribute('data-theme', resolved);
}catch(e){}})();`;

const ThemeContext = createContext<ThemeContextValue | null>(null);

// useLayoutEffect runs after DOM paint and avoids a flash on hydration, but
// it logs a warning on the server — noop there.
const useIsoLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  // Read persisted theme once on mount. The init script has already applied
  // data-theme to <html>, but we still need to sync React state so that
  // consumers (toggle UI) see the correct `theme` value.
  useIsoLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setThemeState(stored);
      }
    } catch {
      // Private mode or disabled storage — stay on 'system' default.
    }
  }, []);

  // Resolve `theme` to a concrete light|dark value, write to <html>, and
  // subscribe to OS-level changes when theme is 'system'.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const compute = () => {
      const resolved: ResolvedTheme =
        theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      setResolvedTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
    };

    compute();

    const onChange = () => {
      if (theme === 'system') compute();
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {
      // Ignore storage errors.
    }
    setThemeState(t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
