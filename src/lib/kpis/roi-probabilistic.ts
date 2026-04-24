/**
 * ROI Probabilístico — Expected return ponderado por inversión y probabilidad,
 * ajustado por riesgo de mercado (Colombia 2026 ~25% por defecto).
 *
 * Fórmula:
 *   totalInv    = Σ investment
 *   weightedRet = Σ(expectedReturn * probability * investment) / totalInv
 *   riskAdj     = 1 - marketRisk
 *   roiProb     = weightedRet * riskAdj
 *
 * Sanity check manual:
 *   Proyectos: A (ret 25%, p 0.8, inv 100M), B (ret 15%, p 0.9, inv 200M), C (ret 40%, p 0.5, inv 50M)
 *   totalInv = 350M
 *   weightedRet = (0.25*0.8*100 + 0.15*0.9*200 + 0.40*0.5*50) / 350
 *               = (20 + 27 + 10) / 350 = 57 / 350 = 0.1629 = 16.29%
 *   marketRisk 0.25 -> riskAdj 0.75
 *   roiProb = 0.1629 * 0.75 = 0.1221 = 12.21% -> neutral
 */

import type {
  KpiBreakdown,
  KpiResult,
  RoiProbabilisticInput,
  RoiProbabilisticProject,
} from '@/types/kpis';

const DEFAULT_MARKET_RISK = 0.25;
const DEFAULT_DISCOUNT_RATE = 0.135;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function severityFor(roiPct: number): KpiResult['severity'] {
  if (!Number.isFinite(roiPct) || roiPct < 5) return 'critical';
  if (roiPct < 10) return 'warn';
  if (roiPct < 20) return 'neutral';
  return 'good';
}

function formatPct(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(decimals)}%`;
}

function formatCopShort(n: number): string {
  if (!Number.isFinite(n)) return '$0 COP';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T COP`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B COP`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M COP`;
  return `${sign}$${Math.round(abs).toLocaleString('es-CO')} COP`;
}

function contributionOf(p: RoiProbabilisticProject, totalInv: number): number {
  if (totalInv <= 0) return 0;
  return (p.expectedReturn * p.probability * p.investment) / totalInv;
}

/** Calculates risk-adjusted probabilistic ROI across a project portfolio. Pure. */
export function calculateRoiProbabilistic(input: RoiProbabilisticInput): KpiResult {
  const projects = Array.isArray(input.projects) ? input.projects : [];
  const marketRisk = clamp01(input.marketRisk ?? DEFAULT_MARKET_RISK);
  const discountRate = input.discountRate ?? DEFAULT_DISCOUNT_RATE;

  const totalInv = projects.reduce(
    (acc, p) => acc + Math.max(0, p.investment || 0),
    0,
  );

  let weightedReturn = 0;
  if (totalInv > 0) {
    weightedReturn = projects.reduce((acc, p) => {
      const inv = Math.max(0, p.investment || 0);
      const prob = clamp01(p.probability);
      const ret = Number.isFinite(p.expectedReturn) ? p.expectedReturn : 0;
      return acc + (ret * prob * inv) / totalInv;
    }, 0);
  }

  const riskAdj = 1 - marketRisk;
  const roiProb = weightedReturn * riskAdj;
  const roiPct = roiProb * 100;

  // Top 3 projects by contribution
  const ranked = projects
    .map((p) => ({ project: p, contribution: contributionOf(p, totalInv) * riskAdj }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);

  const breakdown: KpiBreakdown[] = [
    {
      label: 'Inversión total',
      value: totalInv,
      formatted: formatCopShort(totalInv),
    },
    {
      label: 'Retorno esperado ponderado',
      value: weightedReturn,
      formatted: formatPct(weightedReturn * 100, 2),
    },
    {
      label: 'Riesgo de mercado CO',
      value: marketRisk,
      formatted: formatPct(marketRisk * 100, 0),
    },
    {
      label: 'Factor de ajuste por riesgo',
      value: riskAdj,
      formatted: riskAdj.toFixed(2),
    },
  ];

  ranked.forEach((r, idx) => {
    breakdown.push({
      label: `Top ${idx + 1}: ${r.project.name}`,
      value: r.contribution * 100,
      formatted: formatPct(r.contribution * 100, 2),
      weight: totalInv > 0 ? r.project.investment / totalInv : 0,
    });
  });

  const assumptions = [
    `Riesgo de mercado CO 2026 estimado en ${(marketRisk * 100).toFixed(0)}%`,
    `Tasa de descuento referencia (WACC) = ${(discountRate * 100).toFixed(1)}%`,
    'Probabilidades de éxito provistas por proyecto; se clampean a [0,1]',
    'Retornos expresados como TIR efectiva anual',
    'Ponderación por inversión relativa en el portfolio',
    'Ajuste por riesgo multiplicativo: roi = Σ(ret·p·w) · (1 - marketRisk)',
  ];

  // Confidence heuristics
  let confidence: KpiResult['confidence'] = 'medium';
  if (projects.length === 0 || totalInv <= 0) confidence = 'low';
  else if (projects.length >= 3 && projects.every((p) => p.riskScore !== undefined)) {
    confidence = 'high';
  }

  return {
    kind: 'roi_probabilistic',
    value: Number(roiPct.toFixed(2)),
    formatted: formatPct(roiPct, 1),
    unit: '%',
    label: 'ROI Probabilístico',
    severity: severityFor(roiPct),
    breakdown,
    assumptions,
    calculatedAt: new Date().toISOString(),
    confidence,
  };
}
