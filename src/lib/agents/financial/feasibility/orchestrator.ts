// ---------------------------------------------------------------------------
// Feasibility Study Orchestrator — sequential pipeline coordinator
// ---------------------------------------------------------------------------
// Pipeline: Project Data -> Agent 1 (Market) -> Agent 2 (Financial) -> Agent 3 (Risk) -> Consolidation
// ---------------------------------------------------------------------------

import { runMarketAnalyst } from './agents/market-analyst';
import { runFinancialModeler } from './agents/financial-modeler';
import { runRiskAssessor } from './agents/risk-assessor';
import type {
  FeasibilityStudyRequest,
  FeasibilityReport,
  FeasibilityProgressEvent,
  ProjectInfo,
} from './types';

export interface OrchestrateFeasibilityOptions {
  onProgress?: (event: FeasibilityProgressEvent) => void;
}

/**
 * Execute the full feasibility study pipeline.
 *
 * Sequential flow with SSE progress events:
 * 1. Market Analyst evaluates market viability → TAM/SAM/SOM, competition, demand
 * 2. Financial Modeler builds projections → pro-forma, WACC, NPV, IRR, sensitivity
 * 3. Risk Assessor evaluates risks → risk matrix, adjusted NPV, go/no-go
 * 4. Orchestrator consolidates everything into one master study
 */
export async function orchestrateFeasibilityStudy(
  request: FeasibilityStudyRequest,
  options: OrchestrateFeasibilityOptions = {},
): Promise<FeasibilityReport> {
  const { projectData, project, language, instructions } = request;
  const { onProgress } = options;

  // ---------------------------------------------------------------------------
  // Stage 1: Market Analyst
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 1,
    label: 'Analista de Mercado — Evaluando viabilidad comercial y entorno competitivo',
  });

  const marketResult = await runMarketAnalyst(projectData, project, language, instructions, onProgress);

  onProgress?.({
    type: 'stage_complete',
    stage: 1,
    label: 'Analisis de mercado completado',
  });

  // ---------------------------------------------------------------------------
  // Stage 2: Financial Modeler
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 2,
    label: 'Modelador Financiero — Construyendo proyecciones y evaluacion de proyecto',
  });

  const financialResult = await runFinancialModeler(marketResult, project, language, onProgress);

  onProgress?.({
    type: 'stage_complete',
    stage: 2,
    label: 'Modelo financiero y evaluacion de proyecto completados',
  });

  // ---------------------------------------------------------------------------
  // Stage 3: Risk Assessor
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 3,
    label: 'Evaluador de Riesgos — Analizando riesgos y recomendacion go/no-go',
  });

  const riskResult = await runRiskAssessor(
    marketResult,
    financialResult,
    project,
    language,
    onProgress,
  );

  onProgress?.({
    type: 'stage_complete',
    stage: 3,
    label: 'Evaluacion de riesgos y recomendacion completadas',
  });

  // ---------------------------------------------------------------------------
  // Stage 4: Consolidation
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 4,
    label: 'Consolidando estudio de factibilidad',
  });

  const consolidatedReport = buildConsolidatedReport(
    project,
    marketResult.fullContent,
    financialResult.fullContent,
    riskResult.fullContent,
    language,
  );

  const report: FeasibilityReport = {
    project,
    marketAnalysis: marketResult,
    financialModel: financialResult,
    riskAssessment: riskResult,
    consolidatedReport,
    generatedAt: new Date().toISOString(),
  };

  onProgress?.({
    type: 'stage_complete',
    stage: 4,
    label: 'Estudio de factibilidad consolidado listo',
  });

  onProgress?.({ type: 'done', report });

  return report;
}

// ---------------------------------------------------------------------------
// Build the final consolidated Markdown report
// ---------------------------------------------------------------------------

function buildConsolidatedReport(
  project: ProjectInfo,
  marketContent: string,
  financialContent: string,
  riskContent: string,
  language: 'es' | 'en',
): string {
  const title =
    language === 'en'
      ? 'FEASIBILITY STUDY'
      : 'ESTUDIO DE FACTIBILIDAD';

  const subtitle =
    language === 'en'
      ? 'Market, Financial & Risk Analysis'
      : 'Analisis de Mercado, Financiero y de Riesgos';

  const date = new Date().toLocaleDateString(
    language === 'es' ? 'es-CO' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  const investmentStr = project.estimatedInvestment
    ? `$${project.estimatedInvestment.toLocaleString('es-CO')} COP`
    : 'Por determinar';

  return `# ${title}
## ${subtitle}

---

| Campo | Detalle |
|-------|---------|
| **Proyecto** | ${project.projectName} |
| **Sector** | ${project.sector} |
${project.ciiu ? `| **CIIU Rev. 4 A.C.** | ${project.ciiu} |\n` : ''}| **Inversion Estimada** | ${investmentStr} |
| **Horizonte de Evaluacion** | ${project.evaluationHorizon || 5} anos |
${project.city ? `| **Ubicacion** | ${project.city}${project.department ? `, ${project.department}` : ''} |\n` : ''}${project.promoterName ? `| **Promotor** | ${project.promoterName} |\n` : ''}| **Fecha de Generacion** | ${date} |
| **Generado por** | UtopIA — Feasibility Study Pipeline (3 Agentes Especializados) |

---

# PARTE I: ANALISIS DE MERCADO
*Preparado por: Agente Analista Senior de Mercado*

${marketContent}

---

# PARTE II: MODELO FINANCIERO Y EVALUACION DE PROYECTO
*Preparado por: Agente Modelador Financiero Senior*

${financialContent}

---

# PARTE III: EVALUACION DE RIESGOS Y RECOMENDACION
*Preparado por: Agente Evaluador Senior de Riesgos*

${riskContent}

---

> **Descargo de Responsabilidad:** Este estudio de factibilidad fue generado por UtopIA, un sistema de inteligencia artificial, como herramienta de apoyo a la toma de decisiones. NO constituye una garantia de resultados ni reemplaza la asesoria profesional especializada. Las proyecciones financieras se basan en supuestos que deben ser validados con estudios de campo, cotizaciones reales y analisis de mercado primario. Todas las cifras, tasas y parametros deben ser verificados con fuentes oficiales vigentes (DANE, Banco de la Republica, DIAN, Superintendencias) antes de tomar decisiones de inversion. UtopIA no se hace responsable por decisiones de inversion basadas exclusivamente en este documento.
`;
}
