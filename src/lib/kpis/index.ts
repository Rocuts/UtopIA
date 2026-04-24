/**
 * KPI engines — public surface consumed by Executive Dashboard (Agente C)
 * and the 4 windows (Agentes E-H: Escudo / Valor / Verdad / Futuro).
 *
 * All functions are pure and deterministic. No LLM, no I/O.
 */

export { calculateTef } from './tax-efficiency';
export { calculateExitValue, formatCop, INDUSTRY_MULTIPLES } from './exit-value';
export { calculateComplianceScore, COMPLIANCE_WEIGHTS } from './compliance-score';
export { calculateRoiProbabilistic } from './roi-probabilistic';

// Mocks / fixtures
export {
  mockTef,
  mockTefExplicit,
  mockExitValue,
  mockCompliance,
  mockRoiProbabilistic,
  generateMockKpiSet,
  MOCK_KPI_SET_DEFAULT,
} from './mocks';
export type { MockKpiSet } from './mocks';

// Type re-exports so consumers can `import { type KpiResult } from '@/lib/kpis'`
export type {
  ComplianceInput,
  ExitValueIndustry,
  ExitValueInput,
  KpiBreakdown,
  KpiRegistry,
  KpiResult,
  KpiSeverity,
  KpiTrend,
  LastAuditOpinion,
  RoiProbabilisticInput,
  RoiProbabilisticProject,
  TefInput,
  TrendDirection,
} from '@/types/kpis';

// Live KPI layer (ERP + persisted reports + mock fallback)
export {
  getDashboardKpis,
  getExitValue,
  getProbabilisticROI,
  getRegulatoryHealth,
  getTaxEfficiencyRatio,
} from './live';
export type { DashboardKPIs, LiveKpiSource, LiveKpiValue } from './live';
