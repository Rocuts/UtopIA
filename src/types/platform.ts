// ─── Case Management ─────────────────────────────────────────────────────────

export type CaseType =
  | 'general_chat'
  | 'dian_defense'
  | 'tax_refund'
  | 'due_diligence'
  | 'financial_intel'
  | 'niif_report'
  | 'tax_planning'
  | 'transfer_pricing'
  | 'business_valuation'
  | 'fiscal_audit_opinion'
  | 'tax_reconciliation'
  | 'feasibility_study'

export type CaseStatus =
  | 'intake'
  | 'processing'
  | 'streaming'
  | 'review'
  | 'complete'

export type AgentTier = 'T1' | 'T2' | 'T3'
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low'
export type QualityGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F'
export type AuditSeverity = 'critico' | 'alto' | 'medio' | 'bajo' | 'informativo'
export type AuditDomain = 'niif' | 'tributario' | 'legal' | 'revisoria'

export type WorkspaceMode = 'intake' | 'chat' | 'pipeline' | 'result'

// ─── Case Entity ─────────────────────────────────────────────────────────────

export interface Case {
  id: string
  type: CaseType
  status: CaseStatus
  createdAt: Date
  updatedAt: Date
  title: string
  riskLevel?: RiskLevel
  riskScore?: number
  grade?: QualityGrade
  messages: Message[]
  intake?: IntakeFormUnion
  report?: FinancialReport
  auditReport?: AuditReport
  qualityReport?: QualityReport
  documents: UploadedDocument[]
  citations: Citation[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  tier?: AgentTier
  toolCalls?: ToolCall[]
  riskLevel?: RiskLevel
  riskScore?: number
  citations?: Citation[]
  sanctionCalc?: SanctionCalculation
  dianDraft?: string
}

// ─── Intake Forms ─────────────────────────────────────────────────────────────

export type IntakeFormUnion =
  | DianDefenseIntake
  | TaxRefundIntake
  | DueDiligenceIntake
  | FinancialIntelIntake
  | NiifReportIntake
  | TaxPlanningIntake
  | TransferPricingIntake
  | BusinessValuationIntake
  | FiscalAuditOpinionIntake
  | TaxReconciliationIntake
  | FeasibilityStudyIntake

export interface DianDefenseIntake {
  caseType: 'dian_defense'
  actType:
    | 'requerimiento_ordinario'
    | 'requerimiento_especial'
    | 'pliego_cargos'
    | 'liquidacion_oficial'
    | 'emplazamiento'
    | 'otro'
  actTypeOther?: string
  taxes: Array<'iva' | 'renta' | 'retencion' | 'ica' | 'otro'>
  periodStart: string
  periodEnd: string
  disputedAmount?: number
  responseDeadline: string
  expedienteNumber?: string
  additionalContext?: string
}

export interface TaxRefundIntake {
  caseType: 'tax_refund'
  taxType: 'iva' | 'renta' | 'retencion'
  period: string
  approximateAmount?: number
  alreadyFiled: boolean
  filingNumber?: string
}

export interface DueDiligenceIntake {
  caseType: 'due_diligence'
  purpose: 'credito' | 'inversion' | 'venta' | 'fusion' | 'otro'
  companyName: string
  nit: string
  periodStart: string
  periodEnd: string
  entityType: 'SAS' | 'SA' | 'LTDA' | 'SCS' | 'otro'
  niifGroup: 1 | 2 | 3
}

export interface FinancialIntelIntake {
  caseType: 'financial_intel'
  analyses: Array<
    | 'cash_flow'
    | 'breakeven'
    | 'dcf_valuation'
    | 'cost_structure'
    | 'profitability'
    | 'tax_simulation'
    | 'merger_scenario'
  >
  period: string
  specificQuestion?: string
}

export interface NiifReportIntake {
  caseType: 'niif_report'
  company: CompanyMetadata
  niifGroup: 1 | 2 | 3
  fiscalPeriod: string
  comparativePeriod?: string
  rawData: string
  preprocessingReport?: PreprocessingReport
  outputOptions: NiifOutputOptions
  specialInstructions?: string
}

export interface CompanyMetadata {
  name: string
  nit: string
  entityType: 'SAS' | 'SA' | 'LTDA' | 'SCS' | 'otro'
  sector?: string
  city?: string
  legalRepresentative?: string
  accountant?: string
  fiscalAuditor?: string
}

export interface NiifOutputOptions {
  financialStatements: boolean
  kpiDashboard: boolean
  cashFlowProjection: boolean
  breakevenAnalysis: boolean
  notesToFinancialStatements: boolean
  shareholdersMinutes: boolean
  auditPipeline: boolean
  metaAudit: boolean
  excelExport: boolean
  comparativeAnalysis: boolean
}

// ─── New Module Intakes ───────────────────────────────────────────────────────

export interface TaxPlanningIntake {
  caseType: 'tax_planning'
  company: CompanyMetadata
  currentRegime: 'ordinario' | 'simple' | 'zona_franca' | 'zomac' | 'otro'
  annualRevenue?: number
  currentTaxBurden?: number
  objectives: Array<
    | 'minimize_renta'
    | 'optimize_iva'
    | 'dividend_planning'
    | 'holding_structure'
    | 'tax_benefits'
    | 'international_planning'
    | 'succession'
  >
  hasRelatedParties: boolean
  period: string
  specialInstructions?: string
}

export interface TransferPricingIntake {
  caseType: 'transfer_pricing'
  company: CompanyMetadata
  grossEquity: number
  grossRevenue: number
  relatedParties: Array<{
    name: string
    country: string
    relationship: 'matriz' | 'subordinada' | 'sucursal' | 'vinculado_economico'
    transactionTypes: Array<'bienes' | 'servicios' | 'financiamiento' | 'intangibles' | 'garantias'>
    annualAmount: number
  }>
  period: string
  hasCurrentDocumentation: boolean
  specialInstructions?: string
}

export interface BusinessValuationIntake {
  caseType: 'business_valuation'
  company: CompanyMetadata
  purpose: 'venta' | 'fusion' | 'adquisicion' | 'aporte_especie' | 'sucesion' | 'impairment' | 'litigio' | 'otro'
  methodologies: Array<'dcf' | 'multiplos_mercado' | 'activos_netos' | 'dividendos' | 'opciones_reales'>
  historicalPeriods: number
  projectionYears: number
  hasFinancialStatements: boolean
  specialInstructions?: string
}

export interface FiscalAuditOpinionIntake {
  caseType: 'fiscal_audit_opinion'
  company: CompanyMetadata
  period: string
  comparativePeriod?: string
  opinionScope: 'plena' | 'limitada' | 'revision'
  areasOfFocus: Array<
    | 'going_concern'
    | 'revenue_recognition'
    | 'inventory'
    | 'related_parties'
    | 'contingencies'
    | 'subsequent_events'
    | 'estimates'
  >
  materialityThreshold?: number
  hasInternalControl: boolean
  specialInstructions?: string
}

export interface TaxReconciliationIntake {
  caseType: 'tax_reconciliation'
  company: CompanyMetadata
  period: string
  niifGroup: 1 | 2 | 3
  reconciledTaxes: Array<'renta' | 'iva' | 'retencion' | 'ica' | 'cree'>
  hasNiifFinancials: boolean
  hasFiscalDeclarations: boolean
  knownDifferences?: string
  specialInstructions?: string
}

export interface FeasibilityStudyIntake {
  caseType: 'feasibility_study'
  projectName: string
  projectType: 'nueva_empresa' | 'expansion' | 'nuevo_producto' | 'inversion_inmobiliaria' | 'franquicia' | 'tecnologia' | 'otro'
  sector: string
  estimatedInvestment: number
  location: string
  projectionYears: number
  analyses: Array<
    | 'market_study'
    | 'technical_feasibility'
    | 'financial_model'
    | 'risk_analysis'
    | 'legal_framework'
    | 'environmental_impact'
    | 'social_impact'
  >
  fundingSource: 'propio' | 'credito' | 'inversion' | 'mixto'
  specialInstructions?: string
}

// ─── Agent & Pipeline ─────────────────────────────────────────────────────────

export interface AgentNode {
  id: string
  label: string
  sublabel?: string
  status: 'pending' | 'active' | 'complete' | 'error'
  lastTool?: string
  elapsed?: number
  branch?: 'main' | 'tax' | 'accounting' | 'parallel'
}

export interface ToolCall {
  name: string
  agent: string
  timestamp: Date
  result?: string
}

export interface PipelineState {
  mode: 'idle' | 'running' | 'auditing' | 'quality' | 'complete'
  currentStage: 0 | 1 | 2 | 3
  stageLabels: string[]
  completedStages: number[]
  auditorsStarted: string[]
  auditorsComplete: string[]
  auditFindings: Record<string, number>
  qualityGrade?: QualityGrade
  qualityScore?: number
  startedAt?: Date
  completedAt?: Date
}

// ─── Normative & Audit ────────────────────────────────────────────────────────

export interface Citation {
  article: string
  source: string
  normText?: string
  url?: string
}

export interface AuditFinding {
  code: string
  severity: AuditSeverity
  domain: AuditDomain
  title: string
  description: string
  normReference: string
  recommendation: string
  impact: string
}

export interface AuditReport {
  findings: AuditFinding[]
  complianceScore: number
  opinion?: string
}

export interface QualityReport {
  grade: QualityGrade
  score: number
  dimensions: QualityDimension[]
}

export interface QualityDimension {
  name: string
  score: number
  maxScore: number
  notes?: string
}

export interface FinancialReport {
  content: string
  sections: ReportSection[]
  kpis?: Record<string, number | string>
}

export interface ReportSection {
  id: string
  title: string
  content: string
  order: number
}

export interface SanctionCalculation {
  type: string
  article: string
  uvt2026: number
  baseAmount: number
  withReduction?: number
  moratoryInterest?: number
  total: number
}

// ─── Documents ────────────────────────────────────────────────────────────────

export interface UploadedDocument {
  id: string
  name: string
  type: 'pdf' | 'docx' | 'xlsx' | 'image' | 'csv'
  sizeBytes: number
  status: 'uploading' | 'processing' | 'indexed' | 'error'
  ocrApplied?: boolean
  uploadedAt: Date
}

export interface PreprocessingReport {
  accountsDetected: number
  pucClassesFound: number
  equationValid: boolean
  assets: number
  liabilities: number
  equity: number
  discrepancies: Discrepancy[]
}

export interface Discrepancy {
  class: number
  account?: string
  reported: number
  calculated: number
  difference: number
  probableCause: string
}

// ─── Intelligence Panel ──────────────────────────────────────────────────────

export interface IntelligencePanelData {
  riskLevel?: RiskLevel
  riskScore?: number
  riskFactors?: Array<{ description: string; points: number }>
  citations: Citation[]
  findings: AuditFinding[]
  grade?: QualityGrade
  qualityScore?: number
  qualityDimensions?: QualityDimension[]
  auditSummary?: Record<AuditSeverity, number>
}
