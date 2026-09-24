// ---------------------------------------------------------------------------
// Pilar VALOR — Series de barras temporales (ValorTrendBars)
// ---------------------------------------------------------------------------
// Detecta la granularidad del balance y construye una serie lista para
// renderizar en recharts. Lógica determinística, sin LLM.
//
// Granularidades:
//   'annual'    → 1 período en el balance  → un único punto real (sin interpolar)
//   'quarterly' → 2-3 períodos             → mostrar cada período (T-n…T-0)
//   'monthly'   → >= 4 períodos            → mostrar cada período directamente
//
// `isInterpolated` se conserva en el contrato pero siempre es false: ya no se
// generan puntos sintéticos (auditoría ratios-kpis-20).
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

import { computeEbitda } from './ebitda';
import { ingresosNetosPeriodo } from './shared-metrics';

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export type ValorGranularity = 'monthly' | 'quarterly' | 'annual';

export interface ValorBarSeries {
  /** Etiqueta del eje X (ej. "2023", "T-1", "ene 25"). */
  label: string;
  /** EBITDA del periodo (pesos colombianos). `null` si no es calculable. */
  ebitda: number | null;
  /** Free Cash Flow; null si no hay EFE (sin periodo comparativo). */
  fcf: number | null;
  /** Ingresos netos de devoluciones 4175. */
  ingresos: number;
  /** Identificador interno del periodo (ej. "2023", "2024-Q1"). */
  period: string;
  /** true si el punto fue generado por interpolación (datos provisionales). */
  isInterpolated: boolean;
}

// ─── Helpers internos ───────────────────────────────────────────────────────

const MESES_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
] as const;

/** EBITDA del snapshot — definición única de ./ebitda.ts (ratios-kpis-05).
 *  `null` sin desglose del grupo 41; nunca utilidad neta + saldo del pasivo 24. */
function extractEbitda(snap: PeriodSnapshot): number | null {
  return computeEbitda(snap).ebitda;
}

/** Extrae FCF del EFE indirecto del snapshot; null si no disponible. */
function extractFcf(snap: PeriodSnapshot): number | null {
  const efe = snap.cashFlowIndirecto;
  if (!efe) return null;
  const ocf = efe.operating.total;
  const capex = efe.investing.varPPE;
  if (capex === null || capex === undefined) return ocf;
  return ocf - Math.abs(capex);
}

/** Genera etiqueta legible dado el identificador de periodo. */
function labelFromPeriod(period: string, index: number, total: number): string {
  // Si el identificador es un año YYYY puro, usarlo directamente.
  if (/^\d{4}$/.test(period)) return period;
  // Si tiene formato YYYY-MM, convertir a "mes YY".
  const mmMatch = period.match(/^(\d{4})-(\d{2})$/);
  if (mmMatch) {
    const yr = mmMatch[1].slice(2); // "25"
    const mo = parseInt(mmMatch[2], 10) - 1;
    return `${MESES_ES[mo] ?? mmMatch[2]} ${yr}`;
  }
  // Fallback: posición relativa.
  const offset = index - (total - 1);
  return offset === 0 ? 'T-0' : `T${offset}`;
}

// ─── Detección de granularidad ───────────────────────────────────────────────

/**
 * Detecta la granularidad del balance a partir de los identificadores de periodo.
 *
 * Heurística:
 *   - Si todos los IDs tienen formato YYYY (4 dígitos) → annual/quarterly según conteo.
 *   - Si algún ID tiene formato YYYY-MM → monthly.
 *   - Si algún ID tiene "Q" → quarterly.
 *   - Fallback por conteo: 1 → annual, 2-3 → quarterly, ≥4 → monthly.
 */
export function detectGranularity(periods: PeriodSnapshot[]): ValorGranularity {
  if (periods.length === 0) return 'annual';

  const ids = periods.map((p) => p.period);
  const hasMonthly = ids.some((id) => /^\d{4}-\d{2}$/.test(id));
  if (hasMonthly) return 'monthly';

  const hasQuarterly = ids.some((id) => /Q\d/i.test(id));
  if (hasQuarterly) return 'quarterly';

  // Todos son años YYYY o labels genéricos.
  if (periods.length === 1) return 'annual';
  if (periods.length <= 3) return 'quarterly';
  return 'monthly';
}

// ─── Función principal ──────────────────────────────────────────────────────

/**
 * Construye la serie `ValorBarSeries[]` a partir del balance preprocesado.
 *
 * - 1 período → un único punto real (la UI oculta la tendencia).
 * - Múltiples períodos → un punto por período (T-n … T-0).
 */
export function buildValorBarSeries(balance: PreprocessedBalance): ValorBarSeries[] {
  const { periods } = balance;
  if (periods.length === 0) return [];

  // Un punto por periodo REAL. Con un solo periodo se devuelve ese único punto
  // (la UI oculta la tendencia): antes se fabricaban 12 meses (saldos de cierre
  // ÷ 12, tendencias descendentes o estacionalidad senoidal) — ratios-kpis-20.

  return periods.map((snap, idx) => ({
    label: labelFromPeriod(snap.period, idx, periods.length),
    ebitda: extractEbitda(snap),
    fcf: extractFcf(snap),
    ingresos: ingresosNetosPeriodo(snap.controlTotals),
    period: snap.period,
    isInterpolated: false,
  }));
}
