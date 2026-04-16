// ---------------------------------------------------------------------------
// Tax Reconciliation Orchestrator — sequential pipeline coordinator
// ---------------------------------------------------------------------------
// Pipeline: Raw Data -> Agent 1 (Difference Identifier) -> Agent 2 (Deferred Tax Calculator) -> Consolidation
// ---------------------------------------------------------------------------

import { runDifferenceIdentifier } from './agents/difference-identifier';
import { runDeferredTaxCalculator } from './agents/deferred-tax-calculator';
import type {
  TaxReconciliationRequest,
  TaxReconciliationReport,
  TaxReconciliationProgressEvent,
} from './types';

export interface OrchestrateTaxReconciliationOptions {
  onProgress?: (event: TaxReconciliationProgressEvent) => void;
}

/**
 * Execute the full tax reconciliation (conciliacion fiscal) pipeline.
 *
 * Sequential flow with SSE progress events:
 * 1. Difference Identifier processes raw data → NIIF-fiscal differences by category
 * 2. Deferred Tax Calculator uses differences → DTA/DTL, effective rate, Formato 2516, journal entries
 * 3. Orchestrator consolidates everything into one master report
 */
export async function orchestrateTaxReconciliation(
  request: TaxReconciliationRequest,
  options: OrchestrateTaxReconciliationOptions = {},
): Promise<TaxReconciliationReport> {
  const { rawData, company, language, instructions } = request;
  const { onProgress } = options;

  // ---------------------------------------------------------------------------
  // Stage 1: Difference Identifier
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 1,
    label: 'Identificador de Diferencias — Analizando bases contables NIIF vs fiscales ET',
  });

  const differenceResult = await runDifferenceIdentifier(
    rawData,
    company,
    language,
    instructions,
    onProgress,
  );

  onProgress?.({
    type: 'stage_complete',
    stage: 1,
    label: 'Diferencias NIIF-fiscal identificadas y clasificadas',
  });

  // ---------------------------------------------------------------------------
  // Stage 2: Deferred Tax Calculator
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 2,
    label: 'Calculador de Impuesto Diferido — Aplicando NIC 12 y conciliando tasa efectiva',
  });

  const deferredTaxResult = await runDeferredTaxCalculator(
    differenceResult,
    company,
    language,
    onProgress,
  );

  onProgress?.({
    type: 'stage_complete',
    stage: 2,
    label: 'Impuesto diferido calculado y mapeo Formato 2516 completado',
  });

  // ---------------------------------------------------------------------------
  // Stage 3: Consolidation
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 3,
    label: 'Consolidando reporte de conciliacion fiscal',
  });

  const consolidatedReport = buildConsolidatedReport(
    company,
    differenceResult.fullContent,
    deferredTaxResult.fullContent,
    language,
  );

  const report: TaxReconciliationReport = {
    company,
    differenceAnalysis: differenceResult,
    deferredTaxCalculation: deferredTaxResult,
    consolidatedReport,
    generatedAt: new Date().toISOString(),
  };

  onProgress?.({
    type: 'stage_complete',
    stage: 3,
    label: 'Reporte de conciliacion fiscal consolidado listo',
  });

  onProgress?.({ type: 'done', report });

  return report;
}

// ---------------------------------------------------------------------------
// Build the final consolidated Markdown report
// ---------------------------------------------------------------------------

function buildConsolidatedReport(
  company: TaxReconciliationRequest['company'],
  differenceContent: string,
  deferredTaxContent: string,
  language: 'es' | 'en',
): string {
  const title =
    language === 'en'
      ? 'TAX RECONCILIATION REPORT (CONCILIACION FISCAL)'
      : 'REPORTE DE CONCILIACION FISCAL';

  const subtitle =
    language === 'en'
      ? 'NIIF-to-Fiscal Reconciliation — Art. 772-1 ET / Formato 2516 DIAN'
      : 'Conciliacion NIIF-Fiscal — Art. 772-1 ET / Formato 2516 DIAN';

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
| **Generado por** | UtopIA — Tax Reconciliation Pipeline (2 Agentes Especializados) |
| **Marco Legal** | Art. 772-1 ET, Decreto 2235/2017, Formato 2516 DIAN |
| **Tasa Impuesto Renta** | 35% (Art. 240 ET 2026) |
| **UVT 2026** | $52.374 COP |

---

# PARTE I: IDENTIFICACION DE DIFERENCIAS NIIF-FISCAL
*Preparado por: Agente Identificador de Diferencias NIIF-Fiscal*

${differenceContent}

---

# PARTE II: CALCULO DE IMPUESTO DIFERIDO (NIC 12)
*Preparado por: Agente Calculador de Impuesto Diferido*

${deferredTaxContent}

---

> **Nota Legal:** Este reporte de conciliacion fiscal fue generado por UtopIA, un sistema de inteligencia artificial. Las diferencias identificadas, calculos de impuesto diferido, y asientos contables deben ser validados por un Contador Publico certificado y un asesor tributario antes de su inclusion en el Formato 2516 DIAN o cualquier declaracion tributaria. UtopIA no reemplaza la asesoria profesional. La transmision electronica del Formato 2516 es obligatoria para contribuyentes con ingresos brutos fiscales >= 45.000 UVT (~$2.356.830.000 COP 2026).
`;
}
