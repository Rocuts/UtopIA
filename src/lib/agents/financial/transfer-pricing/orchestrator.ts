// ---------------------------------------------------------------------------
// Transfer Pricing Orchestrator — sequential pipeline coordinator
// ---------------------------------------------------------------------------
// Pipeline: Raw Data -> Agent 1 (TP Analyst) -> Agent 2 (Comparable Analysis) -> Agent 3 (Documentation Writer) -> Consolidation
// ---------------------------------------------------------------------------

import { runTPAnalyst } from './agents/tp-analyst';
import { runComparableAnalyst } from './agents/comparable-analyst';
import { runTPDocumentationWriter } from './agents/tp-documentation-writer';
import type {
  TransferPricingRequest,
  TransferPricingReport,
  TPProgressEvent,
} from './types';

export interface OrchestrateTPOptions {
  onProgress?: (event: TPProgressEvent) => void;
}

/**
 * Execute the full transfer pricing analysis pipeline.
 *
 * Sequential flow with SSE progress events:
 * 1. TP Analyst processes raw data -> obligation, FAR, method selection
 * 2. Comparable Analyst runs benchmarking -> comparables, interquartile range
 * 3. Documentation Writer produces DIAN-ready docs -> Local File, Master File, Formato 1125
 * 4. Orchestrator consolidates everything into one master report
 */
export async function orchestrateTransferPricing(
  request: TransferPricingRequest,
  options: OrchestrateTPOptions = {},
): Promise<TransferPricingReport> {
  const { rawData, company, language, instructions } = request;
  const { onProgress } = options;

  // Build enhanced data with related parties and transactions if provided
  let enhancedData = rawData;
  if (request.relatedParties && request.relatedParties.length > 0) {
    enhancedData += '\n\nVINCULADOS ECONOMICOS IDENTIFICADOS:\n';
    for (const party of request.relatedParties) {
      enhancedData += `- ${party.name} (Tax ID: ${party.taxId}, Jurisdiccion: ${party.jurisdiction}`;
      if (party.relationshipType) enhancedData += `, Vinculacion: ${party.relationshipType}`;
      if (party.isTaxHaven) enhancedData += ', PARAISO FISCAL';
      enhancedData += ')\n';
    }
  }
  if (request.controlledTransactions && request.controlledTransactions.length > 0) {
    enhancedData += '\n\nTRANSACCIONES CONTROLADAS:\n';
    const fmt = (n: number) =>
      (n < 0 ? '-' : '') +
      '$' +
      Math.abs(n).toLocaleString('es-CO', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
    for (const tx of request.controlledTransactions) {
      enhancedData += `- ${tx.description} | Tipo: ${tx.type} | Monto: ${fmt(tx.amount)} COP | Contraparte: ${tx.relatedParty} | Direccion: ${tx.direction}\n`;
    }
  }

  // ---------------------------------------------------------------------------
  // Stage 1: TP Analyst
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 1,
    label: 'Analista de Precios de Transferencia — Evaluando obligatoriedad y analisis funcional',
  });

  const tpResult = await runTPAnalyst(enhancedData, company, language, instructions, onProgress);

  onProgress?.({
    type: 'stage_complete',
    stage: 1,
    label: 'Analisis funcional y seleccion de metodo completados',
  });

  // ---------------------------------------------------------------------------
  // Stage 2: Comparable Analysis
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 2,
    label: 'Analista de Comparables — Benchmarking y rango intercuartil',
  });

  const comparableResult = await runComparableAnalyst(tpResult, company, language, onProgress);

  onProgress?.({
    type: 'stage_complete',
    stage: 2,
    label: 'Estudio de comparables y rango intercuartil completados',
  });

  // ---------------------------------------------------------------------------
  // Stage 3: Documentation Writer
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 3,
    label: 'Especialista en Documentacion — Redactando informe comprobatorio DIAN',
  });

  const documentationResult = await runTPDocumentationWriter(
    tpResult,
    comparableResult,
    company,
    language,
    onProgress,
  );

  onProgress?.({
    type: 'stage_complete',
    stage: 3,
    label: 'Documentacion comprobatoria y guia Formato 1125 completadas',
  });

  // ---------------------------------------------------------------------------
  // Stage 4: Consolidation
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 4,
    label: 'Consolidando reporte maestro de precios de transferencia',
  });

  const consolidatedReport = buildConsolidatedReport(
    company,
    tpResult.fullContent,
    comparableResult.fullContent,
    documentationResult.fullContent,
    language,
  );

  const report: TransferPricingReport = {
    company,
    tpAnalysis: tpResult,
    comparableAnalysis: comparableResult,
    documentation: documentationResult,
    consolidatedReport,
    generatedAt: new Date().toISOString(),
  };

  onProgress?.({
    type: 'stage_complete',
    stage: 4,
    label: 'Reporte consolidado de precios de transferencia listo',
  });

  onProgress?.({ type: 'done' });

  return report;
}

// ---------------------------------------------------------------------------
// Build the final consolidated Markdown report
// ---------------------------------------------------------------------------

function buildConsolidatedReport(
  company: TransferPricingRequest['company'],
  tpContent: string,
  comparableContent: string,
  documentationContent: string,
  language: 'es' | 'en',
): string {
  const title =
    language === 'en'
      ? 'TRANSFER PRICING STUDY — CONSOLIDATED REPORT'
      : 'ESTUDIO DE PRECIOS DE TRANSFERENCIA — REPORTE CONSOLIDADO';

  const subtitle =
    language === 'en'
      ? 'Arm\'s Length Compliance Analysis'
      : 'Analisis de Cumplimiento del Principio de Plena Competencia';

  const date = new Date().toLocaleDateString(
    language === 'es' ? 'es-CO' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  const legalBasis =
    language === 'en'
      ? 'Arts. 260-1 to 260-11 Colombian Tax Code (ET) | Decree 2120/2017 | OECD TP Guidelines 2022'
      : 'Arts. 260-1 a 260-11 ET | Decreto 2120/2017 | Guias OCDE de Precios de Transferencia 2022';

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
| **Base Normativa** | ${legalBasis} |
| **Fecha de Generacion** | ${date} |
| **Generado por** | 1+1 — Transfer Pricing Pipeline (3 Agentes Especializados) |

---

# PARTE I: ANALISIS DE PRECIOS DE TRANSFERENCIA
*Preparado por: Agente Analista de Precios de Transferencia*

${tpContent}

---

# PARTE II: ESTUDIO DE COMPARABLES Y BENCHMARKING
*Preparado por: Agente Analista de Comparables*

${comparableContent}

---

# PARTE III: DOCUMENTACION COMPROBATORIA
*Preparado por: Agente Especialista en Documentacion*

${documentationContent}

---

> **Nota Legal:** Este estudio de precios de transferencia fue generado por 1+1, un sistema de inteligencia artificial. La documentacion comprobatoria, el analisis de comparables y las conclusiones deben ser validados por un especialista en precios de transferencia certificado antes de su presentacion ante la DIAN. 1+1 no reemplaza la asesoria profesional especializada. Los comparables presentados pueden requerir validacion con bases de datos comerciales (Orbis, RoyaltyStat, Capital IQ).
`;
}
