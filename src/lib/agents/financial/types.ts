// ---------------------------------------------------------------------------
// Types for the 1+1 Financial Orchestrator pipeline
// ---------------------------------------------------------------------------
// Pipeline: Raw Data -> Agent 1 (NIIF) -> Agent 2 (Strategy) -> Agent 3 (Governance) -> Consolidation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

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
  /** Representante legal — campo legacy (string nombre). Mantener para retrocompat. */
  legalRepresentative?: string;
  /** Revisor fiscal — campo legacy (string nombre). Mantener para retrocompat. */
  fiscalAuditor?: string;
  /** Contador publico — campo legacy (string nombre). Mantener para retrocompat. */
  accountant?: string;
  /**
   * Firmantes estructurados (forma canónica nueva). Coexiste con los campos
   * legacy `legalRepresentative` / `fiscalAuditor` / `accountant`: si ambos
   * están presentes, `signatories` gana. Loaders (`loadSignatoriesForWorkspace`)
   * y renderers (`renderSignatureBlock`) consumen esta forma.
   *
   * - `representanteLegal.nombre` → bloque de firma en dictamen / acta.
   * - `revisorFiscal.{nombre, tp}` → '12345-T' formato Tarjeta Profesional.
   * - `contadorPublico.{nombre, tp}` → idem.
   *
   * `tp` debe seguir el formato '<numero>-T' (ej. '12345-T') exigido por la
   * Junta Central de Contadores (JCC) bajo Ley 43/1990 Art. 3.
   */
  signatories?: {
    representanteLegal?: { nombre: string };
    revisorFiscal?: { nombre: string; tp: string };
    contadorPublico?: { nombre: string; tp: string };
  };
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
  | { type: 'done' };
