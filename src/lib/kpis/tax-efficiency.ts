/**
 * TEF — Tax Efficiency Factor
 *
 * TEF = (ahorro logrado / impuesto baseline) * 100
 * donde impuesto = base gravable * tarifa. La tarifa de referencia es la
 * general del Art. 240 E.T. (35%) salvo que se declare otra; el escenario
 * optimizado puede declarar una tarifa distinta (régimen preferencial).
 *
 * valoracion-25: base de referencia ausente o ≤ 0 ⇒ N/D (antes TEF 0 %);
 * base optimizada ausente ⇒ N/D; sin tasas efectivas ni ingresos no se
 * publica una «tasa efectiva» igual a la nominal.
 *
 * Sanity check manual:
 *   baseline 1_000_000_000, optimized 800_000_000, rate 0.35
 *   taxBaseline = 350_000_000, taxOpt = 280_000_000, savings = 70_000_000
 *   tef = 70_000_000 / 350_000_000 * 100 = 20.0 % -> good
 */

import type {
  KpiBreakdown,
  KpiResult,
  KpiTrend,
  TefInput,
} from '@/types/kpis';
import { KpiNoCalculableError } from './no-calculable';
import { formatKpiCop, formatKpiPercentPoints, formatKpiRate } from './format';

/**
 * `taxRateOptimized` ya forma parte de `TefInput`; el alias se conserva por
 * compatibilidad.
 */
export type TefInputDeclarado = TefInput;

const DEFAULT_TAX_RATE = 0.35;
const CALC_VERSION_LABEL = 'Tasa de Eficiencia Fiscal';

function severityFor(tef: number): KpiResult['severity'] {
  if (!Number.isFinite(tef) || tef < 3) return 'critical';
  if (tef < 7) return 'warn';
  if (tef < 15) return 'neutral';
  return 'good';
}

function validRate(r: number | undefined): number | null {
  return typeof r === 'number' && Number.isFinite(r) && r > 0 && r < 1 ? r : null;
}

function computeTef(
  taxableBaseline: number,
  taxableOptimized: number,
  rateBaseline: number,
  rateOptimized: number,
): number | null {
  const taxBaseline = taxableBaseline * rateBaseline;
  if (!Number.isFinite(taxBaseline) || taxBaseline <= 0) return null;
  const taxOptimized = taxableOptimized * rateOptimized;
  return ((taxBaseline - taxOptimized) / taxBaseline) * 100;
}

/** Calculates TEF and returns a KpiResult. Pure, deterministic. */
export function calculateTef(input: TefInputDeclarado): KpiResult {
  const rateBaseline = input.taxRate === undefined ? DEFAULT_TAX_RATE : validRate(input.taxRate);
  if (rateBaseline === null) {
    throw new KpiNoCalculableError('tef', 'Tarifa de referencia inválida.');
  }
  const rateOptimized =
    input.taxRateOptimized === undefined ? rateBaseline : validRate(input.taxRateOptimized);
  if (rateOptimized === null) {
    throw new KpiNoCalculableError('tef', 'Tarifa del escenario optimizado inválida.');
  }

  const baseline = input.taxableIncomeBaseline;
  if (typeof baseline !== 'number' || !Number.isFinite(baseline) || baseline <= 0) {
    throw new KpiNoCalculableError(
      'tef',
      'Base gravable de referencia no disponible o ≤ 0: sin impuesto de referencia no hay ahorro medible.',
    );
  }
  const optimized = input.taxableIncomeOptimized;
  if (typeof optimized !== 'number' || !Number.isFinite(optimized)) {
    throw new KpiNoCalculableError('tef', 'Base gravable optimizada no disponible.');
  }
  const optimizedBase = Math.max(0, optimized);

  const taxBaseline = baseline * rateBaseline;
  const taxOptimized = optimizedBase * rateOptimized;
  const savings = taxBaseline - taxOptimized;
  const tef = computeTef(baseline, optimizedBase, rateBaseline, rateOptimized) as number;

  // Tasas efectivas: las declaradas o impuesto / ingresos; sin ninguna, N/D.
  const revenue = typeof input.revenue === 'number' && Number.isFinite(input.revenue) ? input.revenue : 0;
  const effBaseline =
    input.effectiveRateBaseline ?? (revenue > 0 ? taxBaseline / revenue : null);
  const effOptimized =
    input.effectiveRateOptimized ?? (revenue > 0 ? taxOptimized / revenue : null);

  let trend: KpiTrend | undefined;
  if (input.periodPrevious) {
    const prevTef = computeTef(
      input.periodPrevious.taxableIncomeBaseline,
      Math.max(0, input.periodPrevious.taxableIncomeOptimized),
      rateBaseline,
      rateOptimized,
    );
    if (prevTef !== null && Number.isFinite(prevTef)) {
      if (prevTef === 0 && tef === 0) {
        trend = { direction: 'flat', delta: 0, periodLabel: 'vs periodo anterior' };
      } else if (prevTef === 0) {
        trend = {
          direction: tef > 0 ? 'up' : 'down',
          delta: tef > 0 ? 100 : -100,
          periodLabel: 'vs periodo anterior',
        };
      } else {
        const delta = ((tef - prevTef) / Math.abs(prevTef)) * 100;
        const direction: KpiTrend['direction'] =
          Math.abs(delta) < 0.5 ? 'flat' : delta > 0 ? 'up' : 'down';
        trend = { direction, delta: Number(delta.toFixed(1)), periodLabel: 'vs periodo anterior' };
      }
    }
  }

  const breakdown: KpiBreakdown[] = [
    {
      label: 'Impuesto baseline',
      value: taxBaseline,
      formatted: formatKpiCop(taxBaseline),
    },
    {
      label: 'Impuesto optimizado',
      value: taxOptimized,
      formatted: formatKpiCop(taxOptimized),
    },
    {
      label: 'Ahorro total',
      value: savings,
      formatted: formatKpiCop(savings),
    },
  ];
  if (effBaseline !== null) {
    breakdown.push({
      label: 'Tasa efectiva baseline',
      value: effBaseline,
      formatted: formatKpiRate(effBaseline, 2),
    });
  }
  if (effOptimized !== null) {
    breakdown.push({
      label: 'Tasa efectiva optimizada',
      value: effOptimized,
      formatted: formatKpiRate(effOptimized, 2),
    });
  }

  const assumptions = [
    `Tarifa de referencia = ${formatKpiRate(rateBaseline, 0)}${input.taxRate === undefined ? ' (general Art. 240 E.T.)' : ' (declarada)'}`,
    rateOptimized === rateBaseline
      ? 'El escenario optimizado usa la misma tarifa (sólo cambia la base gravable)'
      : `Tarifa del escenario optimizado declarada = ${formatKpiRate(rateOptimized, 0)}`,
    'Base gravable neta de deducciones vigentes (Art. 107 ET y correlacionados)',
    'Ahorro se mide como diferencia absoluta de impuesto sobre base gravable ajustada',
    'No incluye anticipos, retenciones ni autorretenciones del periodo',
  ];

  // Confidence: menor si las tasas efectivas no se declararon o no hay ingresos.
  let confidence: KpiResult['confidence'] = 'high';
  if (
    input.effectiveRateBaseline === undefined ||
    input.effectiveRateOptimized === undefined ||
    revenue <= 0
  ) {
    confidence = 'medium';
  }
  if (optimizedBase <= 0) confidence = 'low';

  return {
    kind: 'tef',
    value: Number(tef.toFixed(2)),
    formatted: formatKpiPercentPoints(tef, 1),
    unit: '%',
    label: CALC_VERSION_LABEL,
    severity: severityFor(tef),
    trend,
    breakdown,
    assumptions,
    calculatedAt: new Date().toISOString(),
    confidence,
  };
}
