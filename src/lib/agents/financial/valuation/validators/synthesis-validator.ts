// ---------------------------------------------------------------------------
// Validador determinista de la síntesis de valor (valoracion-14 / valoracion-15)
// ---------------------------------------------------------------------------
// Entradas: el JSON del Sintetizador y los resultados YA VALIDADOS de las
// metodologías (null si no están disponibles). El código recalcula:
//
//   Pesos efectivos: metodología no disponible → 0; única disponible → 100.
//                    Con ambas: métodos únicos que sumen exactamente 100
//                    (±0,01) — si no, la opinión de valor se bloquea.
//   Base          = Σ peso_i × punto medio_i / 100
//   Divergencia   = |DCF − Múltiplos| / promedio × 100 (sólo con ambas)
//   Bandera roja  = divergencia > 50%
//   Rango         = conservador/optimista del LLM ordenados y acotados a
//                   [mín de los pisos, máx de los techos] de las metodologías,
//                   con conservador ≤ base ≤ optimista.
// ---------------------------------------------------------------------------

import type { ValuationSynthesisReportJson } from '../../contracts/valuation';
import { formatCopFromCents, parseMoneyCop, serializeMoneyCop } from '../../contracts/money';
import { absBig, divRoundHalfUp, maxBig, minBig, moneyDiffers, ZERO } from '../calc/fixed-point';
import type { ValidationDiscrepancy, ValidationIssue } from './wacc';

export type MethodKey = 'dcf' | 'market_comparables';

/** Resumen validado de una metodología (valor del patrimonio). */
export interface MethodologySummary {
  midpointCop: string;
  lowCop: string;
  highCop: string;
}

export interface SynthesisInputs {
  dcf: MethodologySummary | null;
  comparables: MethodologySummary | null;
}

export interface SynthesisComputed {
  methodologies: MethodKey[];
  weights: Record<MethodKey, number>;
  dcfMidpointCop: string | null;
  comparablesMidpointCop: string | null;
  boundsLowCop: string;
  boundsHighCop: string;
  conservativeCop: string;
  baseCop: string;
  optimisticCop: string;
  divergencePercent: number | null;
  divergenceIsRedFlag: boolean;
}

export type SynthesisValidation =
  | { status: 'ok'; computed: SynthesisComputed; discrepancies: ValidationDiscrepancy[]; notes: ValidationIssue[] }
  | { status: 'blocked'; blockingErrors: ValidationIssue[]; discrepancies: ValidationDiscrepancy[] };

const fmtCop = (v: bigint) => formatCopFromCents(v, false);
const METHOD_LABEL: Record<MethodKey, string> = { dcf: 'DCF', market_comparables: 'Múltiplos' };

function clamp(v: bigint, lo: bigint, hi: bigint): bigint {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function validateSynthesis(json: ValuationSynthesisReportJson, inputs: SynthesisInputs): SynthesisValidation {
  const discrepancies: ValidationDiscrepancy[] = [];
  const notes: ValidationIssue[] = [];
  const available: MethodKey[] = [];
  if (inputs.dcf) available.push('dcf');
  if (inputs.comparables) available.push('market_comparables');
  if (available.length === 0) {
    return {
      status: 'blocked',
      blockingErrors: [{
        code: 'no_methodology',
        es: 'Ninguna metodología válida (DCF y múltiplos no disponibles): no se emite opinión de valor.',
        en: 'No valid methodology (DCF and multiples unavailable): no value opinion is issued.',
      }],
      discrepancies,
    };
  }

  // -- Pesos efectivos ------------------------------------------------------------
  const weights: Record<MethodKey, number> = { dcf: 0, market_comparables: 0 };
  const methodsListed = json.methodologyWeights.map((w) => w.method);
  const duplicated = methodsListed.length !== new Set(methodsListed).size;
  if (available.length === 1) {
    const only = available[0];
    weights[only] = 100;
    const reported = json.methodologyWeights.find((w) => w.method === only)?.weightPercent ?? null;
    const other = json.methodologyWeights.filter((w) => w.method !== only && w.weightPercent > 0);
    if (duplicated || reported !== 100 || other.length > 0) {
      discrepancies.push({
        field: 'Pesos',
        reported: json.methodologyWeights.map((w) => `${METHOD_LABEL[w.method]} ${w.weightPercent}%`).join(' + '),
        recomputed: `${METHOD_LABEL[only]} 100% (metodología única disponible)`,
      });
    }
  } else {
    const sum = json.methodologyWeights.reduce((a, w) => a + w.weightPercent, 0);
    const covers = available.every((m) => methodsListed.includes(m));
    if (duplicated || !covers || Math.abs(sum - 100) > 0.01 + 1e-9) {
      return {
        status: 'blocked',
        blockingErrors: [{
          code: 'invalid_weights',
          es: `Ponderación inválida: ${json.methodologyWeights.map((w) => `${METHOD_LABEL[w.method]} ${w.weightPercent}%`).join(' + ')} (se exigen métodos únicos DCF y Múltiplos que sumen 100%). No se emite opinión de valor.`,
          en: `Invalid weighting: ${json.methodologyWeights.map((w) => `${w.method} ${w.weightPercent}%`).join(' + ')} (unique DCF and multiples methods summing to 100% are required). No value opinion is issued.`,
        }],
        discrepancies,
      };
    }
    for (const w of json.methodologyWeights) weights[w.method] = w.weightPercent;
  }

  // -- Base ponderada ----------------------------------------------------------------
  const mids: Record<MethodKey, bigint | null> = {
    dcf: inputs.dcf ? parseMoneyCop(inputs.dcf.midpointCop) : null,
    market_comparables: inputs.comparables ? parseMoneyCop(inputs.comparables.midpointCop) : null,
  };
  let weighted = ZERO;
  for (const m of available) {
    weighted += (mids[m] as bigint) * BigInt(Math.round(weights[m] * 100));
  }
  const base = divRoundHalfUp(weighted, BigInt(10_000));

  // -- Límites de las metodologías ----------------------------------------------------
  const lows: bigint[] = [];
  const highs: bigint[] = [];
  for (const s of [inputs.dcf, inputs.comparables]) {
    if (!s) continue;
    lows.push(parseMoneyCop(s.lowCop), parseMoneyCop(s.midpointCop));
    highs.push(parseMoneyCop(s.highCop), parseMoneyCop(s.midpointCop));
  }
  const boundsLow = minBig(lows);
  const boundsHigh = maxBig(highs);

  // -- Rango del LLM ordenado y acotado --------------------------------------------------
  const r = json.consolidatedRange;
  const llmCons = parseMoneyCop(r.conservativeCop);
  const llmOpt = parseMoneyCop(r.optimisticCop);
  const llmBase = parseMoneyCop(r.baseCop);
  const ordered = [llmCons < llmOpt ? llmCons : llmOpt, llmCons < llmOpt ? llmOpt : llmCons];
  const conservative = clamp(ordered[0], boundsLow, base);
  const optimistic = clamp(ordered[1], base, boundsHigh);
  if (moneyDiffers(llmBase, base)) {
    discrepancies.push({ field: 'Base (punto medio ponderado)', reported: fmtCop(llmBase), recomputed: fmtCop(base) });
  }
  if (conservative !== llmCons) {
    discrepancies.push({ field: 'Conservador (piso)', reported: fmtCop(llmCons), recomputed: fmtCop(conservative) });
  }
  if (optimistic !== llmOpt) {
    discrepancies.push({ field: 'Optimista (techo)', reported: fmtCop(llmOpt), recomputed: fmtCop(optimistic) });
  }

  // -- Reconciliación -------------------------------------------------------------------------
  const rec = json.methodologyReconciliation;
  const cmpMid = (field: string, reported: string | null, recomputed: bigint | null) => {
    if (recomputed === null) {
      if (reported !== null) discrepancies.push({ field, reported: fmtCop(parseMoneyCop(reported)), recomputed: 'N/D' });
      return;
    }
    if (reported === null || moneyDiffers(parseMoneyCop(reported), recomputed)) {
      discrepancies.push({ field, reported: reported === null ? 'N/D' : fmtCop(parseMoneyCop(reported)), recomputed: fmtCop(recomputed) });
    }
  };
  cmpMid('Punto medio DCF', rec.dcfMidpointCop, mids.dcf);
  cmpMid('Punto medio Múltiplos', rec.comparablesMidpointCop, mids.market_comparables);

  let divergence: number | null = null;
  let redFlag = false;
  if (mids.dcf !== null && mids.market_comparables !== null) {
    const sum = mids.dcf + mids.market_comparables;
    if (sum > ZERO) {
      // |D − C| / ((D + C)/2) × 100, redondeado a 0,1 pp
      const tenthsOfPct = divRoundHalfUp(absBig(mids.dcf - mids.market_comparables) * BigInt(2000), sum);
      divergence = Number(tenthsOfPct) / 10;
      redFlag = divergence > 50;
    } else {
      notes.push({
        code: 'divergence_undefined',
        es: 'Divergencia no definida: el promedio de los puntos medios es ≤ 0.',
        en: 'Divergence undefined: the average of the midpoints is ≤ 0.',
      });
    }
  }
  const reportedDiv = rec.divergencePercent;
  if ((divergence === null) !== (reportedDiv === null) || (divergence !== null && reportedDiv !== null && Math.abs(divergence - reportedDiv) > 0.1)) {
    discrepancies.push({
      field: 'Divergencia',
      reported: reportedDiv === null ? 'N/D' : `${reportedDiv.toFixed(1)}%`,
      recomputed: divergence === null ? 'N/D' : `${divergence.toFixed(1)}%`,
    });
  }
  if (rec.divergenceIsRedFlag !== redFlag) {
    discrepancies.push({
      field: 'Bandera roja (divergencia > 50%)',
      reported: rec.divergenceIsRedFlag ? 'Sí' : 'No',
      recomputed: redFlag ? 'Sí' : 'No',
    });
  }

  return {
    status: 'ok',
    discrepancies,
    notes,
    computed: {
      methodologies: available,
      weights,
      dcfMidpointCop: mids.dcf === null ? null : serializeMoneyCop(mids.dcf),
      comparablesMidpointCop: mids.market_comparables === null ? null : serializeMoneyCop(mids.market_comparables),
      boundsLowCop: serializeMoneyCop(boundsLow),
      boundsHighCop: serializeMoneyCop(boundsHigh),
      conservativeCop: serializeMoneyCop(conservative),
      baseCop: serializeMoneyCop(base),
      optimisticCop: serializeMoneyCop(optimistic),
      divergencePercent: divergence,
      divergenceIsRedFlag: redFlag,
    },
  };
}
