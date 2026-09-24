// ---------------------------------------------------------------------------
// Pilar ESCUDO — Series de barras temporales (EscudoTrendBars)
// ---------------------------------------------------------------------------
// Detecta la granularidad del balance y construye una serie lista para
// renderizar en ECharts. Lógica determinística, sin LLM.
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
import { detectGranularity } from '@/lib/pillars/valor-bars';

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export type EscudoGranularity = 'monthly' | 'quarterly' | 'annual';

export interface EscudoBarSeries {
  /** Etiqueta del eje X (ej. "2023", "T-1", "ene 25"). */
  label: string;
  /** Identificador interno del período (ej. "2023", "2024-01"). */
  period: string;
  /** Saldo de efectivo (Cuenta 11, pesos colombianos). */
  efectivo: number;
  /** Total activo corriente (pesos colombianos). */
  activoCorriente: number;
  /** Total pasivo corriente (pesos colombianos). */
  pasivoCorriente: number;
  /** Razón corriente = activoCorriente / pasivoCorriente; null si pasivoCorriente=0. */
  solvencia: number | null;
  /** true si el punto fue generado por interpolación (datos provisionales). */
  isInterpolated: boolean;
}

// ─── Re-export detectGranularity ────────────────────────────────────────────

export { detectGranularity };

// ─── Helpers internos ───────────────────────────────────────────────────────

const MESES_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
] as const;

/** Genera etiqueta legible dado el identificador de período. */
function labelFromPeriod(period: string, index: number, total: number): string {
  if (/^\d{4}$/.test(period)) return period;
  const mmMatch = period.match(/^(\d{4})-(\d{2})$/);
  if (mmMatch) {
    const yr = mmMatch[1].slice(2);
    const mo = parseInt(mmMatch[2], 10) - 1;
    return `${MESES_ES[mo] ?? mmMatch[2]} ${yr}`;
  }
  const offset = index - (total - 1);
  return offset === 0 ? 'T-0' : `T${offset}`;
}

/** Extrae los campos de liquidez de un snapshot. */
function extractLiquidity(snap: PeriodSnapshot): {
  efectivo: number;
  activoCorriente: number;
  pasivoCorriente: number;
  solvencia: number | null;
} {
  const ct = snap.controlTotals;
  const efectivo = ct.efectivoCuenta11;
  const activoCorriente = ct.activoCorriente;
  const pasivoCorriente = ct.pasivoCorriente;
  const solvencia = pasivoCorriente > 0 ? activoCorriente / pasivoCorriente : null;
  return { efectivo, activoCorriente, pasivoCorriente, solvencia };
}

// ─── Función principal ──────────────────────────────────────────────────────

/**
 * Construye la serie `EscudoBarSeries[]` a partir del balance preprocesado.
 *
 * - 1 período → un único punto real (la UI oculta la tendencia).
 * - Múltiples períodos → un punto por período (T-n … T-0).
 */
export function buildEscudoBarSeries(balance: PreprocessedBalance): EscudoBarSeries[] {
  const { periods } = balance;
  if (periods.length === 0) return [];

  // Un punto por periodo REAL. Con un solo periodo se devuelve ese único punto
  // (la UI oculta la tendencia): antes se fabricaban 12 meses (saldos de cierre
  // ÷ 12, tendencias descendentes o estacionalidad senoidal) — ratios-kpis-20.

  return periods.map((snap, idx) => {
    const { efectivo, activoCorriente, pasivoCorriente, solvencia } = extractLiquidity(snap);
    return {
      label: labelFromPeriod(snap.period, idx, periods.length),
      period: snap.period,
      efectivo,
      activoCorriente,
      pasivoCorriente,
      solvencia,
      isInterpolated: false,
    };
  });
}
