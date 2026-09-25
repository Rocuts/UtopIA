// ---------------------------------------------------------------------------
// Types for the 1+1 Feasibility Study (Estudio de Factibilidad) pipeline
// ---------------------------------------------------------------------------
// Pipeline: Project Data -> Agent 1 (Market) -> Agent 2 (Financial) -> Agent 3 (Risk) -> Consolidation
// ---------------------------------------------------------------------------

import type { MacroSnapshot } from '../valuation/macro-context';
import type { ValidationDiscrepancy } from '../valuation/validators/wacc';
import type { BreakEvenResult, ProjectMetrics } from './calc/project-metrics';

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
  /**
   * Año calendario de inicio de operaciones (año gravable del año 1). Ausente →
   * el prompt asume el año siguiente a la evaluación y lo rotula como supuesto.
   */
  startYear?: number;
  /**
   * Tamaño: micro, pequena, mediana, grande. Para ZOMAC se interpreta según el
   * Art. 236 Ley 1819/2016 (activos); en general, Decreto 957/2019 (ingresos).
   */
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
  /** Parámetros macro con fecha de vigencia y fuente por campo (valoracion-18) */
  macro?: MacroSnapshot | null;
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
  /** Tasa de descuento efectivamente usada y su origen */
  discountRate: {
    percent: number | null;
    source: 'wacc_recalculado' | 'tasa_usuario' | 'no_disponible';
  };
  /** VPN/TIR/TIRM/payback/IR calculados en código; null si no es posible */
  metrics: ProjectMetrics | null;
  /** Motivos por los que las métricas quedaron N/D */
  metricsUnavailableReasons: string[];
  /** Punto de equilibrio calculado en código */
  breakEven: BreakEvenResult;
  /** Flujos estructurados del Modelador (para recalcular el VPN ajustado) */
  cashFlows: Array<{ year: number; freeCashFlowCop: string }>;
  initialInvestmentCop: string;
  /** Diferencias entre lo emitido por el LLM y lo recalculado */
  discrepancies: ValidationDiscrepancy[];
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
  /** Decisión final tras las reglas deterministas */
  decision: 'go' | 'go_con_condiciones' | 'no_go' | 'no_determinable';
  /** Ajustes que el código aplicó a la decisión del LLM */
  decisionOverrides: string[];
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
