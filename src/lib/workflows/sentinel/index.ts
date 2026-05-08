// Sentinel public API barrel.
export { runSentinelCheck, evaluateTriggersForTest } from './orchestrator';
export type {
  SentinelInput,
  SentinelMetrics,
  SentinelEvaluation,
  SentinelRunReport,
  TriggerCode,
  TriggerEvaluation,
} from './types';
export { runT1 } from './triggers/r1-truth-gap';
export { runT2 } from './triggers/r2-shield-liquidity';
export { runT3 } from './triggers/r3-value-anomaly';
export { runT4 } from './triggers/r4-future-inflection';
export {
  evaluateEscalation,
  REEMIT_THRESHOLD_HOURS,
  ESCALATE_THRESHOLD_HOURS,
} from './relevance-learning';
