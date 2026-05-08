// ---------------------------------------------------------------------------
// Pilar ESCUDO — Series de barras temporales (EscudoTrendBars)
// ---------------------------------------------------------------------------
// Detecta la granularidad del balance y construye una serie lista para
// renderizar en ECharts. Lógica determinística, sin LLM.
//
// Granularidades:
//   'annual'    → 1 período en el balance  → interpolar 12 meses provisionales
//   'quarterly' → 2-3 períodos             → mostrar cada período (T-n…T-0)
//   'monthly'   → >= 4 períodos            → mostrar cada período directamente
//
// El campo `isInterpolated` marca si el punto es real o estimado linealmente.
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
 * - 1 período anual → interpola 12 meses linealmente (isInterpolated=true).
 * - Múltiples períodos → un punto por período (T-n … T-0).
 */
export function buildEscudoBarSeries(balance: PreprocessedBalance): EscudoBarSeries[] {
  const { periods } = balance;
  if (periods.length === 0) return [];

  const granularity = detectGranularity(periods);

  if (granularity === 'annual' && periods.length === 1) {
    return buildInterpolatedMonths(periods[0]);
  }

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

/**
 * Interpola 12 meses cuando sólo hay 1 período anual.
 * Distribuye linealmente efectivo y activo/pasivo corriente.
 * Variación estacional sinusoidal ±5% sobre efectivo (igual que valor-bars).
 */
function buildInterpolatedMonths(snap: PeriodSnapshot): EscudoBarSeries[] {
  const { efectivo: efectivoAnual, activoCorriente: acAnual, pasivoCorriente: pcAnual } =
    extractLiquidity(snap);

  const yearMatch = snap.period.match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1].slice(2) : '??';

  return MESES_ES.map((mes, i) => {
    const seasonal = 1 + (Math.sin((i * Math.PI) / 6) * 0.05);
    const weight = seasonal / 12;
    const efectivo = Math.round(efectivoAnual * weight);
    const activoCorriente = Math.round(acAnual * weight);
    const pasivoCorriente = Math.round(pcAnual / 12);
    const solvencia = pasivoCorriente > 0 ? activoCorriente / pasivoCorriente : null;
    return {
      label: `${mes} ${year}`,
      period: `${snap.period}-${String(i + 1).padStart(2, '0')}`,
      efectivo,
      activoCorriente,
      pasivoCorriente,
      solvencia,
      isInterpolated: true,
    };
  });
}
