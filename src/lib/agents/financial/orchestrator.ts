// ---------------------------------------------------------------------------
// Financial Orchestrator — sequential pipeline coordinator
// ---------------------------------------------------------------------------
// Pipeline: Raw Data -> Agent 1 (NIIF) -> Agent 2 (Strategy) -> Agent 3 (Governance) -> Consolidation
// ---------------------------------------------------------------------------

import { runNiifAnalyst } from './agents/niif-analyst';
import { runStrategyDirector } from './agents/strategy-director';
import { runGovernanceSpecialist } from './agents/governance-specialist';
import type {
  FinancialReportRequest,
  FinancialReport,
  FinancialProgressEvent,
} from './types';

export interface OrchestrateFinancialOptions {
  onProgress?: (event: FinancialProgressEvent) => void;
}

/**
 * Execute the full financial reporting pipeline.
 *
 * Sequential flow with SSE progress events:
 * 1. NIIF Analyst processes raw data → 4 financial statements
 * 2. Strategy Director interprets statements → KPIs, projections, recommendations
 * 3. Governance Specialist produces legal docs → notes + assembly minutes
 * 4. Orchestrator consolidates everything into one master report
 */
export async function orchestrateFinancialReport(
  request: FinancialReportRequest,
  options: OrchestrateFinancialOptions = {},
): Promise<FinancialReport> {
  const { rawData, company, language, instructions } = request;
  const { onProgress } = options;

  // ---------------------------------------------------------------------------
  // Stage 1: NIIF Analyst
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 1,
    label: 'Analista Contable NIIF — Procesando datos y construyendo estados financieros',
  });

  const niifResult = await runNiifAnalyst(rawData, company, language, instructions, onProgress);

  onProgress?.({
    type: 'stage_complete',
    stage: 1,
    label: 'Estados financieros NIIF generados',
  });

  // ---------------------------------------------------------------------------
  // Stage 2: Strategy Director
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 2,
    label: 'Director de Estrategia — Analizando KPIs y proyecciones',
  });

  const strategyResult = await runStrategyDirector(niifResult, company, language, onProgress);

  onProgress?.({
    type: 'stage_complete',
    stage: 2,
    label: 'Dashboard ejecutivo y proyecciones completados',
  });

  // ---------------------------------------------------------------------------
  // Stage 3: Governance Specialist
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 3,
    label: 'Especialista en Gobierno Corporativo — Redactando documentos legales',
  });

  const governanceResult = await runGovernanceSpecialist(
    niifResult,
    strategyResult,
    company,
    language,
    onProgress,
  );

  onProgress?.({
    type: 'stage_complete',
    stage: 3,
    label: 'Notas contables y acta de asamblea redactadas',
  });

  // ---------------------------------------------------------------------------
  // Stage 4: Consolidation
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 4,
    label: 'Consolidando reporte maestro',
  });

  const consolidatedReport = buildConsolidatedReport(
    company,
    niifResult.fullContent,
    strategyResult.fullContent,
    governanceResult.fullContent,
    language,
  );

  const report: FinancialReport = {
    company,
    niifAnalysis: niifResult,
    strategicAnalysis: strategyResult,
    governance: governanceResult,
    consolidatedReport,
    generatedAt: new Date().toISOString(),
  };

  onProgress?.({
    type: 'stage_complete',
    stage: 4,
    label: 'Reporte consolidado listo',
  });

  onProgress?.({ type: 'done', report });

  return report;
}

// ---------------------------------------------------------------------------
// Build the final consolidated Markdown report
// ---------------------------------------------------------------------------

function buildConsolidatedReport(
  company: FinancialReportRequest['company'],
  niifContent: string,
  strategyContent: string,
  governanceContent: string,
  language: 'es' | 'en',
): string {
  const title =
    language === 'en'
      ? 'CONSOLIDATED FINANCIAL REPORT'
      : 'REPORTE FINANCIERO CONSOLIDADO';

  const subtitle =
    language === 'en'
      ? 'NIIF Elite Corporate Analysis'
      : 'Analisis Corporativo Elite NIIF';

  const date = new Date().toLocaleDateString(
    language === 'es' ? 'es-CO' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  return `# ${title}
## ${subtitle}

---

| Campo | Detalle |
|-------|---------|
| **Empresa** | ${company.name} |
| **NIT** | ${company.nit} |
| **Tipo Societario** | ${company.entityType || 'N/A'} |
| **Periodo Fiscal** | ${company.fiscalPeriod} |
| **Fecha de Generacion** | ${date} |
| **Generado por** | UtopIA — Financial Orchestrator (3 Agentes Especializados) |

---

# PARTE I: ESTADOS FINANCIEROS NIIF
*Preparado por: Agente Analista Contable NIIF*

${niifContent}

---

# PARTE II: ANALISIS ESTRATEGICO Y PROYECCIONES
*Preparado por: Agente Director de Estrategia Financiera*

${strategyContent}

---

# PARTE III: GOBIERNO CORPORATIVO Y DOCUMENTOS LEGALES
*Preparado por: Agente Especialista en Gobierno Corporativo*

${governanceContent}

---

> **Nota Legal:** Este reporte fue generado por UtopIA, un sistema de inteligencia artificial. Las cifras, analisis y documentos legales deben ser validados por un Contador Publico certificado y un abogado antes de su uso oficial. UtopIA no reemplaza la asesoria profesional.
`;
}
