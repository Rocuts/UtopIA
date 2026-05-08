// ---------------------------------------------------------------------------
// Pilar VALOR — Series de barras temporales (ValorTrendBars)
// ---------------------------------------------------------------------------
// Detecta la granularidad del balance y construye una serie lista para
// renderizar en recharts. Lógica determinística, sin LLM.
//
// Granularidades:
//   'annual'    → 1 período en el balance  → interpolar 12 meses provisionales
//   'quarterly' → 2-3 períodos             → mostrar cada período (T-n…T-0)
//   'monthly'   → >= 4 períodos            → mostrar cada período directamente
//
// El campo `isInterpolated` marca si el punto es real o estimado linealmente.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export type ValorGranularity = 'monthly' | 'quarterly' | 'annual';

export interface ValorBarSeries {
  /** Etiqueta del eje X (ej. "2023", "T-1", "ene 25"). */
  label: string;
  /** EBITDA del periodo (pesos colombianos). */
  ebitda: number;
  /** Free Cash Flow; null si no hay EFE (sin periodo comparativo). */
  fcf: number | null;
  /** Ingresos totales (Clase 4). */
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

/** Extrae EBITDA de un snapshot.
 *  EBITDA = Utilidad Operacional + Depreciaciones (5160) + Amortizaciones (5165). */
function extractEbitda(snap: PeriodSnapshot): number {
  const ct = snap.controlTotals;
  const claseGastos = snap.classes.find((c) => c.code === 5);
  const dep = claseGastos?.accounts
    .filter((a) => a.code.startsWith('5160') && !isVirtual(a.code))
    .reduce((s, a) => s + a.balance, 0) ?? 0;
  const amor = claseGastos?.accounts
    .filter((a) => a.code.startsWith('5165') && !isVirtual(a.code))
    .reduce((s, a) => s + a.balance, 0) ?? 0;
  const utilidadOp = ct.utilidadNeta + ct.impuestosCuenta24;
  return utilidadOp + dep + amor;
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

function isVirtual(code: string): boolean {
  return (
    code.endsWith('VC') ||
    code.endsWith('ZZ') ||
    code.startsWith('2810ZZ-') ||
    code.startsWith('3710ZZ')
  );
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
 * - 1 período anual → interpola 12 meses linealmente (isInterpolated=true).
 * - Múltiples períodos → un punto por período (T-n … T-0).
 */
export function buildValorBarSeries(balance: PreprocessedBalance): ValorBarSeries[] {
  const { periods } = balance;
  if (periods.length === 0) return [];

  const granularity = detectGranularity(periods);

  if (granularity === 'annual' && periods.length === 1) {
    return buildInterpolatedMonths(periods[0]);
  }

  // Múltiples períodos → serie directa.
  return periods.map((snap, idx) => ({
    label: labelFromPeriod(snap.period, idx, periods.length),
    ebitda: extractEbitda(snap),
    fcf: extractFcf(snap),
    ingresos: snap.controlTotals.ingresos,
    period: snap.period,
    isInterpolated: false,
  }));
}

/**
 * Interpola 12 meses cuando sólo hay 1 período anual.
 * Distribuye linealmente EBITDA e ingresos. FCF se divide en 12.
 */
function buildInterpolatedMonths(snap: PeriodSnapshot): ValorBarSeries[] {
  const ebitdaAnual = extractEbitda(snap);
  const ingresosAnual = snap.controlTotals.ingresos;
  const fcfAnual = extractFcf(snap);

  // Año base del período.
  const yearMatch = snap.period.match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1].slice(2) : '??';

  return MESES_ES.map((mes, i) => {
    // Distribución lineal con pequeña variación estacional sintética (±5%)
    // para que las barras no sean todas idénticas → más legible visualmente.
    const seasonal = 1 + (Math.sin((i * Math.PI) / 6) * 0.05);
    const weight = seasonal / 12;
    return {
      label: `${mes} ${year}`,
      ebitda: Math.round(ebitdaAnual * weight),
      fcf: fcfAnual !== null ? Math.round(fcfAnual * weight) : null,
      ingresos: Math.round(ingresosAnual * weight),
      period: `${snap.period}-${String(i + 1).padStart(2, '0')}`,
      isInterpolated: true,
    };
  });
}
