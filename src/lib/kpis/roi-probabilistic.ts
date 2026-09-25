/**
 * ROI Probabilístico — retorno esperado del portafolio ponderado por inversión.
 *
 * Fórmula:
 *   totalInv    = Σ investment
 *   E[r_i]      = p_i · r_i + (1 − p_i) · failureReturn
 *   weightedRet = Σ(E[r_i] · investment_i) / totalInv
 *   roiProb     = weightedRet · (1 − marketRisk)   sólo si weightedRet > 0 y
 *                 el riesgo de mercado fue declarado
 *
 * valoracion-25: el retorno en caso de fracaso era 0 % implícito (con pérdida
 * total el E[r] del ejemplo pasa de +9,38 % a −37,5 %) y el «riesgo de
 * mercado CO 25 %» se aplicaba por defecto sin fuente, achicando incluso las
 * pérdidas. Ahora failureReturn es obligatorio (N/D sin él) y el riesgo de
 * mercado sólo se aplica si se declara, rotulado con su fuente.
 *
 * Sanity check manual:
 *   A (ret 25 %, p 0,5, inv 100), failureReturn −100 %
 *   E[r] = 0,5 × 25 % + 0,5 × (−100 %) = −37,5 %
 */

import type {
  KpiBreakdown,
  KpiResult,
  RoiProbabilisticInput,
  RoiProbabilisticProject,
} from '@/types/kpis';
import { KpiNoCalculableError } from './no-calculable';
import { formatKpiCop, formatKpiNumber, formatKpiPercentPoints, formatKpiRate } from './format';

/**
 * Supuestos que el usuario debe declarar (valoracion-25). `failureReturn` y
 * `marketRiskSource` ya forman parte de `RoiProbabilisticInput`; el alias se
 * conserva por compatibilidad.
 */
export type RoiProbabilisticInputDeclarado = RoiProbabilisticInput;

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

function expectedReturnOf(p: RoiProbabilisticProject, failureReturn: number): number {
  return clamp01(p.probability) * p.expectedReturn + (1 - clamp01(p.probability)) * failureReturn;
}

/** Calculates the probabilistic ROI across a project portfolio. Pure. */
export function calculateRoiProbabilistic(input: RoiProbabilisticInputDeclarado): KpiResult {
  const projects = Array.isArray(input.projects) ? input.projects : [];
  const failureReturn = input.failureReturn;
  if (typeof failureReturn !== 'number' || !Number.isFinite(failureReturn)) {
    throw new KpiNoCalculableError(
      'roi_probabilistic',
      'Falta el retorno en caso de fracaso de los proyectos (p. ej. −100 % = pérdida total): sin él el retorno esperado no es verificable.',
    );
  }
  const marketRisk =
    typeof input.marketRisk === 'number' && Number.isFinite(input.marketRisk)
      ? clamp01(input.marketRisk)
      : null;
  // valoracion-07: sin tasa por defecto (13,5 % "CO típico" sin fuente). La
  // tasa es informativa y sólo se publica si el usuario la declara.
  const discountRate =
    typeof input.discountRate === 'number' && Number.isFinite(input.discountRate)
      ? input.discountRate
      : null;

  const totalInv = projects.reduce(
    (acc, p) => acc + Math.max(0, p.investment || 0),
    0,
  );
  if (projects.length === 0 || totalInv <= 0) {
    throw new KpiNoCalculableError(
      'roi_probabilistic',
      'Sin proyectos con inversión documentada no hay retorno ponderado.',
    );
  }

  const incompleto = projects.find(
    (p) => !Number.isFinite(p.expectedReturn) || !Number.isFinite(p.probability),
  );
  if (incompleto) {
    throw new KpiNoCalculableError(
      'roi_probabilistic',
      `El proyecto «${incompleto.name}» no tiene retorno o probabilidad documentados.`,
    );
  }

  const weightedReturn = projects.reduce(
    (acc, p) => acc + (expectedReturnOf(p, failureReturn) * Math.max(0, p.investment || 0)) / totalInv,
    0,
  );

  // El ajuste por riesgo de mercado recorta retornos positivos; nunca achica
  // una pérdida esperada.
  const riskAdj = marketRisk === null || weightedReturn <= 0 ? 1 : 1 - marketRisk;
  const roiProb = weightedReturn * riskAdj;
  const roiPct = roiProb * 100;

  // Top 3 projects by contribution
  const ranked = projects
    .map((p) => ({
      project: p,
      contribution: (expectedReturnOf(p, failureReturn) * Math.max(0, p.investment || 0)) / totalInv,
    }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);

  const breakdown: KpiBreakdown[] = [
    {
      label: 'Inversión total',
      value: totalInv,
      formatted: formatKpiCop(totalInv),
    },
    {
      label: 'Retorno esperado ponderado',
      value: weightedReturn,
      formatted: formatKpiPercentPoints(weightedReturn * 100, 2),
    },
    {
      label: 'Retorno en caso de fracaso (declarado)',
      value: failureReturn,
      formatted: formatKpiPercentPoints(failureReturn * 100, 0),
    },
  ];
  if (marketRisk !== null) {
    breakdown.push(
      {
        label: 'Riesgo de mercado (declarado)',
        value: marketRisk,
        formatted: formatKpiPercentPoints(marketRisk * 100, 0),
      },
      {
        label: 'Factor de ajuste por riesgo',
        value: riskAdj,
        formatted: formatKpiNumber(riskAdj, 2),
      },
    );
  }

  ranked.forEach((r, idx) => {
    breakdown.push({
      label: `Top ${idx + 1}: ${r.project.name}`,
      value: r.contribution * 100,
      formatted: formatKpiPercentPoints(r.contribution * 100, 2),
      weight: r.project.investment / totalInv,
    });
  });

  const assumptions = [
    marketRisk === null
      ? 'Riesgo de mercado no declarado: no se aplica ajuste'
      : `Riesgo de mercado declarado = ${formatKpiRate(marketRisk, 0)} (${input.marketRiskSource?.trim() || 'sin fuente: supuesto del usuario'}); no achica pérdidas`,
    `Retorno en caso de fracaso declarado = ${formatKpiRate(failureReturn, 0)}`,
    discountRate === null
      ? 'Tasa de descuento no declarada (no se aplica al retorno del portafolio)'
      : `Tasa de descuento declarada por el usuario (supuesto) = ${formatKpiRate(discountRate, 1)}`,
    'Probabilidades de éxito provistas por proyecto; se clampean a [0,1]',
    'Retornos expresados como TIR efectiva anual',
    'Ponderación por inversión relativa en el portfolio',
  ];

  // Confidence heuristics
  let confidence: KpiResult['confidence'] = 'medium';
  if (projects.length >= 3 && projects.every((p) => p.riskScore !== undefined)) {
    confidence = 'high';
  }

  return {
    kind: 'roi_probabilistic',
    value: Number(roiPct.toFixed(2)),
    formatted: formatKpiPercentPoints(roiPct, 1),
    unit: '%',
    label: 'ROI Probabilístico',
    severity: severityFor(roiPct),
    breakdown,
    assumptions,
    calculatedAt: new Date().toISOString(),
    confidence,
  };
}
