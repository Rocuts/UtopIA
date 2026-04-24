// ---------------------------------------------------------------------------
// Business Valuation Orchestrator — hybrid parallel + sequential pipeline
// ---------------------------------------------------------------------------
// Pipeline:
//   [DCF Modeler] ──┐
//                   ├──→ [Valuation Synthesizer]
//   [Comparables] ──┘
//
// DCF and Comparables run in PARALLEL (Promise.allSettled).
// Synthesizer runs AFTER both complete, receiving their outputs.
// ---------------------------------------------------------------------------

import { runDcfModeler } from './agents/dcf-modeler';
import { runMarketComparables } from './agents/market-comparables';
import { runValuationSynthesizer } from './agents/valuation-synthesizer';
import type {
  ValuationRequest,
  ValuationReport,
  DcfModelResult,
  MarketComparablesResult,
  ValuationProgressEvent,
} from './types';

export interface ValuationOrchestrateOptions {
  onProgress?: (event: ValuationProgressEvent) => void;
}

/**
 * Execute the full business valuation pipeline.
 *
 * Hybrid flow:
 * 1. DCF Modeler + Market Comparables run in PARALLEL
 * 2. Valuation Synthesizer merges both outputs into a consolidated opinion
 * 3. Orchestrator builds the final consolidated report
 */
export async function orchestrateValuation(
  request: ValuationRequest,
  options: ValuationOrchestrateOptions = {},
): Promise<ValuationReport> {
  const { financialData, company, language, instructions, purpose } = request;
  const { onProgress } = options;

  const agentNames = [
    'Modelador DCF (Flujo de Caja Descontado)',
    'Experto en Multiplos de Mercado',
    'Sintetizador de Valoracion',
  ];

  onProgress?.({ type: 'valuation_start', agents: agentNames });

  // ---------------------------------------------------------------------------
  // Stage 1: Launch DCF and Comparables in PARALLEL
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'agent_start',
    agent: 'dcf',
    name: 'Modelador DCF (Flujo de Caja Descontado)',
  });
  onProgress?.({
    type: 'agent_start',
    agent: 'comparables',
    name: 'Experto en Multiplos de Mercado',
  });

  const [dcfSettled, comparablesSettled] = await Promise.allSettled([
    runDcfModeler(financialData, company, language, purpose, instructions, onProgress),
    runMarketComparables(financialData, company, language, purpose, instructions, onProgress),
  ]);

  // ---------------------------------------------------------------------------
  // Handle DCF result
  // ---------------------------------------------------------------------------
  let dcfResult: DcfModelResult;
  if (dcfSettled.status === 'fulfilled') {
    dcfResult = dcfSettled.value;
    onProgress?.({
      type: 'agent_complete',
      agent: 'dcf',
      name: 'Modelador DCF (Flujo de Caja Descontado)',
    });
  } else {
    const errorMsg = dcfSettled.reason instanceof Error
      ? dcfSettled.reason.message
      : 'Error desconocido';
    console.error('[valuation] DCF Modeler failed:', errorMsg);
    onProgress?.({
      type: 'agent_failed',
      agent: 'dcf',
      name: 'Modelador DCF',
      error: errorMsg,
    });
    // Provide empty fallback so synthesizer can still work with comparables
    dcfResult = {
      cashFlowProjections: '',
      waccCalculation: '',
      terminalValue: '',
      valuationSummary: '',
      sensitivityAnalysis: '',
      fullContent: `[ERROR: El Modelador DCF no pudo completar el analisis. Error: ${errorMsg}]`,
    };
  }

  // ---------------------------------------------------------------------------
  // Handle Comparables result
  // ---------------------------------------------------------------------------
  let comparablesResult: MarketComparablesResult;
  if (comparablesSettled.status === 'fulfilled') {
    comparablesResult = comparablesSettled.value;
    onProgress?.({
      type: 'agent_complete',
      agent: 'comparables',
      name: 'Experto en Multiplos de Mercado',
    });
  } else {
    const errorMsg = comparablesSettled.reason instanceof Error
      ? comparablesSettled.reason.message
      : 'Error desconocido';
    console.error('[valuation] Market Comparables failed:', errorMsg);
    onProgress?.({
      type: 'agent_failed',
      agent: 'comparables',
      name: 'Experto en Multiplos de Mercado',
      error: errorMsg,
    });
    // Provide empty fallback
    comparablesResult = {
      comparableSelection: '',
      multiplesAnalysis: '',
      impliedValuation: '',
      colombianAdjustments: '',
      fullContent: `[ERROR: El Experto en Multiplos no pudo completar el analisis. Error: ${errorMsg}]`,
    };
  }

  // ---------------------------------------------------------------------------
  // Stage 2: Valuation Synthesizer (sequential — needs both outputs)
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'agent_start',
    agent: 'synthesizer',
    name: 'Sintetizador de Valoracion',
  });
  onProgress?.({ type: 'synthesizing' });

  const synthesisResult = await runValuationSynthesizer(
    dcfResult.fullContent,
    comparablesResult.fullContent,
    company,
    language,
    purpose,
    onProgress,
  );

  onProgress?.({
    type: 'agent_complete',
    agent: 'synthesizer',
    name: 'Sintetizador de Valoracion',
  });

  // ---------------------------------------------------------------------------
  // Stage 3: Build consolidated report
  // ---------------------------------------------------------------------------
  const consolidatedReport = buildConsolidatedValuationReport(
    company,
    dcfResult.fullContent,
    comparablesResult.fullContent,
    synthesisResult.fullContent,
    purpose || 'General',
    language,
  );

  const report: ValuationReport = {
    company,
    dcfModel: dcfResult,
    marketComparables: comparablesResult,
    synthesis: synthesisResult,
    consolidatedReport,
    purpose: purpose || 'General',
    generatedAt: new Date().toISOString(),
  };

  onProgress?.({ type: 'done' });

  return report;
}

// ---------------------------------------------------------------------------
// Build the final consolidated Markdown report
// ---------------------------------------------------------------------------

function buildConsolidatedValuationReport(
  company: ValuationRequest['company'],
  dcfContent: string,
  comparablesContent: string,
  synthesisContent: string,
  purpose: string,
  language: 'es' | 'en',
): string {
  const title =
    language === 'en'
      ? 'BUSINESS VALUATION REPORT'
      : 'INFORME DE VALORACION EMPRESARIAL';

  const subtitle =
    language === 'en'
      ? 'Multi-Methodology Corporate Valuation'
      : 'Valoracion Corporativa Multi-Metodologia';

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
| **Periodo Base** | ${company.fiscalPeriod} |
| **Proposito** | ${purpose} |
| **Fecha de Valoracion** | ${date} |
| **Sistema** | 1+1 — Valuation Pipeline (3 Agentes: DCF + Multiplos en Paralelo → Sintetizador) |

---

# PARTE I: VALORACION POR FLUJO DE CAJA DESCONTADO (DCF)
*Preparado por: Agente Modelador DCF*

${dcfContent}

---

# PARTE II: VALORACION POR MULTIPLOS DE MERCADO
*Preparado por: Agente Experto en Multiplos de Mercado*

${comparablesContent}

---

# PARTE III: SINTESIS Y OPINION DE VALOR CONSOLIDADA
*Preparado por: Agente Sintetizador de Valoracion (Socio Senior)*

${synthesisContent}

---

> **Nota Legal:** Este informe de valoracion fue generado por 1+1, un sistema de inteligencia artificial. Las estimaciones de valor, supuestos y proyecciones deben ser validados por un valuador profesional certificado antes de su uso en transacciones, procesos legales o presentaciones ante la DIAN o SuperSociedades. 1+1 no reemplaza la opinion profesional de un perito valuador. La valoracion se realiza bajo el marco de NIIF 13 (Valor Razonable), Art. 90 del Estatuto Tributario, y los lineamientos de la Superintendencia de Sociedades vigentes a 2026.
`;
}
