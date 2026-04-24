/**
 * TEF — Tax Efficiency Factor
 *
 * TEF = (ahorro logrado / impuesto baseline) * 100
 * donde impuesto = base gravable * tasa IR sociedades (default 35% — Art. 240 ET 2026).
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

const DEFAULT_TAX_RATE = 0.35;
const CALC_VERSION_LABEL = 'Tasa de Eficiencia Fiscal';

function formatCopShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T COP`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B COP`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M COP`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K COP`;
  return `${sign}$${Math.round(abs).toLocaleString('es-CO')} COP`;
}

function formatPct(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(decimals)}%`;
}

function severityFor(tef: number): KpiResult['severity'] {
  if (!Number.isFinite(tef) || tef < 3) return 'critical';
  if (tef < 7) return 'warn';
  if (tef < 15) return 'neutral';
  return 'good';
}

function computeTef(taxableBaseline: number, taxableOptimized: number, rate: number): number {
  const taxBaseline = taxableBaseline * rate;
  if (taxBaseline <= 0) return 0;
  const taxOptimized = taxableOptimized * rate;
  const savings = taxBaseline - taxOptimized;
  return (savings / taxBaseline) * 100;
}

/** Calculates TEF and returns a KpiResult. Pure, deterministic. */
export function calculateTef(input: TefInput): KpiResult {
  const taxRate = input.taxRate ?? DEFAULT_TAX_RATE;
  const safeRate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : DEFAULT_TAX_RATE;

  const baseline = Math.max(0, input.taxableIncomeBaseline || 0);
  const optimized = Math.max(0, input.taxableIncomeOptimized || 0);

  const taxBaseline = baseline * safeRate;
  const taxOptimized = optimized * safeRate;
  const savings = taxBaseline - taxOptimized;
  const tef = computeTef(baseline, optimized, safeRate);

  // Effective rates — prefer provided values, else infer (tax / revenue) if revenue present
  const revenue = Math.max(0, input.revenue || 0);
  const effBaseline =
    input.effectiveRateBaseline ?? (revenue > 0 ? taxBaseline / revenue : safeRate);
  const effOptimized =
    input.effectiveRateOptimized ?? (revenue > 0 ? taxOptimized / revenue : safeRate);

  let trend: KpiTrend | undefined;
  if (input.periodPrevious) {
    const prevTef = computeTef(
      Math.max(0, input.periodPrevious.taxableIncomeBaseline || 0),
      Math.max(0, input.periodPrevious.taxableIncomeOptimized || 0),
      safeRate,
    );
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

  const breakdown: KpiBreakdown[] = [
    {
      label: 'Impuesto baseline',
      value: taxBaseline,
      formatted: formatCopShort(taxBaseline),
    },
    {
      label: 'Impuesto optimizado',
      value: taxOptimized,
      formatted: formatCopShort(taxOptimized),
    },
    {
      label: 'Ahorro total',
      value: savings,
      formatted: formatCopShort(savings),
    },
    {
      label: 'Tasa efectiva baseline',
      value: effBaseline,
      formatted: formatPct(effBaseline * 100, 2),
    },
    {
      label: 'Tasa efectiva optimizada',
      value: effOptimized,
      formatted: formatPct(effOptimized * 100, 2),
    },
  ];

  const assumptions = [
    `Tasa IR sociedades Art. 240 ET = ${(safeRate * 100).toFixed(0)}% salvo régimen SIMPLE o zonas especiales`,
    'Base gravable neta de deducciones vigentes (Art. 107 ET y correlacionados)',
    'Ahorro se mide como diferencia absoluta de impuesto sobre base gravable ajustada',
    'No incluye anticipos, retenciones ni autorretenciones del periodo',
  ];

  // Confidence: lower if we had to guess effective rates, or if magnitudes look degenerate
  let confidence: KpiResult['confidence'] = 'high';
  if (
    input.effectiveRateBaseline === undefined ||
    input.effectiveRateOptimized === undefined ||
    revenue <= 0
  ) {
    confidence = 'medium';
  }
  if (baseline <= 0 || optimized <= 0) confidence = 'low';

  return {
    kind: 'tef',
    value: Number(tef.toFixed(2)),
    formatted: formatPct(tef, 1),
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
