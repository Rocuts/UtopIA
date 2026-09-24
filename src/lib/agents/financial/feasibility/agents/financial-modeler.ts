// ---------------------------------------------------------------------------
// Agente 2: Modelador Financiero (Feasibility)
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4 con `callFinancialAgent` +
// `FinancialModelReportSchema` + `MODELS_CONFIG.financialModeler`.
//
// valoracion-09: recibe los datos del usuario (projectData) y sus
// instrucciones además del análisis de mercado; devuelve inversión inicial,
// flujos y componentes del WACC estructurados. VPN, TIR, TIRM, payback, IR y
// punto de equilibrio se calculan en código (calc/project-metrics.ts); el
// WACC se recalcula con el mismo validador de la valoración.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildFinancialModelerPrompt } from '../prompts/financial-modeler.prompt';
import {
  FinancialModelReportSchema,
  type FinancialModelReportJson,
} from '../../contracts/feasibility';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import { recomputeWacc, type ValidationDiscrepancy, type WaccValidation } from '../../valuation/validators/wacc';
import { renderDiscrepancies } from '../../valuation/validators/render';
import type { MacroSnapshot } from '../../valuation/macro-context';
import {
  computeBreakEven,
  computeProjectMetrics,
  type BreakEvenResult,
  type ProjectMetrics,
} from '../calc/project-metrics';
import type { ProjectInfo, MarketAnalysisResult, FinancialModelResult, FeasibilityProgressEvent } from '../types';

export interface FinancialModelerInput {
  marketOutput: MarketAnalysisResult;
  project: ProjectInfo;
  language: 'es' | 'en';
  /** Datos del proyecto suministrados por el usuario (precios, costos, cotizaciones) */
  projectData: string;
  /** Instrucciones adicionales del usuario */
  instructions?: string;
  macro?: MacroSnapshot | null;
  onProgress?: (event: FeasibilityProgressEvent) => void;
  /** Fecha de evaluación (inyectable en pruebas) */
  now?: Date;
}

/**
 * Takes market analysis from Agent 1 plus the user's project data and builds a
 * financial model whose decision metrics are computed in code.
 */
export async function runFinancialModeler(input: FinancialModelerInput): Promise<FinancialModelResult> {
  const { marketOutput, project, language, projectData, instructions, macro, onProgress, now } = input;
  onProgress?.({ type: 'stage_progress', stage: 2, detail: 'Construyendo estados pro-forma y calculando WACC...' });

  const userContent = [
    'DATOS DEL PROYECTO SUMINISTRADOS POR EL USUARIO (fuente primaria de precios, costos, capacidad y cotizaciones):',
    '',
    projectData,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}\n` : '',
    'ANALISIS DE MERCADO GENERADO POR EL ANALISTA DE MERCADO:',
    '',
    marketOutput.fullContent,
  ]
    .filter(Boolean)
    .join('\n');

  const { json } = await callFinancialAgent({
    agentName: 'financial-modeler',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: FinancialModelReportSchema,
    system: buildFinancialModelerPrompt(project, language, { macro, now }),
    userContent,
    ...MODELS_CONFIG.financialModeler,
  });

  return toFinancialModelResult(json, `${projectData}\n${instructions ?? ''}`, language);
}

// ---------------------------------------------------------------------------
// Tasa de descuento: WACC recalculado o tasa expresamente indicada por el usuario
// ---------------------------------------------------------------------------

/** ¿Aparece `ratePercent` como "N%" / "N,M %" en el texto del usuario? */
export function userTextMentionsRate(userText: string, ratePercent: number): boolean {
  const re = /(\d{1,3}(?:[.,]\d+)?)\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(userText)) !== null) {
    const v = Number(m[1].replace(',', '.'));
    if (Number.isFinite(v) && Math.abs(v - ratePercent) < 0.005) return true;
  }
  return false;
}

interface DiscountRateDecision {
  percent: number | null;
  source: FinancialModelResult['discountRate']['source'];
  notes: string[];
  discrepancies: ValidationDiscrepancy[];
}

function decideDiscountRate(
  json: FinancialModelReportJson,
  waccCheck: WaccValidation,
  userText: string,
  lang: 'es' | 'en',
): DiscountRateDecision {
  const notes: string[] = [];
  const discrepancies: ValidationDiscrepancy[] = [];
  if (json.discountRateSource === 'tasa_indicada_por_usuario') {
    if (userTextMentionsRate(userText, json.discountRatePercent)) {
      return { percent: json.discountRatePercent, source: 'tasa_usuario', notes, discrepancies };
    }
    notes.push(lang === 'en'
      ? `The ${json.discountRatePercent.toFixed(2)}% rate declared as user-provided does not appear in the user data; the recomputed WACC is used instead.`
      : `La tasa de ${json.discountRatePercent.toFixed(2)}% declarada como indicada por el usuario no aparece en sus datos; se usa el WACC recalculado.`);
  }
  if (waccCheck.status === 'ok') {
    const wacc = waccCheck.computed.waccPercent;
    if (Math.abs(json.discountRatePercent - wacc) > 0.01 + 1e-9) {
      discrepancies.push({
        field: lang === 'en' ? 'Discount rate' : 'Tasa de descuento',
        reported: `${json.discountRatePercent.toFixed(2)}%`,
        recomputed: `${wacc.toFixed(2)}%`,
      });
    }
    return { percent: wacc, source: 'wacc_recalculado', notes, discrepancies };
  }
  notes.push(...waccCheck.blockingErrors.map((e) => (lang === 'en' ? e.en : e.es)));
  return { percent: null, source: 'no_disponible', notes, discrepancies };
}

// ---------------------------------------------------------------------------
// Adapter local — JSON-strict -> FinancialModelResult (métricas en código)
// ---------------------------------------------------------------------------

const fmt = (v: string) => formatCopFromCents(parseMoneyCop(v), false);
const fmtPct = (v: number | null) => (v === null ? 'N/D' : `${v.toFixed(2)}%`);
const fmtYears = (v: number | null, lang: 'es' | 'en') =>
  v === null ? (lang === 'en' ? 'N/D (not recovered within the horizon)' : 'N/D (no se recupera en el horizonte)') : `${v.toFixed(2)} ${lang === 'en' ? 'years' : 'años'}`;

function renderWaccTable(waccCheck: WaccValidation, json: FinancialModelReportJson, lang: 'es' | 'en'): string {
  const en = lang === 'en';
  const w = json.wacc;
  if (waccCheck.status !== 'ok') {
    return [
      en ? '**WACC NOT COMPUTABLE:**' : '**WACC NO CALCULABLE:**',
      ...waccCheck.blockingErrors.map((e) => `- ${en ? e.en : e.es}`),
    ].join('\n');
  }
  const c = waccCheck.computed;
  const basis = w.riskFreeBasis === 'UST_USD_fisher'
    ? 'Rf (UST 10Y USD) + Fisher'
    : (en ? 'Rf (TES COP net of default spread)' : 'Rf (TES COP neto del diferencial soberano)');
  return [
    en ? '| Component | Value |\n|---|---:|' : '| Componente | Valor |\n|---|---:|',
    `| ${basis} | ${fmtPct(c.riskFreeRatePercent)} |`,
    `| CRP | ${fmtPct(w.countryRiskPremiumPercent)} |`,
    `| ERP (${en ? 'mature' : 'madura'}) | ${fmtPct(w.equityRiskPremiumPercent)} |`,
    `| Beta | ${w.beta.toFixed(2)} |`,
    `| Size Premium | ${fmtPct(w.sizePremiumPercent)} |`,
    `| **Ke COP** | **${fmtPct(c.costOfEquityPercent)}** |`,
    `| Kd × (1 − t) | ${fmtPct(c.afterTaxCostOfDebtPercent)} |`,
    `| E/V / D/V | ${fmtPct(w.equityWeightPercent)} / ${fmtPct(w.debtWeightPercent)} |`,
    `| **WACC** | **${fmtPct(c.waccPercent)}** |`,
    '',
    `**${en ? 'Market data source and cut-off date' : 'Fuente y fecha de corte de parámetros de mercado'}:** ${w.marketDataProvenance}`,
  ].join('\n');
}

function renderEvaluation(
  metrics: ProjectMetrics | null,
  unavailable: string[],
  rate: DiscountRateDecision,
  json: FinancialModelReportJson,
  lang: 'es' | 'en',
): string {
  const en = lang === 'en';
  const sourceLabel = rate.source === 'tasa_usuario'
    ? (en ? 'rate indicated by the user' : 'tasa indicada por el usuario')
    : rate.source === 'wacc_recalculado'
      ? (en ? 'WACC recomputed in code' : 'WACC recalculado en código')
      : 'N/D';
  const header = [
    en ? '_Metrics computed in code from the structured cash flows._' : '_Métricas calculadas en código a partir de los flujos estructurados._',
    '',
    `**${en ? 'Discount rate' : 'Tasa de descuento'}:** ${fmtPct(rate.percent)} (${sourceLabel})`,
  ];
  if (!metrics) {
    return [
      ...header,
      '',
      en ? '**NPV / IRR / MIRR / payback / PI: N/D**' : '**VPN / TIR / TIRM / payback / IR: N/D**',
      ...unavailable.map((r) => `- ${r}`),
      '',
      `**${en ? 'Modeler interpretation' : 'Interpretación del modelador'}:** ${json.projectEvaluation}`,
    ].join('\n');
  }
  const flowsTable = [
    en
      ? '| Year | FCF | PV | Cumulative | Discounted cumulative |\n|---|---:|---:|---:|---:|'
      : '| Año | FCLP | VP | Acumulado | Acumulado descontado |\n|---|---:|---:|---:|---:|',
    `| 0 | ${fmt(`-${metrics.initialInvestmentCop}`)} | ${fmt(`-${metrics.initialInvestmentCop}`)} | ${fmt(`-${metrics.initialInvestmentCop}`)} | ${fmt(`-${metrics.initialInvestmentCop}`)} |`,
    ...metrics.rows.map((r) => `| ${r.year} | ${fmt(r.freeCashFlowCop)} | ${fmt(r.pvCop)} | ${fmt(r.cumulativeCop)} | ${fmt(r.cumulativePvCop)} |`),
  ].join('\n');
  const npvPositive = BigInt(metrics.npvCop) > BigInt(0);
  const irrLine = metrics.irrPercent === null
    ? `N/D (${en ? metrics.irrNote?.en : metrics.irrNote?.es})`
    : `${metrics.irrPercent.toFixed(2)}% (${metrics.irrPercent > metrics.discountRatePercent ? (en ? '> rate' : '> tasa') : (en ? '≤ rate' : '≤ tasa')})`;
  const metricsTable = [
    en ? '| Metric | Value | Criterion |\n|---|---:|---|' : '| Métrica | Valor | Criterio |\n|---|---:|---|',
    `| ${en ? 'NPV' : 'VPN'} | ${fmt(metrics.npvCop)} | ${npvPositive ? (en ? 'NPV > 0 ✓' : 'VPN > 0 ✓') : (en ? 'NPV ≤ 0 ✗' : 'VPN ≤ 0 ✗')} |`,
    `| ${en ? 'IRR' : 'TIR'} | ${irrLine} | ${en ? 'IRR > rate' : 'TIR > tasa'} |`,
    `| ${en ? 'MIRR' : 'TIRM'} | ${fmtPct(metrics.mirrPercent)} | ${en ? 'reinvestment at the discount rate' : 'reinversión a la tasa de descuento'} |`,
    `| ${en ? 'Simple payback' : 'Payback simple'} | ${fmtYears(metrics.paybackYears, lang)} | — |`,
    `| ${en ? 'Discounted payback' : 'Payback descontado'} | ${fmtYears(metrics.discountedPaybackYears, lang)} | — |`,
    `| ${en ? 'Profitability index' : 'Índice de rentabilidad (IR)'} | ${metrics.profitabilityIndex === null ? 'N/D' : metrics.profitabilityIndex.toFixed(4)} | IR > 1 |`,
  ].join('\n');
  return [
    ...header,
    '',
    flowsTable,
    '',
    metricsTable,
    '',
    `**${en ? 'Modeler interpretation' : 'Interpretación del modelador'}:** ${json.projectEvaluation}`,
  ].join('\n');
}

function renderBreakEven(be: BreakEvenResult, json: FinancialModelReportJson, lang: 'es' | 'en'): string {
  const en = lang === 'en';
  const computed = be.status === 'ok'
    ? [
        `**${en ? 'Operating break-even (year 1, computed in code)' : 'Punto de equilibrio operativo (año 1, calculado en código)'}:** ${be.units.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${en ? 'units' : 'unidades'} — ${fmt(be.revenueCop)}`,
        `_${en ? 'Unit contribution margin' : 'Margen de contribución unitario'}: ${fmt(be.contributionMarginCop)}_`,
      ].join('\n')
    : `**${en ? 'Operating break-even' : 'Punto de equilibrio operativo'}:** N/D (${en ? be.reason.en : be.reason.es})`;
  return [computed, '', json.breakEvenAnalysis].join('\n');
}

export function toFinancialModelResult(
  json: FinancialModelReportJson,
  userText: string,
  lang: 'es' | 'en',
): FinancialModelResult {
  const waccCheck = recomputeWacc(json.wacc);
  const rate = decideDiscountRate(json, waccCheck, userText, lang);
  const discrepancies = [...waccCheck.discrepancies, ...rate.discrepancies];

  let metrics: ProjectMetrics | null = null;
  const unavailable: string[] = [];
  if (rate.percent === null) {
    unavailable.push(lang === 'en' ? 'no valid discount rate' : 'sin tasa de descuento válida', ...rate.notes);
  } else {
    const result = computeProjectMetrics(json.initialInvestmentCop, json.cashFlows, rate.percent);
    if (result.status === 'ok') metrics = result.metrics;
    else unavailable.push(...result.reasons.map((r) => (lang === 'en' ? r.en : r.es)));
  }
  const breakEven = computeBreakEven(
    json.breakEvenInputs.fixedCostsCop,
    json.breakEvenInputs.unitPriceCop,
    json.breakEvenInputs.unitVariableCostCop,
  );

  const capitalStructure = [renderWaccTable(waccCheck, json, lang), '', json.capitalStructure].join('\n');
  const projectEvaluation = renderEvaluation(metrics, unavailable, rate, json, lang);
  const breakEvenAnalysis = renderBreakEven(breakEven, json, lang);
  const notes = rate.percent === null ? [] : rate.notes;
  const validationReport = [
    renderDiscrepancies(discrepancies, lang),
    ...(notes.length > 0 ? ['', ...notes.map((n) => `- ${n}`)] : []),
  ].join('\n');

  const fullContent = [
    '## 1. ESTADOS FINANCIEROS PRO-FORMA',
    '',
    json.proFormaStatements,
    '',
    '## 2. ESTRUCTURA DE CAPITAL Y WACC',
    '',
    capitalStructure,
    '',
    '## 3. EVALUACION DEL PROYECTO',
    '',
    projectEvaluation,
    '',
    '## 4. ANALISIS DE SENSIBILIDAD Y ESCENARIOS',
    '',
    json.sensitivityAnalysis,
    '',
    '## 5. PUNTO DE EQUILIBRIO',
    '',
    breakEvenAnalysis,
    '',
    '## 6. VALIDACION DETERMINISTA',
    '',
    validationReport,
  ].join('\n');

  return {
    proFormaStatements: json.proFormaStatements,
    capitalStructure,
    projectEvaluation,
    sensitivityAnalysis: json.sensitivityAnalysis,
    breakEvenAnalysis,
    fullContent,
    discountRate: { percent: rate.percent, source: rate.source },
    metrics,
    metricsUnavailableReasons: unavailable,
    breakEven,
    cashFlows: json.cashFlows.map((f) => ({ year: f.year, freeCashFlowCop: f.freeCashFlowCop })),
    initialInvestmentCop: json.initialInvestmentCop,
    discrepancies,
  };
}
