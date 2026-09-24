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
import { buildDegradationNotice } from './reconcile-anchors';
import {
  deterministicTrends,
  fmtTrendPct,
  strategyAnchorSources,
} from '../validators/strategy-anchors';
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

  // Degradación visible (pipeline-flujo-15): `callFinancialAgent` baja el
  // esfuerzo de razonamiento cuando el primer intento no produce salida. El
  // aviso se reenvía como progreso y la sección viaja marcada en el cuerpo.
  const result = await callFinancialAgent({
    agentName: 'strategy-director',
    // PREMIUM (gpt-5.5): consume el JSON del NIIF Analyst y produce
    // KPIs + proyecciones — schema rico, amerita el techo amplio.
    model: MODELS.FINANCIAL_PIPELINE_PREMIUM,
    schema: StrategyReportSchema,
    system: systemPrompt,
    userContent,
    ...MODELS_CONFIG.strategyDirector,
    signal,
    onDegraded: (info) => onProgress?.({ type: 'stage_progress', stage: 2, detail: info.message }),
  });

  const verified = reconcileStrategyReport(result.json, strategyAnchorsFrom(preprocessed));
  applyDeterministicTrends(verified, preprocessed);
  const strategic = toStrategicAnalysisResult(verified.json, verified.checks);
  if (result.meta?.degraded === true) {
    const notice = buildDegradationNotice(
      [language === 'es' ? 'Análisis estratégico (Parte II)' : 'Strategic analysis (Part II)'],
      language,
    );
    strategic.degraded = true;
    strategic.kpiDashboard = `${notice}\n${strategic.kpiDashboard}`;
    strategic.fullContent = `${notice}\n${strategic.fullContent}`;
  }
  return strategic;
}

// ---------------------------------------------------------------------------
// Post-procesador determinista (auditoría 2026-09, valoracion-12)
// ---------------------------------------------------------------------------
// La puerta de liquidez (AC < PC ⇒ sin escenarios), el punto de equilibrio y la
// aritmética de los escenarios vivían sólo en el prompt: con triggered=false y
// AC 100M < PC 300M se publicaba "AC ≥ PC: proyección habilitada", y con costos
// variables mayores que los ingresos se publicaba un PE "positivo" con margen
// de seguridad de 300 %. Aquí se recalculan en centavos (BigInt) desde los
// totales vinculantes; el LLM conserva el juicio (clasificación CF/CV,
// supuestos), no la aritmética.
// ---------------------------------------------------------------------------

const ZERO = BigInt(0);

interface StrategyAnchors {
  activoCorrienteCents: bigint | null;
  pasivoCorrienteCents: bigint | null;
  efectivoCuenta11Cents: bigint | null;
}

export interface StrategyChecks {
  /** Motivo por el que el punto de equilibrio no existe; null si se calculó. */
  breakEvenUndefinedReason: string | null;
  /** Observaciones visibles por escenario (conciliación de la tabla). */
  scenarioIssues: Record<string, string[]>;
  /**
   * Procedencia de las tendencias (e2e-niif-14/-17): 'deterministic' cuando
   * las variaciones se calcularon desde las anclas de ambos cortes.
   */
  trendsSource?: 'deterministic';
  /** Motivo de las tendencias N/D (base cero, comparativo de apertura…). */
  trendsNdMotivo?: string | null;
  /** Por qué no hay tendencias (sin comparativo / comparativo impracticable). */
  noTrendsReason?: string | null;
}

function pesosToCents(v: unknown): bigint | null {
  return typeof v === 'number' && Number.isFinite(v) ? BigInt(Math.round(v * 100)) : null;
}

function strategyAnchorsFrom(preprocessed: PreprocessedBalance | undefined): StrategyAnchors | null {
  const ct = preprocessed?.primary?.controlTotals;
  if (!ct) return null;
  return {
    activoCorrienteCents: pesosToCents(ct.activoCorriente),
    pasivoCorrienteCents: pesosToCents(ct.pasivoCorriente),
    efectivoCuenta11Cents: ct.cents?.efectivoCuenta11 ?? pesosToCents(ct.efectivoCuenta11),
  };
}

/** División BigInt redondeada al entero más cercano (mitad hacia afuera). */
function divRound(num: bigint, den: bigint): bigint {
  const neg = (num < ZERO) !== (den < ZERO);
  const n = num < ZERO ? -num : num;
  const d = den < ZERO ? -den : den;
  const q = (n * BigInt(2) + d) / (BigInt(2) * d);
  return neg ? -q : q;
}

function fmtSigned(cents: bigint): string {
  return formatCopFromCents(cents, false);
}

export function reconcileStrategyReport(
  input: StrategyReportJson,
  anchors: StrategyAnchors | null,
): { json: StrategyReportJson; checks: StrategyChecks } {
  const json: StrategyReportJson = structuredClone(input);
  const checks: StrategyChecks = { breakEvenUndefinedReason: null, scenarioIssues: {} };
  const pcf = json.projectedCashFlow;

  // -- Puerta de liquidez: AC y PC vinculantes → triggered, brecha, mensaje --
  const ac = anchors?.activoCorrienteCents ?? parseMoneyCop(pcf.liquidityGate.currentAssetsCop);
  const pc = anchors?.pasivoCorrienteCents ?? parseMoneyCop(pcf.liquidityGate.currentLiabilitiesCop);
  const gap = ac - pc;
  const triggered = ac < pc;
  pcf.liquidityGate = {
    triggered,
    currentAssetsCop: ac.toString(10),
    currentLiabilitiesCop: pc.toString(10),
    gapCop: gap.toString(10),
    message: triggered
      ? `ALERTA DE LIQUIDEZ: AC (${fmtSigned(ac)}) < PC (${fmtSigned(pc)}). Brecha: ${fmtSigned(gap)}. ` +
        'NO se proyecta flujo hasta resolver esta inconsistencia.'
      : null,
  };
  if (triggered) {
    pcf.scenarios = [];
    pcf.controlKpis = [];
  }
  if (anchors?.efectivoCuenta11Cents !== null && anchors?.efectivoCuenta11Cents !== undefined) {
    pcf.initialCashBalanceCop = anchors.efectivoCuenta11Cents.toString(10);
  }

  // -- Punto de equilibrio: PE = CF / (1 − CV/I) = CF · I / (I − CV) ---------
  const be = json.breakEven;
  const cf = parseMoneyCop(be.fixedCostsCop);
  const cv = parseMoneyCop(be.variableCostsCop);
  const ing = parseMoneyCop(be.revenueCop);
  const contribution = ing - cv;
  if (ing <= ZERO || contribution <= ZERO || cf < ZERO) {
    checks.breakEvenUndefinedReason =
      ing <= ZERO
        ? 'sin ingresos del periodo no hay punto de equilibrio'
        : contribution <= ZERO
          ? 'los costos variables igualan o superan los ingresos (margen de contribución ≤ 0): ningún nivel de ventas cubre los costos fijos'
          : 'costos fijos negativos: la clasificación de costos no es válida';
    // El PE no existe: no se conserva la cifra que emitió el LLM (valoracion-12).
    be.breakEvenPointCop = null;
    be.marginOfSafetyPct = 'ND';
    be.classificationNote = `Punto de equilibrio N/D: ${checks.breakEvenUndefinedReason}. ${be.classificationNote}`;
  } else {
    const pe = divRound(cf * ing, contribution);
    be.breakEvenPointCop = pe.toString(10);
    // Margen de seguridad = (I − PE) / I × 100, en centésimas de punto.
    const bps = divRound((ing - pe) * BigInt(10000), ing);
    be.marginOfSafetyPct = (Number(bps) / 100).toFixed(2);
  }

  // -- Escenarios: resumen = tabla; saldo final = anterior + flujo neto -------
  for (const sc of pcf.scenarios) {
    const issues: string[] = [];
    const saldo = sc.lines.find((l) => /saldo\s+final/i.test(l.concept));
    const flujo = sc.lines.find((l) => /flujo\s+(de\s+caja\s+)?neto/i.test(l.concept));
    if (saldo) {
      const tableY3 = saldo.yearPlus3;
      if (tableY3 !== sc.finalCashBalanceYear3) {
        issues.push(
          `El saldo final del año +3 del resumen (${fmtSigned(parseMoneyCop(sc.finalCashBalanceYear3))}) ` +
            `difería de la tabla; se presenta el de la tabla.`,
        );
        sc.finalCashBalanceYear3 = tableY3;
      }
      if (flujo) {
        const s = [saldo.currentYear, saldo.yearPlus1, saldo.yearPlus2, saldo.yearPlus3].map(parseMoneyCop);
        const f = [flujo.currentYear, flujo.yearPlus1, flujo.yearPlus2, flujo.yearPlus3].map(parseMoneyCop);
        for (let y = 1; y <= 3; y++) {
          const expected = s[y - 1] + f[y];
          if (s[y] !== expected) {
            issues.push(
              `La tabla no concilia en el Año +${y}: saldo final ${fmtSigned(s[y])} ≠ saldo anterior ` +
                `${fmtSigned(s[y - 1])} + flujo neto ${fmtSigned(f[y])} (brecha ${fmtSigned(s[y] - expected)}).`,
            );
          }
        }
      } else {
        issues.push('Sin renglón de flujo neto: no se pudo verificar la conciliación de saldos.');
      }
      const initial = parseMoneyCop(pcf.initialCashBalanceCop);
      if (parseMoneyCop(saldo.currentYear) !== initial) {
        issues.push(
          `El saldo de caja actual de la tabla (${fmtSigned(parseMoneyCop(saldo.currentYear))}) no coincide ` +
            `con el efectivo PUC 11 (${fmtSigned(initial)}).`,
        );
      }
    } else {
      issues.push('Sin renglón de saldo final de caja: el escenario no se pudo conciliar.');
    }
    if (issues.length > 0) checks.scenarioIssues[sc.scenario] = issues;
  }

  return { json, checks };
}

// ---------------------------------------------------------------------------
// Tendencias deterministas (e2e-niif-14 / e2e-niif-17)
// ---------------------------------------------------------------------------
// Las variaciones interanuales son aritmética pura de dos cortes que el
// preprocesador ya conoce: el código las produce y el modelo sólo redacta el
// comentario. Con comparativo, cada variación es la determinista (o N/D con
// motivo cuando no hay base); el Δ de margen, cuyo margen no está definido, no
// se imprime como cifra. Sin comparativo no hay tendencias, las haya escrito o
// no el modelo. Antes: con trends=null se imprimía "Sin periodo comparativo
// disponible" en un informe "2025 vs 2024", y una tendencia "+33,3 %" de una
// pérdida que pasó de −$30M a −$40M salía como verificada.
// ---------------------------------------------------------------------------

function applyDeterministicTrends(
  verified: { json: StrategyReportJson; checks: StrategyChecks },
  preprocessed: PreprocessedBalance | undefined,
): void {
  if (!preprocessed?.primary) return; // sin anclas no se sustituye nada
  const { json, checks } = verified;
  const sources = strategyAnchorSources(preprocessed, null);
  if (!sources.comparative) {
    json.trends = null;
    checks.noTrendsReason =
      preprocessed.comparative && preprocessed.comparativos_impracticables === true
        ? 'Comparativo impracticable (NIIF para las PYMES 3.14 / 10.21): no se presentan variaciones interanuales.'
        : 'Sin periodo comparativo disponible.';
    return;
  }
  const t = deterministicTrends(sources);
  const fmtOrNd = (v: number | null | undefined) => (typeof v === 'number' ? fmtTrendPct(v) : 'N/D');
  const periods = `${sources.primary?.period ?? ''} vs ${sources.comparative.period ?? ''}`.trim();
  json.trends = {
    yoyRevenue: fmtOrNd(t.revenue),
    yoyEbitda: fmtOrNd(t.ebitda),
    yoyNetIncome: fmtOrNd(t.netIncome),
    yoyEquity: fmtOrNd(t.equity),
    marginDeltaPp: json.trends?.marginDeltaPp ? 'N/D' : null,
    qualitativeCommentary:
      json.trends?.qualitativeCommentary?.trim() ||
      `Periodo ${periods}: el análisis no redactó comentario sobre las variaciones.`,
  };
  checks.trendsSource = 'deterministic';
  checks.trendsNdMotivo = t.motivo;
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
  // Con signo (valoracion-11): un capital de trabajo negativo no es positivo.
  if (unit === 'cop') return formatCopFromCents(parseMoneyCop(value), false);
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

/** Porcentaje decimal ("12.5") → es-CO ("12,50%"); 'ND' → 'N/D'. */
function fmtPctField(v: string): string {
  if (v === 'ND') return 'N/D';
  const n = Number(v.replace(',', '.'));
  if (!Number.isFinite(n)) return `${v}%`;
  return `${n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function renderTrendsAndBreakEven(json: StrategyReportJson, checks?: StrategyChecks): string {
  const lines: string[] = ['## 3. ANÁLISIS DE TENDENCIAS'];
  if (json.trends) {
    lines.push('');
    if (json.trends.yoyRevenue) lines.push(`- Ingresos YoY: ${json.trends.yoyRevenue}`);
    if (json.trends.yoyEbitda) lines.push(`- EBITDA YoY: ${json.trends.yoyEbitda}`);
    if (json.trends.yoyNetIncome) lines.push(`- Utilidad Neta YoY: ${json.trends.yoyNetIncome}`);
    if (json.trends.yoyEquity) lines.push(`- Patrimonio YoY: ${json.trends.yoyEquity}`);
    if (json.trends.marginDeltaPp) lines.push(`- Δ Margen (pp): ${json.trends.marginDeltaPp}`);
    if (checks?.trendsSource === 'deterministic') {
      lines.push(
        '',
        `_Variaciones calculadas por el sistema desde el balance preprocesado de ambos periodos: ` +
          `(actual − comparativo) / |comparativo|.${checks.trendsNdMotivo ? ` N/D: ${checks.trendsNdMotivo}.` : ''}` +
          `${json.trends.marginDeltaPp === 'N/D' ? ' Δ margen: N/D (margen no definido por el modelo).' : ''}_`,
      );
    }
    lines.push('', json.trends.qualitativeCommentary);
  } else {
    lines.push('', `_${checks?.noTrendsReason ?? 'Sin periodo comparativo disponible.'}_`);
  }
  const be = json.breakEven;
  lines.push(
    '',
    '### Punto de Equilibrio (Break-Even)',
    `- Costos Fijos: ${formatCopFromCents(parseMoneyCop(be.fixedCostsCop), false)}`,
    `- Costos Variables: ${formatCopFromCents(parseMoneyCop(be.variableCostsCop), false)}`,
    `- Ingresos: ${formatCopFromCents(parseMoneyCop(be.revenueCop), false)}`,
    `- **Punto de Equilibrio**: ${
      checks?.breakEvenUndefinedReason
        ? `N/D (${checks.breakEvenUndefinedReason})`
        : be.breakEvenPointCop === null
          ? 'N/D'
          : formatCopFromCents(parseMoneyCop(be.breakEvenPointCop), false)
    }`,
    `- **Margen de Seguridad**: ${fmtPctField(be.marginOfSafetyPct)}`,
    '',
    be.classificationNote,
  );
  return lines.join('\n');
}

function renderProjections(json: StrategyReportJson, checks?: StrategyChecks): string {
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
    `- Saldo Inicial Caja: ${formatCopFromCents(parseMoneyCop(pcf.initialCashBalanceCop), false)}`,
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
    lines.push(`- Saldo Final Año +3: ${formatCopFromCents(parseMoneyCop(sc.finalCashBalanceYear3), false)}`);
    for (const issue of checks?.scenarioIssues[sc.scenario] ?? []) {
      lines.push(`> ⚠ ${issue}`);
    }
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
    `> Costo de Ventas: ${formatCopFromCents(parseMoneyCop(w.costOfSalesCop), false)} vs Ingresos: ${formatCopFromCents(parseMoneyCop(w.revenueCop), false)}.`,
    `> Inventario al cierre: ${formatCopFromCents(parseMoneyCop(w.inventoryClosingCop), false)}.`,
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

function toStrategicAnalysisResult(
  json: StrategyReportJson,
  checks?: StrategyChecks,
): StrategicAnalysisResult {
  const kpiDashboard = [renderDashboard(json), '', renderKpis(json)].join('\n');
  const trendsAndBreakEven = renderTrendsAndBreakEven(json, checks);
  const projectedCashFlow = renderProjections(json, checks);
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
