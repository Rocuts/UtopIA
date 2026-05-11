// ---------------------------------------------------------------------------
// Agente 1b: Valoración por Múltiplos de Mercado (GPT-5.4, JSON-strict)
// ---------------------------------------------------------------------------
//
// Output contract: `MarketComparablesReportSchema` (NIIF 13 Nivel 2 +
// Circular SuperSociedades 115-000011/2008 + Art. 90 E.T.).
// Renderer LOCAL: produce la estructura legacy `MarketComparablesResult`.
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
): Promise<MarketComparablesResult> {
  const system = buildMarketComparablesPrompt(company, language, purpose);

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

function fmtCop(v: string | null): string {
  return v === null ? 'N/D' : formatCopFromCents(parseMoneyCop(v), true);
}

function renderComparableSelection(json: MarketComparablesReportJson, lang: 'es' | 'en'): string {
  const c = json.comparableSelection;
  const header = lang === 'en'
    ? '| Comparable | Country | Source | Revenue | EBITDA | EV/EBITDA | P/E | P/BV | EV/Revenue |\n|---|---|---|---:|---:|---:|---:|---:|---:|'
    : '| Comparable | País | Fuente | Ingresos | EBITDA | EV/EBITDA | P/E | P/BV | EV/Revenue |\n|---|---|---|---:|---:|---:|---:|---:|---:|';
  const rows = c.comparables
    .map((cmp) => `| ${cmp.name} | ${cmp.country} | ${cmp.source} | ${fmtCop(cmp.revenueCop)} | ${fmtCop(cmp.ebitdaCop)} | ${fmtMultiple(cmp.evEbitda)} | ${fmtMultiple(cmp.pe)} | ${fmtMultiple(cmp.pBv)} | ${fmtMultiple(cmp.evRevenue)} |`)
    .join('\n');
  const rationale = c.comparables.map((cmp) => `- **${cmp.name}:** ${cmp.rationale}`).join('\n');
  return [
    `**${lang === 'en' ? 'Selection criteria' : 'Criterios de selección'}:** ${c.criteria.join(', ')}`,
    `**${lang === 'en' ? 'Geographic note' : 'Nota geográfica'}:** ${c.geographicNote}`,
    '',
    header,
    rows,
    '',
    `**${lang === 'en' ? 'Inclusion rationale' : 'Justificación de inclusión'}:**`,
    rationale,
  ].join('\n');
}

function renderMultiplesAnalysis(json: MarketComparablesReportJson, lang: 'es' | 'en'): string {
  if (json.multipleStatistics.length === 0) {
    return lang === 'en' ? '_No multiple statistics computed._' : '_Sin estadísticas de múltiplos calculadas._';
  }
  const labels: Record<typeof json.multipleStatistics[number]['multiple'], string> = {
    ev_ebitda: 'EV/EBITDA',
    pe: 'P/E',
    pbv: 'P/BV',
    ev_revenue: 'EV/Revenue',
  };
  const header = lang === 'en'
    ? '| Multiple | Median | Mean | Min | Max | n |\n|---|---:|---:|---:|---:|---:|'
    : '| Múltiplo | Mediana | Media | Mín | Máx | n |\n|---|---:|---:|---:|---:|---:|';
  const rows = json.multipleStatistics
    .map((s) => `| ${labels[s.multiple]} | ${s.median.toFixed(2)}x | ${s.mean.toFixed(2)}x | ${s.min.toFixed(2)}x | ${s.max.toFixed(2)}x | ${s.count} |`)
    .join('\n');
  return [header, rows].join('\n');
}

function renderImpliedValuation(json: MarketComparablesReportJson, lang: 'es' | 'en'): string {
  const v = json.impliedValuation;
  const labels: Record<typeof v.primaryMultiple, string> = {
    ev_ebitda: 'EV/EBITDA',
    pe: 'P/E',
    pbv: 'P/BV',
    ev_revenue: 'EV/Revenue',
  };
  return [
    `**${lang === 'en' ? 'Target metrics' : 'Métricas del target'}:**`,
    `- ${lang === 'en' ? 'Revenue' : 'Ingresos'}: ${fmtCop(v.targetRevenueCop)}`,
    `- EBITDA: ${fmtCop(v.targetEbitdaCop)}`,
    `- ${lang === 'en' ? 'Net income' : 'Utilidad neta'}: ${fmtCop(v.targetNetIncomeCop)}`,
    `- ${lang === 'en' ? 'Book value' : 'Valor en libros'}: ${fmtCop(v.targetBookValueCop)}`,
    '',
    `**${lang === 'en' ? 'Implied Enterprise Value' : 'Enterprise Value implícito'}:**`,
    `- ${lang === 'en' ? 'Min' : 'Mínimo'}: ${formatCopFromCents(parseMoneyCop(v.enterpriseValueMinCop), false)}`,
    `- ${lang === 'en' ? 'Median' : 'Mediana'}: ${formatCopFromCents(parseMoneyCop(v.enterpriseValueMedianCop), false)}`,
    `- ${lang === 'en' ? 'Max' : 'Máximo'}: ${formatCopFromCents(parseMoneyCop(v.enterpriseValueMaxCop), false)}`,
    '',
    `**${lang === 'en' ? 'Implied Equity Value' : 'Equity Value implícito'}:**`,
    `- ${lang === 'en' ? 'Min' : 'Mínimo'}: ${formatCopFromCents(parseMoneyCop(v.equityValueMinCop), false)}`,
    `- ${lang === 'en' ? 'Median' : 'Mediana'}: ${formatCopFromCents(parseMoneyCop(v.equityValueMedianCop), false)}`,
    `- ${lang === 'en' ? 'Max' : 'Máximo'}: ${formatCopFromCents(parseMoneyCop(v.equityValueMaxCop), false)}`,
    '',
    `**${lang === 'en' ? 'Primary multiple' : 'Múltiplo primario'}:** ${labels[v.primaryMultiple]} — ${v.primaryMultipleRationale}`,
  ].join('\n');
}

function renderColombianAdjustments(json: MarketComparablesReportJson, lang: 'es' | 'en'): string {
  if (json.adjustments.length === 0) {
    return lang === 'en' ? '_No Colombian adjustments applied._' : '_Sin ajustes colombianos aplicados._';
  }
  const labels: Record<typeof json.adjustments[number]['type'], string> = {
    size_discount: lang === 'en' ? 'Size discount' : 'Descuento por tamaño',
    illiquidity_discount: lang === 'en' ? 'Illiquidity discount' : 'Descuento por iliquidez',
    control_premium: lang === 'en' ? 'Control premium' : 'Prima de control',
  };
  const lines = json.adjustments.map((a) => {
    const sign = a.type === 'control_premium' ? '+' : '-';
    return `- **${labels[a.type]}** (${sign}${a.appliedPercent.toFixed(1)}%): ${a.rationale}`;
  });
  const range = [
    '',
    `**${lang === 'en' ? 'Final adjusted range' : 'Rango final ajustado'}:**`,
    `- ${lang === 'en' ? 'Conservative' : 'Conservador'}: ${formatCopFromCents(parseMoneyCop(json.adjustedValueRange.conservativeCop), false)}`,
    `- ${lang === 'en' ? 'Base' : 'Base'}: ${formatCopFromCents(parseMoneyCop(json.adjustedValueRange.baseCop), false)}`,
    `- ${lang === 'en' ? 'Optimistic' : 'Optimista'}: ${formatCopFromCents(parseMoneyCop(json.adjustedValueRange.optimisticCop), false)}`,
  ].join('\n');
  return [lines.join('\n'), range].join('\n');
}

function toMarketComparablesResult(
  json: MarketComparablesReportJson,
  lang: 'es' | 'en',
): MarketComparablesResult {
  const comparableSelection = renderComparableSelection(json, lang);
  const multiplesAnalysis = renderMultiplesAnalysis(json, lang);
  const impliedValuation = renderImpliedValuation(json, lang);
  const colombianAdjustments = renderColombianAdjustments(json, lang);

  const limitations = json.limitations.length > 0
    ? `\n\n**${lang === 'en' ? 'Limitations' : 'Limitaciones'}:**\n${json.limitations.map((l) => `- ${l}`).join('\n')}`
    : '';

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
    limitations,
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
    fullContent,
  };
}
