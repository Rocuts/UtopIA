// ---------------------------------------------------------------------------
// Capa 2 — Motor Normativo — Barrel
// ---------------------------------------------------------------------------
//
// Re-exporta el catálogo completo y el prompt builder para consumo desde
// Capa 4 (Agente Fiscal) y el validator agent (que opera en paralelo).
// ---------------------------------------------------------------------------

// Catálogo agregado + sub-catálogos
export {
  MOTOR_NORMATIVO_CATALOG,
  ARTICULOS_ET,
  CONCEPTOS_DIAN,
  LEYES_REFORMAS,
  JURISPRUDENCIA,
  SANCIONES,
  TARIFAS_RETENCION,
  NORMAS_AUDITORIA,
} from './catalog';

// Prompt builder
export { buildMotorNormativoPrompt } from './prompts/motor-normativo.prompt';

// Tipos (re-export completo para que los consumidores no importen de types.ts directamente)
export type {
  NormativeVigencia,
  BlacklistSeveridad,
  NormativeCitationKind,
  NormativeAmendment,
  NormativeArticleEntry,
  DianConceptEntry,
  LawReformEntry,
  JurisprudenceEntry,
  SanctionEntry,
  RetentionTariffEntry,
  AuditStandardEntry,
  BlacklistEntry,
  ParsedCitation,
  CitationCheckResult,
  MotorNormativoPromptOptions,
  NormativeCatalogue,
} from './types';
