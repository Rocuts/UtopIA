// ---------------------------------------------------------------------------
// Business Valuation Orchestrator — hybrid parallel + sequential pipeline
// ---------------------------------------------------------------------------
// Pipeline:
//   [DCF Modeler] ──┐
//                   ├──→ [Valuation Synthesizer]
//   [Comparables] ──┘
//
// DCF and Comparables run in PARALLEL (Promise.allSettled). Cada metodología
// pasa por su validador determinista; su estado queda en 'ok' | 'blocked' |
// 'failed'.
//
// valoracion-14:
//   - Ninguna metodología válida → el Sintetizador NO se ejecuta y el informe
//     declara "sin opinión de valor (N/D)" con los motivos.
//   - Una sola válida → el Sintetizador recibe la otra como null estructurado
//     (peso 0) y el informe se rotula como de metodología única.
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
  ValuationSynthesisResult,
} from './types';

export interface ValuationOrchestrateOptions {
  onProgress?: (event: ValuationProgressEvent) => void;
}

function failedDcf(errorMsg: string): DcfModelResult {
  const reason = `El Modelador DCF no pudo completar el análisis: ${errorMsg}`;
  return {
    cashFlowProjections: '',
    waccCalculation: '',
    terminalValue: '',
    valuationSummary: '',
    sensitivityAnalysis: '',
    validationReport: '',
    fullContent: `[ERROR: ${reason}]`,
    status: 'failed',
    blockingReasons: [reason],
    computed: null,
    discrepancies: [],
  };
}

function failedComparables(errorMsg: string): MarketComparablesResult {
  const reason = `El Experto en Múltiplos no pudo completar el análisis: ${errorMsg}`;
  return {
    comparableSelection: '',
    multiplesAnalysis: '',
    impliedValuation: '',
    colombianAdjustments: '',
    validationReport: '',
    fullContent: `[ERROR: ${reason}]`,
    status: 'failed',
    blockingReasons: [reason],
    computed: null,
    discrepancies: [],
  };
}

/**
 * Execute the full business valuation pipeline.
 *
 * Hybrid flow:
 * 1. DCF Modeler + Market Comparables run in PARALLEL (validated in code)
 * 2. Valuation Synthesizer merges the VALID outputs into a consolidated opinion
 * 3. Orchestrator builds the final consolidated report
 */
export async function orchestrateValuation(
  request: ValuationRequest,
  options: ValuationOrchestrateOptions = {},
): Promise<ValuationReport> {
  const { financialData, company, language, instructions, purpose, macro } = request;
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
    runDcfModeler(financialData, company, language, purpose, instructions, onProgress, undefined, macro),
    runMarketComparables(financialData, company, language, purpose, instructions, onProgress, undefined, macro),
  ]);

  // ---------------------------------------------------------------------------
  // Handle DCF result
  // ---------------------------------------------------------------------------
  let dcfResult: DcfModelResult;
  if (dcfSettled.status === 'fulfilled') {
    dcfResult = dcfSettled.value;
    if (dcfResult.status === 'ok') {
      onProgress?.({ type: 'agent_complete', agent: 'dcf', name: 'Modelador DCF (Flujo de Caja Descontado)' });
    } else {
      onProgress?.({ type: 'agent_failed', agent: 'dcf', name: 'Modelador DCF', error: dcfResult.blockingReasons.join(' ') });
    }
  } else {
    const errorMsg = dcfSettled.reason instanceof Error
      ? dcfSettled.reason.message
      : 'Error desconocido';
    console.error('[valuation] DCF Modeler failed:', errorMsg);
    onProgress?.({ type: 'agent_failed', agent: 'dcf', name: 'Modelador DCF', error: errorMsg });
    dcfResult = failedDcf(errorMsg);
  }

  // ---------------------------------------------------------------------------
  // Handle Comparables result
  // ---------------------------------------------------------------------------
  let comparablesResult: MarketComparablesResult;
  if (comparablesSettled.status === 'fulfilled') {
    comparablesResult = comparablesSettled.value;
    if (comparablesResult.status === 'ok') {
      onProgress?.({ type: 'agent_complete', agent: 'comparables', name: 'Experto en Multiplos de Mercado' });
    } else {
      onProgress?.({
        type: 'agent_failed',
        agent: 'comparables',
        name: 'Experto en Multiplos de Mercado',
        error: comparablesResult.blockingReasons.join(' '),
      });
    }
  } else {
    const errorMsg = comparablesSettled.reason instanceof Error
      ? comparablesSettled.reason.message
      : 'Error desconocido';
    console.error('[valuation] Market Comparables failed:', errorMsg);
    onProgress?.({ type: 'agent_failed', agent: 'comparables', name: 'Experto en Multiplos de Mercado', error: errorMsg });
    comparablesResult = failedComparables(errorMsg);
  }

  const methodologies: Array<'dcf' | 'market_comparables'> = [];
  if (dcfResult.status === 'ok') methodologies.push('dcf');
  if (comparablesResult.status === 'ok') methodologies.push('market_comparables');
  const reasons = [
    ...(dcfResult.status === 'ok' ? [] : dcfResult.blockingReasons.map((r) => `DCF: ${r}`)),
    ...(comparablesResult.status === 'ok' ? [] : comparablesResult.blockingReasons.map((r) => `Múltiplos: ${r}`)),
  ];

  // ---------------------------------------------------------------------------
  // Stage 2: Valuation Synthesizer — sólo con al menos una metodología válida
  // ---------------------------------------------------------------------------
  let synthesisResult: ValuationSynthesisResult | null = null;
  if (methodologies.length === 0) {
    onProgress?.({ type: 'value_opinion_not_issued', reasons });
  } else {
    onProgress?.({ type: 'agent_start', agent: 'synthesizer', name: 'Sintetizador de Valoracion' });
    onProgress?.({ type: 'synthesizing' });

    synthesisResult = await runValuationSynthesizer(
      dcfResult,
      comparablesResult,
      company,
      language,
      purpose,
      onProgress,
    );

    if (synthesisResult.status === 'ok') {
      onProgress?.({ type: 'agent_complete', agent: 'synthesizer', name: 'Sintetizador de Valoracion' });
    } else {
      reasons.push(...synthesisResult.blockingReasons.map((r) => `Síntesis: ${r}`));
      onProgress?.({
        type: 'agent_failed',
        agent: 'synthesizer',
        name: 'Sintetizador de Valoracion',
        error: synthesisResult.blockingReasons.join(' '),
      });
      onProgress?.({ type: 'value_opinion_not_issued', reasons });
    }
  }

  const issued = synthesisResult !== null && synthesisResult.status === 'ok';
  const valueOpinion: ValuationReport['valueOpinion'] = {
    status: issued ? 'issued' : 'not_issued',
    methodologies: issued ? methodologies : [],
    reasons,
  };

  // ---------------------------------------------------------------------------
  // Stage 3: Build consolidated report
  // ---------------------------------------------------------------------------
  const consolidatedReport = buildConsolidatedValuationReport(
    company,
    dcfResult.fullContent,
    comparablesResult.fullContent,
    synthesisResult,
    valueOpinion,
    purpose || 'General',
    language,
  );

  const report: ValuationReport = {
    company,
    dcfModel: dcfResult,
    marketComparables: comparablesResult,
    synthesis: synthesisResult,
    valueOpinion,
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

function buildSubtitle(valueOpinion: ValuationReport['valueOpinion'], language: 'es' | 'en'): string {
  const en = language === 'en';
  if (valueOpinion.status === 'not_issued') {
    return en ? 'No value opinion issued (N/D)' : 'Sin opinión de valor (N/D)';
  }
  if (valueOpinion.methodologies.length === 1) {
    const m = valueOpinion.methodologies[0] === 'dcf' ? 'DCF' : (en ? 'Market Multiples' : 'Multiplos de Mercado');
    return en ? `Single-Methodology Valuation: ${m}` : `Valoracion por Metodologia Unica: ${m}`;
  }
  return en ? 'Multi-Methodology Corporate Valuation' : 'Valoracion Corporativa Multi-Metodologia';
}

function buildConsolidatedValuationReport(
  company: ValuationRequest['company'],
  dcfContent: string,
  comparablesContent: string,
  synthesis: ValuationSynthesisResult | null,
  valueOpinion: ValuationReport['valueOpinion'],
  purpose: string,
  language: 'es' | 'en',
): string {
  const en = language === 'en';
  const title = en ? 'BUSINESS VALUATION REPORT' : 'INFORME DE VALORACION EMPRESARIAL';
  const subtitle = buildSubtitle(valueOpinion, language);

  const date = new Date().toLocaleDateString(
    language === 'es' ? 'es-CO' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  const synthesisContent = valueOpinion.status === 'issued' && synthesis
    ? synthesis.fullContent
    : [
        en
          ? '**NO VALUE OPINION IS ISSUED (N/D).** No methodology produced a valid value after the deterministic validation:'
          : '**NO SE EMITE OPINIÓN DE VALOR (N/D).** Ninguna metodología produjo un valor válido tras la validación determinista:',
        ...valueOpinion.reasons.map((r) => `- ${r}`),
      ].join('\n');

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
| **Sistema** | 1+1 — Valuation Pipeline (3 Agentes: DCF + Multiplos en Paralelo → Sintetizador, con validación determinista) |

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

> **Nota Legal:** Este informe de valoracion fue generado por 1+1, un sistema de inteligencia artificial. Las estimaciones de valor, supuestos y proyecciones deben ser validados por un valuador profesional certificado antes de su uso en transacciones, procesos legales o presentaciones ante la DIAN o SuperSociedades. 1+1 no reemplaza la opinion profesional de un perito valuador. La valoracion se realiza bajo el marco de NIIF 13 (Valor Razonable) y el Art. 90 del Estatuto Tributario.
`;
}
