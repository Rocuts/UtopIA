// ---------------------------------------------------------------------------
// Capa 4 — Agente Fiscal — Barrel
// ---------------------------------------------------------------------------
//
// Single import surface para el API handler (`/api/escudo/fiscal`), el
// validator (rama paralela) y la UI.
// ---------------------------------------------------------------------------

// Orchestrator (entry point principal)
export { orchestrateFiscalAgent } from './orchestrator';

// Bloqueo del balance con motivo (misma lectura que /niif, P4 cross-dep): el
// API handler puede responder 422 con `reasons` igual que /niif.
export {
  EscudoBalanceBloqueadoError,
  ESCUDO_BALANCE_BLOQUEADO_CODE,
} from '../lib/balance-ingesta';

// Tipos públicos
export type {
  FiscalAgentInput,
  FiscalAgentMode,
  FiscalAgentReport,
  FiscalAgentOrchestratorInput,
  FiscalAgentOrchestratorCallbacks,
  FiscalAgentProgressEvent,
  FiscalAgentStage,
  CcvModuleResult,
  ConciliacionModuleResult,
  RiskScoreModuleResult,
  PlaneacionModuleResult,
  DefensaDianModuleResult,
  DevolucionesModuleResult,
  SupervivenciaModuleResult,
  FiscalSynthesisResult,
  FiscalSynthesisRecommendation,
  DianRequirementKind,
} from './types';

// Schemas (los consume el validator agent — rama paralela)
export {
  ccvModuleSchema,
  conciliacionModuleSchema,
  riskScoreModuleSchema,
  planeacionModuleSchema,
  defensaDianModuleSchema,
  devolucionesModuleSchema,
  supervivenciaModuleSchema,
  synthesisSchema,
} from './schemas';

// Tools determinísticos (los consume el validator agent + tests del otro agente)
export { precomputeCcv, buildAlertaTasaMinima, clasificarEficienciaFiscal } from './tools/ccv-calculator';
export { computeRiskScore, posibleSaldoAFavorContableCents } from './tools/risk-score-calculator';
export { buildConciliacionSkeleton, TARIFA_GENERAL_PCT_VAL } from './tools/conciliacion-builder';
export { analyzeRefund } from './tools/refund-analyzer';
export {
  buildDianLetterSkeleton,
  classifyDianRequirement,
  reduccionesDisponibles,
} from './tools/dian-letter-builder';

// Runtime (lo reusan los validators o tests para invocar agentes individuales)
export { callFiscalAgent } from './runtime';
