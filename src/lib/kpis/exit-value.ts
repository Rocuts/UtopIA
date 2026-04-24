/**
 * Exit Value — método híbrido DCF-lite + múltiplos de EBITDA por industria.
 *
 * Pipeline:
 *   ebitdaAjustado = ebitda + sum(adjustments)
 *   multiple_base  = INDUSTRY_MULTIPLES[industry]  (o override manual)
 *   multiple_adj   = multiple_base * (1 + growthRate)
 *   EV             = ebitdaAjustado * multiple_adj
 *   Equity Value   = EV - netDebt
 *
 * Sanity check manual:
 *   ebitda 800M, industry 'services' (7x), growth 15%, netDebt 200M, sin ajustes
 *   multiple_adj = 7 * 1.15 = 8.05
 *   EV = 800M * 8.05 = 6_440M = $6.44B
 *   Equity = 6_440M - 200M = 6_240M = $6.24B COP -> severity good
 */

import type {
  ExitValueIndustry,
  ExitValueInput,
  KpiBreakdown,
  KpiResult,
} from '@/types/kpis';

/** Múltiplos EBITDA de referencia para transacciones CO 2024-2026 (midpoints). */
export const INDUSTRY_MULTIPLES: Record<ExitValueIndustry, number> = {
  tech: 10,
  retail: 6,
  manufacturing: 5.5,
  services: 7,
  financial: 9,
  other: 6,
};

const DEFAULT_WACC = 0.135;

/**
 * Formats a COP amount into a compact human string.
 * n >= 1e12 → $X.YYT COP
 * n >= 1e9  → $X.YYB COP
 * n >= 1e6  → $X.YYM COP
 * else      → $X COP (con separadores es-CO)
 */
export function formatCop(n: number): string {
  if (!Number.isFinite(n)) return '$0 COP';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T COP`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B COP`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M COP`;
  return `${sign}$${Math.round(abs).toLocaleString('es-CO')} COP`;
}

function severityFor(growthRate: number, equityValue: number): KpiResult['severity'] {
  if (equityValue <= 0 || growthRate < 0) return 'critical';
  if (growthRate >= 0.15) return 'good';
  if (growthRate >= 0.05) return 'neutral';
  return 'warn';
}

/** Calculates company Exit Value (equity). Pure, deterministic. */
export function calculateExitValue(input: ExitValueInput): KpiResult {
  const adjustmentsTotal = (input.adjustments ?? []).reduce(
    (acc, a) => acc + (Number.isFinite(a.amount) ? a.amount : 0),
    0,
  );
  const ebitdaAdj = (input.ebitda || 0) + adjustmentsTotal;

  const baseMultiple =
    input.comparableMultiplesOverride ?? INDUSTRY_MULTIPLES[input.industry] ?? INDUSTRY_MULTIPLES.other;

  // Growth adjustment: clamp to [-0.5, +1.0] to keep the multiple physically reasonable.
  const growth = Math.min(1.0, Math.max(-0.5, input.growthRate ?? 0));
  const adjMultiple = baseMultiple * (1 + growth);

  const enterpriseValue = ebitdaAdj * adjMultiple;
  const netDebt = input.netDebt ?? 0;
  const equityValue = enterpriseValue - netDebt;

  const wacc = input.wacc ?? DEFAULT_WACC;

  const breakdown: KpiBreakdown[] = [
    {
      label: 'EBITDA normalizado',
      value: ebitdaAdj,
      formatted: formatCop(ebitdaAdj),
    },
    {
      label: 'Múltiplo aplicado',
      value: Number(adjMultiple.toFixed(2)),
      formatted: `${adjMultiple.toFixed(2)}x`,
    },
    {
      label: 'Enterprise Value',
      value: enterpriseValue,
      formatted: formatCop(enterpriseValue),
    },
    {
      label: 'Deuda neta',
      value: netDebt,
      formatted: formatCop(netDebt),
    },
    {
      label: 'Equity Value',
      value: equityValue,
      formatted: formatCop(equityValue),
    },
  ];

  if (adjustmentsTotal !== 0) {
    breakdown.splice(1, 0, {
      label: 'Ajustes EBITDA',
      value: adjustmentsTotal,
      formatted: formatCop(adjustmentsTotal),
    });
  }

  const assumptions = [
    `WACC de referencia CO 2026 = ${(wacc * 100).toFixed(1)}%`,
    'Múltiplos basados en transacciones comparables CO 2024-2026 por industria',
    'Ajuste por crecimiento lineal sobre el múltiplo base',
    'Cifras expresadas en COP corrientes',
    'Equity Value = Enterprise Value - Deuda neta',
  ];

  // Confidence: override manual = high, tabla por industria = medium, ebitda<=0 = low
  let confidence: KpiResult['confidence'] = 'medium';
  if (input.comparableMultiplesOverride !== undefined) confidence = 'high';
  if (input.ebitda <= 0) confidence = 'low';

  return {
    kind: 'exit_value',
    value: equityValue,
    formatted: formatCop(equityValue),
    unit: 'COP',
    label: 'Exit Value (Equity)',
    severity: severityFor(growth, equityValue),
    breakdown,
    assumptions,
    calculatedAt: new Date().toISOString(),
    confidence,
  };
}
