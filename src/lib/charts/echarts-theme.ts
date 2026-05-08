// ---------------------------------------------------------------------------
// ECharts themes — UtopIA design tokens (light & dark).
// ---------------------------------------------------------------------------
// ECharts no resuelve CSS variables, así que mapeamos los hex EXACTOS de los
// design tokens (`globals.css`) a un tema registrado. Cada tema se registra
// una sola vez al importar este módulo. Los widgets reciben el nombre del
// tema vía `useChartTheme()`.
//
// IMPORTANT: si los tokens cambian en `globals.css`, actualiza estos hex.
// ---------------------------------------------------------------------------

import { echarts } from './setup';

// ─── Hex tokens (luz) ───────────────────────────────────────────────────────
const LIGHT = {
  bg: '#FCFBF8',           // n-0
  textPrimary: '#0C0A06',  // n-1000
  textSecondary: '#5C5642', // n-700
  border: '#E2DCC8',       // n-200
  gold: '#B8934A',         // gold-500
  goldSoft: '#D4B876',     // gold-300
  wine: '#A04855',         // wine-500
  wineDeep: '#722F37',     // wine-700 (sangría)
  success: '#4F7A4C',
  warning: '#C48A2E',
  danger: '#A83838',
  info: '#3D6B7E',
  areaVerdad: '#3D6B7E',
  areaValor: '#B8934A',
  areaFuturo: '#5A7F7A',
  areaEscudo: '#A83838',
};

// ─── Hex tokens (oscuro) ────────────────────────────────────────────────────
const DARK = {
  bg: '#0A0907',           // n-0 dark = espresso warm
  textPrimary: '#FAF5E6',  // n-1000 dark
  textSecondary: '#B8B19A', // n-700 dark
  border: '#3A3528',       // n-200 dark
  gold: '#D4B876',
  goldSoft: '#B8934A',
  wine: '#B85968',
  wineDeep: '#902F37',
  success: '#7AAC75',
  warning: '#E0A857',
  danger: '#D85858',
  info: '#6BA0B5',
  areaVerdad: '#6BA0B5',
  areaValor: '#D4B876',
  areaFuturo: '#88B5A6',
  areaEscudo: '#D85858',
};

// La paleta principal cubre los 8 slots típicos que ECharts asigna a
// múltiples series. Orden: gold/wine/success/warning/info + áreas.
function buildPalette(t: typeof LIGHT): string[] {
  return [
    t.gold,
    t.wine,
    t.success,
    t.warning,
    t.info,
    t.areaVerdad,
    t.areaFuturo,
    t.areaEscudo,
  ];
}

function buildTheme(t: typeof LIGHT) {
  return {
    backgroundColor: 'transparent',
    color: buildPalette(t),
    textStyle: {
      fontFamily: 'var(--font-sans), Geist Sans, system-ui, sans-serif',
      color: t.textPrimary,
    },
    title: {
      textStyle: { color: t.textPrimary, fontWeight: 500 },
      subtextStyle: { color: t.textSecondary },
    },
    legend: { textStyle: { color: t.textSecondary } },
    grid: { borderColor: t.border, top: 32, right: 24, bottom: 32, left: 48 },
    categoryAxis: {
      axisLine: { lineStyle: { color: t.border } },
      axisTick: { lineStyle: { color: t.border } },
      splitLine: { show: false },
      axisLabel: { color: t.textSecondary },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: t.border, type: 'dashed' } },
      axisLabel: { color: t.textSecondary },
    },
    line: {
      lineStyle: { width: 2 },
      symbolSize: 6,
      smooth: true,
      symbol: 'circle',
    },
    bar: {
      itemStyle: { borderRadius: [3, 3, 0, 0] },
    },
    treemap: {
      itemStyle: { borderColor: t.bg, borderWidth: 1 },
    },
    tooltip: {
      backgroundColor: t.bg,
      borderColor: t.border,
      textStyle: { color: t.textPrimary },
      extraCssText: 'box-shadow: 0 8px 24px -8px rgba(0,0,0,0.18);',
    },
  };
}

// Registramos los temas una sola vez al primer import.
let registered = false;
function ensureRegistered() {
  if (registered) return;
  echarts.registerTheme('utopia-light', buildTheme(LIGHT));
  echarts.registerTheme('utopia-dark', buildTheme(DARK));
  registered = true;
}

ensureRegistered();

// ─── Constants exposed for widgets that need direct color access ──────────
export const TOKENS = { LIGHT, DARK };

/** Helper para resolver el set de tokens según el theme name. */
export function getTokens(theme: 'utopia-light' | 'utopia-dark') {
  return theme === 'utopia-dark' ? DARK : LIGHT;
}
