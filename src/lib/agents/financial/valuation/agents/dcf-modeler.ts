// ---------------------------------------------------------------------------
// Agente 1a: Modelador de Flujo de Caja Descontado (GPT-5.4, JSON-strict)
// ---------------------------------------------------------------------------
//
// Output contract: `DcfModelReportSchema` (NIIF 13 + NIC 36 + Art. 90 E.T.).
// El LLM aporta SUPUESTOS; `validateDcf` (validators/dcf-validator.ts) recalcula
// Ke, WACC, FCF, TV, EV, puente a patrimonio y sensibilidad (valoracion-06/07/08).
// Renderer LOCAL: produce la estructura legacy `DcfModelResult` con las cifras
// recalculadas y una sección de validación determinista.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildDcfModelerPrompt } from '../prompts/dcf-modeler.prompt';
import { DcfModelReportSchema, type DcfModelReportJson } from '../../contracts/valuation';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import type { CompanyInfo } from '../../types';
import type { DcfModelResult, ValuationProgressEvent } from '../types';
import type { MacroSnapshot } from '../macro-context';
import { validateDcf, type DcfComputed } from '../validators/dcf-validator';
import type { ValidationDiscrepancy, ValidationIssue } from '../validators/wacc';
import { renderDiscrepancies } from '../validators/render';

/**
 * Construye el modelo DCF. Si la validación determinista bloquea (g ≥ WACC,
 * doble conteo de riesgo país, pesos ≠ 100…) devuelve `status: 'blocked'` sin
 * cifras de valor.
 */
export async function runDcfModeler(
  financialData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  purpose?: string,
  instructions?: string,
  onProgress?: (event: ValuationProgressEvent) => void,
  signal?: AbortSignal,
  macro?: MacroSnapshot | null,
): Promise<DcfModelResult> {
  const system = buildDcfModelerPrompt(company, language, purpose, macro);

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
// Adapter local: DcfModelReportJson -> DcfModelResult (cifras recalculadas)
// ---------------------------------------------------------------------------

const fmt = (v: string) => formatCopFromCents(parseMoneyCop(v), false);
const fmtPct = (v: number) => `${v.toFixed(2)}%`;

function renderProjection(json: DcfModelReportJson, c: DcfComputed, lang: 'es' | 'en'): string {
  const header = lang === 'en'
    ? '| Year | Revenue | EBITDA | EBIT | Operating tax | D&A | CAPEX | ΔWC | FCF | t | PV(FCF) |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
    : '| Año | Ingresos | EBITDA | EBIT | Impuesto operacional | D&A | CAPEX | ΔWC | FCF | t | VP(FCF) |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|';
  const rows = c.rows
    .map((r) => `| ${r.year} | ${fmt(r.revenueCop)} | ${fmt(r.ebitdaCop)} | ${fmt(r.ebitCop)} | ${fmt(r.taxCop)} | ${fmt(r.depAmortCop)} | ${fmt(r.capexCop)} | ${fmt(r.workingCapitalChangeCop)} | ${fmt(r.fcfCop)} | ${r.period} | ${fmt(r.pvFcfCop)} |`)
    .join('\n');
  const assumptions = json.projection.keyAssumptions
    .map((a) => `- ${a}`)
    .join('\n');
  return [
    header,
    rows,
    '',
    lang === 'en'
      ? `_FCF = EBIT − operating tax (t × EBIT if EBIT > 0) + D&A − CAPEX − ΔWC; PV at WACC ${fmtPct(c.wacc.waccPercent)}, end-of-year convention. Figures recomputed in code._`
      : `_FCF = EBIT − impuesto operacional (t × EBIT si EBIT > 0) + D&A − CAPEX − ΔWC; VP al WACC ${fmtPct(c.wacc.waccPercent)}, convención de fin de año. Cifras recalculadas en código._`,
    '',
    `**${lang === 'en' ? 'Key assumptions' : 'Supuestos clave'}:**`,
    assumptions || (lang === 'en' ? '_None._' : '_Ninguno._'),
  ].join('\n');
}

function renderWacc(json: DcfModelReportJson, c: DcfComputed, lang: 'es' | 'en'): string {
  const w = json.wacc;
  const en = lang === 'en';
  const isUsd = w.riskFreeBasis === 'UST_USD_fisher';
  const lines = [en ? '| Component | Value |\n|---|---:|' : '| Componente | Valor |\n|---|---:|'];
  if (isUsd) {
    lines.push(`| Rf (UST 10Y USD) | ${fmtPct(c.wacc.riskFreeRatePercent)} |`);
  } else {
    if (w.sovereignYieldPercent !== null) {
      lines.push(`| ${en ? 'TES 10Y COP (gross)' : 'TES 10Y COP (bruto)'} | ${fmtPct(w.sovereignYieldPercent)} |`);
    }
    if (w.defaultSpreadPercent !== null) {
      lines.push(`| ${en ? '− Sovereign default spread' : '− Diferencial soberano'} | ${fmtPct(w.defaultSpreadPercent)} |`);
    }
    lines.push(`| Rf (${en ? 'TES COP net of default spread' : 'TES COP neto del diferencial soberano'}) | ${fmtPct(c.wacc.riskFreeRatePercent)} |`);
  }
  lines.push(
    `| CRP (${en ? 'country risk premium' : 'prima riesgo país'}) | ${fmtPct(w.countryRiskPremiumPercent)} |`,
    `| ERP (${en ? 'mature market' : 'mercado maduro'}) | ${fmtPct(w.equityRiskPremiumPercent)} |`,
    `| Beta | ${w.beta.toFixed(2)} |`,
    `| Size Premium | ${fmtPct(w.sizePremiumPercent)} |`,
  );
  if (isUsd && c.wacc.costOfEquityUsdPercent !== null) {
    lines.push(
      `| Ke USD | ${fmtPct(c.wacc.costOfEquityUsdPercent)} |`,
      `| ${en ? 'COP inflation' : 'Inflación COP'} | ${fmtPct(w.copInflationPercent ?? 0)} |`,
      `| ${en ? 'USD inflation' : 'Inflación USD'} | ${fmtPct(w.usdInflationPercent ?? 0)} |`,
    );
  }
  lines.push(
    `| **Ke COP (CAPM${isUsd ? ' + Fisher' : ''})** | **${fmtPct(c.wacc.costOfEquityPercent)}** |`,
    `| Kd | ${fmtPct(w.costOfDebtPercent)} |`,
    `| t (${en ? 'tax rate' : 'tarifa impositiva'}) | ${fmtPct(w.taxRatePercent)} |`,
    `| Kd × (1 − t) | ${fmtPct(c.wacc.afterTaxCostOfDebtPercent)} |`,
    `| E/V | ${fmtPct(w.equityWeightPercent)} |`,
    `| D/V | ${fmtPct(w.debtWeightPercent)} |`,
    `| **WACC** | **${fmtPct(c.wacc.waccPercent)}** |`,
    '',
    `**${en ? 'Market data source and cut-off date' : 'Fuente y fecha de corte de parámetros de mercado'}:** ${w.marketDataProvenance}`,
    '',
    w.rationale,
  );
  return lines.join('\n');
}

function renderTerminalValue(json: DcfModelReportJson, c: DcfComputed, lang: 'es' | 'en'): string {
  const en = lang === 'en';
  const tvPct = c.terminalValuePercentOfEv;
  const flag = tvPct !== null && tvPct > 75
    ? ` _(${en ? 'excessive dependency — flagged' : 'dependencia excesiva — bandera levantada'})_`
    : '';
  return [
    `**FCF(n+1) = FCF(n) × (1 + g):** ${fmt(c.nextYearFcfCop)}`,
    `**g (${en ? 'perpetual growth' : 'crecimiento perpetuo'}):** ${fmtPct(c.growthPercent)}`,
    `**WACC:** ${fmtPct(c.wacc.waccPercent)}`,
    `**TV = FCF(n+1) / (WACC − g) = ${fmt(c.terminalValueCop)}**`,
    `**${en ? 'PV(TV)' : 'VP(TV)'}:** ${fmt(c.pvTerminalValueCop)}`,
    `**${en ? 'PV(TV) / EV' : 'VP(TV) / EV'} = ${tvPct === null ? 'N/D' : `${tvPct.toFixed(1)}%`}**${flag}`,
    '',
    json.terminalValue.rationale,
  ].join('\n');
}

function renderValuation(c: DcfComputed, lang: 'es' | 'en'): string {
  const en = lang === 'en';
  const lines = [
    `**${en ? 'Σ PV(FCF)' : 'Σ VP(FCF)'}:** ${fmt(c.sumPvFcfCop)}`,
    `**${en ? 'PV(TV)' : 'VP(TV)'}:** ${fmt(c.pvTerminalValueCop)}`,
    `**Enterprise Value:** ${fmt(c.enterpriseValueCop)}`,
  ];
  if (c.financialDebtCop !== null) lines.push(`**${en ? 'Financial debt' : 'Deuda financiera'}:** ${fmt(c.financialDebtCop)}`);
  if (c.cashAndEquivalentsCop !== null) lines.push(`**${en ? 'Cash and equivalents' : 'Efectivo y equivalentes'}:** ${fmt(c.cashAndEquivalentsCop)}`);
  lines.push(
    `**${en ? 'Net Debt' : 'Deuda Neta'}${c.netDebtDerived ? (en ? ' (= debt − cash)' : ' (= deuda − efectivo)') : ''}:** ${fmt(c.netDebtCop)}`,
  );
  if (c.otherBridgeAdjustmentsCop !== null) {
    lines.push(`**${en ? 'Other bridge adjustments (net)' : 'Otros ajustes del puente (netos)'}:** ${fmt(c.otherBridgeAdjustmentsCop)}`);
  }
  lines.push(
    `**Equity Value = EV − ${en ? 'Net Debt' : 'Deuda Neta'}${c.otherBridgeAdjustmentsCop !== null ? (en ? ' + adjustments' : ' + ajustes') : ''}:** ${fmt(c.equityValueCop)}`,
    c.pricePerShareCop !== null && c.sharesOutstanding !== null
      ? `**${en ? 'Price per share' : 'Precio por acción'} (${c.sharesOutstanding.toLocaleString('es-CO')} ${en ? 'shares' : 'acciones'}):** ${fmt(c.pricePerShareCop)}`
      : `**${en ? 'Price per share' : 'Precio por acción'}:** N/D (${en ? 'no share count in the data' : 'sin número de acciones en los datos'})`,
    `**${en ? 'DCF equity range (sensitivity)' : 'Rango de patrimonio DCF (sensibilidad)'}:** ${fmt(c.equityRange.lowCop)} – ${fmt(c.equityRange.highCop)}`,
  );
  return lines.join('\n');
}

function renderSensitivity(c: DcfComputed, lang: 'es' | 'en'): string {
  const s = c.sensitivity;
  const lookup = new Map<string, string | null>();
  for (const cell of s.cells) lookup.set(`${cell.waccPercent}|${cell.growthPercent}`, cell.enterpriseValueCop);
  const headerCells = ['WACC \\ g', ...s.growths.map((g) => fmtPct(g))];
  const sep = headerCells.map(() => '---').join('|');
  const bodyRows = s.waccs
    .map((w) => {
      const cells = [
        fmtPct(w),
        ...s.growths.map((g) => {
          const v = lookup.get(`${w}|${g}`);
          return v ? fmt(v) : 'N/A (g ≥ WACC)';
        }),
      ];
      return `| ${cells.join(' | ')} |`;
    })
    .join('\n');
  return [
    lang === 'en' ? '_Enterprise Value by WACC × g, computed in code._' : '_Enterprise Value por WACC × g, calculado en código._',
    '',
    `| ${headerCells.join(' | ')} |`,
    `| ${sep} |`,
    bodyRows,
    '',
    `**${lang === 'en' ? 'Base case' : 'Escenario base'}:** WACC = ${fmtPct(c.wacc.waccPercent)} / g = ${fmtPct(c.growthPercent)}`,
  ].join('\n');
}

function renderValidation(
  discrepancies: ValidationDiscrepancy[],
  notes: ValidationIssue[],
  lang: 'es' | 'en',
): string {
  return [
    lang === 'en'
      ? 'All figures in sections 1-5 were recomputed in code from the model assumptions (Ke, WACC, FCF, TV, discount factors, EV, equity bridge and sensitivity). Differences above max($1; 0.1%) or 0.01 pp are listed below; the published figure is always the recomputed one.'
      : 'Todas las cifras de las secciones 1-5 se recalcularon en código a partir de los supuestos del modelo (Ke, WACC, FCF, TV, factores de descuento, EV, puente a patrimonio y sensibilidad). Se listan las diferencias superiores a max($1; 0,1%) o 0,01 pp; la cifra publicada es siempre la recalculada.',
    '',
    renderDiscrepancies(discrepancies, lang),
    ...(notes.length > 0 ? ['', ...notes.map((n) => `- ${lang === 'en' ? n.en : n.es}`)] : []),
  ].join('\n');
}

function renderLimitations(json: DcfModelReportJson, lang: 'es' | 'en'): string {
  return json.limitations.length > 0
    ? `\n\n**${lang === 'en' ? 'Limitations' : 'Limitaciones'}:**\n${json.limitations.map((l) => `- ${l}`).join('\n')}`
    : '';
}

export function toDcfModelResult(json: DcfModelReportJson, lang: 'es' | 'en'): DcfModelResult {
  const validation = validateDcf(json);

  if (validation.status === 'blocked') {
    const reasons = validation.blockingErrors.map((e) => (lang === 'en' ? e.en : e.es));
    const validationReport = [
      lang === 'en'
        ? '**DCF NOT ISSUABLE** — the deterministic validation blocked the model:'
        : '**DCF NO EMITIBLE** — la validación determinista bloqueó el modelo:',
      ...reasons.map((r) => `- ${r}`),
      '',
      renderDiscrepancies(validation.discrepancies, lang),
    ].join('\n');
    const fullContent = [
      lang === 'en' ? '## DCF NOT ISSUABLE' : '## DCF NO EMITIBLE',
      validationReport,
      renderLimitations(json, lang),
    ]
      .filter(Boolean)
      .join('\n');
    return {
      cashFlowProjections: '',
      waccCalculation: '',
      terminalValue: '',
      valuationSummary: '',
      sensitivityAnalysis: '',
      validationReport,
      fullContent,
      status: 'blocked',
      blockingReasons: reasons,
      computed: null,
      discrepancies: validation.discrepancies,
    };
  }

  const c = validation.computed;
  const cashFlowProjections = renderProjection(json, c, lang);
  const waccCalculation = renderWacc(json, c, lang);
  const terminalValue = renderTerminalValue(json, c, lang);
  const valuationSummary = renderValuation(c, lang);
  const sensitivityAnalysis = renderSensitivity(c, lang);
  const validationReport = renderValidation(validation.discrepancies, validation.notes, lang);

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
    '',
    '## 6. VALIDACIÓN DETERMINISTA',
    validationReport,
    renderLimitations(json, lang),
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
    validationReport,
    fullContent,
    status: 'ok',
    blockingReasons: [],
    computed: c,
    discrepancies: validation.discrepancies,
  };
}
