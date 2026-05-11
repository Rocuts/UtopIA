// ---------------------------------------------------------------------------
// Agente 1: Analista de Precios de Transferencia (GPT-5.4, JSON-strict)
// ---------------------------------------------------------------------------
//
// Output contract: `TpAnalysisReportSchema` (Arts. 260-1 a 260-11 E.T.).
// El JSON validado se mantiene en memoria para downstream y se renderiza a
// la estructura legacy `TPAnalysisResult` (campos markdown) que aún consume
// el orchestrator + el report consolidado. El renderer es LOCAL — no se
// toca `agents/renderer.ts` (Fase 1 / NIIF analyst).
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildTPAnalystPrompt } from '../prompts/tp-analyst.prompt';
import { TpAnalysisReportSchema, type TpAnalysisReportJson } from '../../contracts/transfer-pricing';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import type { CompanyInfo } from '../../types';
import type { TPAnalysisResult, TPProgressEvent } from '../types';

/**
 * Procesa los datos de transacciones intercompañía y produce el análisis de
 * Fase I (obligatoriedad, FAR, selección de método, pricing preliminar).
 */
export async function runTPAnalyst(
  rawData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions?: string,
  onProgress?: (event: TPProgressEvent) => void,
  signal?: AbortSignal,
): Promise<TPAnalysisResult> {
  const system = buildTPAnalystPrompt(company, language);

  const userContent = [
    'DATOS DE TRANSACCIONES INTERCOMPAÑÍA:',
    '',
    rawData,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 1,
    detail: 'Evaluando obligatoriedad (Art. 260-1 E.T.) y caracterizando transacciones controladas...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'tp-analyst',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: TpAnalysisReportSchema,
    system,
    userContent,
    ...MODELS_CONFIG.tpAnalyst,
    signal,
  });

  return toTPAnalysisResult(json, language);
}

// ---------------------------------------------------------------------------
// Adapter local: TpAnalysisReportJson -> TPAnalysisResult legacy
// ---------------------------------------------------------------------------

function renderObligation(json: TpAnalysisReportJson, lang: 'es' | 'en'): string {
  const o = json.obligation;
  const yes = lang === 'en' ? 'YES' : 'SÍ';
  const no = lang === 'en' ? 'NO' : 'NO';
  const status = o.isObligated ? yes : no;
  const lines = [
    `**Conclusión:** ${o.isObligated ? (lang === 'en' ? 'OBLIGATED' : 'OBLIGADO') : (lang === 'en' ? 'NOT OBLIGATED' : 'NO OBLIGADO')}`,
    '',
    `| Umbral | Valor empresa | Umbral 2026 | ¿Cumple? |`,
    `|---|---:|---:|:---:|`,
    `| Patrimonio bruto (100.000 UVT) | ${formatCopFromCents(parseMoneyCop(o.grossEquityCop), true)} | ${formatCopFromCents(parseMoneyCop(o.grossEquityThresholdCop), true)} | ${o.grossEquityMeetsThreshold ? yes : no} |`,
    `| Ingresos brutos (61.000 UVT) | ${formatCopFromCents(parseMoneyCop(o.grossIncomeCop), true)} | ${formatCopFromCents(parseMoneyCop(o.grossIncomeThresholdCop), true)} | ${o.grossIncomeMeetsThreshold ? yes : no} |`,
    `| Operaciones con paraíso fiscal (Art. 260-8 E.T.) | — | — | ${o.hasTaxHavenTransactions ? yes : no} |`,
    '',
    `**Estado:** ${status}`,
    '',
    o.rationale,
  ];
  return lines.join('\n');
}

function renderTransactions(json: TpAnalysisReportJson): string {
  if (json.controlledTransactions.length === 0) {
    return '_Sin transacciones controladas reportadas._';
  }
  const rows = json.controlledTransactions.map((t) => {
    const amount = formatCopFromCents(parseMoneyCop(t.amountCop), true);
    return `- **${t.description}** | Tipo: ${t.type} | Dirección: ${t.direction} | Contraparte: ${t.relatedPartyName} | Monto: ${amount}${t.contractualNotes ? ` | ${t.contractualNotes}` : ''}`;
  });
  const parties = json.relatedParties.map((p) => {
    const haven = p.isTaxHaven ? ' — **PARAÍSO FISCAL (Art. 260-8 E.T.)**' : '';
    return `- ${p.name} (Tax ID: ${p.taxId}, Jurisdicción: ${p.jurisdiction}${p.relationshipType ? `, Vinculación: ${p.relationshipType}` : ''})${haven}`;
  });
  return [
    '**Vinculados económicos identificados:**',
    parties.length > 0 ? parties.join('\n') : '_Sin vinculados reportados._',
    '',
    '**Transacciones controladas:**',
    rows.join('\n'),
  ].join('\n');
}

function renderFAR(json: TpAnalysisReportJson, lang: 'es' | 'en'): string {
  if (json.functionalAnalysis.length === 0) {
    return lang === 'en' ? '_No functional analysis recorded._' : '_Sin análisis funcional registrado._';
  }
  const blocks = json.functionalAnalysis.map((p) => {
    const role = p.party === 'contribuyente' ? (lang === 'en' ? 'Taxpayer' : 'Contribuyente') : (lang === 'en' ? 'Related Party' : 'Vinculado');
    return [
      `#### ${role}`,
      `- **${lang === 'en' ? 'Functions' : 'Funciones'}:** ${p.functions.join('; ') || '—'}`,
      `- **${lang === 'en' ? 'Assets' : 'Activos'}:** ${p.assets.join('; ') || '—'}`,
      `- **${lang === 'en' ? 'Risks' : 'Riesgos'}:** ${p.risks.join('; ') || '—'}`,
    ].join('\n');
  });
  return blocks.join('\n\n');
}

function renderMethodSelection(json: TpAnalysisReportJson, lang: 'es' | 'en'): string {
  const m = json.methodSelection;
  const discarded = m.discardedMethods
    .map((d) => `- **${d.method}:** ${d.reason}`)
    .join('\n');
  return [
    `**${lang === 'en' ? 'Most Appropriate Method (MMA)' : 'Método Más Apropiado (MMA)'}:** ${m.selectedMethod}`,
    `**Tested Party:** ${m.testedParty === 'contribuyente' ? (lang === 'en' ? 'Taxpayer' : 'Contribuyente') : (lang === 'en' ? 'Related Party' : 'Vinculado')}`,
    `**${lang === 'en' ? 'Profit Level Indicator (PLI)' : 'Indicador de Rentabilidad (PLI)'}:** ${m.profitLevelIndicator}`,
    '',
    m.justification,
    '',
    `**${lang === 'en' ? 'Discarded Methods' : 'Métodos descartados'}:**`,
    discarded || (lang === 'en' ? '_None._' : '_Ninguno._'),
  ].join('\n');
}

function renderPreliminary(json: TpAnalysisReportJson, lang: 'es' | 'en'): string {
  const p = json.preliminaryPricing;
  const pli = p.observedPliPercent !== null ? `${p.observedPliPercent.toFixed(2)}%` : 'N/D';
  const flags = p.riskFlags.map((f) => `- ${f}`).join('\n') || (lang === 'en' ? '_None._' : '_Ninguna._');
  return [
    `**${lang === 'en' ? 'Observed PLI' : 'PLI observado'}:** ${pli}`,
    `**${lang === 'en' ? 'Requires median adjustment?' : '¿Requiere ajuste a la mediana?'}** ${p.requiresMedianAdjustment ? (lang === 'en' ? 'Yes' : 'Sí') : 'No'}`,
    '',
    `**${lang === 'en' ? 'Risk flags' : 'Banderas rojas'}:**`,
    flags,
  ].join('\n');
}

function toTPAnalysisResult(json: TpAnalysisReportJson, lang: 'es' | 'en'): TPAnalysisResult {
  const obligationAssessment = renderObligation(json, lang);
  const transactionCharacterization = renderTransactions(json);
  const functionalAnalysis = renderFAR(json, lang);
  const methodSelection = renderMethodSelection(json, lang);
  const preliminaryPricingAnalysis = renderPreliminary(json, lang);

  const fullContent = [
    '## 1. EVALUACIÓN DE OBLIGATORIEDAD',
    obligationAssessment,
    '',
    '## 2. CARACTERIZACIÓN DE TRANSACCIONES CONTROLADAS',
    transactionCharacterization,
    '',
    '## 3. ANÁLISIS FUNCIONAL (FAR)',
    functionalAnalysis,
    '',
    '## 4. SELECCIÓN DEL MÉTODO DE PRECIOS DE TRANSFERENCIA',
    methodSelection,
    '',
    '## 5. ANÁLISIS PRELIMINAR DE PRECIOS',
    preliminaryPricingAnalysis,
    '',
    json.citations.length > 0
      ? `_Citas: ${json.citations.join(' · ')}_`
      : '',
    json.technicalNotes.length > 0
      ? `\n**${lang === 'en' ? 'Technical notes' : 'Notas técnicas'}:**\n${json.technicalNotes.map((n) => `- ${n}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    obligationAssessment,
    transactionCharacterization,
    functionalAnalysis,
    methodSelection,
    preliminaryPricingAnalysis,
    fullContent,
  };
}
