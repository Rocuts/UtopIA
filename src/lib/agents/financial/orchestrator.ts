// ---------------------------------------------------------------------------
// Financial Orchestrator — sequential pipeline coordinator
// ---------------------------------------------------------------------------
// Pipeline: Raw Data -> Preprocess -> Agent 1 (NIIF) -> Agent 2 (Strategy) -> Agent 3 (Governance) -> Consolidation -> Validate
// ---------------------------------------------------------------------------

import { runNiifAnalyst } from './agents/niif-analyst';
import { runStrategyDirector } from './agents/strategy-director';
import { runGovernanceSpecialist } from './agents/governance-specialist';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
  type PeriodSnapshot,
  type EquityBreakdown,
} from '@/lib/preprocessing/trial-balance';
import { validateConsolidatedReport, type ControlTotalsInput } from './validators/report-validator';
import { pullTrialBalanceForPeriod } from '@/lib/erp/pipeline';
import type { PeriodSpec } from '@/lib/erp/adapter';
import type { ERPServiceConnection } from '@/lib/erp/service';
import type {
  FinancialReportRequest,
  FinancialReport,
  FinancialProgressEvent,
  NiifAnalysisResult,
  StrategicAnalysisResult,
  GovernanceResult,
} from './types';
import type {
  AdjustmentLedger,
  ProvisionalFlag,
} from '@/lib/agents/repair/types';
import { applyAdjustments } from '@/lib/agents/repair/adjustments';
import { BasePipeline, type PipelineStage } from './base-pipeline';

export interface OrchestrateFinancialOptions {
  onProgress?: (event: FinancialProgressEvent) => void;
  /**
   * Override del usuario: cuando `active === true`, la validacion post-render
   * NO lanza si falla — el reporte se devuelve con un watermark BORRADOR y se
   * emite un `event: warning` con la lista de errores. Lo activa el repair
   * chat ("El Doctor de Datos") cuando el usuario insiste en generar el
   * reporte a pesar del fallo.
   */
  provisional?: ProvisionalFlag;
  /**
   * Resultado del preprocesador (si el caller ya lo corrio, p.ej. /api/upload
   * o /api/financial-report). Si se omite, el orchestrator corre el preprocess
   * internamente (es idempotente). Usamos `unknown` porque Agente A3 esta
   * extendiendo el shape y no queremos acoplarnos rigido aqui.
   */
  preprocessed?: unknown;
  /**
   * Conexiones ERP disponibles para auto-pull de `rawData` cuando el caller
   * no provee el CSV manualmente. Se combina con `period` para llamar a
   * `pullTrialBalanceForPeriod` antes del preprocess.
   */
  erpConnections?: ERPServiceConnection[];
  /** Periodo fiscal a extraer del ERP cuando se dispara auto-pull. */
  period?: PeriodSpec;
  /**
   * Phase 2 (Doctor de Datos): ledger de ajustes confirmados por el usuario en
   * el repair chat. Solo entradas con `status === 'applied'` se honran.
   *
   * Flujo: el orchestrator corre el preprocesador como siempre y, antes del
   * Stage 0.5 (gate), reescribe el `preprocessed` aplicando los ajustes via
   * `applyAdjustments()`. Asi la validacion y los Agentes 1/2/3 ven el balance
   * ya parchado, y el reporte refleja exactamente lo que el usuario aprobo en
   * el chat.
   */
  adjustmentLedger?: AdjustmentLedger;
}

// ---------------------------------------------------------------------------
// Helpers de extraccion defensiva — Agente A3 esta ampliando el shape del
// preprocesador. Leemos con optional chaining y caemos al shape legado.
// ---------------------------------------------------------------------------

/**
 * Acceso defensivo al PeriodSnapshot del periodo actual (`primary`).
 * Retorna null si la forma no matchea (consumer pre-T1 o preprocesado vacio).
 */
function getPrimarySnapshot(preprocessed: unknown): PeriodSnapshot | null {
  if (!preprocessed || typeof preprocessed !== 'object') return null;
  const pp = preprocessed as { primary?: PeriodSnapshot };
  return pp.primary && typeof pp.primary === 'object' ? pp.primary : null;
}

/**
 * Acceso defensivo al PeriodSnapshot del periodo comparativo. Puede ser null
 * legitimamente (single-period). Retorna null tambien si la forma no matchea.
 */
function getComparativeSnapshot(preprocessed: unknown): PeriodSnapshot | null {
  if (!preprocessed || typeof preprocessed !== 'object') return null;
  const pp = preprocessed as { comparative?: PeriodSnapshot | null };
  return pp.comparative && typeof pp.comparative === 'object' ? pp.comparative : null;
}

function deriveControlTotalsFromSnapshot(
  snap: PeriodSnapshot | null,
): ControlTotalsInput | undefined {
  if (!snap) return undefined;
  if (snap.controlTotals) return snap.controlTotals;
  if (snap.summary) {
    return {
      activo: snap.summary.totalAssets,
      pasivo: snap.summary.totalLiabilities,
      patrimonio: snap.summary.totalEquity,
      ingresos: snap.summary.totalRevenue,
      gastos: snap.summary.totalExpenses,
      utilidadNeta: snap.summary.netIncome,
    };
  }
  return undefined;
}

/** Totales del periodo actual (primary). Usado por validator y guardas. */
function deriveControlTotals(preprocessed: unknown): ControlTotalsInput | undefined {
  return deriveControlTotalsFromSnapshot(getPrimarySnapshot(preprocessed));
}

function deriveEquityBreakdownFromSnapshot(
  snap: PeriodSnapshot | null,
): EquityBreakdown | undefined {
  if (!snap) return undefined;
  return snap.equityBreakdown;
}

function deriveDiscrepanciesFromSnapshot(snap: PeriodSnapshot | null): string[] {
  if (!snap || !Array.isArray(snap.discrepancies)) return [];
  const out: string[] = [];
  for (const d of snap.discrepancies) {
    if (typeof d === 'string') {
      out.push(d);
    } else if (d && typeof d === 'object') {
      const asObj = d as { description?: string; location?: string };
      if (asObj.description) {
        out.push(asObj.location ? `${asObj.location}: ${asObj.description}` : asObj.description);
      }
    }
  }
  return out;
}

/**
 * Extrae el `ValidationResult` consolidado del preprocesador. Multiperiodo:
 * unifica las validaciones de TODOS los PeriodSnapshots — si CUALQUIER periodo
 * tiene blocking=true, el conjunto bloquea, y los reasons/suggestedAccounts se
 * concatenan con prefijo de periodo para que el usuario sepa donde corregir.
 */
function deriveValidation(preprocessed: unknown): {
  blocking: boolean;
  reasons: string[];
  suggestedAccounts: string[];
  adjustments: string[];
} {
  const empty = { blocking: false, reasons: [], suggestedAccounts: [], adjustments: [] };
  if (!preprocessed || typeof preprocessed !== 'object') return empty;
  const pp = preprocessed as { periods?: PeriodSnapshot[] };
  const snapshots = Array.isArray(pp.periods) ? pp.periods : [];
  if (snapshots.length === 0) return empty;

  const asStringArray = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];

  let blocking = false;
  const reasons: string[] = [];
  const suggestedAccounts: string[] = [];
  const adjustments: string[] = [];

  for (const snap of snapshots) {
    const v = snap.validation;
    if (!v) continue;
    const tag = `[${snap.period}] `;
    if (v.blocking) blocking = true;
    for (const r of asStringArray(v.reasons)) reasons.push(`${tag}${r}`);
    for (const a of asStringArray(v.suggestedAccounts)) suggestedAccounts.push(a);
    for (const adj of asStringArray(v.adjustments)) adjustments.push(`${tag}${adj}`);
  }

  return {
    blocking,
    reasons,
    suggestedAccounts: Array.from(new Set(suggestedAccounts)),
    adjustments,
  };
}

/**
 * Type-guard defensivo: verifica que `preprocessed` parezca un PreprocessedBalance
 * suficientemente bien formado para alimentar `applyAdjustments`. El nuevo
 * contrato exige `periods[]` no vacio y un `primary` referenciable.
 */
function isPreprocessedBalance(pp: unknown): pp is PreprocessedBalance {
  if (!pp || typeof pp !== 'object') return false;
  const candidate = pp as { periods?: unknown; primary?: unknown };
  return (
    Array.isArray(candidate.periods) &&
    candidate.periods.length > 0 &&
    !!candidate.primary &&
    typeof candidate.primary === 'object'
  );
}

/**
 * Error especifico para descuadres del balance que NO deben producir reporte.
 * `/api/financial-report` lo captura y devuelve un 422 con el detalle para que
 * el UI muestre la lista de cuentas a revisar en el archivo original.
 */
export class BalanceValidationError extends Error {
  readonly reasons: string[];
  readonly suggestedAccounts: string[];

  constructor(reasons: string[], suggestedAccounts: string[]) {
    const joined = reasons.join(' ') || 'El balance de prueba no cuadra.';
    super(joined);
    this.name = 'BalanceValidationError';
    this.reasons = reasons;
    this.suggestedAccounts = suggestedAccounts;
  }
}

/** Formatea un monto en COP con separador punto-miles y coma-decimal. */
function fmtCop(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'N/D';
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (n < 0 ? '-$' : '$') + formatted;
}

/**
 * Renderiza un PeriodSnapshot a lineas Markdown. Helper usado por
 * `buildBindingTotalsBlock` en single-period y multi-period.
 */
function renderSnapshotLines(snap: PeriodSnapshot): string[] {
  const totals = deriveControlTotalsFromSnapshot(snap);
  const equity = deriveEquityBreakdownFromSnapshot(snap);
  const discrepancies = deriveDiscrepanciesFromSnapshot(snap);
  const lines: string[] = [];

  if (!totals) {
    lines.push(`- (Sin totales pre-calculados para ${snap.period})`);
    return lines;
  }

  lines.push(`- Total Activo: ${fmtCop(totals.activo)} COP`);
  if (typeof totals.activoCorriente === 'number') {
    lines.push(`  - Activo Corriente: ${fmtCop(totals.activoCorriente)} COP`);
  }
  if (typeof totals.activoNoCorriente === 'number') {
    lines.push(`  - Activo No Corriente: ${fmtCop(totals.activoNoCorriente)} COP`);
  }
  lines.push(`- Total Pasivo: ${fmtCop(totals.pasivo)} COP`);
  if (typeof totals.pasivoCorriente === 'number') {
    lines.push(`  - Pasivo Corriente: ${fmtCop(totals.pasivoCorriente)} COP`);
  }
  if (typeof totals.pasivoNoCorriente === 'number') {
    lines.push(`  - Pasivo No Corriente: ${fmtCop(totals.pasivoNoCorriente)} COP`);
  }
  lines.push(`- Total Patrimonio: ${fmtCop(totals.patrimonio)} COP`);
  lines.push(`- Total Ingresos: ${fmtCop(totals.ingresos)} COP`);
  lines.push(`- Total Gastos: ${fmtCop(totals.gastos)} COP`);
  lines.push(`- Utilidad Neta (P&L): ${fmtCop(totals.utilidadNeta)} COP`);

  const hasAnyBigFourField =
    typeof totals.efectivoCuenta11 === 'number' ||
    typeof totals.deudoresCuenta13 === 'number' ||
    typeof totals.cuentasPorPagar23 === 'number' ||
    typeof totals.impuestosCuenta24 === 'number' ||
    typeof totals.obligacionesLaborales25 === 'number';
  if (hasAnyBigFourField) {
    lines.push('- Cuentas PUC clave (Big Four — Flujo de Caja Proyectado):');
    if (typeof totals.efectivoCuenta11 === 'number') {
      lines.push(`  - PUC 11 (Efectivo y equivalentes): ${fmtCop(totals.efectivoCuenta11)} COP`);
    }
    if (typeof totals.deudoresCuenta13 === 'number') {
      lines.push(`  - PUC 13 (Deudores comerciales): ${fmtCop(totals.deudoresCuenta13)} COP`);
    }
    if (typeof totals.cuentasPorPagar23 === 'number') {
      lines.push(`  - PUC 23 (Cuentas por pagar): ${fmtCop(totals.cuentasPorPagar23)} COP`);
    }
    if (typeof totals.impuestosCuenta24 === 'number') {
      lines.push(`  - PUC 24 (Impuestos por pagar): ${fmtCop(totals.impuestosCuenta24)} COP`);
    }
    if (typeof totals.obligacionesLaborales25 === 'number') {
      lines.push(`  - PUC 25 (Obligaciones laborales): ${fmtCop(totals.obligacionesLaborales25)} COP`);
    }
  }

  if (equity) {
    const desglose: string[] = [];
    if (typeof equity.capitalAutorizado === 'number')
      desglose.push(`capital autorizado ${fmtCop(equity.capitalAutorizado)}`);
    if (typeof equity.capitalSuscritoPagado === 'number')
      desglose.push(`capital suscrito ${fmtCop(equity.capitalSuscritoPagado)}`);
    if (typeof equity.reservaLegal === 'number')
      desglose.push(`reserva legal ${fmtCop(equity.reservaLegal)}`);
    if (typeof equity.otrasReservas === 'number')
      desglose.push(`otras reservas ${fmtCop(equity.otrasReservas)}`);
    if (typeof equity.utilidadEjercicio === 'number')
      desglose.push(`utilidad del ejercicio ${fmtCop(equity.utilidadEjercicio)}`);
    if (typeof equity.utilidadesAcumuladas === 'number')
      desglose.push(`utilidades acumuladas ${fmtCop(equity.utilidadesAcumuladas)}`);
    if (desglose.length > 0) {
      lines.push(`- Desglose patrimonio: ${desglose.join(', ')}`);
    }
  }

  if (discrepancies.length > 0) {
    lines.push('- Discrepancias detectadas:');
    for (const d of discrepancies.slice(0, 10)) {
      lines.push(`  * ${d}`);
    }
    if (discrepancies.length > 10) {
      lines.push(`  * ...y ${discrepancies.length - 10} mas.`);
    }
  } else {
    lines.push('- Discrepancias detectadas: ninguna.');
  }

  return lines;
}

/**
 * Calcula la variacion porcentual con guardas para divisiones por 0.
 * Retorna 'ND' si el valor base es 0/null/undefined.
 */
function pctYoY(current: number | undefined, base: number | undefined): string {
  if (typeof current !== 'number' || typeof base !== 'number') return 'ND';
  if (!Number.isFinite(current) || !Number.isFinite(base)) return 'ND';
  if (base === 0) return current === 0 ? '0,00%' : 'ND';
  const pct = ((current - base) / Math.abs(base)) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function absDelta(current: number | undefined, base: number | undefined): string {
  if (typeof current !== 'number' || typeof base !== 'number') return 'ND';
  return fmtCop(current - base);
}

/**
 * Construye el bloque Markdown "TOTALES VINCULANTES" que se inyecta a los 3
 * agentes. Este bloque es la fuente de verdad: los agentes deben citar estas
 * cifras textualmente y no re-calcularlas.
 *
 * Multiperiodo: si `preprocessed.periods.length >= 2`, emite una seccion por
 * periodo + tabla de variacion YoY entre primary y comparative. Si solo hay
 * 1 periodo, emite el bloque simple legacy.
 */
function buildBindingTotalsBlock(preprocessed: unknown): string {
  const primary = getPrimarySnapshot(preprocessed);
  const comparative = getComparativeSnapshot(preprocessed);

  if (!primary) {
    // Si no hay preprocesado, devolvemos un bloque minimo explicito para
    // que el agente sepa que no tiene anclas numericas pre-calculadas.
    return [
      'TOTALES VINCULANTES (pre-calculados por 1+1 — NO los modifiques):',
      '- No se pudo pre-calcular totales vinculantes desde los datos recibidos.',
      '  Usa las cifras de los auxiliares y declaralo explicitamente en las',
      '  notas tecnicas.',
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push('TOTALES VINCULANTES (pre-calculados por 1+1 — NO los modifiques):');
  lines.push('');
  lines.push(`=== Periodo actual (${primary.period}) ===`);
  lines.push(...renderSnapshotLines(primary));

  if (comparative) {
    lines.push('');
    lines.push(`=== Periodo comparativo (${comparative.period}) ===`);
    lines.push(...renderSnapshotLines(comparative));

    const pT = deriveControlTotalsFromSnapshot(primary);
    const cT = deriveControlTotalsFromSnapshot(comparative);
    if (pT && cT) {
      lines.push('');
      lines.push(`=== Variacion YoY (${primary.period} vs ${comparative.period}) ===`);
      lines.push(
        `- Activo: ${absDelta(pT.activo, cT.activo)} (${pctYoY(pT.activo, cT.activo)})`,
      );
      lines.push(
        `- Pasivo: ${absDelta(pT.pasivo, cT.pasivo)} (${pctYoY(pT.pasivo, cT.pasivo)})`,
      );
      lines.push(
        `- Patrimonio: ${absDelta(pT.patrimonio, cT.patrimonio)} (${pctYoY(pT.patrimonio, cT.patrimonio)})`,
      );
      lines.push(
        `- Ingresos: ${absDelta(pT.ingresos, cT.ingresos)} (${pctYoY(pT.ingresos, cT.ingresos)})`,
      );
      lines.push(
        `- Gastos: ${absDelta(pT.gastos, cT.gastos)} (${pctYoY(pT.gastos, cT.gastos)})`,
      );
      lines.push(
        `- Utilidad Neta: ${absDelta(pT.utilidadNeta, cT.utilidadNeta)} (${pctYoY(pT.utilidadNeta, cT.utilidadNeta)})`,
      );
    }
    lines.push('');
    lines.push(
      'REGLA MULTIPERIODO: las cifras de cada periodo son AUTORITARIAS para ese periodo. Tus estados financieros, KPIs y notas DEBEN producir DOS columnas (actual + comparativo) + variacion. Si una cifra del comparativo es 0, declarala como $0,00. Si NO existe, declarala como ND. NUNCA omitas el periodo comparativo silenciosamente.',
    );
  } else {
    lines.push('');
    lines.push(
      'NOTA: solo hay un periodo en el balance — modo single-period. Declara "Sin periodo comparativo disponible" en cada estado financiero.',
    );
  }

  lines.push('');
  lines.push(
    'REGLA: Estos totales son VINCULANTES. Tus estados financieros y notas DEBEN reflejarlos exactamente.',
  );

  // Bloque legacy "lines" para compat con la rama if(!totals) — mantenemos el
  // nombre `lines` pero ya no entra al for de duplicados; retornamos directo.
  return lines.join('\n');
}

/**
 * Heuristica no-fatal: verifica si el output del Agente 1 cita alguno de los
 * totales numericos vinculantes. Si no, el orchestrator emite un warning via
 * onProgress (sin abortar — los Agentes 2/3 aun tienen el bindingTotals).
 */
function niifOutputMentionsBindingTotals(
  fullContent: string,
  preprocessed: unknown,
): boolean {
  const totals = deriveControlTotals(preprocessed);
  if (!totals) return true; // no hay anclas -> no podemos invalidar

  const candidates: number[] = [
    totals.activo,
    totals.pasivo,
    totals.patrimonio,
    totals.utilidadNeta,
  ].filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) > 1,
  );

  if (candidates.length === 0) return true;

  // Comparamos contra el texto sin espacios (para tolerar "$ 1.234.567" etc.)
  const text = fullContent.replace(/\s+/g, '');
  for (const val of candidates) {
    const asInt = Math.round(Math.abs(val)).toString();
    const withDotThousands = asInt.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const withCommaThousands = asInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const variants = [asInt, withDotThousands, withCommaThousands];
    for (const v of variants) {
      if (v.length >= 3 && text.includes(v)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Execute the full financial reporting pipeline.
 *
 * Sequential flow with SSE progress events:
 * 0. Preprocess raw data (idempotent) -> binding totals
 * 1. NIIF Analyst processes raw data -> 4 financial statements
 * 2. Strategy Director interprets statements -> KPIs, projections, recommendations
 * 3. Governance Specialist produces legal docs -> notes + assembly minutes
 * 4. Orchestrator consolidates everything -> post-render validation
 */
export async function orchestrateFinancialReport(
  request: FinancialReportRequest,
  options: OrchestrateFinancialOptions = {},
): Promise<FinancialReport> {
  const { rawData, company, language, instructions } = request;
  const { onProgress } = options;

  // ---------------------------------------------------------------------------
  // Stage 0.0: Auto-pull desde ERP si el caller no entrego rawData explicito
  // ---------------------------------------------------------------------------
  // Cuando el usuario tiene un ERP conectado y no pasa un CSV manual, tiramos
  // el balance de prueba en vivo y lo serializamos al mismo contrato CSV que
  // consume `parseTrialBalanceCSV`. Si el ERP falla, propagamos via onProgress
  // y lanzamos — el route handler captura y devuelve el error al cliente.
  // ---------------------------------------------------------------------------
  let effectiveRawData = rawData;
  if (!effectiveRawData?.trim() && options?.erpConnections?.length && options?.period) {
    try {
      effectiveRawData = await pullTrialBalanceForPeriod(
        options.erpConnections,
        options.period,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress?.({ type: 'error', message: `erp_pull_failed: ${message}` });
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Stage 0: Preprocess (idempotente) — genera los totales vinculantes
  // ---------------------------------------------------------------------------
  let preprocessed: unknown = options.preprocessed;
  if (!preprocessed) {
    try {
      const rows = parseTrialBalanceCSV(effectiveRawData);
      if (rows.length > 0) {
        preprocessed = preprocessTrialBalance(rows);
      }
    } catch (err) {
      // No-fatal: seguimos sin bindingTotals si el CSV es exotico.
      console.warn(
        '[financial-orchestrator] Preprocess fallo, continuando sin bindingTotals:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Stage 0.4: Aplicar adjustmentLedger (Phase 2 — Doctor de Datos)
  // ---------------------------------------------------------------------------
  // Si el usuario confirmo ajustes en el repair chat, los aplicamos AHORA
  // sobre el preprocessed antes del gate de validacion. Esto permite que un
  // balance que fallaba el gate en su forma original pase con los ajustes
  // aprobados por el usuario.
  // ---------------------------------------------------------------------------
  const appliedAdjustments =
    options.adjustmentLedger?.adjustments?.filter((a) => a.status === 'applied') ?? [];
  let adjustmentsApplicationDetail: ReturnType<typeof applyAdjustments> | null = null;
  if (
    appliedAdjustments.length > 0 &&
    preprocessed &&
    typeof preprocessed === 'object' &&
    isPreprocessedBalance(preprocessed)
  ) {
    adjustmentsApplicationDetail = applyAdjustments(
      preprocessed,
      appliedAdjustments,
    );
    preprocessed = adjustmentsApplicationDetail.balance;
    onProgress?.({
      type: 'stage_progress',
      stage: 1,
      detail: `Doctor de Datos: ${appliedAdjustments.length} ajuste(s) aplicado(s) al balance antes de generar el reporte.`,
    });
  }

  // ---------------------------------------------------------------------------
  // Stage 0.5: Gate de validacion aritmetica
  // ---------------------------------------------------------------------------
  // Si el preprocesador marco el balance como "blocking" (p.ej. la ecuacion
  // Activo = Pasivo + Patrimonio descuadra >1%), abortamos aqui en vez de
  // gastar tokens generando un reporte que sera incorrecto. El usuario recibe
  // razones y cuentas sugeridas para corregir el Excel.
  //
  // Si el preprocesador aplico auto-reparaciones (p.ej. reinyeccion de la
  // utilidad del ejercicio), las reportamos como progreso informativo.
  // ---------------------------------------------------------------------------
  const balanceValidation = deriveValidation(preprocessed);
  if (balanceValidation.adjustments.length > 0) {
    for (const adj of balanceValidation.adjustments) {
      onProgress?.({
        type: 'stage_progress',
        stage: 1,
        detail: `Ajuste automatico: ${adj}`,
      });
    }
  }
  if (balanceValidation.blocking) {
    throw new BalanceValidationError(
      balanceValidation.reasons,
      balanceValidation.suggestedAccounts,
    );
  }

  const bindingTotalsBlock = buildBindingTotalsBlock(preprocessed);

  // ---------------------------------------------------------------------------
  // Multiperiodo: si el preprocesador detecto >=2 periodos pero el caller no
  // declaro `company.comparativePeriod`, lo autocompletamos con el penultimo
  // periodo detectado. Asi el copy "Periodo Comparativo: YYYY" en los prompts
  // queda alineado con el preprocesado real.
  // ---------------------------------------------------------------------------
  let effectiveCompany = company;
  if (
    !effectiveCompany.comparativePeriod &&
    Array.isArray(effectiveCompany.detectedPeriods) &&
    effectiveCompany.detectedPeriods.length >= 2
  ) {
    const dp = effectiveCompany.detectedPeriods;
    effectiveCompany = {
      ...effectiveCompany,
      comparativePeriod: dp[dp.length - 2],
    };
  } else {
    // Si no viene detectedPeriods en company, derivarlo del preprocesado.
    const ppPeriods =
      preprocessed && typeof preprocessed === 'object'
        ? (preprocessed as { periods?: PeriodSnapshot[] }).periods ?? []
        : [];
    if (ppPeriods.length >= 2) {
      const detected = ppPeriods.map((p) => p.period);
      effectiveCompany = {
        ...effectiveCompany,
        detectedPeriods: detected,
        comparativePeriod:
          effectiveCompany.comparativePeriod ?? detected[detected.length - 2],
      };
    }
  }

  // PreprocessedBalance tipado para los agents (nuevo contrato T1).
  const ppForAgents: PreprocessedBalance | undefined =
    preprocessed && isPreprocessedBalance(preprocessed) ? preprocessed : undefined;

  // ---------------------------------------------------------------------------
  // Stages 1-3: NIIF Analyst -> Strategy Director -> Governance Specialist
  // ---------------------------------------------------------------------------
  // Coordinados via BasePipeline.runSequential. Cada stage emite SSE
  // `stage_start`/`stage_complete` con el shape FinancialProgressEvent ya
  // existente — preservamos el contrato del API route. Los stages internos
  // que ya emiten `stage_progress` (token streaming desde los agentes via
  // onProgress) siguen funcionando porque la callback es la misma.
  //
  // Acumulador: encadenamos los outputs (NIIF -> Strategy y NIIF+Strategy ->
  // Governance) en un objeto que cada stage agranda monotonicamente. Esto
  // permite que cada stage reciba lo que necesita sin perder el output
  // previo, y que el caller obtenga el shape final en un solo pase.
  // ---------------------------------------------------------------------------

  type SequentialAccumulator = {
    niif?: NiifAnalysisResult;
    strategy?: StrategicAnalysisResult;
    governance?: GovernanceResult;
  };

  const stageLabels: Record<1 | 2 | 3, { start: string; complete: string }> = {
    1: {
      start:
        'Analista Contable NIIF — Procesando datos y construyendo estados financieros',
      complete: 'Estados financieros NIIF generados',
    },
    2: {
      start: 'Director de Estrategia — Analizando KPIs y proyecciones',
      complete: 'Dashboard ejecutivo y proyecciones completados',
    },
    3: {
      start:
        'Especialista en Gobierno Corporativo — Redactando documentos legales',
      complete: 'Notas contables y acta de asamblea redactadas',
    },
  };

  const stages: ReadonlyArray<PipelineStage<unknown, unknown>> = [
    {
      name: 'niif-analyst',
      onStart: () =>
        onProgress?.({ type: 'stage_start', stage: 1, label: stageLabels[1].start }),
      onSuccess: (out) => {
        const acc = out as SequentialAccumulator;
        // Sanity-check no-fatal: el Agente 1 deberia citar las cifras vinculantes.
        if (
          acc.niif &&
          !niifOutputMentionsBindingTotals(acc.niif.fullContent, preprocessed)
        ) {
          onProgress?.({
            type: 'stage_progress',
            stage: 1,
            detail:
              'Advertencia: el output NIIF no cita ninguno de los totales vinculantes pre-calculados. ' +
              'Los Agentes 2 y 3 recibiran igualmente los bindingTotals.',
          });
        }
        onProgress?.({ type: 'stage_complete', stage: 1, label: stageLabels[1].complete });
      },
      run: async (input) => {
        const acc = (input as SequentialAccumulator) ?? {};
        const niifResult = await runNiifAnalyst(
          effectiveRawData,
          effectiveCompany,
          language,
          instructions,
          bindingTotalsBlock,
          ppForAgents,
          onProgress,
        );
        return { ...acc, niif: niifResult } satisfies SequentialAccumulator;
      },
    },
    {
      name: 'strategy-director',
      onStart: () =>
        onProgress?.({ type: 'stage_start', stage: 2, label: stageLabels[2].start }),
      onSuccess: () =>
        onProgress?.({ type: 'stage_complete', stage: 2, label: stageLabels[2].complete }),
      run: async (input) => {
        const acc = input as SequentialAccumulator;
        if (!acc?.niif) {
          throw new Error('strategy-director: missing NIIF output in accumulator');
        }
        const strategyResult = await runStrategyDirector(
          acc.niif,
          effectiveCompany,
          language,
          instructions,
          bindingTotalsBlock,
          ppForAgents,
          onProgress,
        );
        return { ...acc, strategy: strategyResult } satisfies SequentialAccumulator;
      },
    },
    {
      name: 'governance-specialist',
      onStart: () =>
        onProgress?.({ type: 'stage_start', stage: 3, label: stageLabels[3].start }),
      onSuccess: () =>
        onProgress?.({ type: 'stage_complete', stage: 3, label: stageLabels[3].complete }),
      run: async (input) => {
        const acc = input as SequentialAccumulator;
        if (!acc?.niif || !acc?.strategy) {
          throw new Error('governance-specialist: missing prior outputs in accumulator');
        }
        const governanceResult = await runGovernanceSpecialist(
          acc.niif,
          acc.strategy,
          effectiveCompany,
          language,
          instructions,
          bindingTotalsBlock,
          ppForAgents,
          onProgress,
        );
        return { ...acc, governance: governanceResult } satisfies SequentialAccumulator;
      },
    },
  ];

  const pipeline = new BasePipeline({ name: 'financial-report' });
  const sequentialResult = await pipeline.runSequential<SequentialAccumulator>(
    stages,
    {} as SequentialAccumulator,
  );

  if (
    !sequentialResult.niif ||
    !sequentialResult.strategy ||
    !sequentialResult.governance
  ) {
    // Imposible si runSequential resolvio sin lanzar — guarda defensivo.
    throw new Error('financial-pipeline: incomplete sequential output');
  }

  const niifResult = sequentialResult.niif;
  const strategyResult = sequentialResult.strategy;
  const governanceResult = sequentialResult.governance;

  // ---------------------------------------------------------------------------
  // Stage 4: Consolidation + post-render validation
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 4,
    label: 'Consolidando reporte maestro',
  });

  let consolidatedReport = buildConsolidatedReport(
    effectiveCompany,
    niifResult.fullContent,
    strategyResult.fullContent,
    governanceResult.fullContent,
    language,
  );

  // -------------------------------------------------------------------------
  // Phase 2: si hubo ajustes aplicados via Doctor de Datos, agregamos una
  // seccion al final del reporte que documenta cada uno (id corto, cuenta,
  // monto, razon). Esto deja una traza auditable en el reporte final.
  // -------------------------------------------------------------------------
  if (adjustmentsApplicationDetail && appliedAdjustments.length > 0) {
    consolidatedReport +=
      '\n\n' +
      buildAdjustmentsAuditSection(
        appliedAdjustments,
        adjustmentsApplicationDetail.affected,
        language,
      );
  }

  // Validator: placeholders + secciones + sanity numerica + ecuacion patrimonial.
  // Multiperiodo: pasamos los totales del periodo actual como anclas primarias
  // y los totales del comparativo (si existe) como anclas secundarias para
  // que el validator pueda verificar tambien las cifras del periodo anterior.
  const primarySnapshotForValidator = getPrimarySnapshot(preprocessed);
  const comparativeSnapshotForValidator = getComparativeSnapshot(preprocessed);
  const controlTotals = deriveControlTotalsFromSnapshot(primarySnapshotForValidator);
  const comparativeControlTotals = deriveControlTotalsFromSnapshot(
    comparativeSnapshotForValidator,
  );
  const validation = validateConsolidatedReport(consolidatedReport, controlTotals, {
    comparativeTotals: comparativeControlTotals,
    primaryPeriod: primarySnapshotForValidator?.period,
    comparativePeriod: comparativeSnapshotForValidator?.period,
  });

  // ---------------------------------------------------------------------------
  // Override del usuario (provisional): si esta activo y la validacion fallo,
  // NO lanzamos. Convertimos los `errors` en `warnings` para la UI y
  // anteponemos un watermark BORRADOR al reporte final.
  // ---------------------------------------------------------------------------
  const provisional = options.provisional;
  if (provisional?.active && !validation.ok) {
    onProgress?.({
      type: 'warning',
      warnings: [...validation.errors, ...validation.warnings],
    });
    consolidatedReport =
      buildProvisionalWatermark(provisional.reason, validation.errors, language) +
      '\n\n' +
      consolidatedReport;
  }

  const report: FinancialReport = {
    company: effectiveCompany,
    niifAnalysis: niifResult,
    strategicAnalysis: strategyResult,
    governance: governanceResult,
    consolidatedReport,
    generatedAt: new Date().toISOString(),
    validation,
  };

  onProgress?.({
    type: 'stage_complete',
    stage: 4,
    label: 'Reporte consolidado listo',
  });

  if (!validation.ok && !provisional?.active) {
    const errMsg = 'Validacion fallida: ' + validation.errors.join('; ');
    onProgress?.({ type: 'error', message: errMsg });
    throw new Error(errMsg);
  }

  if (validation.warnings.length > 0) {
    onProgress?.({
      type: 'stage_progress',
      stage: 4,
      detail: 'Advertencias: ' + validation.warnings.slice(0, 3).join(' | '),
    });
  }

  onProgress?.({ type: 'done' });

  return report;
}

// ---------------------------------------------------------------------------
// Build the final consolidated Markdown report
// ---------------------------------------------------------------------------

function buildConsolidatedReport(
  company: FinancialReportRequest['company'],
  niifContent: string,
  strategyContent: string,
  governanceContent: string,
  language: 'es' | 'en',
): string {
  const title =
    language === 'en'
      ? 'CONSOLIDATED FINANCIAL REPORT'
      : 'REPORTE FINANCIERO CONSOLIDADO';

  const subtitle =
    language === 'en'
      ? 'NIIF Elite Corporate Analysis'
      : 'Analisis Corporativo Elite NIIF';

  const date = new Date().toLocaleDateString(
    language === 'es' ? 'es-CO' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  return `# ${title}
## ${subtitle}

---

| Campo | Detalle |
|-------|---------|
| **Empresa** | ${company.name} |
| **NIT** | ${company.nit} |
| **Tipo Societario** | ${company.entityType || 'N/A'} |
| **Periodo Fiscal** | ${company.fiscalPeriod} |
| **Fecha de Generacion** | ${date} |
| **Generado por** | 1+1 — Financial Orchestrator (3 Agentes Especializados) |

---

# PARTE I: ESTADOS FINANCIEROS NIIF
*Preparado por: Agente Analista Contable NIIF*

${niifContent}

---

# PARTE II: ANALISIS ESTRATEGICO Y PROYECCIONES
*Preparado por: Agente Director de Estrategia Financiera*

${strategyContent}

---

# PARTE III: GOBIERNO CORPORATIVO Y DOCUMENTOS LEGALES
*Preparado por: Agente Especialista en Gobierno Corporativo*

${governanceContent}

---

> **Nota Legal:** Este reporte fue generado por 1+1, un sistema de inteligencia artificial. Las cifras, analisis y documentos legales deben ser validados por un Contador Publico certificado y un abogado antes de su uso oficial. 1+1 no reemplaza la asesoria profesional.
`;
}

// ---------------------------------------------------------------------------
// Provisional watermark — se prepende al reporte cuando el usuario activa el
// override desde el repair chat ("El Doctor de Datos"). Bilingue: respeta
// `language`. Lista los errores de validacion para que quede explicito por
// que el reporte va marcado como borrador.
// ---------------------------------------------------------------------------

function buildProvisionalWatermark(
  reason: string,
  errors: string[],
  language: 'es' | 'en',
): string {
  const safeReason = (reason || '').trim() || (language === 'en' ? '(no reason provided)' : '(razon no declarada)');
  const errLines = errors.length > 0
    ? errors.map((e) => `> - ${e}`).join('\n')
    : language === 'en'
      ? '> - (no detailed errors)'
      : '> - (sin errores detallados)';

  if (language === 'en') {
    return [
      '> ⚠️ **DRAFT — VALIDATION PENDING**',
      '> This report was generated with a user override. Automatic validation detected:',
      errLines,
      `> User-stated reason: "${safeReason}"`,
      '> Must NOT be signed by the statutory auditor in this state.',
    ].join('\n');
  }

  return [
    '> ⚠️ **BORRADOR — VALIDACION PENDIENTE**',
    '> Este reporte fue generado con override del usuario. La validacion automatica detecto:',
    errLines,
    `> Razon declarada: "${safeReason}"`,
    '> NO debe firmarse por revisor fiscal en este estado.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Adjustments audit section (Phase 2 — Doctor de Datos)
// ---------------------------------------------------------------------------

/**
 * Documenta los ajustes aplicados por el Doctor de Datos al final del reporte
 * consolidado. Bilingue. Usa los `affected` resueltos por `applyAdjustments`
 * (que ya conocen oldBalance / newBalance / isNewAccount) para que la tabla
 * sea autoexplicativa.
 */
function buildAdjustmentsAuditSection(
  applied: AdjustmentLedger['adjustments'],
  affected: ReturnType<typeof applyAdjustments>['affected'],
  language: 'es' | 'en',
): string {
  const isEs = language === 'es';
  const fmt = (n: number) => fmtCop(n);
  const byId = new Map<string, (typeof affected)[number]>();
  for (const row of affected) byId.set(row.adjustmentId, row);

  const lines: string[] = [];
  lines.push('---');
  lines.push('');
  lines.push(
    isEs
      ? '## Ajustes contables aplicados durante el proceso de revision'
      : '## Accounting adjustments applied during the review process',
  );
  lines.push('');
  lines.push(
    isEs
      ? 'Los siguientes ajustes fueron propuestos por el agente "Doctor de Datos" y confirmados explicitamente por el usuario antes de generar este reporte. Las cifras del cuerpo del reporte ya los reflejan.'
      : 'The following adjustments were proposed by the "Data Doctor" agent and explicitly confirmed by the user prior to generating this report. The figures in the body of the report already reflect them.',
  );
  lines.push('');
  lines.push(
    isEs
      ? '| id | Cuenta | Saldo previo | Monto ajuste | Saldo nuevo | Nueva cuenta | Razon |'
      : '| id | Account | Previous balance | Adjustment | New balance | New account | Rationale |',
  );
  lines.push('|----|--------|------------|------------|------------|------------|------|');

  for (const adj of applied) {
    const a = byId.get(adj.id);
    const shortId = (adj.id || '').slice(0, 8);
    const code = adj.accountCode;
    const name = adj.accountName || (isEs ? '(sin nombre)' : '(unnamed)');
    const oldBal = a ? fmt(a.oldBalance) : 'N/D';
    const amt = fmt(Number(adj.amount) || 0);
    const newBal = a ? fmt(a.newBalance) : 'N/D';
    const isNew = a?.isNewAccount ? (isEs ? 'Si' : 'Yes') : 'No';
    const rationale = (adj.rationale || '').replace(/\s+/g, ' ').slice(0, 200);
    lines.push(
      `| \`${shortId}\` | ${code} ${name} | ${oldBal} | ${amt} | ${newBal} | ${isNew} | ${rationale} |`,
    );
  }

  return lines.join('\n');
}
