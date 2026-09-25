// ---------------------------------------------------------------------------
// Recalculo determinista de Rf, Ke y WACC (valoracion-06 / valoracion-07)
// ---------------------------------------------------------------------------
// El LLM declara los componentes; el código recalcula:
//
//   Base TES_COP_ex_default:
//     Rf    = TES 10Y COP − diferencial soberano
//     Ke    = Rf + β·ERP(madura) + CRP + SP
//   Base UST_USD_fisher:
//     Ke$   = Rf(UST) + β·ERP(madura) + CRP + SP
//     Ke    = (1 + Ke$)·(1 + π COP)/(1 + π USD) − 1
//   WACC    = E/V·Ke + D/V·Kd·(1 − t)
//
// Bloqueos (no se emite valor):
//   - E/V + D/V ≠ 100 o pesos fuera de [0, 100].
//   - Base TES con CRP > 0 sin diferencial soberano > 0 declarado: el TES
//     completo más el CRP cuenta dos veces el riesgo país.
//   - Base USD sin inflaciones COP/USD para la conversión Fisher.
//   - WACC ≤ 0.
// Discrepancias (se publica el valor recalculado y se lista la diferencia):
//   - Rf, Ke o WACC emitidos que difieren > 0,01 pp del recalculado.
// ---------------------------------------------------------------------------

import type { WaccBreakdownJson } from '../../contracts/valuation';
import { percentDiffers, roundPercent } from '../calc/fixed-point';

export interface ValidationIssue {
  code: string;
  es: string;
  en: string;
}

export interface ValidationDiscrepancy {
  field: string;
  reported: string;
  recomputed: string;
}

export interface WaccComputed {
  riskFreeRatePercent: number;
  /** Ke en USD antes de Fisher (sólo base UST_USD_fisher). */
  costOfEquityUsdPercent: number | null;
  costOfEquityPercent: number;
  afterTaxCostOfDebtPercent: number;
  waccPercent: number;
}

export type WaccValidation =
  | { status: 'ok'; computed: WaccComputed; discrepancies: ValidationDiscrepancy[] }
  | { status: 'blocked'; blockingErrors: ValidationIssue[]; discrepancies: ValidationDiscrepancy[] };

const pct = (v: number) => `${v.toFixed(2)}%`;

export function recomputeWacc(w: WaccBreakdownJson): WaccValidation {
  const blocking: ValidationIssue[] = [];
  const discrepancies: ValidationDiscrepancy[] = [];

  // -- Pesos de la estructura de capital ------------------------------------
  const weightsOutOfRange =
    w.equityWeightPercent < 0 || w.equityWeightPercent > 100 || w.debtWeightPercent < 0 || w.debtWeightPercent > 100;
  const weightSum = w.equityWeightPercent + w.debtWeightPercent;
  if (weightsOutOfRange || Math.abs(weightSum - 100) > 0.01 + 1e-9) {
    blocking.push({
      code: 'capital_weights_invalid',
      es: `Pesos de capital inválidos: E/V ${pct(w.equityWeightPercent)} + D/V ${pct(w.debtWeightPercent)} = ${pct(weightSum)} (deben sumar 100% y estar en [0, 100]).`,
      en: `Invalid capital weights: E/V ${pct(w.equityWeightPercent)} + D/V ${pct(w.debtWeightPercent)} = ${pct(weightSum)} (must sum to 100% and lie in [0, 100]).`,
    });
  }

  // -- Tasa libre de riesgo según la base declarada ---------------------------
  let rf = w.riskFreeRatePercent;
  let keUsd: number | null = null;
  let ke: number | null = null;

  if (w.riskFreeBasis === 'TES_COP_ex_default') {
    const hasSplit = w.sovereignYieldPercent !== null && w.defaultSpreadPercent !== null;
    if (w.countryRiskPremiumPercent > 0 && (!hasSplit || (w.defaultSpreadPercent as number) <= 0)) {
      blocking.push({
        code: 'country_risk_double_count',
        es: 'Base TES COP con CRP > 0 sin restar el diferencial soberano al TES: el riesgo país se contaría dos veces (TES ya lo incluye). Declare TES bruto y diferencial soberano, o use base UST USD + Fisher.',
        en: 'COP TES basis with CRP > 0 without subtracting the sovereign default spread from the TES yield: country risk would be counted twice. Declare the gross TES yield and the default spread, or use the USD UST + Fisher basis.',
      });
    }
    if (hasSplit) {
      const expected = roundPercent((w.sovereignYieldPercent as number) - (w.defaultSpreadPercent as number));
      if (percentDiffers(w.riskFreeRatePercent, expected)) {
        discrepancies.push({ field: 'Rf', reported: pct(w.riskFreeRatePercent), recomputed: pct(expected) });
      }
      rf = expected;
    }
    ke = roundPercent(rf + w.beta * w.equityRiskPremiumPercent + w.countryRiskPremiumPercent + w.sizePremiumPercent);
  } else {
    if (w.copInflationPercent === null || w.usdInflationPercent === null) {
      blocking.push({
        code: 'fisher_inputs_missing',
        es: 'Base UST USD sin inflación esperada COP y USD: no es posible convertir Ke a COP (Fisher).',
        en: 'USD UST basis without expected COP and USD inflation: Ke cannot be converted to COP (Fisher).',
      });
    } else {
      keUsd = roundPercent(rf + w.beta * w.equityRiskPremiumPercent + w.countryRiskPremiumPercent + w.sizePremiumPercent);
      ke = roundPercent(
        ((1 + keUsd / 100) * (1 + w.copInflationPercent / 100) / (1 + w.usdInflationPercent / 100) - 1) * 100,
      );
    }
  }

  if (ke !== null && percentDiffers(w.costOfEquityPercent, ke)) {
    discrepancies.push({ field: 'Ke', reported: pct(w.costOfEquityPercent), recomputed: pct(ke) });
  }

  if (blocking.length > 0 || ke === null) {
    return { status: 'blocked', blockingErrors: blocking, discrepancies };
  }

  const kdAfterTax = roundPercent(w.costOfDebtPercent * (1 - w.taxRatePercent / 100));
  const wacc = roundPercent((w.equityWeightPercent / 100) * ke + (w.debtWeightPercent / 100) * kdAfterTax);
  if (percentDiffers(w.waccPercent, wacc)) {
    discrepancies.push({ field: 'WACC', reported: pct(w.waccPercent), recomputed: pct(wacc) });
  }
  if (wacc <= 0) {
    return {
      status: 'blocked',
      blockingErrors: [
        {
          code: 'wacc_not_positive',
          es: `WACC recalculado no positivo (${pct(wacc)}).`,
          en: `Recomputed WACC is not positive (${pct(wacc)}).`,
        },
      ],
      discrepancies,
    };
  }

  return {
    status: 'ok',
    computed: {
      riskFreeRatePercent: rf,
      costOfEquityUsdPercent: keUsd,
      costOfEquityPercent: ke,
      afterTaxCostOfDebtPercent: kdAfterTax,
      waccPercent: wacc,
    },
    discrepancies,
  };
}
