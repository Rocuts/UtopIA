// ---------------------------------------------------------------------------
// Pilar FUTURO — Series de proyección de caja (FuturoTrendBars)
// ---------------------------------------------------------------------------
// Genera 12 meses PROYECTADOS hacia el futuro bajo 3 escenarios: base,
// conservador y agresivo. Usa el snapshot actual como punto de partida.
//
// A diferencia de verdad-bars / escudo-bars / valor-bars, esta serie es
// SIEMPRE proyectada — sin granularidad histórica, sin detectGranularity.
//
// Factores por escenario aplicados al ingreso mensual:
//   Base         → 1.00 (escenario medio)
//   Conservadora → 0.85 (20% contracción de ingresos, ej. estrés de cartera)
//   Agresiva     → 1.10 (10% mejora, ej. campaña comercial exitosa)
// ---------------------------------------------------------------------------

import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export interface FuturoBarSeries {
  /** Etiqueta del eje X. Ej "M+1", "M+2". */
  label: string;
  /** Índice del mes proyectado (1-12). */
  monthIndex: number;
  /** Caja proyectada — escenario base (factor 1.0). */
  cajaBase: number;
  /** Caja proyectada — escenario conservador (factor 0.85 sobre ingresos). */
  cajaConservadora: number;
  /** Caja proyectada — escenario agresivo (factor 1.10 sobre ingresos). */
  cajaAgresiva: number;
}

// ─── Constantes ─────────────────────────────────────────────────────────────

const FACTOR_BASE = 1.0;
const FACTOR_CONSERVADOR = 0.85;
const FACTOR_AGRESIVO = 1.10;

// ─── Función principal ───────────────────────────────────────────────────────

/**
 * Construye la serie `FuturoBarSeries[]` (12 meses proyectados) a partir del
 * balance preprocesado.
 *
 * Siempre retorna exactamente 12 puntos. No interpola períodos históricos.
 *
 * Fórmula por escenario (mes m):
 *   caja[m] = caja[m-1] + ingresoMes × factor − egresoMes
 */
export function buildFuturoBarSeries(balance: PreprocessedBalance): FuturoBarSeries[] {
  const ct = balance.primary.controlTotals;

  const cajaInicial = ct.efectivoCuenta11;
  const ingresoMes = ct.ingresos / 12;
  const egresoMes = ct.gastos / 12;

  const series: FuturoBarSeries[] = [];

  let prevBase = cajaInicial;
  let prevCons = cajaInicial;
  let prevAgr = cajaInicial;

  for (let m = 1; m <= 12; m++) {
    const cajaBase = prevBase + ingresoMes * FACTOR_BASE - egresoMes;
    const cajaConservadora = prevCons + ingresoMes * FACTOR_CONSERVADOR - egresoMes;
    const cajaAgresiva = prevAgr + ingresoMes * FACTOR_AGRESIVO - egresoMes;

    series.push({
      label: `M+${m}`,
      monthIndex: m,
      cajaBase,
      cajaConservadora,
      cajaAgresiva,
    });

    prevBase = cajaBase;
    prevCons = cajaConservadora;
    prevAgr = cajaAgresiva;
  }

  return series;
}
