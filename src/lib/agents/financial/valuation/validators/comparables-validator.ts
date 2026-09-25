// ---------------------------------------------------------------------------
// Validador determinista de la valoración por múltiplos (valoracion-13)
// ---------------------------------------------------------------------------
// El LLM aporta los comparables (con fuente), las métricas del objetivo, el
// múltiplo primario y los ajustes colombianos. El código recalcula:
//
//   - Estadísticas por múltiplo (mediana, media, mín, máx, n) desde los
//     comparables con valor > 0 (un múltiplo ≤ 0 proviene de métricas negativas
//     y no es comparable).
//   - Aplicabilidad: un múltiplo NO aplica si la métrica del objetivo es N/D o
//     ≤ 0 (EV/EBITDA con EBITDA negativo, P/E con pérdida…).
//   - Valor implícito del múltiplo primario:
//       EV/EBITDA, EV/Revenue → EV_k = múltiplo_k × métrica;
//                               Patrimonio_k = EV_k − deuda neta del objetivo
//       P/E, P/BV             → Patrimonio_k = múltiplo_k × métrica;
//                               EV_k = Patrimonio_k + deuda neta (si existe)
//   - Rango ajustado: Patrimonio_k × Π(1 − descuento_i) × Π(1 + prima_j),
//     con k ∈ {mín, mediana, máx} ⇒ conservador ≤ base ≤ optimista.
//
// Si el múltiplo primario no aplica o falta la deuda neta para un múltiplo de
// EV, la metodología queda "no emitible" (N/D con motivo). Nunca se cambia el
// múltiplo primario por juicio del código.
// ---------------------------------------------------------------------------

import type { MarketComparablesReportJson } from '../../contracts/valuation';
import { formatCopFromCents, parseMoneyCop, serializeMoneyCop } from '../../contracts/money';
import { RATE_SCALE, ZERO, divRoundHalfUp, moneyDiffers, multiplyByMultiple, powBig } from '../calc/fixed-point';
import type { ValidationDiscrepancy, ValidationIssue } from './wacc';

export type MultipleKey = 'ev_ebitda' | 'pe' | 'pbv' | 'ev_revenue';

export const MULTIPLE_LABELS: Record<MultipleKey, string> = {
  ev_ebitda: 'EV/EBITDA',
  pe: 'P/E',
  pbv: 'P/BV',
  ev_revenue: 'EV/Revenue',
};

const MULTIPLE_ORDER: MultipleKey[] = ['ev_ebitda', 'pe', 'pbv', 'ev_revenue'];

export interface MultipleStat {
  multiple: MultipleKey;
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  count: number;
  applicable: boolean;
  notApplicableReason: { es: string; en: string } | null;
}

export interface ComparablesComputed {
  statistics: MultipleStat[];
  primaryMultiple: MultipleKey;
  implied: {
    enterpriseValueMinCop: string | null;
    enterpriseValueMedianCop: string | null;
    enterpriseValueMaxCop: string | null;
    equityValueMinCop: string;
    equityValueMedianCop: string;
    equityValueMaxCop: string;
  };
  /** Factor combinado de ajustes (presentación). */
  adjustmentFactor: number;
  adjustedRange: { conservativeCop: string; baseCop: string; optimisticCop: string };
  comparablesUsed: number;
}

export type ComparablesValidation =
  | { status: 'ok'; computed: ComparablesComputed; discrepancies: ValidationDiscrepancy[]; notes: ValidationIssue[] }
  | {
      status: 'blocked';
      blockingErrors: ValidationIssue[];
      statistics: MultipleStat[];
      discrepancies: ValidationDiscrepancy[];
      notes: ValidationIssue[];
    };

const fmtCop = (v: bigint) => formatCopFromCents(v, false);

function comparableValue(
  c: MarketComparablesReportJson['comparableSelection']['comparables'][number],
  m: MultipleKey,
): number | null {
  switch (m) {
    case 'ev_ebitda': return c.evEbitda;
    case 'pe': return c.pe;
    case 'pbv': return c.pBv;
    case 'ev_revenue': return c.evRevenue;
  }
}

function targetMetric(json: MarketComparablesReportJson, m: MultipleKey): string | null {
  const v = json.impliedValuation;
  switch (m) {
    case 'ev_ebitda': return v.targetEbitdaCop;
    case 'pe': return v.targetNetIncomeCop;
    case 'pbv': return v.targetBookValueCop;
    case 'ev_revenue': return v.targetRevenueCop;
  }
}

const METRIC_LABEL: Record<MultipleKey, { es: string; en: string }> = {
  ev_ebitda: { es: 'EBITDA', en: 'EBITDA' },
  pe: { es: 'utilidad neta', en: 'net income' },
  pbv: { es: 'valor en libros', en: 'book value' },
  ev_revenue: { es: 'ingresos', en: 'revenue' },
};

function median(sorted: number[]): number {
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** Estadísticas recalculadas para los 4 múltiplos canónicos. */
export function computeMultipleStatistics(json: MarketComparablesReportJson): MultipleStat[] {
  return MULTIPLE_ORDER.map((m) => {
    const values = json.comparableSelection.comparables
      .map((c) => comparableValue(c, m))
      .filter((v): v is number => v !== null && Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    const metric = targetMetric(json, m);
    let reason: { es: string; en: string } | null = null;
    if (metric === null) {
      reason = { es: `${METRIC_LABEL[m].es} del objetivo N/D`, en: `target ${METRIC_LABEL[m].en} not available` };
    } else if (parseMoneyCop(metric) <= ZERO) {
      reason = { es: `${METRIC_LABEL[m].es} del objetivo ≤ 0`, en: `target ${METRIC_LABEL[m].en} ≤ 0` };
    } else if (values.length === 0) {
      reason = { es: 'sin comparables con múltiplo positivo', en: 'no comparables with a positive multiple' };
    }
    const count = values.length;
    return {
      multiple: m,
      median: count > 0 ? median(values) : null,
      mean: count > 0 ? values.reduce((a, b) => a + b, 0) / count : null,
      min: count > 0 ? values[0] : null,
      max: count > 0 ? values[count - 1] : null,
      count,
      applicable: reason === null,
      notApplicableReason: reason,
    };
  });
}

export function validateComparables(json: MarketComparablesReportJson): ComparablesValidation {
  const discrepancies: ValidationDiscrepancy[] = [];
  const notes: ValidationIssue[] = [];
  const blocking: ValidationIssue[] = [];

  const statistics = computeMultipleStatistics(json);

  // Contraste de las estadísticas emitidas por el LLM.
  for (const reported of json.multipleStatistics) {
    const s = statistics.find((x) => x.multiple === reported.multiple);
    if (!s) continue;
    const label = MULTIPLE_LABELS[reported.multiple];
    if (s.count === 0) {
      discrepancies.push({ field: `${label} (n)`, reported: String(reported.count), recomputed: '0' });
      continue;
    }
    const pairs: Array<[string, number, number]> = [
      ['mediana', reported.median, s.median as number],
      ['media', reported.mean, s.mean as number],
      ['mín', reported.min, s.min as number],
      ['máx', reported.max, s.max as number],
    ];
    for (const [name, r, c] of pairs) {
      if (Math.abs(r - c) > 0.005) {
        discrepancies.push({ field: `${label} ${name}`, reported: `${r.toFixed(2)}x`, recomputed: `${c.toFixed(2)}x` });
      }
    }
    if (reported.count !== s.count) {
      discrepancies.push({ field: `${label} (n)`, reported: String(reported.count), recomputed: String(s.count) });
    }
  }

  const nComparables = json.comparableSelection.comparables.length;
  if (nComparables < 4) {
    notes.push({
      code: 'small_sample',
      es: `Muestra de ${nComparables} comparable(s), inferior a los 4-6 recomendados (NIIF 13 Nivel 2): confianza baja.`,
      en: `Sample of ${nComparables} comparable(s), below the recommended 4-6 (IFRS 13 Level 2): low confidence.`,
    });
  }

  // -- Múltiplo primario --------------------------------------------------------
  const primary = json.impliedValuation.primaryMultiple;
  const primaryStat = statistics.find((s) => s.multiple === primary) as MultipleStat;
  if (!primaryStat.applicable) {
    const r = primaryStat.notApplicableReason as { es: string; en: string };
    blocking.push({
      code: 'primary_multiple_not_applicable',
      es: `El múltiplo primario ${MULTIPLE_LABELS[primary]} no aplica: ${r.es}.`,
      en: `The primary multiple ${MULTIPLE_LABELS[primary]} does not apply: ${r.en}.`,
    });
  }

  const isEvMultiple = primary === 'ev_ebitda' || primary === 'ev_revenue';
  const netDebtRaw = json.impliedValuation.targetNetDebtCop;
  if (isEvMultiple && netDebtRaw === null) {
    blocking.push({
      code: 'net_debt_missing',
      es: `Falta la deuda neta del objetivo para el puente EV → patrimonio del múltiplo ${MULTIPLE_LABELS[primary]}.`,
      en: `Target net debt missing for the EV → equity bridge of the ${MULTIPLE_LABELS[primary]} multiple.`,
    });
  }

  // -- Ajustes colombianos ------------------------------------------------------
  let factorNum = RATE_SCALE;
  let factorPow = 1;
  for (const a of json.adjustments) {
    const p = a.appliedPercent;
    const isDiscount = a.type !== 'control_premium';
    if (!Number.isFinite(p) || p < 0 || (isDiscount && p >= 100)) {
      blocking.push({
        code: 'adjustment_invalid',
        es: `Ajuste ${a.type} inválido (${p}%): los descuentos van en [0, 100) y las primas ≥ 0.`,
        en: `Invalid ${a.type} adjustment (${p}%): discounts must lie in [0, 100) and premiums ≥ 0.`,
      });
      continue;
    }
    const scaled = BigInt(Math.round((isDiscount ? 100 - p : 100 + p) * 10_000));
    factorNum *= scaled;
    factorPow += 1;
  }

  if (blocking.length > 0) {
    return { status: 'blocked', blockingErrors: blocking, statistics, discrepancies, notes };
  }

  const metric = parseMoneyCop(targetMetric(json, primary) as string);
  const netDebt = netDebtRaw === null ? null : parseMoneyCop(netDebtRaw);
  const points = [primaryStat.min, primaryStat.median, primaryStat.max] as number[];
  const evs: Array<bigint | null> = [];
  const equities: bigint[] = [];
  for (const m of points) {
    const product = multiplyByMultiple(metric, m);
    if (isEvMultiple) {
      evs.push(product);
      equities.push(product - (netDebt as bigint));
    } else {
      equities.push(product);
      evs.push(netDebt === null ? null : product + netDebt);
    }
  }

  // factor = Π(escala_i) / RATE_SCALE^(k); se aplica con un único redondeo.
  const factorDen = powBig(RATE_SCALE, factorPow);
  const adjusted = equities.map((e) => divRoundHalfUp(e * factorNum, factorDen));
  const adjustmentFactor = Number(factorNum * BigInt(1_000_000) / factorDen) / 1_000_000;

  // Contraste con lo emitido por el LLM.
  const iv = json.impliedValuation;
  const cmp = (field: string, reportedRaw: string, recomputed: bigint | null) => {
    if (recomputed === null) return;
    const r = parseMoneyCop(reportedRaw);
    if (moneyDiffers(r, recomputed)) discrepancies.push({ field, reported: fmtCop(r), recomputed: fmtCop(recomputed) });
  };
  cmp('EV implícito mín', iv.enterpriseValueMinCop, evs[0]);
  cmp('EV implícito mediana', iv.enterpriseValueMedianCop, evs[1]);
  cmp('EV implícito máx', iv.enterpriseValueMaxCop, evs[2]);
  cmp('Patrimonio implícito mín', iv.equityValueMinCop, equities[0]);
  cmp('Patrimonio implícito mediana', iv.equityValueMedianCop, equities[1]);
  cmp('Patrimonio implícito máx', iv.equityValueMaxCop, equities[2]);
  cmp('Rango ajustado conservador', json.adjustedValueRange.conservativeCop, adjusted[0]);
  cmp('Rango ajustado base', json.adjustedValueRange.baseCop, adjusted[1]);
  cmp('Rango ajustado optimista', json.adjustedValueRange.optimisticCop, adjusted[2]);

  const ser = (v: bigint | null) => (v === null ? null : serializeMoneyCop(v));
  return {
    status: 'ok',
    discrepancies,
    notes,
    computed: {
      statistics,
      primaryMultiple: primary,
      implied: {
        enterpriseValueMinCop: ser(evs[0]),
        enterpriseValueMedianCop: ser(evs[1]),
        enterpriseValueMaxCop: ser(evs[2]),
        equityValueMinCop: serializeMoneyCop(equities[0]),
        equityValueMedianCop: serializeMoneyCop(equities[1]),
        equityValueMaxCop: serializeMoneyCop(equities[2]),
      },
      adjustmentFactor,
      adjustedRange: {
        conservativeCop: serializeMoneyCop(adjusted[0]),
        baseCop: serializeMoneyCop(adjusted[1]),
        optimisticCop: serializeMoneyCop(adjusted[2]),
      },
      comparablesUsed: primaryStat.count,
    },
  };
}
