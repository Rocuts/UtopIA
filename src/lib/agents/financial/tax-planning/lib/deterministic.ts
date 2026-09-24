// ---------------------------------------------------------------------------
// Planeación tributaria — recomputo determinista sobre la salida del LLM
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (tributario-modulos-08, tributario-calc-16):
//   - El optimizador emitía un «cálculo dual» con TMT = utilidad contable ×
//     15% e impuesto a cargo = MAX(35%, TMT), con tmtAplicable=true por
//     defecto. La TTD del parág. 6 Art. 240 E.T. es ID/UD; sin impuesto
//     depurado ni utilidad depurada verificados, el impuesto adicional, la
//     aplicabilidad y el impuesto a cargo final son N/D (null) — política del
//     HANDOFF, igual que CCV/Supervivencia del Agente Fiscal.
//   - La identidad Σ ahorros = ahorro total se prometía «validada post-LLM»
//     y no existía. Aquí se recalcula en BigInt.
//   - El descuento del Art. 257 se netea contra una base no verificada: se
//     publica como ESTIMACIÓN con el tope CONJUNTO del Art. 258 (255+256+257)
//     y el excedente trasladable al periodo siguiente.
// ---------------------------------------------------------------------------

import type { TaxOptimizationReportJson } from '../../contracts/tax-planning';

const ZERO = BigInt(0);
const TARIFA_GENERAL_PCT = BigInt(35); // Art. 240 E.T.

function pctOf(cents: bigint, pct: bigint): bigint {
  if (cents <= ZERO) return ZERO;
  const num = cents * pct;
  const q = num / BigInt(100);
  return (num % BigInt(100)) * BigInt(2) >= BigInt(100) ? q + BigInt(1) : q;
}

function ratePct(taxCents: bigint, baseCents: bigint): number | null {
  if (baseCents <= ZERO) return null;
  // 2 decimales con redondeo half-up (escala ×10⁵ antes de dividir).
  return Math.round(Number((taxCents * BigInt(100_000)) / baseCents) / 10) / 100;
}

export const TTD_ND_MOTIVO =
  'TTD (parág. 6 Art. 240 E.T.) no determinable: faltan impuesto depurado (ID) y utilidad depurada (UD) verificados; el impuesto adicional, su aplicabilidad y el impuesto a cargo final quedan N/D. La utilidad contable × 15% no es la TTD.';

/**
 * Sobrescribe las cifras que tienen cálculo determinista y fuerza `null` en
 * las que no tienen base verificada. No lanza.
 */
export function enforceTaxOptimization(json: TaxOptimizationReportJson): TaxOptimizationReportJson {
  const d = json.currentDiagnosis;
  const notes = [...json.preparerNotes];
  const rentaOrdinaria35 = pctOf(BigInt(d.taxableIncomeCents), TARIFA_GENERAL_PCT);

  if (d.dualCalculation.tmtExemptionReason) {
    notes.push(`Posible excepción a la TTD señalada por el modelo, sin verificar: ${d.dualCalculation.tmtExemptionReason}`);
  }
  notes.push(TTD_ND_MOTIVO);

  const recommendations = [...json.recommendations].sort((a, b) => {
    const diff = BigInt(b.estimatedSavingsCents) - BigInt(a.estimatedSavingsCents);
    return diff > ZERO ? 1 : diff < ZERO ? -1 : 0;
  });
  const totalSavings = recommendations.reduce((acc, r) => acc + BigInt(r.estimatedSavingsCents), ZERO);
  const p = json.savingsProjection;
  if (BigInt(p.totalAnnualSavingsCents) !== totalSavings) {
    notes.push(
      `Ahorro total recalculado en código: Σ de las recomendaciones = ${totalSavings.toString()} centavos (el modelo reportó ${p.totalAnnualSavingsCents}).`,
    );
  }
  const current = BigInt(p.currentScenarioTaxCents);
  const optimized = current - totalSavings;
  const uai = BigInt(d.accountingProfitBeforeTaxCents);

  return {
    ...json,
    currentDiagnosis: {
      ...d,
      effectiveTaxRatePct: null,
      dualCalculation: {
        rentaOrdinaria35Cents: rentaOrdinaria35.toString(),
        tributacionMinima15Cents: null,
        impuestoACargoCents: null,
        tmtAplicable: null,
        tmtExemptionReason: null,
      },
    },
    recommendations,
    savingsProjection: {
      ...p,
      totalAnnualSavingsCents: totalSavings.toString(),
      optimizedScenarioTaxCents: (optimized < ZERO ? ZERO : optimized).toString(),
      effectiveRateBeforePct: ratePct(current, uai),
      effectiveRateAfterPct: ratePct(optimized < ZERO ? ZERO : optimized, uai),
    },
    preparerNotes: notes,
  };
}
