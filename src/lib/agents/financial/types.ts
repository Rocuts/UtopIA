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
  /** Representante legal */
  legalRepresentative?: string;
  /** Revisor fiscal */
  fiscalAuditor?: string;
  /** Contador publico */
  accountant?: string;
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
