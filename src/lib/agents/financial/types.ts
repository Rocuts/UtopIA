// ---------------------------------------------------------------------------
// Types for the 1+1 Financial Orchestrator pipeline
// ---------------------------------------------------------------------------
// Pipeline: Raw Data -> Agent 1 (NIIF) -> Agent 2 (Strategy) -> Agent 3 (Governance) -> Consolidation
// ---------------------------------------------------------------------------

import type { NiifReportJson } from './contracts/niif-report';
import type { StrategyReportJson } from './contracts/strategy-report';
import type { GovernanceReportJson } from './contracts/governance-report';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Firmantes legales del informe financiero (Ley 43/1990 art. 10 y 13).
 *
 * Contrato compartido con C (`elite-C-fiscal-pdf`): el renderer del PDF firma
 * la plantilla `{nombre} / {cargo} / T.P. {numero}-T` cuando estos campos
 * están presentes. Si el caller no los inyecta, los prompts del Governance
 * Specialist caen al fallback de strings legacy (`legalRepresentative`,
 * `fiscalAuditor`, `accountant`) sin romper retrocompatibilidad.
 *
 * Why: la firma del Revisor Fiscal y del Contador Público bajo Ley 43/1990
 * requiere número de Tarjeta Profesional (T.P.) — sin ella el dictamen no es
 * válido. La estructura tipada evita que el LLM invente T.P.s.
 */
export interface Signatories {
  /**
   * Representante Legal — Ley 222/1995 art. 23 + Art. 196 C.Co.
   * `cedula` opcional (ITEM 5 ORDEN DE CIERRE): cuando está presente, los
   * prompts y el renderer PDF la incluyen debajo del nombre como "C.C. XXX".
   */
  representanteLegal?: { nombre: string; cedula?: string };
  /** Revisor Fiscal — Ley 43/1990 art. 10. T.P. formato '12345-T'. */
  revisorFiscal?: { nombre: string; tp: string };
  /** Contador Público — Ley 43/1990 art. 13. T.P. formato '12345-T'. */
  contadorPublico?: { nombre: string; tp: string };
}

export interface CompanyInfo {
  /** Razon social */
  name: string;
  /** NIT */
  nit: string;
  /** Tipo societario (SAS, SA, LTDA, etc.) */
  entityType?: string;
  /** Sector economico */
  sector?: string;
  /** NIIF group (1 = Plenas, 2 = PYMES, 3 = Simplificada) */
  niifGroup?: 1 | 2 | 3;
  /** Periodo fiscal (e.g. "2025") */
  fiscalPeriod: string;
  /** Periodo comparativo (e.g. "2024") */
  comparativePeriod?: string;
  /** Ciudad / municipio */
  city?: string;
  /** Representante legal (legacy — string simple). Mantener para retrocompat. */
  legalRepresentative?: string;
  /**
   * ITEM 5 ORDEN DE CIERRE — Cédula del Representante Legal.
   * Aceptado en formato '80.123.456' o '80123456' (sin DV — la cédula no
   * lleva dígito de verificación). Si falta, la firma usa placeholder.
   */
  legalRepresentativeId?: string;
  /** Revisor fiscal (legacy — string simple). Mantener para retrocompat. */
  fiscalAuditor?: string;
  /**
   * ITEM 5 ORDEN DE CIERRE — Tarjeta Profesional del Revisor Fiscal.
   * Formato Junta Central de Contadores: '12345-T'. Ley 43/1990 Art. 3.
   */
  fiscalAuditorTp?: string;
  /** Contador publico (legacy — string simple). Mantener para retrocompat. */
  accountant?: string;
  /**
   * ITEM 5 ORDEN DE CIERRE — Tarjeta Profesional del Contador Público.
   * Formato Junta Central de Contadores: '12345-T'. Ley 43/1990 Art. 13.
   */
  accountantTp?: string;
  /**
   * Firmantes estructurados (forma canónica). Coexiste con los strings legacy:
   * si ambos están presentes, `signatories` gana. Consumido por loaders
   * (`loadSignatoriesForWorkspace`) y renderers (`renderSignatureBlock`).
   * Backward-compat total: si `signatories` falta, los prompts del Governance
   * Specialist y el renderer PDF caen al fallback legacy.
   *
   * `tp` formato '<numero>-T' (ej. '12345-T') exigido por la Junta Central de
   * Contadores (Ley 43/1990 Art. 3).
   */
  signatories?: Signatories;
  /** Períodos detectados en el archivo. Sourced en /api/upload. */
  detectedPeriods?: string[];
}

export interface FinancialReportRequest {
  /** Raw accounting data (CSV text, trial balance, ERP export) */
  rawData: string;
  /** Company metadata */
  company: CompanyInfo;
  /** Language for the report */
  language: 'es' | 'en';
  /** Additional instructions or context from the user */
  instructions?: string;
}

// ---------------------------------------------------------------------------
// Stage 1: NIIF Analyst Output
// ---------------------------------------------------------------------------

export interface NiifAnalysisResult {
  /** Estado de Situacion Financiera (Balance General) */
  balanceSheet: string;
  /** Estado de Resultados Integral (P&L) */
  incomeStatement: string;
  /** Estado de Flujos de Efectivo */
  cashFlowStatement: string;
  /** Estado de Cambios en el Patrimonio */
  equityChangesStatement: string;
  /** Technical notes on account mapping and variations */
  technicalNotes: string;
  /** Raw content as a single Markdown block for downstream agents */
  fullContent: string;
  /**
   * JSON-strict del NIIF Analyst (Fase 2 outcome-first). Disponible cuando el
   * agente corre vía `callFinancialAgent` (default actual). Los renderers
   * post-Fase-3 lo consumen DIRECTO en lugar de parsear los strings Markdown.
   * Los consumers legacy (PDF Élite, Excel) hacen optional chaining y caen al
   * Markdown si está ausente.
   */
  json?: NiifReportJson;
}

// ---------------------------------------------------------------------------
// Stage 2: Strategy Director Output
// ---------------------------------------------------------------------------

export interface StrategicAnalysisResult {
  /** KPIs dashboard (Razon Corriente, Margen Neto, ROA, Endeudamiento) */
  kpiDashboard: string;
  /** Break-even analysis */
  breakEvenAnalysis: string;
  /** Projected cash flow / master budget */
  projectedCashFlow: string;
  /** Strategic recommendations (3 minimum) */
  strategicRecommendations: string;
  /** Raw content as a single Markdown block */
  fullContent: string;
  /** JSON-strict del Strategy Director (Fase 2 outcome-first). Ver `NiifAnalysisResult.json`. */
  json?: StrategyReportJson;
}

// ---------------------------------------------------------------------------
// Stage 3: Governance Specialist Output
// ---------------------------------------------------------------------------

export interface GovernanceResult {
  /** Notas a los Estados Financieros */
  financialNotes: string;
  /** Acta de Asamblea General Ordinaria de Accionistas */
  shareholderMinutes: string;
  /** Raw content as a single Markdown block */
  fullContent: string;
  /** JSON-strict del Governance Specialist (Fase 2 outcome-first). Ver `NiifAnalysisResult.json`. */
  json?: GovernanceReportJson;
}

// ---------------------------------------------------------------------------
// Post-render validation result (D2/D3)
// ---------------------------------------------------------------------------

export interface ReportValidationResult {
  /** Whether the report passes all hard checks */
  ok: boolean;
  /** Hard failures that block the report from being surfaced as-is */
  errors: string[];
  /** Soft issues (warnings) worth surfacing to the UI */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Consolidated Output
// ---------------------------------------------------------------------------

export interface FinancialReport {
  /** Company info echo */
  company: CompanyInfo;
  /** Stage 1 output */
  niifAnalysis: NiifAnalysisResult;
  /** Stage 2 output */
  strategicAnalysis: StrategicAnalysisResult;
  /** Stage 3 output */
  governance: GovernanceResult;
  /** Final consolidated Markdown report */
  consolidatedReport: string;
  /** Timestamp */
  generatedAt: string;
  /** Post-render validation result (placeholders, sections, numeric sanity). */
  validation?: ReportValidationResult;
  /** Flags de auditoría sobre los ajustes deterministas aplicados por el Curator (R1, R5, R6, R7). */
  annotations?: FinancialReportAnnotations;
  /**
   * Pulido NIIF PYME Grupo 2 — discriminator del gate `auditReportEmittable`.
   * Cuando `kind === 'no-emitible'`, el endpoint `/api/financial-report` debe
   * devolver el objeto al cliente sin los EEFF visibles, sólo con la lista
   * de blockers y los ajustes sugeridos. Cuando `kind === 'emittable'` (o el
   * campo está ausente por retrocompat), el reporte se sirve tal cual.
   */
  emittability?: ReportEmittabilityState;
}

export type ReportEmittabilityKind = 'emittable' | 'no-emitible';

export interface ReportEmittabilityState {
  kind: ReportEmittabilityKind;
  /** Códigos V1..V12 que dispararon el bloqueo (vacío si emittable). */
  blockers: Array<{ code: string; message: string; detail?: string }>;
  /** Sugerencias accionables (asientos pendientes, etc.). */
  suggestedAdjustments: string[];
}

/**
 * Flags de auditoría producidos por el Curator NIIF tras correr R1 / R5 / R6 / R7.
 * Permiten al renderer y al validator post-pipeline saber qué ajustes
 * deterministas se aplicaron al snapshot antes de que los agentes LLM lo vieran.
 */
export interface FinancialReportAnnotations {
  hasEquityConvergence: boolean;
  hasCashFlowClosure: boolean;
  hasNegativeAssetReclass: boolean;
  hasPresumedCostWarning: boolean;
  /** Total absoluto reclasificado por R1 (suma de effectiveTransferCop). */
  reclassifiedAmountCop: number;
}

// ---------------------------------------------------------------------------
// SSE Progress Events
// ---------------------------------------------------------------------------

export type FinancialProgressEvent =
  | { type: 'stage_start'; stage: 1 | 2 | 3 | 4; label: string }
  | { type: 'stage_progress'; stage: 1 | 2 | 3 | 4; detail: string }
  | { type: 'stage_complete'; stage: 1 | 2 | 3 | 4; label: string }
  | { type: 'warning'; warnings: string[] }
  | { type: 'error'; message: string }
  | {
      /**
       * Telemetría por-agente para observabilidad UI/dashboard. Lo emite cada
       * agent.ts después de su `callFinancialAgent`, vía el callback
       * `onTelemetry`. Incluye señal diagnóstica del primer pase cuando el
       * auto-fallback se activó (`fallbackUsed=true`).
       */
      type: 'agent_telemetry';
      agentName: string;
      modelId?: string;
      inputTokens?: number;
      outputTokens?: number;
      reasoningTokens?: number;
      cachedInputTokens?: number;
      elapsedMs: number;
      fallbackUsed: boolean;
      firstPassReasoningTokens?: number;
      firstPassFinishReason?: string;
    }
  | { type: 'done' };
