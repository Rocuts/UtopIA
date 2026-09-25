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
import { formato2516Threshold, type Formato2516Threshold } from './lib/deterministic';
import { formatCopFromCents } from '../contracts/money';

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
  // Umbral del Formato 2516 con la UVT del año gravable objeto de conciliación
  // (DUR 1625/2016 art. 1.7.2). Año sin UVT registrada ⇒ error explícito antes
  // de gastar llamadas al LLM.
  const umbral2516 = formato2516Threshold(company.fiscalPeriod);

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
    umbral2516,
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

  onProgress?.({ type: 'done' });

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
  umbral2516: Formato2516Threshold,
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
| **Generado por** | 1+1 — Tax Reconciliation Pipeline (2 Agentes Especializados) |
| **Marco Legal** | Art. 772-1 ET, Decreto 1998/2017 (DUR 1625/2016 arts. 1.7.1 y ss.), Formato 2516 DIAN |
| **Tarifas del diferido** | 35% renta ordinaria (Art. 240 ET); 15% ganancia ocasional (Art. 313 ET) según forma de recuperación |
| **UVT ${umbral2516.year}** | $${umbral2516.uvtCop.toLocaleString('es-CO')} COP |

---

# PARTE I: IDENTIFICACION DE DIFERENCIAS NIIF-FISCAL
*Preparado por: Agente Identificador de Diferencias NIIF-Fiscal*

${differenceContent}

---

# PARTE II: CALCULO DE IMPUESTO DIFERIDO (NIC 12)
*Preparado por: Agente Calculador de Impuesto Diferido*

${deferredTaxContent}

---

> **Nota Legal:** Este reporte de conciliacion fiscal fue generado por 1+1, un sistema de inteligencia artificial. Las diferencias identificadas, calculos de impuesto diferido, y asientos contables deben ser validados por un Contador Publico certificado y un asesor tributario antes de su inclusion en el Formato 2516 DIAN o cualquier declaracion tributaria. 1+1 no reemplaza la asesoria profesional. La transmision electronica del Formato 2516 es obligatoria para contribuyentes con ingresos brutos fiscales del año gravable ${umbral2516.year} >= 45.000 UVT (${formatCopFromCents(BigInt(umbral2516.thresholdCents), true)}; DUR 1625/2016 art. 1.7.2).
`;
}
