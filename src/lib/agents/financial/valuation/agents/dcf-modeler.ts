// ---------------------------------------------------------------------------
// Agente 1a: Modelador de Flujo de Caja Descontado (GPT-5.4, JSON-strict)
// ---------------------------------------------------------------------------
//
// Output contract: `DcfModelReportSchema` (NIIF 13 + NIC 36 + Art. 90 E.T.).
// Renderer LOCAL: produce la estructura legacy `DcfModelResult`.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildDcfModelerPrompt } from '../prompts/dcf-modeler.prompt';
import { DcfModelReportSchema, type DcfModelReportJson } from '../../contracts/valuation';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import type { CompanyInfo } from '../../types';
import type { DcfModelResult, ValuationProgressEvent } from '../types';

/**
 * Construye el modelo DCF y devuelve enterprise value, equity value, WACC y
 * sensibilidad — todo validado contra Zod.
 */
export async function runDcfModeler(
  financialData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  purpose?: string,
  instructions?: string,
  onProgress?: (event: ValuationProgressEvent) => void,
  signal?: AbortSignal,
): Promise<DcfModelResult> {
  const system = buildDcfModelerPrompt(company, language, purpose);

  const userContent = [
    'DATOS FINANCIEROS PARA VALORACIÓN DCF:',
    '',
    financialData,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({
    type: 'agent_progress',
    agent: 'dcf',
    detail: 'Proyectando FCF, calculando WACC y valor terminal (NIIF 13 / NIC 36)...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'dcf-modeler',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: DcfModelReportSchema,
    system,
    userContent,
    ...MODELS_CONFIG.dcfModeler,
    signal,
  });

  return toDcfModelResult(json, language);
}

// ---------------------------------------------------------------------------
// Adapter local: DcfModelReportJson -> DcfModelResult legacy
// ---------------------------------------------------------------------------

function renderProjection(json: DcfModelReportJson, lang: 'es' | 'en'): string {
  const fmt = (v: string) => formatCopFromCents(parseMoneyCop(v), false);
  const header = lang === 'en'
    ? '| Year | Revenue | EBITDA | EBIT | Taxes | D&A | CAPEX | ΔWC | FCF |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|'
    : '| Año | Ingresos | EBITDA | EBIT | Impuestos | D&A | CAPEX | ΔWC | FCF |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|';
  const rows = json.projection.rows
    .map((r) => `| ${r.year} | ${fmt(r.revenueCop)} | ${fmt(r.ebitdaCop)} | ${fmt(r.ebitCop)} | ${fmt(r.taxCop)} | ${fmt(r.depAmortCop)} | ${fmt(r.capexCop)} | ${fmt(r.workingCapitalChangeCop)} | ${fmt(r.fcfCop)} |`)
    .join('\n');
  const assumptions = json.projection.keyAssumptions
    .map((a) => `- ${a}`)
    .join('\n');
  return [
    header,
    rows,
    '',
    `**${lang === 'en' ? 'Key assumptions' : 'Supuestos clave'}:**`,
    assumptions || (lang === 'en' ? '_None._' : '_Ninguno._'),
  ].join('\n');
}

function renderWacc(json: DcfModelReportJson, lang: 'es' | 'en'): string {
  const w = json.wacc;
  const fmtPct = (v: number) => `${v.toFixed(2)}%`;
  return [
    lang === 'en'
      ? '| Component | Value |\n|---|---:|'
      : '| Componente | Valor |\n|---|---:|',
    `| Rf (TES 10Y) | ${fmtPct(w.riskFreeRatePercent)} |`,
    `| CRP (EMBI Colombia) | ${fmtPct(w.countryRiskPremiumPercent)} |`,
    `| ERP (mercado) | ${fmtPct(w.equityRiskPremiumPercent)} |`,
    `| Beta | ${w.beta.toFixed(2)} |`,
    `| Size Premium | ${fmtPct(w.sizePremiumPercent)} |`,
    `| **Ke (CAPM)** | **${fmtPct(w.costOfEquityPercent)}** |`,
    `| Kd | ${fmtPct(w.costOfDebtPercent)} |`,
    `| t (${lang === 'en' ? 'tax rate' : 'tarifa impositiva'}) | ${fmtPct(w.taxRatePercent)} |`,
    `| E/V | ${fmtPct(w.equityWeightPercent)} |`,
    `| D/V | ${fmtPct(w.debtWeightPercent)} |`,
    `| **WACC** | **${fmtPct(w.waccPercent)}** |`,
    '',
    w.rationale,
  ].join('\n');
}

function renderTerminalValue(json: DcfModelReportJson, lang: 'es' | 'en'): string {
  const t = json.terminalValue;
  return [
    `**FCF(n+1):** ${formatCopFromCents(parseMoneyCop(t.nextYearFcfCop), false)}`,
    `**g (${lang === 'en' ? 'perpetual growth' : 'crecimiento perpetuo'}):** ${t.perpetualGrowthPercent.toFixed(2)}%`,
    `**WACC:** ${t.waccPercent.toFixed(2)}%`,
    `**TV = FCF(n+1) / (WACC − g) = ${formatCopFromCents(parseMoneyCop(t.terminalValueCop), false)}**`,
    `**TV / EV = ${t.terminalValuePercentOfTotal.toFixed(1)}%** ${t.terminalValuePercentOfTotal > 75 ? `_(${lang === 'en' ? 'excessive dependency — flagged' : 'dependencia excesiva — bandera levantada'})_` : ''}`,
    '',
    t.rationale,
  ].join('\n');
}

function renderValuation(json: DcfModelReportJson, lang: 'es' | 'en'): string {
  const v = json.valuation;
  const fmt = (s: string) => formatCopFromCents(parseMoneyCop(s), false);
  return [
    `**Enterprise Value:** ${fmt(v.enterpriseValueCop)}`,
    `**${lang === 'en' ? 'Net Debt' : 'Deuda Neta'}:** ${fmt(v.netDebtCop)}`,
    `**Equity Value:** ${fmt(v.equityValueCop)}`,
    v.pricePerShareCop ? `**${lang === 'en' ? 'Price per share' : 'Precio por acción'}:** ${fmt(v.pricePerShareCop)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function renderSensitivity(json: DcfModelReportJson, lang: 'es' | 'en'): string {
  const s = json.sensitivity;
  // Agrupamos celdas en grid WACC x g
  const waccs = Array.from(new Set(s.cells.map((c) => c.waccPercent))).sort((a, b) => a - b);
  const gs = Array.from(new Set(s.cells.map((c) => c.growthPercent))).sort((a, b) => a - b);
  const lookup = new Map<string, string>();
  for (const c of s.cells) {
    lookup.set(`${c.waccPercent}|${c.growthPercent}`, c.enterpriseValueCop);
  }
  const headerCells = ['WACC \\ g', ...gs.map((g) => `${g.toFixed(2)}%`)];
  const sep = headerCells.map(() => '---').join('|');
  const headerRow = `| ${headerCells.join(' | ')} |`;
  const bodyRows = waccs
    .map((w) => {
      const cells = [
        `${w.toFixed(2)}%`,
        ...gs.map((g) => {
          const v = lookup.get(`${w}|${g}`);
          return v ? formatCopFromCents(parseMoneyCop(v), false) : '—';
        }),
      ];
      return `| ${cells.join(' | ')} |`;
    })
    .join('\n');
  return [
    headerRow,
    `| ${sep} |`,
    bodyRows,
    '',
    `**${lang === 'en' ? 'Base case' : 'Escenario base'}:** WACC = ${s.baseCaseWaccPercent.toFixed(2)}% / g = ${s.baseCaseGrowthPercent.toFixed(2)}%`,
  ].join('\n');
}

function toDcfModelResult(json: DcfModelReportJson, lang: 'es' | 'en'): DcfModelResult {
  const cashFlowProjections = renderProjection(json, lang);
  const waccCalculation = renderWacc(json, lang);
  const terminalValue = renderTerminalValue(json, lang);
  const valuationSummary = renderValuation(json, lang);
  const sensitivityAnalysis = renderSensitivity(json, lang);

  const limitations = json.limitations.length > 0
    ? `\n\n**${lang === 'en' ? 'Limitations' : 'Limitaciones'}:**\n${json.limitations.map((l) => `- ${l}`).join('\n')}`
    : '';

  const fullContent = [
    '## 1. PROYECCIÓN DE FLUJOS DE CAJA LIBRE',
    cashFlowProjections,
    '',
    '## 2. CÁLCULO DEL WACC',
    waccCalculation,
    '',
    '## 3. VALOR TERMINAL',
    terminalValue,
    '',
    '## 4. VALORACIÓN DCF',
    valuationSummary,
    '',
    '## 5. ANÁLISIS DE SENSIBILIDAD',
    sensitivityAnalysis,
    limitations,
    '',
    json.citations.length > 0 ? `_${lang === 'en' ? 'Citations' : 'Citas'}: ${json.citations.join(' · ')}_` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    cashFlowProjections,
    waccCalculation,
    terminalValue,
    valuationSummary,
    sensitivityAnalysis,
    fullContent,
  };
}
