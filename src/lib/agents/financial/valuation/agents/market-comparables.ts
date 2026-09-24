// ---------------------------------------------------------------------------
// Agente 1b: Valoración por Múltiplos de Mercado (GPT-5.4, JSON-strict)
// ---------------------------------------------------------------------------
//
// Output contract: `MarketComparablesReportSchema` (NIIF 13 Nivel 2 +
// Art. 90 E.T.). `validateComparables` (validators/comparables-validator.ts)
// recalcula estadísticas, valor implícito y rango ajustado (valoracion-13).
// Renderer LOCAL: produce la estructura legacy `MarketComparablesResult` con
// signo preservado y cifras recalculadas.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildMarketComparablesPrompt } from '../prompts/market-comparables.prompt';
import {
  MarketComparablesReportSchema,
  type MarketComparablesReportJson,
} from '../../contracts/valuation';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import type { CompanyInfo } from '../../types';
import type { MarketComparablesResult, ValuationProgressEvent } from '../types';
import type { MacroSnapshot } from '../macro-context';
import {
  MULTIPLE_LABELS,
  validateComparables,
  type ComparablesComputed,
  type MultipleStat,
} from '../validators/comparables-validator';
import type { ValidationIssue } from '../validators/wacc';
import { renderDiscrepancies } from '../validators/render';

/**
 * Realiza la valoración relativa por múltiplos de mercado.
 */
export async function runMarketComparables(
  financialData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  purpose?: string,
  instructions?: string,
  onProgress?: (event: ValuationProgressEvent) => void,
  signal?: AbortSignal,
  macro?: MacroSnapshot | null,
): Promise<MarketComparablesResult> {
  const system = buildMarketComparablesPrompt(company, language, purpose, macro);

  const userContent = [
    'DATOS FINANCIEROS PARA VALORACIÓN POR MÚLTIPLOS:',
    '',
    financialData,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({
    type: 'agent_progress',
    agent: 'comparables',
    detail: 'Seleccionando comparables y calculando múltiplos (EV/EBITDA, P/E, P/BV, EV/Revenue)...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'market-comparables',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: MarketComparablesReportSchema,
    system,
    userContent,
    ...MODELS_CONFIG.marketComparables,
    signal,
  });

  return toMarketComparablesResult(json, language);
}

// ---------------------------------------------------------------------------
// Adapter local: MarketComparablesReportJson -> MarketComparablesResult legacy
// ---------------------------------------------------------------------------

function fmtMultiple(v: number | null): string {
  return v === null ? 'N/D' : `${v.toFixed(2)}x`;
}

/** Conserva el signo: un EBITDA negativo se imprime como `($500.000.000,00)`. */
function fmtCop(v: string | null): string {
  return v === null ? 'N/D' : formatCopFromCents(parseMoneyCop(v), false);
}

function renderComparableSelection(json: MarketComparablesReportJson, lang: 'es' | 'en'): string {
  const c = json.comparableSelection;
  const en = lang === 'en';
  if (c.comparables.length === 0) {
    return [
      `**${en ? 'Selection criteria' : 'Criterios de selección'}:** ${c.criteria.join(', ')}`,
      `**${en ? 'Geographic note' : 'Nota geográfica'}:** ${c.geographicNote}`,
      '',
      en ? '_No comparables with verifiable data._' : '_Sin comparables con datos verificables._',
    ].join('\n');
  }
  const header = en
    ? '| Comparable | Country | Source (cut-off) | Revenue | EBITDA | EV/EBITDA | P/E | P/BV | EV/Revenue |\n|---|---|---|---:|---:|---:|---:|---:|---:|'
    : '| Comparable | País | Fuente (corte) | Ingresos | EBITDA | EV/EBITDA | P/E | P/BV | EV/Revenue |\n|---|---|---|---:|---:|---:|---:|---:|---:|';
  const rows = c.comparables
    .map((cmp) => `| ${cmp.name} | ${cmp.country} | ${cmp.source} (${cmp.sourceAsOf ?? 'N/D'}) | ${fmtCop(cmp.revenueCop)} | ${fmtCop(cmp.ebitdaCop)} | ${fmtMultiple(cmp.evEbitda)} | ${fmtMultiple(cmp.pe)} | ${fmtMultiple(cmp.pBv)} | ${fmtMultiple(cmp.evRevenue)} |`)
    .join('\n');
  const rationale = c.comparables.map((cmp) => `- **${cmp.name}:** ${cmp.rationale}`).join('\n');
  return [
    `**${en ? 'Selection criteria' : 'Criterios de selección'}:** ${c.criteria.join(', ')}`,
    `**${en ? 'Geographic note' : 'Nota geográfica'}:** ${c.geographicNote}`,
    '',
    header,
    rows,
    '',
    `**${en ? 'Inclusion rationale' : 'Justificación de inclusión'}:**`,
    rationale,
  ].join('\n');
}

function renderMultiplesAnalysis(statistics: MultipleStat[], lang: 'es' | 'en'): string {
  const en = lang === 'en';
  const header = en
    ? '| Multiple | Median | Mean | Min | Max | n | Applies to target |\n|---|---:|---:|---:|---:|---:|---|'
    : '| Múltiplo | Mediana | Media | Mín | Máx | n | Aplica al objetivo |\n|---|---:|---:|---:|---:|---:|---|';
  const rows = statistics
    .map((s) => {
      const applies = s.applicable
        ? (en ? 'Yes' : 'Sí')
        : `N/A — ${en ? s.notApplicableReason?.en : s.notApplicableReason?.es}`;
      return `| ${MULTIPLE_LABELS[s.multiple]} | ${fmtMultiple(s.median)} | ${fmtMultiple(s.mean)} | ${fmtMultiple(s.min)} | ${fmtMultiple(s.max)} | ${s.count} | ${applies} |`;
    })
    .join('\n');
  return [
    en
      ? '_Statistics recomputed in code from the listed comparables (multiples ≤ 0 excluded)._'
      : '_Estadísticas recalculadas en código desde los comparables listados (múltiplos ≤ 0 excluidos)._',
    '',
    header,
    rows,
  ].join('\n');
}

function renderTargetMetrics(json: MarketComparablesReportJson, lang: 'es' | 'en'): string[] {
  const v = json.impliedValuation;
  const en = lang === 'en';
  return [
    `**${en ? 'Target metrics' : 'Métricas del target'}:**`,
    `- ${en ? 'Revenue' : 'Ingresos'}: ${fmtCop(v.targetRevenueCop)}`,
    `- EBITDA: ${fmtCop(v.targetEbitdaCop)}`,
    `- ${en ? 'Net income' : 'Utilidad neta'}: ${fmtCop(v.targetNetIncomeCop)}`,
    `- ${en ? 'Book value' : 'Valor en libros'}: ${fmtCop(v.targetBookValueCop)}`,
    `- ${en ? 'Net debt' : 'Deuda neta'}: ${fmtCop(v.targetNetDebtCop)}`,
  ];
}

function renderImpliedValuation(json: MarketComparablesReportJson, c: ComparablesComputed, lang: 'es' | 'en'): string {
  const v = json.impliedValuation;
  const en = lang === 'en';
  return [
    ...renderTargetMetrics(json, lang),
    '',
    `**${en ? 'Implied Enterprise Value' : 'Enterprise Value implícito'}:**`,
    `- ${en ? 'Min' : 'Mínimo'}: ${fmtCop(c.implied.enterpriseValueMinCop)}`,
    `- ${en ? 'Median' : 'Mediana'}: ${fmtCop(c.implied.enterpriseValueMedianCop)}`,
    `- ${en ? 'Max' : 'Máximo'}: ${fmtCop(c.implied.enterpriseValueMaxCop)}`,
    '',
    `**${en ? 'Implied Equity Value' : 'Equity Value implícito'}:**`,
    `- ${en ? 'Min' : 'Mínimo'}: ${fmtCop(c.implied.equityValueMinCop)}`,
    `- ${en ? 'Median' : 'Mediana'}: ${fmtCop(c.implied.equityValueMedianCop)}`,
    `- ${en ? 'Max' : 'Máximo'}: ${fmtCop(c.implied.equityValueMaxCop)}`,
    '',
    `**${en ? 'Primary multiple' : 'Múltiplo primario'}:** ${MULTIPLE_LABELS[v.primaryMultiple]} (n = ${c.comparablesUsed}) — ${v.primaryMultipleRationale}`,
  ].join('\n');
}

function renderColombianAdjustments(json: MarketComparablesReportJson, c: ComparablesComputed | null, lang: 'es' | 'en'): string {
  const en = lang === 'en';
  const labels: Record<typeof json.adjustments[number]['type'], string> = {
    size_discount: en ? 'Size discount' : 'Descuento por tamaño',
    illiquidity_discount: en ? 'Illiquidity discount' : 'Descuento por iliquidez',
    control_premium: en ? 'Control premium' : 'Prima de control',
  };
  const lines = json.adjustments.length === 0
    ? [en ? '_No Colombian adjustments applied._' : '_Sin ajustes colombianos aplicados._']
    : json.adjustments.map((a) => {
        const sign = a.type === 'control_premium' ? '+' : '-';
        return `- **${labels[a.type]}** (${sign}${a.appliedPercent.toFixed(1)}%): ${a.rationale}`;
      });
  if (!c) return lines.join('\n');
  const range = [
    '',
    `**${en ? 'Final adjusted equity range' : 'Rango final ajustado (patrimonio)'}** _(${en ? 'implied equity × combined factor' : 'patrimonio implícito × factor combinado'} ${c.adjustmentFactor.toFixed(4)})_:`,
    `- ${en ? 'Conservative' : 'Conservador'}: ${fmtCop(c.adjustedRange.conservativeCop)}`,
    `- ${en ? 'Base' : 'Base'}: ${fmtCop(c.adjustedRange.baseCop)}`,
    `- ${en ? 'Optimistic' : 'Optimista'}: ${fmtCop(c.adjustedRange.optimisticCop)}`,
  ].join('\n');
  return [lines.join('\n'), range].join('\n');
}

function renderNotes(notes: ValidationIssue[], lang: 'es' | 'en'): string[] {
  return notes.length > 0 ? ['', ...notes.map((n) => `- ${lang === 'en' ? n.en : n.es}`)] : [];
}

function renderLimitations(json: MarketComparablesReportJson, lang: 'es' | 'en'): string {
  return json.limitations.length > 0
    ? `\n\n**${lang === 'en' ? 'Limitations' : 'Limitaciones'}:**\n${json.limitations.map((l) => `- ${l}`).join('\n')}`
    : '';
}

export function toMarketComparablesResult(
  json: MarketComparablesReportJson,
  lang: 'es' | 'en',
): MarketComparablesResult {
  const validation = validateComparables(json);
  const comparableSelection = renderComparableSelection(json, lang);
  const statistics = validation.status === 'ok' ? validation.computed.statistics : validation.statistics;
  const multiplesAnalysis = renderMultiplesAnalysis(statistics, lang);

  if (validation.status === 'blocked') {
    const reasons = validation.blockingErrors.map((e) => (lang === 'en' ? e.en : e.es));
    const impliedValuation = [
      ...renderTargetMetrics(json, lang),
      '',
      lang === 'en'
        ? '**MULTIPLES VALUATION NOT ISSUABLE** — N/D:'
        : '**VALORACIÓN POR MÚLTIPLOS NO EMITIBLE** — N/D:',
      ...reasons.map((r) => `- ${r}`),
    ].join('\n');
    const colombianAdjustments = renderColombianAdjustments(json, null, lang);
    const validationReport = [
      renderDiscrepancies(validation.discrepancies, lang),
      ...renderNotes(validation.notes, lang),
    ].join('\n');
    const fullContent = [
      '## 1. SELECCIÓN DE COMPARABLES',
      comparableSelection,
      '',
      '## 2. ANÁLISIS DE MÚLTIPLOS',
      multiplesAnalysis,
      '',
      '## 3. VALORACIÓN IMPLÍCITA',
      impliedValuation,
      '',
      '## 4. AJUSTES COLOMBIANOS',
      colombianAdjustments,
      '',
      '## 5. VALIDACIÓN DETERMINISTA',
      validationReport,
      renderLimitations(json, lang),
    ]
      .filter(Boolean)
      .join('\n');
    return {
      comparableSelection,
      multiplesAnalysis,
      impliedValuation,
      colombianAdjustments,
      validationReport,
      fullContent,
      status: 'blocked',
      blockingReasons: reasons,
      computed: null,
      discrepancies: validation.discrepancies,
    };
  }

  const c = validation.computed;
  const impliedValuation = renderImpliedValuation(json, c, lang);
  const colombianAdjustments = renderColombianAdjustments(json, c, lang);
  const validationReport = [
    lang === 'en'
      ? 'Statistics, implied values and the adjusted range were recomputed in code; the published figure is always the recomputed one.'
      : 'Estadísticas, valores implícitos y rango ajustado se recalcularon en código; la cifra publicada es siempre la recalculada.',
    '',
    renderDiscrepancies(validation.discrepancies, lang),
    ...renderNotes(validation.notes, lang),
  ].join('\n');

  const fullContent = [
    '## 1. SELECCIÓN DE COMPARABLES',
    comparableSelection,
    '',
    '## 2. ANÁLISIS DE MÚLTIPLOS',
    multiplesAnalysis,
    '',
    '## 3. VALORACIÓN IMPLÍCITA',
    impliedValuation,
    '',
    '## 4. AJUSTES COLOMBIANOS',
    colombianAdjustments,
    '',
    '## 5. VALIDACIÓN DETERMINISTA',
    validationReport,
    renderLimitations(json, lang),
    '',
    json.citations.length > 0 ? `_${lang === 'en' ? 'Citations' : 'Citas'}: ${json.citations.join(' · ')}_` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    comparableSelection,
    multiplesAnalysis,
    impliedValuation,
    colombianAdjustments,
    validationReport,
    fullContent,
    status: 'ok',
    blockingReasons: [],
    computed: c,
    discrepancies: validation.discrepancies,
  };
}
