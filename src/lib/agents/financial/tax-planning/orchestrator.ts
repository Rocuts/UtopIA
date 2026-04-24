// ---------------------------------------------------------------------------
// Tax Planning Orchestrator — sequential pipeline coordinator
// ---------------------------------------------------------------------------
// Pipeline: Company Data -> Agent 1 (Tax Optimizer) -> Agent 2 (NIIF Impact)
//           -> Agent 3 (Compliance Validator) -> Consolidation
// ---------------------------------------------------------------------------

import { runTaxOptimizer } from './agents/tax-optimizer';
import { runNiifImpactAnalyst } from './agents/niif-impact-analyst';
import { runComplianceValidator } from './agents/compliance-validator';
import type {
  TaxPlanningRequest,
  TaxPlanningReport,
  TaxPlanningProgressEvent,
} from './types';

export interface OrchestrateTaxPlanningOptions {
  onProgress?: (event: TaxPlanningProgressEvent) => void;
}

/**
 * Execute the full tax planning pipeline.
 *
 * Sequential flow with SSE progress events:
 * 1. Tax Optimizer analyzes current structure → strategies + projected savings
 * 2. NIIF Impact Analyst evaluates accounting effects → deferred tax, disclosures
 * 3. Compliance Validator checks regulatory risk → checklists, red flags
 * 4. Orchestrator consolidates everything into one master report
 */
export async function orchestrateTaxPlanning(
  request: TaxPlanningRequest,
  options: OrchestrateTaxPlanningOptions = {},
): Promise<TaxPlanningReport> {
  const { rawData, company, language, instructions } = request;
  const { onProgress } = options;

  // ---------------------------------------------------------------------------
  // Stage 1: Tax Optimizer
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 1,
    label: 'Optimizador Tributario — Analizando estructura fiscal y evaluando estrategias',
  });

  const taxOptimizerResult = await runTaxOptimizer(
    rawData,
    company,
    language,
    instructions,
    onProgress,
  );

  onProgress?.({
    type: 'stage_complete',
    stage: 1,
    label: 'Estrategias de optimizacion tributaria generadas',
  });

  // ---------------------------------------------------------------------------
  // Stage 2: NIIF Impact Analyst
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 2,
    label: 'Analista de Impacto NIIF — Evaluando efectos contables de cada estrategia',
  });

  const niifImpactResult = await runNiifImpactAnalyst(
    taxOptimizerResult,
    company,
    language,
    onProgress,
  );

  onProgress?.({
    type: 'stage_complete',
    stage: 2,
    label: 'Analisis de impacto NIIF completado',
  });

  // ---------------------------------------------------------------------------
  // Stage 3: Compliance Validator
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 3,
    label: 'Validador de Cumplimiento — Verificando riesgos regulatorios y anti-abuso',
  });

  const complianceResult = await runComplianceValidator(
    taxOptimizerResult,
    niifImpactResult,
    company,
    language,
    onProgress,
  );

  onProgress?.({
    type: 'stage_complete',
    stage: 3,
    label: 'Validacion de cumplimiento regulatorio completada',
  });

  // ---------------------------------------------------------------------------
  // Stage 4: Consolidation
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 4,
    label: 'Consolidando reporte de planeacion tributaria',
  });

  const consolidatedReport = buildConsolidatedReport(
    company,
    taxOptimizerResult.fullContent,
    niifImpactResult.fullContent,
    complianceResult.fullContent,
    language,
  );

  const report: TaxPlanningReport = {
    company,
    taxOptimization: taxOptimizerResult,
    niifImpact: niifImpactResult,
    complianceValidation: complianceResult,
    consolidatedReport,
    generatedAt: new Date().toISOString(),
  };

  onProgress?.({
    type: 'stage_complete',
    stage: 4,
    label: 'Reporte de planeacion tributaria consolidado listo',
  });

  onProgress?.({ type: 'done' });

  return report;
}

// ---------------------------------------------------------------------------
// Build the final consolidated Markdown report
// ---------------------------------------------------------------------------

function buildConsolidatedReport(
  company: TaxPlanningRequest['company'],
  taxOptimizerContent: string,
  niifImpactContent: string,
  complianceContent: string,
  language: 'es' | 'en',
): string {
  const title =
    language === 'en'
      ? 'TAX PLANNING REPORT'
      : 'REPORTE DE PLANEACION TRIBUTARIA';

  const subtitle =
    language === 'en'
      ? 'Comprehensive Tax Optimization Analysis'
      : 'Analisis Integral de Optimizacion Tributaria';

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
| **Sector** | ${company.sector || 'N/A'} |
| **Periodo Fiscal** | ${company.fiscalPeriod} |
| **Fecha de Generacion** | ${date} |
| **Generado por** | 1+1 — Tax Planning Pipeline (3 Agentes Especializados) |

---

# PARTE I: DIAGNOSTICO Y ESTRATEGIAS DE OPTIMIZACION TRIBUTARIA
*Preparado por: Agente Optimizador Tributario*

${taxOptimizerContent}

---

# PARTE II: ANALISIS DE IMPACTO NIIF
*Preparado por: Agente Analista de Impacto NIIF*

${niifImpactContent}

---

# PARTE III: VALIDACION DE CUMPLIMIENTO REGULATORIO
*Preparado por: Agente Validador de Cumplimiento*

${complianceContent}

---

> **Nota Legal:** Este reporte fue generado por 1+1, un sistema de inteligencia artificial. Las estrategias de planeacion tributaria propuestas deben ser validadas por un abogado tributarista y un contador publico certificado antes de su implementacion. 1+1 no reemplaza la asesoria profesional. La planeacion tributaria (elusion legal) es un derecho del contribuyente; sin embargo, la evasion fiscal es un delito. Toda estrategia debe cumplir con la clausula anti-abuso del Art. 869 del Estatuto Tributario.
`;
}
