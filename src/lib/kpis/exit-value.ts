/**
 * Exit Value — múltiplos de EBITDA por industria.
 *
 * Pipeline:
 *   ebitdaAjustado = ebitda + sum(adjustments)
 *   multiple       = override del usuario, o INDUSTRY_MULTIPLES[industry]
 *   EV             = ebitdaAjustado * multiple
 *   Equity Value   = EV - netDebt
 *
 * valoracion-25: EBITDA ausente o ≤ 0 y deuda neta no declarada ⇒ N/D
 * (KpiNoCalculableError), nunca 0; el crecimiento ya no multiplica el
 * múltiplo (g = 100 % lo duplicaba) y sólo informa la severidad.
 *
 * Sanity check manual:
 *   ebitda 800M, industry 'services' (7x), netDebt 200M, sin ajustes
 *   EV = 800M * 7 = 5_600M ; Equity = 5_400M COP
 */

import type {
  ExitValueIndustry,
  ExitValueInput,
  KpiBreakdown,
  KpiResult,
} from '@/types/kpis';
import { KpiNoCalculableError } from './no-calculable';
import { formatKpiCop, formatKpiMultiple, formatKpiRate, KPI_ND } from './format';

/**
 * Múltiplos EBITDA de referencia internos (midpoints por industria). No tienen
 * fuente de mercado verificable en el repositorio: son un supuesto rotulado y
 * dan confianza «low»; un múltiplo declarado por el usuario la sube a «medium».
 */
export const INDUSTRY_MULTIPLES: Record<ExitValueIndustry, number> = {
  tech: 10,
  retail: 6,
  manufacturing: 5.5,
  services: 7,
  financial: 9,
  other: 6,
};

/**
 * Formateador COMPACTO heredado (`$X.YYM COP`). Sólo lo usa
 * `components/workspace/areas/ValorArea.tsx`, cuya prueba fija ese texto;
 * los KPIs de este módulo ya publican el formato es-CO de `./format`
 * (ratios-kpis-27). Un valor no finito es `N/D`, nunca `$0 COP`.
 *
 * @deprecated Usar `formatBigCop` de `@/lib/charts/format` (coma decimal,
 * `mil M`, paréntesis); pendiente migrar ValorArea (fuera de este paquete).
 */
export function formatCop(n: number): string {
  if (!Number.isFinite(n)) return KPI_ND;
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
  if (typeof input.ebitda !== 'number' || !Number.isFinite(input.ebitda)) {
    throw new KpiNoCalculableError('exit_value', 'EBITDA no disponible: sin EBITDA validado no hay valor por múltiplos.');
  }
  if (typeof input.netDebt !== 'number' || !Number.isFinite(input.netDebt)) {
    throw new KpiNoCalculableError(
      'exit_value',
      'Deuda neta no declarada: el patrimonio no se deriva del Enterprise Value sin restarla.',
    );
  }
  const adjustmentsTotal = (input.adjustments ?? []).reduce(
    (acc, a) => acc + (Number.isFinite(a.amount) ? a.amount : 0),
    0,
  );
  const ebitdaAdj = input.ebitda + adjustmentsTotal;
  if (ebitdaAdj <= 0) {
    throw new KpiNoCalculableError(
      'exit_value',
      'EBITDA normalizado ≤ 0: el método por múltiplos de EBITDA no aplica.',
    );
  }

  const override =
    typeof input.comparableMultiplesOverride === 'number' &&
    Number.isFinite(input.comparableMultiplesOverride) &&
    input.comparableMultiplesOverride > 0
      ? input.comparableMultiplesOverride
      : null;
  const adjMultiple = override ?? INDUSTRY_MULTIPLES[input.industry] ?? INDUSTRY_MULTIPLES.other;
  const growth = Number.isFinite(input.growthRate) ? input.growthRate : 0;

  const enterpriseValue = ebitdaAdj * adjMultiple;
  const netDebt = input.netDebt;
  const equityValue = enterpriseValue - netDebt;

  // valoracion-07: sin WACC por defecto (el 13,5 % "CO típico" no tenía
  // fuente). El método por múltiplos no descuenta flujos; la tasa sólo se
  // informa si el usuario la declara, rotulada como supuesto.
  const wacc = typeof input.wacc === 'number' && Number.isFinite(input.wacc) ? input.wacc : null;

  const breakdown: KpiBreakdown[] = [
    {
      label: 'EBITDA normalizado',
      value: ebitdaAdj,
      formatted: formatKpiCop(ebitdaAdj),
    },
    {
      label: 'Múltiplo aplicado',
      value: Number(adjMultiple.toFixed(2)),
      formatted: formatKpiMultiple(adjMultiple),
    },
    {
      label: 'Enterprise Value',
      value: enterpriseValue,
      formatted: formatKpiCop(enterpriseValue),
    },
    {
      label: 'Deuda neta',
      value: netDebt,
      formatted: formatKpiCop(netDebt),
    },
    {
      label: 'Equity Value',
      value: equityValue,
      formatted: formatKpiCop(equityValue),
    },
  ];

  if (adjustmentsTotal !== 0) {
    breakdown.splice(1, 0, {
      label: 'Ajustes EBITDA',
      value: adjustmentsTotal,
      formatted: formatKpiCop(adjustmentsTotal),
    });
  }

  const assumptions = [
    wacc === null
      ? 'WACC no declarado: el valor por múltiplos no usa tasa de descuento'
      : `WACC declarado por el usuario (supuesto) = ${formatKpiRate(wacc, 1)} — informativo: el valor por múltiplos no lo usa`,
    override === null
      ? 'Múltiplo de referencia interno por industria, sin fuente de mercado verificable (supuesto)'
      : `Múltiplo declarado por el usuario (supuesto) = ${formatKpiMultiple(override)}`,
    'El crecimiento esperado no ajusta el múltiplo; sólo informa la severidad',
    'Cifras expresadas en COP corrientes',
    'Equity Value = Enterprise Value - Deuda neta',
  ];

  // Confidence: múltiplo interno sin fuente = low; declarado por el usuario = medium.
  const confidence: KpiResult['confidence'] = override === null ? 'low' : 'medium';

  return {
    kind: 'exit_value',
    value: equityValue,
    formatted: formatKpiCop(equityValue),
    unit: 'COP',
    label: 'Exit Value (Equity)',
    severity: severityFor(growth, equityValue),
    breakdown,
    assumptions,
    calculatedAt: new Date().toISOString(),
    confidence,
  };
}
