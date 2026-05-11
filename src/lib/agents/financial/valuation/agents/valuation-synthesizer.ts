// ---------------------------------------------------------------------------
// Agente 2: Sintetizador de Valoración (GPT-5.4, JSON-strict)
// ---------------------------------------------------------------------------
//
// Output contract: `ValuationSynthesisReportSchema` (NIIF 13 + NIC 36/NIIF 3
// + Art. 90 E.T. + Circular SuperSociedades 115-000011/2008).
// Renderer LOCAL: produce la estructura legacy `ValuationSynthesisResult`.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildValuationSynthesizerPrompt } from '../prompts/valuation-synthesizer.prompt';
import {
  ValuationSynthesisReportSchema,
  type ValuationSynthesisReportJson,
} from '../../contracts/valuation';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import type { CompanyInfo } from '../../types';
import type { ValuationSynthesisResult, ValuationProgressEvent } from '../types';

/**
 * Sintetiza DCF + Múltiplos en una opinión de valor consolidada.
 */
export async function runValuationSynthesizer(
  dcfContent: string,
  comparablesContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  purpose?: string,
  onProgress?: (event: ValuationProgressEvent) => void,
  signal?: AbortSignal,
): Promise<ValuationSynthesisResult> {
  const system = buildValuationSynthesizerPrompt(company, language, purpose);

  const userContent = `INFORME DEL MODELADOR DCF:

${dcfContent}

---

INFORME DEL EXPERTO EN MÚLTIPLOS DE MERCADO:

${comparablesContent}`;

  onProgress?.({
    type: 'agent_progress',
    agent: 'synthesizer',
    detail: 'Ponderando metodologías y construyendo opinión de valor consolidada (NIIF 13)...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'valuation-synthesizer',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: ValuationSynthesisReportSchema,
    system,
    userContent,
    ...MODELS_CONFIG.valuationSynthesizer,
    signal,
  });

  return toValuationSynthesisResult(json, language);
}

// ---------------------------------------------------------------------------
// Adapter local: ValuationSynthesisReportJson -> ValuationSynthesisResult
// ---------------------------------------------------------------------------

function renderMethodologyWeighting(json: ValuationSynthesisReportJson, lang: 'es' | 'en'): string {
  const labels: Record<typeof json.methodologyWeights[number]['method'], string> = {
    dcf: 'DCF',
    market_comparables: lang === 'en' ? 'Market Comparables' : 'Múltiplos de Mercado',
  };
  const rows = json.methodologyWeights
    .map((w) => `- **${labels[w.method]}** (${w.weightPercent.toFixed(1)}%): ${w.rationale}`)
    .join('\n');
  const totalCheck = json.methodologyWeights.reduce((acc, w) => acc + w.weightPercent, 0);
  const totalNote = Math.abs(totalCheck - 100) < 0.01
    ? ''
    : `\n_${lang === 'en' ? 'Warning: weights sum' : 'Advertencia: la suma de pesos'} ${totalCheck.toFixed(1)}% ${lang === 'en' ? 'instead of 100%' : 'en vez de 100%'}._`;
  return [rows, totalNote].filter(Boolean).join('\n');
}

function renderValueRange(json: ValuationSynthesisReportJson, lang: 'es' | 'en'): string {
  const r = json.consolidatedRange;
  const reconc = json.methodologyReconciliation;
  return [
    `| ${lang === 'en' ? 'Scenario' : 'Escenario'} | ${lang === 'en' ? 'Value' : 'Valor'} |`,
    '|---|---:|',
    `| ${lang === 'en' ? 'Conservative (floor)' : 'Conservador (piso)'} | ${formatCopFromCents(parseMoneyCop(r.conservativeCop), false)} |`,
    `| **${lang === 'en' ? 'Base (midpoint)' : 'Base (punto medio)'}** | **${formatCopFromCents(parseMoneyCop(r.baseCop), false)}** |`,
    `| ${lang === 'en' ? 'Optimistic (ceiling)' : 'Optimista (techo)'} | ${formatCopFromCents(parseMoneyCop(r.optimisticCop), false)} |`,
    '',
    `**${lang === 'en' ? 'Confidence level' : 'Nivel de confianza'}:** ${r.confidenceLevel}`,
    '',
    r.rationale,
    '',
    `### ${lang === 'en' ? 'Reconciliation between methodologies' : 'Reconciliación entre metodologías'}`,
    `- ${lang === 'en' ? 'DCF midpoint' : 'Punto medio DCF'}: ${formatCopFromCents(parseMoneyCop(reconc.dcfMidpointCop), false)}`,
    `- ${lang === 'en' ? 'Comparables midpoint' : 'Punto medio Múltiplos'}: ${formatCopFromCents(parseMoneyCop(reconc.comparablesMidpointCop), false)}`,
    `- ${lang === 'en' ? 'Divergence' : 'Divergencia'}: ${reconc.divergencePercent.toFixed(1)}%${reconc.divergenceIsRedFlag ? ` — **${lang === 'en' ? 'RED FLAG' : 'BANDERA ROJA'}**` : ''}`,
    '',
    reconc.rationale,
  ].join('\n');
}

function renderKeyAssumptions(json: ValuationSynthesisReportJson, lang: 'es' | 'en'): string {
  if (json.keyAssumptions.length === 0) {
    return lang === 'en' ? '_No key assumptions documented._' : '_Sin supuestos clave documentados._';
  }
  return json.keyAssumptions
    .map((a) => `- **${a.assumption}** — ${a.impactDescription}`)
    .join('\n');
}

function renderLimitations(json: ValuationSynthesisReportJson, lang: 'es' | 'en'): string {
  const reg = json.regulatoryImplications;
  const regBlock = [
    `**Art. 90 E.T.:** ${reg.art90Et}`,
    reg.nic36OrNiif3 ? `**NIC 36 / NIIF 3:** ${reg.nic36OrNiif3}` : '',
    reg.superSociedades ? `**SuperSociedades (Circular 115-000011/2008):** ${reg.superSociedades}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const limits = json.limitations.length > 0
    ? json.limitations.map((l) => `- ${l}`).join('\n')
    : (lang === 'en' ? '_No specific limitations._' : '_Sin limitaciones específicas._');
  return [
    `### ${lang === 'en' ? 'Regulatory implications' : 'Implicaciones normativas'}`,
    regBlock,
    '',
    `### ${lang === 'en' ? 'Limitations' : 'Limitaciones'}`,
    limits,
  ].join('\n');
}

function renderExecutiveSummary(json: ValuationSynthesisReportJson, lang: 'es' | 'en'): string {
  return [
    `**${lang === 'en' ? 'Value Opinion' : 'Opinión de Valor'}:** ${json.valueOpinion.statement}`,
    '',
    `**${lang === 'en' ? 'Purpose' : 'Propósito'}:** ${json.purpose}`,
    '',
    json.valueOpinion.executiveSummary,
  ].join('\n');
}

function toValuationSynthesisResult(
  json: ValuationSynthesisReportJson,
  lang: 'es' | 'en',
): ValuationSynthesisResult {
  const methodologyWeighting = renderMethodologyWeighting(json, lang);
  const valueRange = renderValueRange(json, lang);
  const keyAssumptions = renderKeyAssumptions(json, lang);
  const limitations = renderLimitations(json, lang);
  const executiveSummary = renderExecutiveSummary(json, lang);

  const fullContent = [
    '## 1. PONDERACIÓN DE METODOLOGÍAS',
    methodologyWeighting,
    '',
    '## 2. RANGO DE VALORACIÓN CONSOLIDADO',
    valueRange,
    '',
    '## 3. SUPUESTOS CLAVE Y SENSIBILIDADES',
    keyAssumptions,
    '',
    '## 4. LIMITACIONES Y ADVERTENCIAS',
    limitations,
    '',
    '## 5. RESUMEN EJECUTIVO',
    executiveSummary,
    '',
    json.citations.length > 0 ? `_${lang === 'en' ? 'Citations' : 'Citas'}: ${json.citations.join(' · ')}_` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    methodologyWeighting,
    valueRange,
    keyAssumptions,
    limitations,
    executiveSummary,
    fullContent,
  };
}
