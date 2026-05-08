// ---------------------------------------------------------------------------
// useChartTheme — hook SSR-safe para obtener el theme de ECharts vigente.
// ---------------------------------------------------------------------------
// La aplicación cambia entre claro y oscuro vía `<html data-theme="dark">` o
// `data-theme="elite"`. ECharts tiene su propio concepto de theme registrado
// (`utopia-light` / `utopia-dark`), así que este hook traduce el atributo
// del DOM al nombre del tema en cada cambio.
//
// El hook es client-only por construcción (usa MutationObserver). En SSR
// devuelve `'utopia-light'`.
// ---------------------------------------------------------------------------

'use client';

import { useEffect, useState } from 'react';

export type ChartTheme = 'utopia-light' | 'utopia-dark';

function readTheme(): ChartTheme {
  if (typeof document === 'undefined') return 'utopia-light';
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark' || t === 'elite') return 'utopia-dark';
  return 'utopia-light';
}

export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>('utopia-light');

  useEffect(() => {
    setTheme(readTheme());
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}
