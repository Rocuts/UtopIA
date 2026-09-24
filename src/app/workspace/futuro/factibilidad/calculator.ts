// ---------------------------------------------------------------------------
// Calculadora VPN / TIR de /workspace/futuro/factibilidad (valoracion-09, IW4)
// ---------------------------------------------------------------------------
// Antes la página tenía su propio VPN/TIR/payback en float (pesos), sin
// detectar flujos no convencionales, y una tasa de descuento por defecto de
// 13,5 % rotulada "WACC CO típico" sin fuente. Ahora:
//   - Los montos se convierten a centavos (MoneyCop) y las métricas salen de
//     `computeProjectMetrics` — la MISMA función determinista que usa el
//     pipeline de factibilidad (VPN en BigInt, TIR N/D con flujos no
//     convencionales, TIRM, payback simple y descontado, IR).
//   - La tasa de descuento es un SUPUESTO que declara el usuario. Sin tasa, las
//     métricas que dependen de ella (VPN, IR, TIRM, payback descontado) son N/D;
//     TIR y payback simple no la necesitan.
// ---------------------------------------------------------------------------

import {
  computeProjectMetrics,
  type Bilingual,
} from '@/lib/agents/financial/feasibility/calc/project-metrics';

export interface CalculatorInput {
  /** Inversión inicial en pesos (t = 0). */
  investmentCop: number;
  /** Flujos antes de impuestos por año (t = 1..n), en pesos. */
  cashflowsCop: number[];
  /** Tasa de impuestos (0-1) para el ajuste didáctico flujo × (1 − t). */
  taxRate: number;
  /** Tasa de descuento declarada por el usuario, en %. null = no declarada. */
  discountRatePercent: number | null;
}

export interface CalculatorResult {
  /** Flujos después del ajuste (1 − t), en pesos. */
  effectiveCashflowsCop: number[];
  /** VPN en pesos. null sin tasa declarada o sin cálculo posible. */
  npv: number | null;
  /** TIR como fracción (0,184 = 18,4 %). null si no es única o no existe. */
  irr: number | null;
  irrNote: Bilingual | null;
  /** TIRM como fracción. null sin tasa declarada. */
  mirr: number | null;
  /** Payback simple (años). */
  payback: number | null;
  /** Payback descontado (años). null sin tasa declarada. */
  discountedPayback: number | null;
  /** Índice de rentabilidad. null sin tasa declarada. */
  pi: number | null;
  /** true cuando falta la tasa de descuento (VPN/IR/TIRM N/D). */
  discountRateMissing: boolean;
  /** Motivos cuando el cálculo no es posible (inversión ≤ 0, sin flujos…). */
  unavailable: Bilingual[] | null;
}

const toCentsString = (pesos: number): string =>
  BigInt(Math.round((Number.isFinite(pesos) ? pesos : 0) * 100)).toString();

export function computeCalculator(input: CalculatorInput): CalculatorResult {
  const tax = Number.isFinite(input.taxRate) ? input.taxRate : 0;
  const effective = input.cashflowsCop.map((cf) => (Number.isFinite(cf) ? cf : 0) * (1 - tax));
  const rateDeclared =
    input.discountRatePercent !== null && Number.isFinite(input.discountRatePercent);

  const res = computeProjectMetrics(
    toCentsString(input.investmentCop),
    effective.map((cf, i) => ({ year: i + 1, freeCashFlowCop: toCentsString(cf) })),
    rateDeclared ? (input.discountRatePercent as number) : 0,
  );

  if (res.status === 'unavailable') {
    return {
      effectiveCashflowsCop: effective,
      npv: null,
      irr: null,
      irrNote: null,
      mirr: null,
      payback: null,
      discountedPayback: null,
      pi: null,
      discountRateMissing: !rateDeclared,
      unavailable: res.reasons,
    };
  }

  const m = res.metrics;
  return {
    effectiveCashflowsCop: effective,
    npv: rateDeclared ? Number(BigInt(m.npvCop)) / 100 : null,
    irr: m.irrPercent === null ? null : m.irrPercent / 100,
    irrNote: m.irrNote,
    mirr: rateDeclared && m.mirrPercent !== null ? m.mirrPercent / 100 : null,
    payback: m.paybackYears,
    discountedPayback: rateDeclared ? m.discountedPaybackYears : null,
    pi: rateDeclared ? m.profitabilityIndex : null,
    discountRateMissing: !rateDeclared,
    unavailable: null,
  };
}
