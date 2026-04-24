/**
 * Compliance Score — índice ponderado 0-100 de cumplimiento regulatorio.
 *
 * Ponderaciones (alineadas con el audit-pipeline en src/lib/agents/financial/audit):
 *   NIIF 30% · Tax 25% · Audit 25% · Legal 20%
 *
 * auditScore = 100 - 15*critical - 6*high - 2*medium (piso 0)
 * Penalización extra por opinión del revisor fiscal.
 *
 * Sanity check manual:
 *   niif=95, tax=92, legal=90, audit findings: 0 crit, 2 high, 5 med, opinion favorable
 *   auditScore = 100 - 0 - 12 - 10 = 78
 *   score = 95*0.30 + 92*0.25 + 90*0.20 + 78*0.25 = 28.5 + 23 + 18 + 19.5 = 89.0
 *   con 'favorable' (penalty 0) -> 89/100 -> neutral
 */

import type {
  ComplianceInput,
  KpiBreakdown,
  KpiResult,
  LastAuditOpinion,
} from '@/types/kpis';

export const COMPLIANCE_WEIGHTS = {
  niif: 0.3,
  tax: 0.25,
  legal: 0.2,
  audit: 0.25,
} as const;

const OPINION_PENALTY: Record<LastAuditOpinion, number> = {
  favorable: 0,
  con_salvedades: 5,
  desfavorable: 20,
  abstension: 30,
};

const OPINION_LABEL: Record<LastAuditOpinion, string> = {
  favorable: 'Favorable',
  con_salvedades: 'Con salvedades',
  desfavorable: 'Desfavorable',
  abstension: 'Abstención',
};

const FINDING_PENALTIES = {
  critical: 15,
  high: 6,
  medium: 2,
} as const;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function severityFor(score: number): KpiResult['severity'] {
  if (score >= 90) return 'good';
  if (score >= 75) return 'neutral';
  if (score >= 60) return 'warn';
  return 'critical';
}

/** Calculates weighted compliance score (0-100). Pure, deterministic. */
export function calculateComplianceScore(input: ComplianceInput): KpiResult {
  const niif = clamp(input.niifCompliance, 0, 100);
  const tax = clamp(input.taxCompliance, 0, 100);
  const legal = clamp(input.legalCompliance, 0, 100);

  const crit = Math.max(0, Math.floor(input.auditFindingsCritical || 0));
  const high = Math.max(0, Math.floor(input.auditFindingsHigh || 0));
  const med = Math.max(0, Math.floor(input.auditFindingsMedium || 0));

  const penalty =
    crit * FINDING_PENALTIES.critical +
    high * FINDING_PENALTIES.high +
    med * FINDING_PENALTIES.medium;
  const auditScoreRaw = 100 - penalty;
  const auditScore = Math.max(0, auditScoreRaw);

  const rawWeighted =
    niif * COMPLIANCE_WEIGHTS.niif +
    tax * COMPLIANCE_WEIGHTS.tax +
    legal * COMPLIANCE_WEIGHTS.legal +
    auditScore * COMPLIANCE_WEIGHTS.audit;

  const opinionPenalty = input.lastAuditOpinion ? OPINION_PENALTY[input.lastAuditOpinion] : 0;
  const score = clamp(rawWeighted - opinionPenalty, 0, 100);
  const roundedScore = Math.round(score);

  const breakdown: KpiBreakdown[] = [
    {
      label: 'NIIF',
      value: niif,
      formatted: `${niif.toFixed(0)}/100`,
      weight: COMPLIANCE_WEIGHTS.niif,
    },
    {
      label: 'Tributario',
      value: tax,
      formatted: `${tax.toFixed(0)}/100`,
      weight: COMPLIANCE_WEIGHTS.tax,
    },
    {
      label: 'Legal',
      value: legal,
      formatted: `${legal.toFixed(0)}/100`,
      weight: COMPLIANCE_WEIGHTS.legal,
    },
    {
      label: 'Auditoría (hallazgos)',
      value: auditScore,
      formatted: `${auditScore.toFixed(0)}/100`,
      weight: COMPLIANCE_WEIGHTS.audit,
    },
    {
      label: 'Hallazgos críticos',
      value: crit,
      formatted: crit.toString(),
    },
    {
      label: 'Hallazgos altos',
      value: high,
      formatted: high.toString(),
    },
    {
      label: 'Hallazgos medios',
      value: med,
      formatted: med.toString(),
    },
  ];

  if (input.lastAuditOpinion) {
    breakdown.push({
      label: 'Última opinión RF',
      value: opinionPenalty,
      formatted: OPINION_LABEL[input.lastAuditOpinion],
    });
  }

  if (typeof input.declarationsOnTime === 'number') {
    const onTime = clamp(input.declarationsOnTime, 0, 100);
    breakdown.push({
      label: 'Declaraciones a tiempo',
      value: onTime,
      formatted: `${onTime.toFixed(0)}%`,
    });
  }

  const assumptions = [
    'Ponderación NIIF 30% / Tax 25% / Audit 25% / Legal 20%',
    'Métricas sub-componente normalizadas 0-100',
    'Hallazgos ponderados: críticos 15 pts, altos 6 pts, medios 2 pts',
    'Penalización por opinión RF: salvedades -5, desfavorable -20, abstención -30',
    'Alineado con el peso del pipeline de auditoría (NIIF 30 / Tax 25 / Legal 20 / Fiscal 25)',
  ];

  // Confidence signals
  let confidence: KpiResult['confidence'] = 'high';
  if (input.lastAuditOpinion === undefined) confidence = 'medium';
  if (niif === 0 && tax === 0 && legal === 0) confidence = 'low';

  return {
    kind: 'compliance',
    value: roundedScore,
    formatted: `${roundedScore}/100`,
    unit: 'score',
    label: 'Compliance Score',
    severity: severityFor(roundedScore),
    breakdown,
    assumptions,
    calculatedAt: new Date().toISOString(),
    confidence,
  };
}
