// ---------------------------------------------------------------------------
// Precios de transferencia — cálculos deterministas (cero LLM)
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (tributario-modulos-09, -10, -17). El LLM producía:
//   - los umbrales de obligatoriedad con UVT 2026 fija para cualquier periodo
//     y los booleanos isObligated / *MeetsThreshold sin verificación;
//   - el rango intercuartil, «dentro del rango» y «CUMPLE», incluso con
//     comparables simulados;
//   - los topes de las sanciones del Art. 260-11 con cifras que no son las del
//     texto vigente.
// Este módulo recalcula todo eso en código y los agentes sobrescriben la
// salida del modelo DESPUÉS de la llamada.
//
// Fuentes (textos del corpus `src/data/tax_docs/`):
//   - Arts. 260-5 y 260-9 E.T.: patrimonio bruto al último día del año
//     gravable ≥ 100.000 UVT o ingresos brutos del respectivo año ≥ 61.000 UVT,
//     con operaciones con vinculados (Arts. 260-1 y 260-2).
//   - Art. 260-7 par. 2 E.T.: operaciones con jurisdicciones no cooperantes /
//     de baja o nula imposición → régimen de PT sin importar los topes.
//   - DUR 1625/2016 art. 1.2.2.2.5 (Decreto 3030/2013 art. 8): metodología
//     del rango intercuartil (posiciones e interpolación).
//   - Art. 260-11 E.T. (texto corregido por el Decreto 939 de 2017).
// ---------------------------------------------------------------------------

import { uvtToCopByYear } from '@/lib/accounting/tax-engine/constants';
import type {
  ComparableAnalysisReportJson,
  TpAnalysisReportJson,
} from '../../contracts/transfer-pricing';

// ---------------------------------------------------------------------------
// Año gravable y umbrales de obligatoriedad (Arts. 260-5 / 260-9)
// ---------------------------------------------------------------------------

export const TP_UMBRAL_PATRIMONIO_UVT = 100_000;
export const TP_UMBRAL_INGRESOS_UVT = 61_000;

/**
 * Año gravable a partir de la etiqueta del periodo ("2025", "AG 2025",
 * "2025-12"). Sin un año de cuatro dígitos se lanza un error explícito: los
 * umbrales dependen de la UVT del año gravable y no se sustituyen por otro.
 */
export function taxYearFromFiscalPeriod(fiscalPeriod: string | undefined | null): number {
  const m = /(19|20)\d{2}/.exec(fiscalPeriod ?? '');
  if (!m) {
    throw new Error(
      `Precios de transferencia: el periodo fiscal "${fiscalPeriod ?? ''}" no identifica el año gravable; los umbrales de los Arts. 260-5 y 260-9 E.T. se calculan con la UVT de ese año.`,
    );
  }
  return Number(m[0]);
}

export interface TpObligationThresholds {
  year: number;
  /** UVT oficial del año gravable (COP). */
  uvtCop: number;
  /** 100.000 UVT en centavos (string MoneyCop). */
  grossEquityThresholdCents: string;
  /** 61.000 UVT en centavos (string MoneyCop). */
  grossIncomeThresholdCents: string;
}

/** Lanza `RangeError` si la UVT del año no está registrada (tax-engine/constants). */
export function tpObligationThresholds(year: number): TpObligationThresholds {
  const uvtCop = uvtToCopByYear(1, year);
  return {
    year,
    uvtCop,
    grossEquityThresholdCents: (BigInt(uvtToCopByYear(TP_UMBRAL_PATRIMONIO_UVT, year)) * BigInt(100)).toString(),
    grossIncomeThresholdCents: (BigInt(uvtToCopByYear(TP_UMBRAL_INGRESOS_UVT, year)) * BigInt(100)).toString(),
  };
}

/**
 * Sobrescribe los umbrales y las conclusiones de obligatoriedad del LLM con el
 * cálculo determinista. Los montos de patrimonio e ingresos del contribuyente
 * son los que el modelo extrajo del texto de entrada (no hay balance
 * estructurado en esta ruta); la comparación y la conclusión se hacen aquí.
 */
export function enforceTpObligation(
  json: TpAnalysisReportJson,
  thresholds: TpObligationThresholds,
): TpAnalysisReportJson {
  const o = json.obligation;
  const equityMeets = BigInt(o.grossEquityCop) >= BigInt(thresholds.grossEquityThresholdCents);
  const incomeMeets = BigInt(o.grossIncomeCop) >= BigInt(thresholds.grossIncomeThresholdCents);
  const hasControlled = json.controlledTransactions.length > 0 || json.relatedParties.length > 0;
  const isObligated = (hasControlled && (equityMeets || incomeMeets)) || o.hasTaxHavenTransactions;
  const notes = [...json.technicalNotes];
  if (isObligated !== o.isObligated || equityMeets !== o.grossEquityMeetsThreshold || incomeMeets !== o.grossIncomeMeetsThreshold) {
    notes.push(
      `Obligatoriedad recalculada en código con la UVT ${thresholds.year} ($${thresholds.uvtCop.toLocaleString('es-CO')}); la conclusión del modelo no coincidía y se descartó.`,
    );
  }
  return {
    ...json,
    obligation: {
      ...o,
      grossEquityThresholdCop: thresholds.grossEquityThresholdCents,
      grossIncomeThresholdCop: thresholds.grossIncomeThresholdCents,
      grossEquityMeetsThreshold: equityMeets,
      grossIncomeMeetsThreshold: incomeMeets,
      isObligated,
    },
    technicalNotes: notes,
  };
}

// ---------------------------------------------------------------------------
// Rango intercuartil — DUR 1625/2016 art. 1.2.2.2.5
// ---------------------------------------------------------------------------

export interface InterquartileStats {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

/** Valor en la posición (base 1) con interpolación lineal de la parte decimal. */
function valorEnPosicion(sorted: readonly number[], pos: number): number {
  const entero = Math.floor(pos);
  const decimal = pos - entero;
  const base = sorted[Math.min(Math.max(entero, 1), sorted.length) - 1];
  if (decimal === 0 || entero >= sorted.length) return base;
  const siguiente = sorted[entero];
  return base + decimal * (siguiente - base);
}

/**
 * Metodología del literal a) a h) del art. 1.2.2.2.5 DUR 1625/2016:
 *   mediana = posición (n + 1) / 2
 *   P25     = posición (mediana + 1) / 2
 *   P75     = posición (mediana − 1) + P25
 * con interpolación cuando la posición tiene decimales. `null` sin datos.
 */
export function interquartileRangeDur1625(values: readonly number[]): InterquartileStats | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return null;
  const posMediana = (n + 1) / 2;
  const posP25 = (posMediana + 1) / 2;
  const posP75 = posMediana - 1 + posP25;
  const r = (v: number) => Math.round(v * 10_000) / 10_000;
  return {
    n,
    min: r(sorted[0]),
    q1: r(valorEnPosicion(sorted, posP25)),
    median: r(valorEnPosicion(sorted, posMediana)),
    q3: r(valorEnPosicion(sorted, posP75)),
    max: r(sorted[n - 1]),
  };
}

export interface TpRangeCheck {
  stats: InterquartileStats | null;
  observedPliPercent: number | null;
  /** `null` = no determinable (sin comparables o sin PLI observado). */
  isWithinRange: boolean | null;
  /** Ajuste relativo a la mediana (pp). `null` si no determinable. */
  requiredAdjustmentPercent: number | null;
  simulatedCount: number;
  /** false ⇒ escenario ilustrativo: no se emite «CUMPLE» ni filas 1125 definitivas. */
  conclusive: boolean;
  /** Motivo en español cuando `conclusive === false`. */
  reason: string | null;
}

export function computeTpRangeCheck(json: ComparableAnalysisReportJson): TpRangeCheck {
  const comparables = json.selectedComparables;
  const stats = interquartileRangeDur1625(comparables.map((c) => c.pliPercent));
  const observed = json.interquartileRange.observedPliPercent;
  const simulatedCount = comparables.filter((c) => c.isSimulated).length;
  let isWithinRange: boolean | null = null;
  let requiredAdjustmentPercent: number | null = null;
  if (stats && observed !== null && Number.isFinite(observed)) {
    isWithinRange = observed >= stats.q1 && observed <= stats.q3;
    requiredAdjustmentPercent = isWithinRange ? 0 : Math.round((stats.median - observed) * 100) / 100;
  }
  const motivos: string[] = [];
  if (!stats) motivos.push('no hay comparables seleccionados');
  if (observed === null) motivos.push('el PLI observado de la parte analizada no está determinado');
  if (simulatedCount > 0) {
    motivos.push(`${simulatedCount} de ${comparables.length} comparables son simulados (sin base de datos verificable)`);
  }
  return {
    stats,
    observedPliPercent: observed,
    isWithinRange,
    requiredAdjustmentPercent,
    simulatedCount,
    conclusive: motivos.length === 0,
    reason: motivos.length === 0 ? null : `Escenario ilustrativo, no concluyente: ${motivos.join('; ')}.`,
  };
}

/**
 * Sobrescribe `interquartileRange` y `armLengthConclusion` con el cálculo
 * determinista. El ajuste en COP no tiene base verificable en esta ruta (el
 * denominador del PLI no llega estructurado): si cumple es "0"; si no, se
 * conserva la estimación del modelo y el render la rotula como tal.
 */
export function enforceComparableAnalysis(
  json: ComparableAnalysisReportJson,
  check: TpRangeCheck,
): ComparableAnalysisReportJson {
  const s = check.stats;
  const complies = check.conclusive && check.isWithinRange === true;
  return {
    ...json,
    interquartileRange: {
      ...json.interquartileRange,
      min: s?.min ?? 0,
      q1: s?.q1 ?? 0,
      median: s?.median ?? 0,
      q3: s?.q3 ?? 0,
      max: s?.max ?? 0,
      isWithinRange: check.isWithinRange === true,
    },
    armLengthConclusion: {
      ...json.armLengthConclusion,
      complies,
      requiredAdjustmentPercent: check.requiredAdjustmentPercent ?? 0,
      requiredAdjustmentCop: check.isWithinRange === true ? '0' : json.armLengthConclusion.requiredAdjustmentCop,
    },
  };
}
