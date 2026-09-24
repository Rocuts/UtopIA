// ---------------------------------------------------------------------------
// Métricas de evaluación de proyectos calculadas en código (valoracion-09)
// ---------------------------------------------------------------------------
// Insumos estructurados del Modelador Financiero: inversión inicial I0 (t = 0,
// positiva), FCLP por año t = 1..n (MoneyCop) y tasa de descuento (%).
//
//   VP_t      = FCLP_t / (1 + r)^t                    (centavos BigInt, half-up)
//   VPN       = −I0 + Σ VP_t
//   TIR       = r tal que VPN(r) = 0 (bisección); N/D si los flujos no son
//               convencionales (≠ 1 cambio de signo) o no hay raíz en el rango
//   TIRM      = (VF flujos positivos a r / VP flujos negativos a r)^(1/n) − 1
//               (reinversión y financiación a la tasa de descuento)
//   Payback   = año en que el acumulado cruza a ≥ 0 y se sostiene hasta el
//               final del horizonte, interpolado linealmente (N/D si no)
//   Payback descontado = ídem sobre VP_t
//   IR        = Σ VP_t / I0
//   Punto de equilibrio = CF / (P − CVu) unidades; ingresos = CF × P / (P − CVu)
//
// Montos en BigInt; TIR/TIRM/IR/payback son razones (number) redondeadas.
// La lógica equivale a la calculadora de la UI de factibilidad
// (src/app/workspace/futuro/factibilidad/page.tsx), llevada a centavos.
// ---------------------------------------------------------------------------

import { parseMoneyCop, serializeMoneyCop } from '../../contracts/money';
import {
  ZERO,
  divRoundHalfUp,
  percentToScaled,
  presentValueCents,
  roundPercent,
} from '../../valuation/calc/fixed-point';

export interface Bilingual {
  es: string;
  en: string;
}

export interface ProjectCashFlowInput {
  year: number;
  freeCashFlowCop: string;
}

export interface ProjectMetricsRow {
  year: number;
  freeCashFlowCop: string;
  pvCop: string;
  cumulativeCop: string;
  cumulativePvCop: string;
}

export interface ProjectMetrics {
  discountRatePercent: number;
  initialInvestmentCop: string;
  rows: ProjectMetricsRow[];
  pvInflowsCop: string;
  npvCop: string;
  irrPercent: number | null;
  irrNote: Bilingual | null;
  mirrPercent: number | null;
  paybackYears: number | null;
  discountedPaybackYears: number | null;
  profitabilityIndex: number | null;
}

export type ProjectMetricsResult =
  | { status: 'ok'; metrics: ProjectMetrics }
  | { status: 'unavailable'; reasons: Bilingual[] };

/** Número de cambios de signo de la serie (ignorando ceros). */
function signChanges(values: number[]): number {
  let changes = 0;
  let prev = 0;
  for (const v of values) {
    if (v === 0) continue;
    const s = Math.sign(v);
    if (prev !== 0 && s !== prev) changes += 1;
    prev = s;
  }
  return changes;
}

function npvFloat(series: number[], rate: number): number {
  return series.reduce((acc, cf, t) => acc + cf / Math.pow(1 + rate, t), 0);
}

/** TIR por bisección sobre la serie completa [−I0, CF1..CFn] (pesos float). */
function computeIrr(series: number[]): { irr: number | null; note: Bilingual | null } {
  const changes = signChanges(series);
  if (changes === 0) {
    return { irr: null, note: { es: 'sin cambio de signo en los flujos', en: 'no sign change in the cash flows' } };
  }
  if (changes > 1) {
    return {
      irr: null,
      note: {
        es: 'flujos no convencionales (más de un cambio de signo): TIR no única — use la TIRM',
        en: 'non-conventional cash flows (more than one sign change): IRR not unique — use the MIRR',
      },
    };
  }
  let lo = -0.99;
  let hi = 10;
  let fLo = npvFloat(series, lo);
  const fHi = npvFloat(series, hi);
  if (fLo * fHi > 0) {
    return { irr: null, note: { es: 'sin raíz entre −99% y 1.000%', en: 'no root between −99% and 1,000%' } };
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npvFloat(series, mid);
    if (fm === 0) return { irr: mid, note: null };
    if (fm * fLo < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fm;
    }
  }
  return { irr: (lo + hi) / 2, note: null };
}

/** TIRM estilo Excel MIRR con tasas de financiación y reinversión = r. */
function computeMirr(series: number[], rate: number): number | null {
  const n = series.length - 1;
  if (n < 1) return null;
  let fvPositive = 0;
  let pvNegative = 0;
  series.forEach((cf, t) => {
    if (cf > 0) fvPositive += cf * Math.pow(1 + rate, n - t);
    else if (cf < 0) pvNegative += -cf / Math.pow(1 + rate, t);
  });
  if (fvPositive <= 0 || pvNegative <= 0) return null;
  return Math.pow(fvPositive / pvNegative, 1 / n) - 1;
}

/**
 * Año en que el acumulado (desde −I0) cruza a ≥ 0 por ÚLTIMA vez y se sostiene
 * hasta el final del horizonte, interpolado. Si flujos negativos posteriores
 * devuelven el acumulado a < 0, esa recuperación no cuenta (valoracion-26);
 * acumulado final < 0 ⇒ N/D.
 */
function computePayback(initial: bigint, flows: bigint[]): number | null {
  let cum = -initial;
  let payback: number | null = null;
  for (let i = 0; i < flows.length; i++) {
    const prev = cum;
    cum += flows[i];
    if (cum < ZERO) {
      payback = null;
    } else if (prev < ZERO && flows[i] > ZERO) {
      const fraction = Number(-prev) / Number(flows[i]);
      payback = Math.round((i + fraction) * 100) / 100;
    }
  }
  return cum >= ZERO ? payback : null;
}

export function computeProjectMetrics(
  initialInvestmentCop: string,
  cashFlows: readonly ProjectCashFlowInput[],
  discountRatePercent: number,
): ProjectMetricsResult {
  const reasons: Bilingual[] = [];
  const initial = parseMoneyCop(initialInvestmentCop);
  if (initial <= ZERO) {
    reasons.push({ es: 'inversión inicial no positiva', en: 'non-positive initial investment' });
  }
  if (cashFlows.length === 0) {
    reasons.push({ es: 'sin flujos de caja estructurados', en: 'no structured cash flows' });
  }
  const consecutive = cashFlows.every((f, i) => f.year === i + 1);
  if (!consecutive) {
    reasons.push({
      es: `años de flujo no consecutivos desde 1 (${cashFlows.map((f) => f.year).join(', ')})`,
      en: `cash-flow years are not consecutive from 1 (${cashFlows.map((f) => f.year).join(', ')})`,
    });
  }
  if (!Number.isFinite(discountRatePercent) || discountRatePercent <= -100) {
    reasons.push({ es: 'tasa de descuento inválida', en: 'invalid discount rate' });
  }
  if (reasons.length > 0) return { status: 'unavailable', reasons };

  const rate = roundPercent(discountRatePercent);
  const rateScaled = percentToScaled(rate);
  const flows = cashFlows.map((f) => parseMoneyCop(f.freeCashFlowCop));
  const pvs = flows.map((cf, i) => presentValueCents(cf, rateScaled, i + 1));

  let cum = -initial;
  let cumPv = -initial;
  const rows: ProjectMetricsRow[] = cashFlows.map((f, i) => {
    cum += flows[i];
    cumPv += pvs[i];
    return {
      year: f.year,
      freeCashFlowCop: serializeMoneyCop(flows[i]),
      pvCop: serializeMoneyCop(pvs[i]),
      cumulativeCop: serializeMoneyCop(cum),
      cumulativePvCop: serializeMoneyCop(cumPv),
    };
  });

  const pvInflows = pvs.reduce((a, b) => a + b, ZERO);
  const npv = pvInflows - initial;

  // Serie en pesos (float) sólo para TIR/TIRM (razones, no montos publicados).
  const series = [-Number(initial) / 100, ...flows.map((f) => Number(f) / 100)];
  const { irr, note } = computeIrr(series);
  const mirr = computeMirr(series, rate / 100);
  const pi = Number(pvInflows) / Number(initial);

  return {
    status: 'ok',
    metrics: {
      discountRatePercent: rate,
      initialInvestmentCop: serializeMoneyCop(initial),
      rows,
      pvInflowsCop: serializeMoneyCop(pvInflows),
      npvCop: serializeMoneyCop(npv),
      irrPercent: irr === null ? null : roundPercent(irr * 100),
      irrNote: note,
      mirrPercent: mirr === null ? null : roundPercent(mirr * 100),
      paybackYears: computePayback(initial, flows),
      discountedPaybackYears: computePayback(initial, pvs),
      profitabilityIndex: Math.round(pi * 10_000) / 10_000,
    },
  };
}

/** VPN (centavos) de los mismos flujos a otra tasa — p. ej. la ajustada por riesgo. */
export function computeNpvCents(initialInvestmentCop: string, cashFlows: readonly ProjectCashFlowInput[], ratePercent: number): bigint {
  const rateScaled = percentToScaled(ratePercent);
  const pv = cashFlows.reduce(
    (acc, f, i) => acc + presentValueCents(parseMoneyCop(f.freeCashFlowCop), rateScaled, i + 1),
    ZERO,
  );
  return pv - parseMoneyCop(initialInvestmentCop);
}

export type BreakEvenResult =
  | { status: 'ok'; units: number; revenueCop: string; contributionMarginCop: string }
  | { status: 'unavailable'; reason: Bilingual };

/** Punto de equilibrio operativo del año 1: CF / (P − CVu). */
export function computeBreakEven(
  fixedCostsCop: string | null,
  unitPriceCop: string | null,
  unitVariableCostCop: string | null,
): BreakEvenResult {
  if (fixedCostsCop === null || unitPriceCop === null || unitVariableCostCop === null) {
    return {
      status: 'unavailable',
      reason: { es: 'faltan costos fijos, precio o costo variable unitario', en: 'fixed costs, unit price or unit variable cost missing' },
    };
  }
  const fixed = parseMoneyCop(fixedCostsCop);
  const price = parseMoneyCop(unitPriceCop);
  const variable = parseMoneyCop(unitVariableCostCop);
  const margin = price - variable;
  if (fixed < ZERO) {
    return { status: 'unavailable', reason: { es: 'costos fijos negativos', en: 'negative fixed costs' } };
  }
  if (margin <= ZERO) {
    return {
      status: 'unavailable',
      reason: { es: 'margen de contribución unitario ≤ 0: no existe punto de equilibrio', en: 'unit contribution margin ≤ 0: no break-even point exists' },
    };
  }
  const unitsHundredths = divRoundHalfUp(fixed * BigInt(100), margin);
  return {
    status: 'ok',
    units: Number(unitsHundredths) / 100,
    revenueCop: serializeMoneyCop(divRoundHalfUp(fixed * price, margin)),
    contributionMarginCop: serializeMoneyCop(margin),
  };
}
