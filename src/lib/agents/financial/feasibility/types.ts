// ---------------------------------------------------------------------------
// Types for the UtopIA Feasibility Study (Estudio de Factibilidad) pipeline
// ---------------------------------------------------------------------------
// Pipeline: Project Data -> Agent 1 (Market) -> Agent 2 (Financial) -> Agent 3 (Risk) -> Consolidation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface ProjectInfo {
  /** Nombre del proyecto o emprendimiento */
  projectName: string;
  /** Descripcion general del proyecto */
  description: string;
  /** Sector economico (e.g. "Tecnologia", "Agroindustria") */
  sector: string;
  /** Clasificacion CIIU Rev. 4 A.C. (opcional) */
  ciiu?: string;
  /** Ciudad / municipio de operacion */
  city?: string;
  /** Departamento */
  department?: string;
  /** Inversion estimada inicial (COP) */
  estimatedInvestment?: number;
  /** Horizonte de evaluacion en anos (default: 5) */
  evaluationHorizon?: number;
  /** Tipo de empresa: micro, pequena, mediana, grande */
  companySize?: 'micro' | 'pequena' | 'mediana' | 'grande';
  /** Nombre del emprendedor o empresa */
  promoterName?: string;
  /** NIT (si la empresa ya existe) */
  nit?: string;
  /** Zona ZOMAC (si aplica) */
  isZomac?: boolean;
  /** Zona Franca (si aplica) */
  isZonaFranca?: boolean;
  /** Economia Naranja (si aplica) */
  isEconomiaNaranja?: boolean;
}

export interface FeasibilityStudyRequest {
  /** Descripcion del proyecto y datos de contexto */
  projectData: string;
  /** Metadata del proyecto */
  project: ProjectInfo;
  /** Idioma del estudio */
  language: 'es' | 'en';
  /** Instrucciones adicionales del usuario */
  instructions?: string;
}

// ---------------------------------------------------------------------------
// Stage 1: Market Analyst Output
// ---------------------------------------------------------------------------

export interface MarketAnalysisResult {
  /** Tamano y dinamica del mercado */
  marketSize: string;
  /** Analisis de segmento objetivo */
  targetSegment: string;
  /** Panorama competitivo */
  competitiveLandscape: string;
  /** Proyecciones de demanda */
  demandProjections: string;
  /** Barreras de entrada y requisitos regulatorios */
  entryBarriers: string;
  /** Raw content as a single Markdown block for downstream agents */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Stage 2: Financial Modeler Output
// ---------------------------------------------------------------------------

export interface FinancialModelResult {
  /** Estados financieros pro-forma */
  proFormaStatements: string;
  /** Estructura de capital y WACC */
  capitalStructure: string;
  /** Evaluacion de proyecto (VPN, TIR, TIRM, Payback, IP) */
  projectEvaluation: string;
  /** Analisis de sensibilidad y escenarios */
  sensitivityAnalysis: string;
  /** Punto de equilibrio */
  breakEvenAnalysis: string;
  /** Raw content as a single Markdown block */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Stage 3: Risk Assessor Output
// ---------------------------------------------------------------------------

export interface RiskAssessmentResult {
  /** Matriz de riesgos (probabilidad x impacto) */
  riskMatrix: string;
  /** VPN ajustado por riesgo */
  riskAdjustedNpv: string;
  /** Estrategias de mitigacion */
  mitigationStrategies: string;
  /** Recomendaciones de seguros y coberturas */
  insuranceRecommendations: string;
  /** Recomendacion go/no-go */
  goNoGoRecommendation: string;
  /** Resumen ejecutivo */
  executiveSummary: string;
  /** Raw content as a single Markdown block */
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Consolidated Output
// ---------------------------------------------------------------------------

export interface FeasibilityReport {
  /** Project info echo */
  project: ProjectInfo;
  /** Stage 1 output */
  marketAnalysis: MarketAnalysisResult;
  /** Stage 2 output */
  financialModel: FinancialModelResult;
  /** Stage 3 output */
  riskAssessment: RiskAssessmentResult;
  /** Final consolidated Markdown report */
  consolidatedReport: string;
  /** Timestamp */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// SSE Progress Events
// ---------------------------------------------------------------------------

export type FeasibilityProgressEvent =
  | { type: 'stage_start'; stage: 1 | 2 | 3 | 4; label: string }
  | { type: 'stage_progress'; stage: 1 | 2 | 3 | 4; detail: string }
  | { type: 'stage_complete'; stage: 1 | 2 | 3 | 4; label: string }
  | { type: 'error'; message: string }
  | { type: 'done' };
