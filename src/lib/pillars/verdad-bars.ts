// ---------------------------------------------------------------------------
// Pilar VERDAD — Series de barras temporales (VerdadTrendBars)
// ---------------------------------------------------------------------------
// Detecta la granularidad del balance y construye una serie lista para
// renderizar en ECharts. Lógica determinística, sin LLM.
//
// Granularidades:
//   'annual'    → 1 período en el balance  → un único punto real (sin interpolar)
//   'quarterly' → 2-3 períodos             → mostrar cada período (T-n…T-0)
//   'monthly'   → >= 4 períodos            → mostrar cada período directamente
//
// El campo `isInterpolated` marca si el punto es real o estimado.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { detectGranularity } from '@/lib/pillars/valor-bars';

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export type VerdadGranularity = 'monthly' | 'quarterly' | 'annual';

export interface VerdadBarSeries {
  /** Etiqueta del eje X (ej. "2023", "T-1", "ene 25"). */
  label: string;
  /** Identificador interno del período (ej. "2023", "2024-01"). */
  period: string;
  /**
   * Total de errores ponderados:
   *   críticos × 3 + altos × 1 + discrepancias + reclasificaciones.
   */
  errores: number;
  /**
   * Binario: 1 si la ecuación patrimonial desbalanceada > $1.000 COP, 0 si cuadra.
   */
  descalces: number;
  /**
   * Proxy de anomalías: cantidad de reclasificaciones NIIF aplicadas.
   */
  anomalias: number;
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

/** Extrae los campos de integridad de un snapshot. */
function extractIntegrity(snap: PeriodSnapshot): {
  errores: number;
  descalces: number;
  anomalias: number;
} {
  const findings = snap.curator?.findings ?? [];
  const criticos = findings.filter((f) => f.severity === 'critico').length;
  const altos = findings.filter((f) => f.severity === 'alto').length;
  const discrepancias = snap.discrepancies?.length ?? 0;
  const reclasifs = snap.reclassifications?.length ?? 0;

  const errores = criticos * 3 + altos + discrepancias + reclasifs;
  const descalces = Math.abs(snap.summary.equationBalance) > 1000 ? 1 : 0;
  const anomalias = reclasifs;

  return { errores, descalces, anomalias };
}

// ─── Función principal ──────────────────────────────────────────────────────

/**
 * Construye la serie `VerdadBarSeries[]` a partir del balance preprocesado.
 *
 * - 1 período → un único punto real (la UI oculta la tendencia).
 * - Múltiples períodos → un punto por período (T-n … T-0).
 */
export function buildVerdadBarSeries(balance: PreprocessedBalance): VerdadBarSeries[] {
  const { periods } = balance;
  if (periods.length === 0) return [];

  // Un punto por periodo REAL. Con un solo periodo se devuelve ese único punto
  // (la UI oculta la tendencia): antes se fabricaban 12 meses (saldos de cierre
  // ÷ 12, tendencias descendentes o estacionalidad senoidal) — ratios-kpis-20.

  return periods.map((snap, idx) => {
    const { errores, descalces, anomalias } = extractIntegrity(snap);
    return {
      label: labelFromPeriod(snap.period, idx, periods.length),
      period: snap.period,
      errores,
      descalces,
      anomalias,
      isInterpolated: false,
    };
  });
}
