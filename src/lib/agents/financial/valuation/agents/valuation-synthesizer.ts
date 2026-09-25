// ---------------------------------------------------------------------------
// Agente 2: Sintetizador de Valoración (GPT-5.4, JSON-strict)
// ---------------------------------------------------------------------------
//
// Output contract: `ValuationSynthesisReportSchema` (NIIF 13 + NIC 36/NIIF 3
// + Art. 90 E.T.).
// valoracion-14: recibe los resultados ESTRUCTURADOS y validados de DCF y
//   Múltiplos (JSON, no Markdown); una metodología no disponible llega como
//   null con su motivo y pesa 0.
// valoracion-15: `validateSynthesis` recalcula pesos efectivos, base,
//   divergencia, bandera roja y acota el rango; la oración de la opinión de
//   valor la redacta el código con las cifras validadas.
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
import type {
  DcfModelResult,
  MarketComparablesResult,
  ValuationSynthesisResult,
  ValuationProgressEvent,
} from '../types';
import {
  validateSynthesis,
  type MethodKey,
  type SynthesisComputed,
  type SynthesisInputs,
} from '../validators/synthesis-validator';
import { MULTIPLE_LABELS } from '../validators/comparables-validator';
import { renderDiscrepancies } from '../validators/render';

/** Resúmenes validados (valor del patrimonio) de cada metodología disponible. */
export function toSynthesisInputs(dcf: DcfModelResult, comparables: MarketComparablesResult): SynthesisInputs {
  return {
    dcf: dcf.status === 'ok' && dcf.computed
      ? {
          midpointCop: dcf.computed.equityValueCop,
          lowCop: dcf.computed.equityRange.lowCop,
          highCop: dcf.computed.equityRange.highCop,
        }
      : null,
    comparables: comparables.status === 'ok' && comparables.computed
      ? {
          midpointCop: comparables.computed.adjustedRange.baseCop,
          lowCop: comparables.computed.adjustedRange.conservativeCop,
          highCop: comparables.computed.adjustedRange.optimisticCop,
        }
      : null,
  };
}

/** Payload JSON estructurado para el Sintetizador (no Markdown). */
export function buildSynthesizerPayload(dcf: DcfModelResult, comparables: MarketComparablesResult): string {
  const dcfPayload = dcf.status === 'ok' && dcf.computed
    ? {
        estado: 'disponible',
        waccPercent: dcf.computed.wacc.waccPercent,
        costoPatrimonioKePercent: dcf.computed.wacc.costOfEquityPercent,
        crecimientoPerpetuoPercent: dcf.computed.growthPercent,
        enterpriseValueCop: dcf.computed.enterpriseValueCop,
        deudaNetaCop: dcf.computed.netDebtCop,
        patrimonioCasoBaseCop: dcf.computed.equityValueCop,
        rangoPatrimonioSensibilidad: dcf.computed.equityRange,
        vpValorTerminalSobreEvPercent: dcf.computed.terminalValuePercentOfEv,
        precioPorAccionCop: dcf.computed.pricePerShareCop,
        discrepanciasCorregidasEnCodigo: dcf.discrepancies.length,
      }
    : { estado: 'no_disponible', motivos: dcf.blockingReasons };
  const compsPayload = comparables.status === 'ok' && comparables.computed
    ? {
        estado: 'disponible',
        multiploPrimario: MULTIPLE_LABELS[comparables.computed.primaryMultiple],
        comparablesUsados: comparables.computed.comparablesUsed,
        estadisticas: comparables.computed.statistics.map((s) => ({
          multiplo: MULTIPLE_LABELS[s.multiple],
          mediana: s.median,
          minimo: s.min,
          maximo: s.max,
          n: s.count,
          aplica: s.applicable,
        })),
        patrimonioImplicito: {
          minimoCop: comparables.computed.implied.equityValueMinCop,
          medianaCop: comparables.computed.implied.equityValueMedianCop,
          maximoCop: comparables.computed.implied.equityValueMaxCop,
        },
        factorAjustesColombianos: comparables.computed.adjustmentFactor,
        rangoPatrimonioAjustado: comparables.computed.adjustedRange,
        discrepanciasCorregidasEnCodigo: comparables.discrepancies.length,
      }
    : { estado: 'no_disponible', motivos: comparables.blockingReasons };
  return JSON.stringify(
    { unidad: 'centavos COP (MoneyCop)', dcf: dcfPayload, multiplos: compsPayload },
    null,
    2,
  );
}

/**
 * Sintetiza DCF + Múltiplos en una opinión de valor consolidada. Precondición:
 * al menos una metodología con status 'ok' (el orquestador lo garantiza).
 */
export async function runValuationSynthesizer(
  dcf: DcfModelResult,
  comparables: MarketComparablesResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  purpose?: string,
  onProgress?: (event: ValuationProgressEvent) => void,
  signal?: AbortSignal,
): Promise<ValuationSynthesisResult> {
  const inputs = toSynthesisInputs(dcf, comparables);
  const available: MethodKey[] = [];
  if (inputs.dcf) available.push('dcf');
  if (inputs.comparables) available.push('market_comparables');

  const system = buildValuationSynthesizerPrompt(company, language, purpose, available);

  const userContent = [
    'RESULTADOS VALIDADOS DE LAS METODOLOGÍAS (JSON; cifras recalculadas en código):',
    '',
    buildSynthesizerPayload(dcf, comparables),
  ].join('\n');

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

  return toValuationSynthesisResult(json, inputs, company, language);
}

// ---------------------------------------------------------------------------
// Adapter local: ValuationSynthesisReportJson -> ValuationSynthesisResult
// ---------------------------------------------------------------------------

const fmt = (v: string | null) => (v === null ? 'N/D' : formatCopFromCents(parseMoneyCop(v), false));

function methodLabels(lang: 'es' | 'en'): Record<MethodKey, string> {
  return {
    dcf: 'DCF',
    market_comparables: lang === 'en' ? 'Market Comparables' : 'Múltiplos de Mercado',
  };
}

function renderMethodologyWeighting(json: ValuationSynthesisReportJson, c: SynthesisComputed, lang: 'es' | 'en'): string {
  const labels = methodLabels(lang);
  const rationale = new Map(json.methodologyWeights.map((w) => [w.method, w.rationale]));
  const methods: MethodKey[] = ['dcf', 'market_comparables'];
  return methods
    .map((m) => {
      const available = c.methodologies.includes(m);
      const why = available
        ? rationale.get(m) ?? ''
        : (lang === 'en' ? 'not available — weight 0' : 'no disponible — peso 0');
      return `- **${labels[m]}** (${c.weights[m].toFixed(1)}%): ${why}`;
    })
    .join('\n');
}

function renderValueRange(json: ValuationSynthesisReportJson, c: SynthesisComputed, lang: 'es' | 'en'): string {
  const en = lang === 'en';
  const r = json.consolidatedRange;
  const reconc = json.methodologyReconciliation;
  const divergenceLine = c.divergencePercent === null
    ? `- ${en ? 'Divergence' : 'Divergencia'}: N/D (${en ? 'single methodology' : 'metodología única'})`
    : `- ${en ? 'Divergence' : 'Divergencia'}: ${c.divergencePercent.toFixed(1)}%${c.divergenceIsRedFlag ? ` — **${en ? 'RED FLAG' : 'BANDERA ROJA'}**` : ''}`;
  return [
    `| ${en ? 'Scenario' : 'Escenario'} | ${en ? 'Equity value' : 'Valor del patrimonio'} |`,
    '|---|---:|',
    `| ${en ? 'Conservative (floor)' : 'Conservador (piso)'} | ${fmt(c.conservativeCop)} |`,
    `| **${en ? 'Base (weighted midpoint)' : 'Base (punto medio ponderado)'}** | **${fmt(c.baseCop)}** |`,
    `| ${en ? 'Optimistic (ceiling)' : 'Optimista (techo)'} | ${fmt(c.optimisticCop)} |`,
    '',
    `_${en ? 'Range bounded to the available methodologies' : 'Rango acotado a las metodologías disponibles'}: ${fmt(c.boundsLowCop)} – ${fmt(c.boundsHighCop)}._`,
    '',
    `**${en ? 'Confidence level' : 'Nivel de confianza'}:** ${r.confidenceLevel}`,
    '',
    r.rationale,
    '',
    `### ${en ? 'Reconciliation between methodologies' : 'Reconciliación entre metodologías'}`,
    `- ${en ? 'DCF midpoint' : 'Punto medio DCF'}: ${fmt(c.dcfMidpointCop)}`,
    `- ${en ? 'Comparables midpoint' : 'Punto medio Múltiplos'}: ${fmt(c.comparablesMidpointCop)}`,
    divergenceLine,
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
    reg.superSociedades ? `**${lang === 'en' ? 'Superintendence of Companies' : 'Superintendencia de Sociedades'}:** ${reg.superSociedades}` : '',
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

/** Oración formal de la opinión de valor, redactada con cifras validadas. */
export function buildValueOpinionStatement(c: SynthesisComputed, companyName: string, lang: 'es' | 'en'): string {
  const single = c.methodologies.length === 1;
  const labels = methodLabels(lang);
  if (lang === 'en') {
    return `In our opinion, the fair value of the equity of ${companyName} lies between ${fmt(c.conservativeCop)} and ${fmt(c.optimisticCop)}, with a midpoint of ${fmt(c.baseCop)}${single ? ` (single methodology: ${labels[c.methodologies[0]]})` : ''}.`;
  }
  return `En nuestra opinión, el valor razonable del patrimonio de ${companyName} se encuentra entre ${fmt(c.conservativeCop)} y ${fmt(c.optimisticCop)}, con punto medio ${fmt(c.baseCop)}${single ? ` (metodología única: ${labels[c.methodologies[0]]})` : ''}.`;
}

function renderExecutiveSummary(json: ValuationSynthesisReportJson, statement: string, lang: 'es' | 'en'): string {
  return [
    `**${lang === 'en' ? 'Value Opinion' : 'Opinión de Valor'}:** ${statement}`,
    '',
    `**${lang === 'en' ? 'Purpose' : 'Propósito'}:** ${json.purpose}`,
    '',
    json.valueOpinion.executiveSummary,
  ].join('\n');
}

export function toValuationSynthesisResult(
  json: ValuationSynthesisReportJson,
  inputs: SynthesisInputs,
  company: CompanyInfo,
  lang: 'es' | 'en',
): ValuationSynthesisResult {
  const validation = validateSynthesis(json, inputs);
  const keyAssumptions = renderKeyAssumptions(json, lang);
  const limitations = renderLimitations(json, lang);

  if (validation.status === 'blocked') {
    const reasons = validation.blockingErrors.map((e) => (lang === 'en' ? e.en : e.es));
    const validationReport = [
      lang === 'en' ? '**VALUE OPINION NOT ISSUABLE (N/D):**' : '**OPINIÓN DE VALOR NO EMITIBLE (N/D):**',
      ...reasons.map((r) => `- ${r}`),
    ].join('\n');
    const fullContent = [
      lang === 'en' ? '## VALUE OPINION NOT ISSUABLE' : '## OPINIÓN DE VALOR NO EMITIBLE',
      validationReport,
      '',
      limitations,
    ].join('\n');
    return {
      methodologyWeighting: '',
      valueRange: '',
      keyAssumptions,
      limitations,
      executiveSummary: '',
      validationReport,
      fullContent,
      status: 'blocked',
      blockingReasons: reasons,
      computed: null,
      discrepancies: validation.discrepancies,
    };
  }

  const c = validation.computed;
  const methodologyWeighting = renderMethodologyWeighting(json, c, lang);
  const valueRange = renderValueRange(json, c, lang);
  const statement = buildValueOpinionStatement(c, company.name, lang);
  const executiveSummary = renderExecutiveSummary(json, statement, lang);
  const validationReport = [
    lang === 'en'
      ? 'Effective weights, weighted midpoint, divergence, red flag and range bounds were recomputed in code from the validated methodologies; the published figure is always the recomputed one.'
      : 'Pesos efectivos, punto medio ponderado, divergencia, bandera roja y límites del rango se recalcularon en código con las metodologías validadas; la cifra publicada es siempre la recalculada.',
    '',
    renderDiscrepancies(validation.discrepancies, lang),
    ...(validation.notes.length > 0 ? ['', ...validation.notes.map((n) => `- ${lang === 'en' ? n.en : n.es}`)] : []),
  ].join('\n');

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
    '## 6. VALIDACIÓN DETERMINISTA',
    validationReport,
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
    validationReport,
    fullContent,
    status: 'ok',
    blockingReasons: [],
    computed: c,
    discrepancies: validation.discrepancies,
  };
}
