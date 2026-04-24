/**
 * KPI mocks — deterministic, timestamp-free fixtures so UI consumers
 * (agents C, E-H) can render the Executive Dashboard without real data.
 *
 * `generateMockKpiSet(severity)` returns a consistent 4-KPI bundle at the
 * requested severity level — handy for visual regression of each state.
 *
 * The timestamps in the exported constants are intentionally fixed
 * (2026-04-23T00:00:00Z) for snapshot-testing stability. If you need a
 * fresh `calculatedAt`, call the calculators directly.
 */

import type { KpiBreakdown, KpiResult, KpiSeverity } from '@/types/kpis';
import { calculateComplianceScore } from './compliance-score';
import { calculateExitValue } from './exit-value';
import { calculateRoiProbabilistic } from './roi-probabilistic';
import { calculateTef } from './tax-efficiency';

const FIXED_TS = '2026-04-23T00:00:00Z';

function freeze(result: KpiResult): KpiResult {
  return { ...result, calculatedAt: FIXED_TS };
}

// ---------------------------------------------------------------------------
// Canonical "good" fixtures — the out-of-the-box dashboard state
// ---------------------------------------------------------------------------

export const mockTef: KpiResult = freeze(
  calculateTef({
    revenue: 5_000_000_000,
    taxableIncomeBaseline: 1_000_000_000,
    taxableIncomeOptimized: 776_000_000,
    taxRate: 0.35,
    periodPrevious: {
      taxableIncomeBaseline: 1_000_000_000,
      taxableIncomeOptimized: 800_000_000,
    },
  }),
);

const mockTefBreakdown: KpiBreakdown[] = mockTef.breakdown ?? [];

/** Redundant-but-explicit override to lock canonical example to 22.4%. */
export const mockTefExplicit: KpiResult = {
  ...mockTef,
  value: 22.4,
  formatted: '22.4%',
  trend: { direction: 'up', delta: 12.3, periodLabel: 'vs trimestre previo' },
  breakdown: mockTefBreakdown,
  confidence: 'medium',
};

export const mockExitValue: KpiResult = freeze(
  calculateExitValue({
    ebitda: 650_000_000,
    industry: 'services',
    growthRate: 0.18,
    wacc: 0.135,
    netDebt: 380_000_000,
    adjustments: [
      { label: 'Normalización arrendamientos', amount: 45_000_000 },
      { label: 'Extraordinarios 2025', amount: -20_000_000 },
    ],
  }),
);

export const mockCompliance: KpiResult = freeze(
  calculateComplianceScore({
    niifCompliance: 98,
    taxCompliance: 95,
    legalCompliance: 96,
    auditFindingsCritical: 0,
    auditFindingsHigh: 1,
    auditFindingsMedium: 2,
    declarationsOnTime: 100,
    lastAuditOpinion: 'favorable',
  }),
);

export const mockRoiProbabilistic: KpiResult = freeze(
  calculateRoiProbabilistic({
    projects: [
      { name: 'Optimización SIMPLE', expectedReturn: 0.28, probability: 0.85, investment: 150_000_000, riskScore: 20 },
      { name: 'Zona Franca PYME', expectedReturn: 0.22, probability: 0.7, investment: 300_000_000, riskScore: 35 },
      { name: 'ZOMAC expansion', expectedReturn: 0.35, probability: 0.55, investment: 120_000_000, riskScore: 50 },
    ],
    marketRisk: 0.22,
    discountRate: 0.135,
  }),
);

// ---------------------------------------------------------------------------
// Parametric fixture generator — emits a 4-KPI bundle tuned to a severity
// ---------------------------------------------------------------------------

export interface MockKpiSet {
  tef: KpiResult;
  exitValue: KpiResult;
  compliance: KpiResult;
  roi: KpiResult;
}

/**
 * Produces a consistent 4-KPI bundle at the requested severity level.
 * Useful for visual QA of each card state (good / neutral / warn / critical).
 */
export function generateMockKpiSet(severity: KpiSeverity): MockKpiSet {
  switch (severity) {
    case 'good':
      return {
        tef: freeze(
          calculateTef({
            revenue: 8_000_000_000,
            taxableIncomeBaseline: 1_500_000_000,
            taxableIncomeOptimized: 1_150_000_000,
            taxRate: 0.35,
            periodPrevious: {
              taxableIncomeBaseline: 1_500_000_000,
              taxableIncomeOptimized: 1_250_000_000,
            },
          }),
        ),
        exitValue: freeze(
          calculateExitValue({
            ebitda: 900_000_000,
            industry: 'tech',
            growthRate: 0.25,
            wacc: 0.13,
            netDebt: 150_000_000,
          }),
        ),
        compliance: freeze(
          calculateComplianceScore({
            niifCompliance: 97,
            taxCompliance: 96,
            legalCompliance: 95,
            auditFindingsCritical: 0,
            auditFindingsHigh: 0,
            auditFindingsMedium: 1,
            lastAuditOpinion: 'favorable',
          }),
        ),
        roi: freeze(
          calculateRoiProbabilistic({
            projects: [
              { name: 'Proyecto Alpha', expectedReturn: 0.35, probability: 0.8, investment: 200_000_000 },
              { name: 'Proyecto Beta', expectedReturn: 0.28, probability: 0.75, investment: 250_000_000 },
              { name: 'Proyecto Gamma', expectedReturn: 0.42, probability: 0.6, investment: 100_000_000 },
            ],
            marketRisk: 0.2,
          }),
        ),
      };

    case 'neutral':
      return {
        tef: freeze(
          calculateTef({
            revenue: 3_000_000_000,
            taxableIncomeBaseline: 700_000_000,
            taxableIncomeOptimized: 630_000_000,
            taxRate: 0.35,
          }),
        ),
        exitValue: freeze(
          calculateExitValue({
            ebitda: 400_000_000,
            industry: 'manufacturing',
            growthRate: 0.08,
            netDebt: 180_000_000,
          }),
        ),
        compliance: freeze(
          calculateComplianceScore({
            niifCompliance: 82,
            taxCompliance: 80,
            legalCompliance: 78,
            auditFindingsCritical: 0,
            auditFindingsHigh: 2,
            auditFindingsMedium: 4,
            lastAuditOpinion: 'con_salvedades',
          }),
        ),
        roi: freeze(
          calculateRoiProbabilistic({
            projects: [
              { name: 'Proyecto Delta', expectedReturn: 0.18, probability: 0.65, investment: 200_000_000 },
              { name: 'Proyecto Epsilon', expectedReturn: 0.14, probability: 0.7, investment: 150_000_000 },
            ],
            marketRisk: 0.25,
          }),
        ),
      };

    case 'warn':
      return {
        tef: freeze(
          calculateTef({
            revenue: 1_500_000_000,
            taxableIncomeBaseline: 400_000_000,
            taxableIncomeOptimized: 380_000_000,
            taxRate: 0.35,
          }),
        ),
        exitValue: freeze(
          calculateExitValue({
            ebitda: 180_000_000,
            industry: 'retail',
            growthRate: 0.03,
            netDebt: 220_000_000,
          }),
        ),
        compliance: freeze(
          calculateComplianceScore({
            niifCompliance: 68,
            taxCompliance: 70,
            legalCompliance: 65,
            auditFindingsCritical: 0,
            auditFindingsHigh: 4,
            auditFindingsMedium: 8,
            lastAuditOpinion: 'con_salvedades',
          }),
        ),
        roi: freeze(
          calculateRoiProbabilistic({
            projects: [
              { name: 'Proyecto Sigma', expectedReturn: 0.1, probability: 0.5, investment: 100_000_000 },
              { name: 'Proyecto Tau', expectedReturn: 0.08, probability: 0.6, investment: 150_000_000 },
            ],
            marketRisk: 0.35,
          }),
        ),
      };

    case 'critical':
    default:
      return {
        tef: freeze(
          calculateTef({
            revenue: 900_000_000,
            taxableIncomeBaseline: 250_000_000,
            taxableIncomeOptimized: 248_000_000,
            taxRate: 0.35,
          }),
        ),
        exitValue: freeze(
          calculateExitValue({
            ebitda: 60_000_000,
            industry: 'other',
            growthRate: -0.08,
            netDebt: 400_000_000,
          }),
        ),
        compliance: freeze(
          calculateComplianceScore({
            niifCompliance: 55,
            taxCompliance: 50,
            legalCompliance: 45,
            auditFindingsCritical: 3,
            auditFindingsHigh: 6,
            auditFindingsMedium: 10,
            lastAuditOpinion: 'desfavorable',
          }),
        ),
        roi: freeze(
          calculateRoiProbabilistic({
            projects: [
              { name: 'Proyecto Omega', expectedReturn: 0.05, probability: 0.4, investment: 80_000_000 },
              { name: 'Proyecto Zeta', expectedReturn: 0.02, probability: 0.3, investment: 120_000_000 },
            ],
            marketRisk: 0.45,
          }),
        ),
      };
  }
}

/** Default bundle used by the dashboard at initial render. */
export const MOCK_KPI_SET_DEFAULT: MockKpiSet = generateMockKpiSet('good');
