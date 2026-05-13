// ---------------------------------------------------------------------------
// Agente 2: Director de Estrategia Financiera (outcome-first GPT-5.4)
// ---------------------------------------------------------------------------
// Refactor Fase 2.A (2026-05): contrato `StrategyReportSchema` + adapter
// LOCAL `toStrategicAnalysisResult` que sintetiza el struct legacy
// (Markdown) consumido por Governance Specialist, PDF Élite y Excel. En
// Fase 3 los renderers se migran a consumir el JSON directamente.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from './runtime';
import {
  StrategyReportSchema,
  type StrategyReportJson,
  type KpiJson,
  type ExecutiveDashboardRowJson,
} from '../contracts/strategy-report';
import { formatCopFromCents, parseMoneyCop } from '../contracts/money';
import {
  buildStrategyDirectorPrompt,
  type StrategyDirectorEliteContext,
} from '../prompts/strategy-director.prompt';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { ReportMode } from '../contracts/base';
import type {
  CompanyInfo,
  NiifAnalysisResult,
  StrategicAnalysisResult,
  FinancialProgressEvent,
} from '../types';

/**
 * Takes the NIIF financial statements from Agent 1 and produces KPIs,
 * break-even, cash-flow projections and strategic recommendations,
 * validated against `StrategyReportSchema`.
 *
 * @param niifOutput    Output del Agente 1 (legacy struct).
 * @param company       Metadata de la empresa.
 * @param language      es | en
 * @param instructions  Instrucciones adicionales del usuario (propagacion A2).
 * @param bindingTotals Bloque Markdown con totales vinculantes.
 * @param preprocessed  PreprocessedBalance completo (activa modo comparativo).
 * @param onProgress    Callback SSE.
 * @param elite         Contexto Élite (R-5/R-6 — verdad financiera condicionada / escenarios).
 * @param signal        AbortSignal opcional.
 * @param reportMode    Modo del reporte (v8.1 §2) — pre-derivado por
 *                      `prepareFinancialContext`. Default
 *                      `'COMPARATIVO_COMPLETO'` para backward compat. Wave 4.F5
 *                      lo cablea al `buildStrategyDirectorPrompt` para que el
 *                      prompt emita el bloque MODO DEL REPORTE y modere verbos.
 */
export async function runStrategyDirector(
  niifOutput: NiifAnalysisResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions: string | undefined,
  bindingTotals: string,
  preprocessed: PreprocessedBalance | undefined,
  onProgress?: (event: FinancialProgressEvent) => void,
  elite?: StrategyDirectorEliteContext,
  signal?: AbortSignal,
  reportMode: ReportMode = 'COMPARATIVO_COMPLETO',
): Promise<StrategicAnalysisResult> {
  const systemPrompt = buildStrategyDirectorPrompt(company, language, preprocessed, elite, reportMode);

  const userContent = [
    bindingTotals,
    '',
    'ANÁLISIS NIIF DEL AGENTE 1:',
    niifOutput.fullContent,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 2,
    detail: 'Calculando KPIs y punto de equilibrio...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'strategy-director',
    // PREMIUM (gpt-5.5): consume el JSON del NIIF Analyst y produce
    // KPIs + proyecciones — schema rico, amerita el techo amplio.
    model: MODELS.FINANCIAL_PIPELINE_PREMIUM,
    schema: StrategyReportSchema,
    system: systemPrompt,
    userContent,
    ...MODELS_CONFIG.strategyDirector,
    signal,
  });

  return toStrategicAnalysisResult(json);
}

// ---------------------------------------------------------------------------
// Adapter local privado: StrategyReportJson -> StrategicAnalysisResult legacy
// ---------------------------------------------------------------------------
// Convierte el JSON estricto en el struct Markdown que consumen Governance
// Specialist (texto), PDF Élite y Excel mientras dura la Fase 2. En Fase 3
// los consumers downstream se migran a JSON puro y este adapter desaparece.
// ---------------------------------------------------------------------------

function fmt(value: string, unit: KpiJson['unit'] = 'cop'): string {
  // Sentinel "ND" (Parte 6 spec v2.0): KPI no confiable — preservar literal.
  if (value === 'ND') return 'ND';
  if (unit === 'cop') return formatCopFromCents(parseMoneyCop(value), true);
  if (unit === 'percent') return `${value}%`;
  if (unit === 'days') return `${value} días`;
  if (unit === 'times') return `${value} veces`;
  return value;
}

/**
 * Formato compacto $X.XXX M / $X,X B para el Dashboard Ejecutivo (Parte 8.2 spec).
 * Why: el reporte C-Level necesita escaneo visual rápido — pesos crudos saturan.
 * Mantiene formato es-CO (coma decimal). El umbral B salta cuando |M| ≥ 1.000.
 */
function formatCopAsMillions(centsStr: string): string {
  const cents = parseMoneyCop(centsStr);
  const pesos = Number(cents) / 100;
  const millions = pesos / 1_000_000;
  if (Math.abs(millions) >= 1000) {
    const billones = millions / 1000;
    return `$${billones.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} B`;
  }
  return `$${millions.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 1 })} M`;
}

function renderDashboard(json: StrategyReportJson): string {
  const { executiveDashboard: dash, company } = json;
  const header = [
    '## 1. DASHBOARD EJECUTIVO',
    '',
    `**${company.name}** — NIT ${company.nit} — Periodo ${company.fiscalPeriod}`,
    '',
    '| Rubro | Periodo actual | Periodo comparativo | Variación | Variación % | Comentario |',
    '|---|---:|---:|---:|---:|---|',
  ].join('\n');
  const rows = dash.rows
    .map((r: ExecutiveDashboardRowJson) => {
      // Why: Dashboard ejecutivo usa formato compacto $X.XXX M / $X B (Parte 8.2
      // spec). La tabla detallada de KPIs y demás secciones conservan pesos
      // completos vía formatCopFromCents.
      const primary = formatCopAsMillions(r.primary);
      const comparative = r.comparative !== null
        ? formatCopAsMillions(r.comparative)
        : '—';
      const variation = r.variation !== null
        ? formatCopAsMillions(r.variation)
        : '—';
      const variationPct = r.variationPct !== null ? `${r.variationPct}%` : '—';
      return `| ${r.label} | ${primary} | ${comparative} | ${variation} | ${variationPct} | ${r.commentary} |`;
    })
    .join('\n');
  return [header, rows, '', `> ${dash.executiveCommentary}`].join('\n');
}

function renderKpis(json: StrategyReportJson): string {
  const header = [
    '## 2. KPIs FINANCIEROS',
    '',
    '| Categoría | KPI | Fórmula | Resultado | Comparativo | Banda | Variación YoY | Diagnóstico |',
    '|---|---|---|---:|---:|---|---|---|',
  ].join('\n');
  const rows = json.kpis
    .map((k) => {
      const result = fmt(k.resultPrimary, k.unit);
      const comparative = k.resultComparative !== null ? fmt(k.resultComparative, k.unit) : '—';
      const yoy = k.yoyVariation ?? '—';
      // Wave 4.F2: benchmarkBand pasó de string a objeto estructurado.
      // El adapter Markdown sólo consume `description` — las cotas
      // numéricas (lowerBound/upperBound) las usa el renderer Slide 03.
      return `| ${k.category} | ${k.name} | ${k.formula} | ${result} | ${comparative} | ${k.benchmarkBand.description} | ${yoy} | ${k.diagnosis} |`;
    })
    .join('\n');

  const dupont = json.dupontAnalysis
    ? [
        '',
        '### Análisis DuPont',
        `- ROE: ${json.dupontAnalysis.roe}%`,
        `- Margen Neto: ${json.dupontAnalysis.netMargin}%`,
        `- Rotación de Activos: ${json.dupontAnalysis.assetTurnover}`,
        `- Apalancamiento Financiero: ${json.dupontAnalysis.financialLeverage}`,
        `- Driver dominante: ${json.dupontAnalysis.drivingFactor}`,
      ].join('\n')
    : '';

  return [header, rows, dupont].filter(Boolean).join('\n');
}

function renderTrendsAndBreakEven(json: StrategyReportJson): string {
  const lines: string[] = ['## 3. ANÁLISIS DE TENDENCIAS'];
  if (json.trends) {
    lines.push('');
    if (json.trends.yoyRevenue) lines.push(`- Ingresos YoY: ${json.trends.yoyRevenue}`);
    if (json.trends.yoyEbitda) lines.push(`- EBITDA YoY: ${json.trends.yoyEbitda}`);
    if (json.trends.yoyNetIncome) lines.push(`- Utilidad Neta YoY: ${json.trends.yoyNetIncome}`);
    if (json.trends.yoyEquity) lines.push(`- Patrimonio YoY: ${json.trends.yoyEquity}`);
    if (json.trends.marginDeltaPp) lines.push(`- Δ Margen (pp): ${json.trends.marginDeltaPp}`);
    lines.push('', json.trends.qualitativeCommentary);
  } else {
    lines.push('', '_Sin periodo comparativo disponible._');
  }
  const be = json.breakEven;
  lines.push(
    '',
    '### Punto de Equilibrio (Break-Even)',
    `- Costos Fijos: ${formatCopFromCents(parseMoneyCop(be.fixedCostsCop), true)}`,
    `- Costos Variables: ${formatCopFromCents(parseMoneyCop(be.variableCostsCop), true)}`,
    `- Ingresos: ${formatCopFromCents(parseMoneyCop(be.revenueCop), true)}`,
    `- **Punto de Equilibrio**: ${formatCopFromCents(parseMoneyCop(be.breakEvenPointCop), true)}`,
    `- **Margen de Seguridad**: ${be.marginOfSafetyPct}%`,
    '',
    be.classificationNote,
  );
  return lines.join('\n');
}

function renderProjections(json: StrategyReportJson): string {
  const { projectedCashFlow: pcf } = json;
  const lines: string[] = ['## 4. PROYECCIONES'];
  lines.push('', '### 4.1 Gate de Liquidez');
  if (pcf.liquidityGate.triggered) {
    lines.push(`**Triggered:** ${pcf.liquidityGate.message ?? 'ALERTA DE LIQUIDEZ activa.'}`);
    lines.push(
      `- Activo Corriente: ${formatCopFromCents(parseMoneyCop(pcf.liquidityGate.currentAssetsCop), true)}`,
    );
    lines.push(
      `- Pasivo Corriente: ${formatCopFromCents(parseMoneyCop(pcf.liquidityGate.currentLiabilitiesCop), true)}`,
    );
    lines.push(
      `- Brecha: ${formatCopFromCents(parseMoneyCop(pcf.liquidityGate.gapCop), false)}`,
    );
    lines.push('', '_Proyección bloqueada. Resolver liquidez antes de proyectar._');
    return lines.join('\n');
  }
  lines.push('AC ≥ PC: proyección habilitada.');
  lines.push(
    '',
    '### 4.2 Saldo Inicial Depurado (PUC 11)',
    `- Saldo Inicial Caja: ${formatCopFromCents(parseMoneyCop(pcf.initialCashBalanceCop), true)}`,
    `- DSO usado: ${pcf.dsoDays} días`,
    `- Inflación aplicada: ${pcf.inflationIndexPct}%`,
  );

  for (const sc of pcf.scenarios) {
    lines.push('', `### Escenario ${sc.scenario}`);
    lines.push(`_Supuestos:_ ${sc.assumptions}`);
    lines.push('');
    lines.push('| Concepto | Actual | Año +1 | Año +2 | Año +3 |');
    lines.push('|---|---:|---:|---:|---:|');
    for (const line of sc.lines) {
      const label = line.isSubtotal ? `**${line.concept}**` : line.concept;
      const cells = [line.currentYear, line.yearPlus1, line.yearPlus2, line.yearPlus3]
        .map((v) => formatCopFromCents(parseMoneyCop(v), false))
        .join(' | ');
      lines.push(`| ${label} | ${cells} |`);
    }
    lines.push(`- Saldo Final Año +3: ${formatCopFromCents(parseMoneyCop(sc.finalCashBalanceYear3), true)}`);
  }

  lines.push('', '### 4.7 Análisis de Solvencia y Capacidad de Inversión', '', pcf.solvencyNarrative);

  if (pcf.controlKpis.length > 0) {
    lines.push('', '### 4.8 KPIs de Control de Caja', '');
    lines.push('| KPI | Año +1 | Año +2 | Año +3 |');
    lines.push('|---|---:|---:|---:|');
    for (const k of pcf.controlKpis) {
      const labelMap = {
        net_cash_margin: 'Margen de Caja Neto',
        days_of_autonomy: 'Días de Autonomía Financiera',
        cumulative_return_on_flow: 'Retorno sobre Flujo Acumulado',
      } as const;
      const suffix = k.unit === 'percent' ? '%' : ' días';
      lines.push(`| ${labelMap[k.name]} | ${k.yearPlus1}${suffix} | ${k.yearPlus2}${suffix} | ${k.yearPlus3}${suffix} |`);
    }
  }

  lines.push('', '### Supuestos de la proyección', pcf.assumptionsNote);
  return lines.join('\n');
}

function renderRecommendations(json: StrategyReportJson): string {
  const lines: string[] = ['## 5. RECOMENDACIONES ESTRATÉGICAS'];
  const priorityLabel = { high: 'Alta', medium: 'Media', low: 'Baja' } as const;
  const horizonLabel = {
    immediate: 'Inmediato (0-30 días)',
    short_term: 'Corto plazo (1-3 meses)',
    medium_term: 'Mediano plazo (3-12 meses)',
  } as const;
  json.recommendations.forEach((rec, idx) => {
    lines.push('', `### 5.${idx + 1} ${rec.title}`);
    lines.push(`- **Diagnóstico:** ${rec.diagnosis}`);
    lines.push(`- **Acción:** ${rec.action}`);
    lines.push(`- **Impacto esperado:** ${rec.expectedImpact}`);
    lines.push(`- **Prioridad:** ${priorityLabel[rec.priority]}`);
    lines.push(`- **Horizonte:** ${horizonLabel[rec.horizon]}`);
    if (rec.normReference) lines.push(`- **Referencia normativa:** ${rec.normReference}`);
  });
  return lines.join('\n');
}

function renderPresumedCostWarning(json: StrategyReportJson): string {
  const w = json.presumedCostWarning;
  if (!w) return '';
  return [
    '## 6. NOTAS INTERNAS DEL PREPARADOR (NO incluir en EEFF firmables ni en declaraciones tributarias)',
    '',
    '> ⚠️ **Advertencia interna de Valoración — Costo de Mercancía Vendida**',
    '>',
    `> Margen bruto observado: ${w.observedGrossMarginPct}% — Benchmark sector: ${w.sectorBenchmarkPct}%.`,
    `> Costo de Ventas: ${formatCopFromCents(parseMoneyCop(w.costOfSalesCop), true)} vs Ingresos: ${formatCopFromCents(parseMoneyCop(w.revenueCop), true)}.`,
    `> Inventario al cierre: ${formatCopFromCents(parseMoneyCop(w.inventoryClosingCop), true)}.`,
    '>',
    '> **Acciones requeridas antes de firmar EEFF:**',
    ...w.recommendedActions.map((a) => `> - ${a}`),
    '>',
    `> _Cita técnica:_ ${w.technicalCitation}`,
  ].join('\n');
}

function renderPreparerNotes(json: StrategyReportJson): string {
  if (json.preparerNotes.length === 0) return '';
  return [
    '### Notas del Preparador',
    ...json.preparerNotes.map((n) => `- ${n.body}${n.norma ? ` (${n.norma})` : ''}`),
  ].join('\n');
}

function toStrategicAnalysisResult(json: StrategyReportJson): StrategicAnalysisResult {
  const kpiDashboard = [renderDashboard(json), '', renderKpis(json)].join('\n');
  const trendsAndBreakEven = renderTrendsAndBreakEven(json);
  const projectedCashFlow = renderProjections(json);
  const strategicRecommendations = renderRecommendations(json);
  const warning = renderPresumedCostWarning(json);
  const preparerNotes = renderPreparerNotes(json);
  const fullContent = [
    kpiDashboard,
    '',
    trendsAndBreakEven,
    '',
    projectedCashFlow,
    '',
    strategicRecommendations,
    warning ? `\n${warning}` : '',
    preparerNotes ? `\n${preparerNotes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    kpiDashboard,
    breakEvenAnalysis: trendsAndBreakEven,
    projectedCashFlow,
    strategicRecommendations,
    fullContent,
    // Exposición del JSON estricto para consumers post-Fase-3.
    json,
  };
}
