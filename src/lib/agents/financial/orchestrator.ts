// ---------------------------------------------------------------------------
// Financial Orchestrator — sequential pipeline coordinator
// ---------------------------------------------------------------------------
// Pipeline: Raw Data -> Preprocess -> Agent 1 (NIIF) -> Agent 2 (Strategy) -> Agent 3 (Governance) -> Consolidation -> Validate
// ---------------------------------------------------------------------------

import { runNiifAnalyst } from './agents/niif-analyst';
import { runStrategyDirector } from './agents/strategy-director';
import { runGovernanceSpecialist } from './agents/governance-specialist';
import {
  extractCompanyMetadata,
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type ExtractedCompanyMetadata,
  type PreprocessedBalance,
  type PeriodSnapshot,
  type EquityBreakdown,
} from '@/lib/preprocessing/trial-balance';
import { deriveReportMode, type ReportMode } from '@/lib/preprocessing/v8-helpers';
import {
  auditReportEmittable,
  type AuditCompanyContext,
} from '@/lib/pillars/audit-report-emittable';
import { validateConsolidatedReport, type ControlTotalsInput } from './validators/report-validator';
import { validateNiifReportJson } from './validators/niif-json-validator';
import { serializeMoneyCop } from './contracts/money';
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
  CompanyInfo,
} from './types';
import type {
  AdjustmentLedger,
  ProvisionalFlag,
} from '@/lib/agents/repair/types';
import { applyAdjustments } from '@/lib/agents/repair/adjustments';

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

/**
 * Construye las anclas del periodo comparativo para `validateNiifReportJson`
 * (E9 cross-check). Toma cents BigInt cuando están disponibles
 * (`controlTotals.cents`); si solo hay `ControlTotals` flotante, multiplica
 * por 100 con `Math.round` (única vía sin un BigInt fuente).
 *
 * NOTA: grossProfit / operatingProfit no se cruzan porque el preprocesador no
 * los computa directamente — el chequeo NOT-NULL en E9 todavía cubre que
 * Pass-1 los emita. Cuando esos campos lleguen al preprocesador, agregar
 * aquí.
 */
function buildComparativeAnchorsForValidator(
  totals: ControlTotalsInput,
  snap: PeriodSnapshot | null,
):
  | {
      totalAssets?: string;
      totalLiabilities?: string;
      totalEquity?: string;
      netIncome?: string;
    }
  | undefined {
  const cents = snap?.controlTotals?.cents;
  const toCentsString = (value: number | undefined, big: bigint | undefined): string | undefined => {
    if (typeof big === 'bigint') return serializeMoneyCop(big);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return serializeMoneyCop(BigInt(Math.round(value * 100)));
    }
    return undefined;
  };
  return {
    totalAssets: toCentsString(totals.activo, cents?.activo),
    totalLiabilities: toCentsString(totals.pasivo, cents?.pasivo),
    totalEquity: toCentsString(totals.patrimonio, cents?.patrimonio),
    netIncome: toCentsString(totals.utilidadNeta, cents?.utilidadNeta),
  };
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

    // ── BRIDGE DE CUADRATURA ────────────────────────────────────────────
    // El flag `validation.blocking` se setea en `buildSnapshotForPeriod`
    // ANTES de que el Curator (R8 Cierre Virtual) corra. Después de R8,
    // la ecuación contable puede haber sido absorbida por la utilidad del
    // periodo (cuenta virtual 3605VC + ajuste residual 3710VC). Si el
    // modelo de datos transformado YA cuadra al centavo, el blocking
    // pre-R8 queda obsoleto y debemos levantarlo automáticamente —
    // de lo contrario, balances perfectamente cuadrables (con utilidad
    // sin trasladar) son rechazados injustamente por el agente de Auditoría.
    //
    // Política:
    //   - Si snap.summary.equationBalanced === true Y existe
    //     snap.virtualCloseAdjustment (R8 actuó) Y el ajuste de centavos
    //     es INMATERIAL (≤1% del activo) → ignorar blocking.
    //     Reasons originales pasan a `adjustments` (informativos).
    //   - Si la ecuación POST-Curator sigue descuadrando → blocking real,
    //     mantener comportamiento original.
    //   - Si R8 absorbió un residual MATERIAL (>1% activo) en 3710VC, el
    //     bridge NO se activa: el descuadre puede ser un error de captura
    //     enmascarado y debe revisarse manualmente (FIX audit B3).
    const equationBalancedPostCurator =
      snap.summary?.equationBalanced === true;
    const r8Applied = snap.virtualCloseAdjustment !== undefined;
    const centsAdjustment = Math.abs(
      snap.virtualCloseAdjustment?.centsAdjustment ?? 0,
    );
    const activoTotal = Math.abs(snap.controlTotals?.activo ?? 0);
    const materialThreshold = Math.max(activoTotal * 0.01, 1_000_000);
    const adjustmentIsImmaterial = centsAdjustment <= materialThreshold;
    const bridgeActive =
      equationBalancedPostCurator && r8Applied && adjustmentIsImmaterial;

    if (v.blocking && !bridgeActive) {
      blocking = true;
    }

    if (bridgeActive && v.blocking) {
      // Bridge de Cuadratura activo: las razones pre-R8 son informativas,
      // no bloqueantes. El operador ve el ajuste documentado.
      const monto = snap.virtualCloseAdjustment?.dynamicNetIncome ?? 0;
      adjustments.push(
        `${tag}Bridge de Cuadratura aplicado: utilidad transitoria de ` +
          `$${monto.toLocaleString('es-CO', { maximumFractionDigits: 0 })} ` +
          `trasladada a Patrimonio (cuenta virtual 3605VC). Ecuación post-R8 cuadra al centavo.`,
      );
      for (const r of asStringArray(v.reasons)) {
        adjustments.push(`${tag}[informativo, no-bloqueante] ${r}`);
      }
    } else {
      for (const r of asStringArray(v.reasons)) reasons.push(`${tag}${r}`);
    }

    // suggestedAccounts solo se reportan si el bloqueo es real.
    if (!bridgeActive || v.blocking === false) {
      for (const a of asStringArray(v.suggestedAccounts)) suggestedAccounts.push(a);
    }
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
 *
 * Exportado SOLO PARA TESTS — el smoke `elite-pulido-diamante-binding.test.ts`
 * verifica que las 4 secciones Curator (R1/R5/R6/R7) salen al bloque vinculante.
 * No es parte de la API publica del modulo.
 */
export function renderSnapshotLines(snap: PeriodSnapshot): string[] {
  const totals = deriveControlTotalsFromSnapshot(snap);
  const equity = deriveEquityBreakdownFromSnapshot(snap);
  const discrepancies = deriveDiscrepanciesFromSnapshot(snap);
  const lines: string[] = [];

  if (!totals) {
    lines.push(`- (Sin totales pre-calculados para ${snap.period})`);
    return lines;
  }

  // Wave 2.F4 — Parte 2.1 VERIFICACIÓN 4: el tipo de período condiciona la
  // ramificación de notas (R8 cierre virtual obligatoria vs explicativa). El
  // LLM debe verlo explícito para citarlo en las notas técnicas.
  if (snap.periodoTipo) {
    lines.push(`- Tipo de período: ${snap.periodoTipo}`);
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
  // Wave 2.F4 — Parte 1.3 spec v2.0: emitir Ingresos BRUTO y NETO de
  // devoluciones 4175 con etiquetas inequívocas para que el LLM NUNCA confunda
  // qué cifra usar en el P&L. NIIF 15 §47 obliga presentación neta.
  lines.push(`- Total Ingresos (bruto Clase 4): ${fmtCop(totals.ingresos)} COP`);
  const totalsForRev = totals as ControlTotalsInput & {
    ingresosNetos?: number;
    totalDevoluciones?: number;
  };
  if (
    typeof totalsForRev.ingresosNetos === 'number' &&
    Number.isFinite(totalsForRev.ingresosNetos)
  ) {
    const devs = totalsForRev.totalDevoluciones ?? 0;
    lines.push(
      `- Total Ingresos Netos (neto de devoluciones 4175): ${fmtCop(totalsForRev.ingresosNetos)} COP ` +
        `(devoluciones 4175 detectadas: ${fmtCop(devs)} COP; NIIF 15 §47)`,
    );
  }
  lines.push(`- Total Gastos: ${fmtCop(totals.gastos)} COP`);
  // Bloque de impuesto vinculante (Bug 2 fix): UAI + impuesto + utilidad neta
  // SIEMPRE explícitos para que el Agente 1 NO confunda el signo del impuesto.
  // Lee desde `controlTotals.cents` (BigInt centavos) si está disponible — es
  // la fuente de mayor precisión que populá el preprocesador. Si por alguna
  // razón no está (tests legacy / consumers viejos), simplemente omitimos
  // las líneas explícitas — el LLM cae al binding heredado vía utilidadNeta.
  // Usamos lookup defensivo porque `totals` aquí es `ControlTotalsInput`
  // (validador) que NO declara `cents`/`utilidadAntesImpuestos`/`impuestoCausado`,
  // pero el dato real viene de `snap.controlTotals` que sí los trae.
  const totalsExt = totals as ControlTotalsInput & {
    cents?: { utilidadAntesImpuestos?: bigint; impuestoCausado?: bigint };
    utilidadAntesImpuestos?: number;
    impuestoCausado?: number;
  };
  let uaiNumber: number | undefined;
  let impuestoNumber: number | undefined;
  if (totalsExt.cents) {
    if (typeof totalsExt.cents.utilidadAntesImpuestos === 'bigint') {
      uaiNumber = Number(totalsExt.cents.utilidadAntesImpuestos) / 100;
    }
    if (typeof totalsExt.cents.impuestoCausado === 'bigint') {
      impuestoNumber = Number(totalsExt.cents.impuestoCausado) / 100;
    }
  }
  // Fallback a campos number-level si por algún motivo cents no estaba poblado.
  if (uaiNumber === undefined && typeof totalsExt.utilidadAntesImpuestos === 'number') {
    uaiNumber = totalsExt.utilidadAntesImpuestos;
  }
  if (impuestoNumber === undefined && typeof totalsExt.impuestoCausado === 'number') {
    impuestoNumber = totalsExt.impuestoCausado;
  }
  if (typeof uaiNumber === 'number' && Number.isFinite(uaiNumber)) {
    lines.push(`- Utilidad Antes de Impuestos (UAI): ${fmtCop(uaiNumber)} COP`);
  }
  if (typeof impuestoNumber === 'number' && Number.isFinite(impuestoNumber)) {
    lines.push(
      `- Impuesto de Renta causado del periodo (clase 54): ${fmtCop(impuestoNumber)} COP ` +
        `[presentar en P&L precedido de "(-)"; SIEMPRE RESTA de UAI]`,
    );
  }
  lines.push(
    `- Utilidad Neta (P&L) [= UAI − Impuesto]: ${fmtCop(totals.utilidadNeta)} COP`,
  );

  // ITEM 2 ORDEN DE CIERRE — Impuesto Renta Neto a Pagar (Curator R16).
  // Cuando hay anticipo material en PUC 135515 vs bruto en PUC 2404, exponemos
  // el neto al LLM para que lo presente en el Balance debajo de "Impuestos
  // Corrientes" (Pasivo). NIC 12 §71 + NIIF for SMEs §29.29 + Art. 850 E.T.
  const totalsExtTax = totals as ControlTotalsInput & {
    impuestoRentaNeto?: {
      brutoPasivo2404: number;
      anticipoActivo135515: number;
      netoAPagar: number;
      applicable: boolean;
    };
  };
  const irn = totalsExtTax.impuestoRentaNeto;
  if (irn && irn.applicable) {
    lines.push('');
    lines.push('## Impuesto de Renta — Neto a Pagar (Curator R16, NIC 12 §71 + Art. 850 E.T.)');
    lines.push(
      `- Bruto PUC 2404 (Impuesto de Renta por Pagar): ${fmtCop(irn.brutoPasivo2404)} COP.`,
    );
    lines.push(
      `- (−) Anticipo PUC 135515 (Anticipo Renta — saldo en Activo): ${fmtCop(irn.anticipoActivo135515)} COP.`,
    );
    lines.push(
      `- = NETO A PAGAR a la DIAN: ${fmtCop(irn.netoAPagar)} COP. ` +
        `Esta es la cifra VINCULANTE que el Balance debe presentar en Pasivo Corriente — ` +
        `Impuestos. NO uses el bruto. NIC 12 §71 + NIIF for SMEs §29.29 + Art. 850 E.T.`,
    );
  }

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

  // ---------------------------------------------------------------------------
  // Wave 2.F4 — 14 KPIs PRE-CALCULADOS (Parte 6 spec v2.0).
  // Fuente única de verdad: estos ratios vienen de `controlTotals` (preprocesador
  // determinístico). Cuando un denominador es 0 o anómalo, el campo es `null`
  // y la línea sale como "ND" para que el LLM NO invente cifras.
  // ---------------------------------------------------------------------------
  const totalsKpi = totals as ControlTotalsInput & {
    razonCorriente?: number | null;
    pruebaAcida?: number | null;
    endeudamientoTotal?: number | null;
    apalancamientoFinanciero?: number | null;
    coberturaIntereses?: number | null;
    margenOperativo?: number | null;
    margenNeto?: number | null;
    roe?: number | null;
    roa?: number | null;
    rotacionActivos?: number | null;
    diasCartera?: number | null;
    diasInventario?: number | null;
    diasProveedores?: number | null;
    ingresosNetos?: number;
    costoVentas6?: number;
    costoProduccion7?: number;
  };

  const hasAnyKpi =
    totalsKpi.razonCorriente !== undefined ||
    totalsKpi.pruebaAcida !== undefined ||
    totalsKpi.endeudamientoTotal !== undefined ||
    totalsKpi.apalancamientoFinanciero !== undefined ||
    totalsKpi.coberturaIntereses !== undefined ||
    totalsKpi.margenOperativo !== undefined ||
    totalsKpi.margenNeto !== undefined ||
    totalsKpi.roe !== undefined ||
    totalsKpi.roa !== undefined ||
    totalsKpi.rotacionActivos !== undefined;

  if (hasAnyKpi) {
    const fmtRatio = (n: number | null | undefined, suffix: string = ''): string => {
      if (n === null || n === undefined || !Number.isFinite(n)) return 'ND';
      const formatted = n.toLocaleString('es-CO', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `${formatted}${suffix}`;
    };
    const fmtPct = (n: number | null | undefined): string => {
      if (n === null || n === undefined || !Number.isFinite(n)) return 'ND';
      return `${n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    };
    const fmtDays = (n: number | null | undefined, ndReason?: string): string => {
      if (n === null || n === undefined || !Number.isFinite(n))
        return ndReason ? `ND (${ndReason})` : 'ND';
      const rounded = Math.round(n);
      return `${rounded} días`;
    };

    // Detectar costos anómalos para etiquetar ND en días inv/prov con razón.
    const ingNetos = totalsKpi.ingresosNetos ?? 0;
    const costoTotal = (totalsKpi.costoVentas6 ?? 0) + (totalsKpi.costoProduccion7 ?? 0);
    const costsAnomalous =
      ingNetos > 0 && Math.abs(costoTotal) < ingNetos * 0.01;
    const costsND = costsAnomalous ? 'base costos insuficiente' : undefined;
    const revenueND = ingNetos === 0 ? 'sin ingresos' : undefined;
    const interestND =
      totalsKpi.coberturaIntereses === null ? 'sin gasto financiero' : undefined;

    lines.push('');
    lines.push(
      '## KPIs PRE-CALCULADOS (preprocessor — fuente única, NO recalcular)',
    );
    lines.push(`- Razón Corriente: ${fmtRatio(totalsKpi.razonCorriente)}`);
    lines.push(`- Prueba Ácida: ${fmtRatio(totalsKpi.pruebaAcida)}`);
    lines.push(`- Endeudamiento Total: ${fmtPct(totalsKpi.endeudamientoTotal)}`);
    lines.push(
      `- Apalancamiento Financiero: ${fmtRatio(totalsKpi.apalancamientoFinanciero)}`,
    );
    lines.push(
      `- Cobertura de Intereses: ${
        interestND
          ? `ND — ${interestND}`
          : fmtRatio(totalsKpi.coberturaIntereses)
      }`,
    );
    lines.push(`- Margen Operativo: ${fmtPct(totalsKpi.margenOperativo)}`);
    lines.push(`- Margen Neto: ${fmtPct(totalsKpi.margenNeto)}`);
    lines.push(`- ROE: ${fmtPct(totalsKpi.roe)}`);
    lines.push(`- ROA: ${fmtPct(totalsKpi.roa)}`);
    lines.push(`- Rotación de Activos: ${fmtRatio(totalsKpi.rotacionActivos)}`);
    lines.push(
      `- Días de Cartera: ${fmtDays(totalsKpi.diasCartera, revenueND)}`,
    );
    lines.push(
      `- Días de Inventario: ${fmtDays(totalsKpi.diasInventario, costsND)}`,
    );
    lines.push(
      `- Días de Proveedores: ${fmtDays(totalsKpi.diasProveedores, costsND)}`,
    );
    lines.push(
      '- AUTORIDAD: estos KPIs son VINCULANTES. NO los recalcules. Cita los valores LITERALMENTE; cuando un KPI sea "ND", DECLARA "ND" y justifica brevemente la causa — NUNCA inventes un valor de respaldo.',
    );
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

  // ---------------------------------------------------------------------------
  // Curator NIIF — campos vinculantes derivados de las reglas R1, R5, R6, R7.
  // Solo emitimos cada seccion cuando el campo respectivo existe en el snapshot
  // y aporta informacion (no emitimos secciones vacias).
  // ---------------------------------------------------------------------------

  // --- Seccion A — Reclasificaciones aplicadas (Curator R1) ---
  const appliedReclassifications = Array.isArray(snap.reclassifications)
    ? snap.reclassifications.filter((r) => r.applied === true)
    : [];
  if (appliedReclassifications.length > 0) {
    lines.push('');
    lines.push('## Reclasificaciones aplicadas (Curator R1)');
    for (const r of appliedReclassifications) {
      const transfer =
        typeof r.effectiveTransferCop === 'number'
          ? r.effectiveTransferCop
          : r.amountCop;
      const footnote = (r.balanceFootnoteText || r.justification || '').trim();
      lines.push(
        `- ${r.accountCode} (${r.accountName}): saldo acreedor ${fmtCop(transfer)} ` +
          `reclasificado a cuenta virtual 2810ZZ-${r.accountCode}. ` +
          `Justificacion: ${footnote} (NIC 1 parr. 32 — no compensacion).`,
      );
    }
  }

  // --- Seccion A2 — Cierre Virtual aplicado (Curator R8) ---
  // R8 corre antes que R5 en `runCurator`. Cuando hay actividad P&L (clases 4-7),
  // R8 SIEMPRE inyecta 3605VC con la utilidad dinámica del periodo y, si hace
  // falta, absorbe el residual de la ecuación contable en 3710VC. El LLM debe
  // ver explícitamente este ajuste para no alucinar la utilidad del ejercicio
  // contra el saldo CSV de 3605 (que R8 anula a 0).
  const vcAdj = snap.virtualCloseAdjustment;
  if (vcAdj) {
    lines.push('');
    lines.push('## Cierre Virtual aplicado (Curator R8)');
    lines.push(
      `- Utilidad dinámica del periodo (Clase 4 − 5 − 6 − 7): ` +
        `${fmtCop(vcAdj.dynamicNetIncome)} → inyectada en cuenta virtual ` +
        `${vcAdj.virtualCurrentCode} (${vcAdj.virtualCurrentName}).`,
    );
    lines.push(
      `- Saldo CSV en 3605 al ingresar al Curator: ` +
        `${fmtCop(vcAdj.csvUtilidadEjercicio)} ` +
        `(anulado a 0 por R8 — la utilidad autoritativa es la dinámica).`,
    );
    if (vcAdj.reclassifiedFrom3605) {
      lines.push(
        `- Reclasificación 3605 → ${vcAdj.virtualRetainedCode}: ` +
          `${fmtCop(vcAdj.reclassifiedAmount)} ` +
          `(${vcAdj.virtualRetainedName}).`,
      );
    }
    if (vcAdj.centsAdjustment !== 0) {
      lines.push(
        `- Ajuste residual absorbido en ${vcAdj.virtualRetainedCode}: ` +
          `${fmtCop(vcAdj.centsAdjustment)} ` +
          `(garantiza Activo = Pasivo + Patrimonio al centavo).`,
      );
    }
    lines.push(
      `- Total Patrimonio post-R8 (autoritativo): ` +
        `${fmtCop(vcAdj.reconciledEquity)}.`,
    );
    lines.push(
      `- Sustento NIIF: Marco Conceptual NIIF parr. 4.37–4.53 ` +
        `(Reconocimiento) + NIC 1 parr. 16 (presentación de EEFF).`,
    );
  }

  // --- Seccion B — Anclaje patrimonial aplicado (Curator R5) ---
  if (
    typeof snap.equityAnchorAdjustment === 'number' &&
    Number.isFinite(snap.equityAnchorAdjustment) &&
    snap.equityAnchorAdjustment !== 0
  ) {
    lines.push('');
    lines.push('## Anclaje patrimonial aplicado (Curator R5)');
    lines.push(
      `- Brecha detectada: ${fmtCop(snap.equityAnchorAdjustment)} ` +
        `(Saldo Final ECP - Total Patrimonio Balance crudo)`,
    );
    lines.push(
      `- Ajuste a insertar en ECP: linea literal "Ajustes de Convergencia / ` +
        `Resultados Acumulados" por ${fmtCop(snap.equityAnchorAdjustment)} en ` +
        `columna "Resultados Acumulados".`,
    );
    if (totals && typeof totals.patrimonio === 'number') {
      lines.push(
        `- Total Patrimonio post-ajuste (autoritativo): ${fmtCop(totals.patrimonio)}`,
      );
    }
    lines.push(
      `- Sustento NIIF: NIC 1 parr. 106 (componentes del Estado de Cambios en el Patrimonio).`,
    );
  }

  // --- Seccion C0 — EFE Indirecto Pre-calculado (Curator R2) ---
  // Bug 3 fix (2026-05-08): el cashFlowIndirecto que produce R2 se inyecta
  // EXPLICITAMENTE al bloque vinculante para que el Agente 1 NIIF cite los
  // valores literalmente en el Estado de Flujos de Efectivo, en lugar de
  // omitir las líneas de capital de trabajo. Si R2 corrió en single-period
  // mode (sin comparativo), el sub-bloque incluye un warning explícito.
  const cfi = snap.cashFlowIndirecto;
  if (cfi) {
    lines.push('');
    lines.push('## EFE INDIRECTO PRECALCULADO (Curator R2 — NIC 7)');
    const isSinglePeriod = cfi.comparativePeriod === '(sin_comparativo)';
    if (isSinglePeriod) {
      lines.push(
        `- MODO PARCIAL — sin balance comparativo: las variaciones asumen ` +
          `saldo inicial = $0. NO es un EFE oficial NIIF. Pendiente: cargar ` +
          `balance del año anterior. Severity: medio.`,
      );
    } else {
      lines.push(
        `- Variación calculada entre periodos ${cfi.comparativePeriod} → ${cfi.period}.`,
      );
    }
    lines.push('### Actividades de Operación');
    lines.push(`  - Utilidad neta: ${fmtCop(cfi.operating.utilidadNeta)}`);
    lines.push(
      `  - (+) Depreciación / Amortización: ${fmtCop(cfi.operating.depreciacionAmortizacion)}`,
    );
    lines.push(
      `  - (+/-) Variación Cuentas por Cobrar (ΔCxC): ${fmtCop(cfi.operating.varCuentasPorCobrar)}`,
    );
    lines.push(
      `  - (+/-) Variación Inventarios (ΔInv): ${fmtCop(cfi.operating.varInventarios)}`,
    );
    lines.push(
      `  - (+/-) Variación Proveedores (ΔProv): ${fmtCop(cfi.operating.varProveedores)}`,
    );
    lines.push(
      `  - (+/-) Variación Cuentas por Pagar (ΔCxP): ${fmtCop(cfi.operating.varCuentasPorPagar)}`,
    );
    lines.push(
      `  - (+/-) Variación Impuestos por Pagar (ΔImp): ${fmtCop(cfi.operating.varImpuestosPorPagar)}`,
    );
    lines.push(
      `  - (+/-) Variación Obligaciones Laborales (ΔLab): ${fmtCop(cfi.operating.varObligacionesLaborales)}`,
    );
    lines.push(
      `  - = Flujo neto Actividades de Operación: ${fmtCop(cfi.operating.total)}`,
    );
    lines.push('### Actividades de Inversión');
    lines.push(`  - Variación PPE bruto: ${fmtCop(cfi.investing.varPPE)}`);
    lines.push(`  - Otros: ${fmtCop(cfi.investing.otros)}`);
    lines.push(
      `  - = Flujo neto Actividades de Inversión: ${fmtCop(cfi.investing.total)}`,
    );
    lines.push('### Actividades de Financiación');
    lines.push(
      `  - Variación Obligaciones Financieras: ${fmtCop(cfi.financing.varObligacionesFinancieras)}`,
    );
    lines.push(
      `  - Variación Capital + Reservas: ${fmtCop(cfi.financing.varCapitalReservas)}`,
    );
    lines.push(
      `  - Dividendos estimados: ${fmtCop(cfi.financing.dividendosEstimados)}`,
    );
    lines.push(
      `  - = Flujo neto Actividades de Financiación: ${fmtCop(cfi.financing.total)}`,
    );
    lines.push(`### Cierre`);
    lines.push(`  - Variación neta de efectivo: ${fmtCop(cfi.netChangeInCash)}`);
    lines.push(
      `  - Variación observada en PUC 11: ${fmtCop(cfi.observedChangeInCash)}`,
    );
    lines.push(`  - Brecha de reconciliación: ${fmtCop(cfi.reconciliationGap)}`);
    lines.push(`  - Reconciliado: ${cfi.reconciled ? 'sí' : 'no'}`);
    lines.push(
      `- AUTORIDAD: estos valores son VINCULANTES para el Estado de Flujos ` +
        `de Efectivo del Agente 1 NIIF. Cita las líneas de capital de trabajo ` +
        `LITERALMENTE — NO omitas ΔInventario ni ΔProveedores aunque sean $0.`,
    );
  }

  // --- Seccion C — Cierre de Flujo de Efectivo aplicado (Curator R6) ---
  if (
    typeof snap.cashFlowClosureAdjustment === 'number' &&
    Number.isFinite(snap.cashFlowClosureAdjustment) &&
    snap.cashFlowClosureAdjustment !== 0
  ) {
    lines.push('');
    lines.push('## Cierre de Flujo de Efectivo aplicado (Curator R6)');
    lines.push(
      `- Brecha absorbida: ${fmtCop(snap.cashFlowClosureAdjustment)} entre ` +
        `EFE neto antes y delta caja observado en PUC 11.`,
    );
    lines.push(
      `- Linea de absorcion a reportar: literal "Variaciones en Capital de Trabajo ` +
        `(ajuste de cierre)" en Actividades de Operacion, monto ` +
        `${fmtCop(snap.cashFlowClosureAdjustment)} (con su signo original).`,
    );
    if (totals && typeof totals.efectivoCuenta11 === 'number') {
      lines.push(
        `- Efectivo al final del periodo (autoritativo): ${fmtCop(totals.efectivoCuenta11)}`,
      );
    }
    lines.push(`- Sustento NIIF: NIC 7 parr. 45 (componentes de efectivo).`);
  }

  // --- Seccion D — Advertencia de Valoracion (Curator R7) ---
  const presumed = snap.presumedCostWarning;
  if (presumed) {
    lines.push('');
    lines.push('## Advertencia de Valoracion (Curator R7) — NOTA INTERNA');
    const fmtPct = (n: number) =>
      Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : 'N/D';
    const fmtPctInt = (n: number) =>
      Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : 'N/D';
    lines.push(
      `- Margen bruto observado: ${fmtPct(presumed.observedGrossMargin)} ` +
        `(threshold ${fmtPctInt(presumed.thresholdGrossMargin)})`,
    );
    lines.push(`- Costo de Ventas reportado: ${fmtCop(presumed.reportedCogsCop)}`);
    lines.push(`- Inventario al cierre: ${fmtCop(presumed.inventoryCop)}`);
    lines.push(
      `- Costo de Ventas presunto bajo rotacion normal: ${fmtCop(presumed.presumedCogsCop)}`,
    );
    lines.push(`- Severidad: ${presumed.severidad}`);
    const calloutTitle = (presumed.calloutTitle || '').trim();
    const calloutBody = (presumed.calloutBody || '').trim();
    lines.push(
      `- Texto literal del callout: "${calloutTitle}" + cuerpo: "${calloutBody}"`,
    );
    lines.push(
      `- IMPORTANTE: este callout va SOLO en seccion "Notas Internas del Preparador". ` +
        `NO incluir en EEFF firmables. Sustento: NIC 2 parr. 25 (medicion de inventarios).`,
    );
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
// Sub-orchestrators (Wave 3.F1) — phase splitting
// ---------------------------------------------------------------------------
// El endpoint legacy `/api/financial-report` ejecuta los 3 stages NIIF +
// Strategy + Governance en una sola request. Con NIIF chunked (3 passes
// internos) + Strategy + Governance, la latencia acumulada excede el budget
// Vercel Pro+Fluid Compute para reportes complejos y rompe el SSE stream.
//
// La solución: 3 endpoints separados (`/niif`, `/strategy`, `/governance`)
// cada uno con su propio `maxDuration` independiente. Las funciones siguientes
// son los sub-orchestrators reutilizables:
//
//   prepareFinancialContext  — Stage 0 (ERP pull, preprocess, adjustments,
//                              gate, bindingTotalsBlock, eliteFor*). Comparte
//                              estado entre los 3 phase runners.
//   runNiifPhase             — Stage 1 (NIIF Analyst 3-pass chunked).
//   runStrategyPhase         — Stage 2 (Strategy Director).
//   runGovernancePhase       — Stage 3 (Governance Specialist).
//
// El legacy `orchestrateFinancialReport` queda como composer secuencial que
// llama a los 3 phase runners — backward-compat total (export route, tests).
// ---------------------------------------------------------------------------

/**
 * Resultado de `prepareFinancialContext` — todo lo que los phase runners
 * necesitan para invocar a su agente correspondiente. Expuesto para que los
 * route handlers `/niif` puedan reusar Stage 0 sin re-implementar la logica.
 */
export interface FinancialPipelineContext {
  effectiveRawData: string;
  effectiveCompany: CompanyInfo;
  preprocessed: unknown;
  ppForAgents: PreprocessedBalance | undefined;
  bindingTotalsBlock: string;
  /**
   * Modo del reporte derivado deterministically por `deriveReportMode()`
   * (spec v8.1 §2). Controla absolutamente toda decisión narrativa de los
   * 3 agentes secuenciales (verbos permitidos, layout de estados financieros,
   * copy del resumen ejecutivo).
   *
   * Default seguro `'COMPARATIVO_COMPLETO'` cuando no hay `ppForAgents`
   * (fallback: el comportamiento legacy preserva al máximo la riqueza
   * narrativa). F4-F6 leen este campo desde los prompt builders.
   */
  reportMode: ReportMode;
  eliteForNiif: {
    comparativosImpracticables: boolean | undefined;
    actividadInferida: { sectorCIIU: string; descripcion: string; evidencia?: string } | undefined;
    reclasificacionesNoCompensacion:
      | Array<{
          cuenta_origen: string;
          saldo_invertido_centavos: bigint;
          cuenta_destino_pasivo: string;
          motivo_norma: string;
        }>
      | undefined;
    saldoAFavorImpuestoCents: bigint | undefined;
  };
  eliteForStrategy: {
    comparativosImpracticables: boolean | undefined;
    actividadInferida: { sectorCIIU: string; descripcion: string; evidencia?: string } | undefined;
  };
  eliteForGovernance: {
    comparativosImpracticables: boolean | undefined;
    actividadInferida: { sectorCIIU: string; descripcion: string; evidencia?: string } | undefined;
  };
  /** Detalle de ajustes aplicados via Doctor de Datos (Phase 2). */
  adjustmentsApplicationDetail: ReturnType<typeof applyAdjustments> | null;
  /** Lista de ajustes confirmados que se intentaron aplicar. */
  appliedAdjustments: NonNullable<AdjustmentLedger['adjustments']>;
}

/**
 * Stage 0 compartido: ERP pull → preprocess → ajustes → gate → bindingTotals.
 *
 * Lanza `BalanceValidationError` si el balance no cuadra y `options.provisional`
 * no esta activo. Los route handlers (legacy y nuevos) capturan ese error y
 * devuelven 422.
 */
export async function prepareFinancialContext(
  request: FinancialReportRequest,
  options: OrchestrateFinancialOptions = {},
): Promise<FinancialPipelineContext> {
  const { rawData, company } = request;
  const { onProgress } = options;

  // ---------------------------------------------------------------------------
  // Stage 0.0: Auto-pull desde ERP si el caller no entrego rawData explicito
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
      console.warn(
        '[financial-orchestrator] Preprocess fallo, continuando sin bindingTotals:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Stage 0.4: Aplicar adjustmentLedger
  const appliedAdjustments =
    options.adjustmentLedger?.adjustments?.filter((a) => a.status === 'applied') ?? [];
  let adjustmentsApplicationDetail: ReturnType<typeof applyAdjustments> | null = null;
  if (
    appliedAdjustments.length > 0 &&
    preprocessed &&
    typeof preprocessed === 'object' &&
    isPreprocessedBalance(preprocessed)
  ) {
    adjustmentsApplicationDetail = applyAdjustments(preprocessed, appliedAdjustments);
    preprocessed = adjustmentsApplicationDetail.balance;
    onProgress?.({
      type: 'stage_progress',
      stage: 1,
      detail: `Doctor de Datos: ${appliedAdjustments.length} ajuste(s) aplicado(s) al balance antes de generar el reporte.`,
    });
  }

  // Stage 0.5: Gate de validacion aritmetica
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

  // ELITE CONTEXT — lectura defensiva
  const ppLoose = preprocessed as unknown as
    | {
        comparativos_impracticables?: boolean;
        actividadInferida?: { sectorCIIU?: string; descripcion?: string; evidencia?: string };
        reclasificacionesNoCompensacion?: Array<{
          cuenta_origen?: string;
          saldo_invertido_centavos?: bigint | number;
          cuenta_destino_pasivo?: string;
          motivo_norma?: string;
        }>;
      }
    | undefined;

  const eliteActividadInferida = ppLoose?.actividadInferida
    ? {
        sectorCIIU: ppLoose.actividadInferida.sectorCIIU ?? '',
        descripcion: ppLoose.actividadInferida.descripcion ?? '',
        evidencia: ppLoose.actividadInferida.evidencia,
      }
    : undefined;

  const eliteReclasif = Array.isArray(ppLoose?.reclasificacionesNoCompensacion)
    ? ppLoose!.reclasificacionesNoCompensacion!.map((r) => ({
        cuenta_origen: r.cuenta_origen ?? '',
        saldo_invertido_centavos: BigInt(r.saldo_invertido_centavos ?? 0),
        cuenta_destino_pasivo: r.cuenta_destino_pasivo ?? '',
        motivo_norma: r.motivo_norma ?? '',
      }))
    : undefined;

  const elitePrimaryCents = getPrimarySnapshot(preprocessed)?.controlTotals?.cents as
    | (Record<string, unknown> & { saldoAFavorImpuesto?: bigint })
    | undefined;

  const eliteSaldoAFavor =
    typeof elitePrimaryCents?.saldoAFavorImpuesto === 'bigint'
      ? elitePrimaryCents.saldoAFavorImpuesto
      : undefined;

  const eliteForNiif = {
    comparativosImpracticables: ppLoose?.comparativos_impracticables,
    actividadInferida: eliteActividadInferida,
    reclasificacionesNoCompensacion: eliteReclasif,
    saldoAFavorImpuestoCents: eliteSaldoAFavor,
  };

  const eliteForStrategy = {
    comparativosImpracticables: ppLoose?.comparativos_impracticables,
    actividadInferida: eliteActividadInferida,
  };

  const eliteForGovernance = {
    comparativosImpracticables: ppLoose?.comparativos_impracticables,
    actividadInferida: eliteActividadInferida,
  };

  // Multiperiodo: autocompletar comparativePeriod si falta
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

  const ppForAgents: PreprocessedBalance | undefined =
    preprocessed && isPreprocessedBalance(preprocessed) ? preprocessed : undefined;

  // Spec v8.1 §2 — derivar el modo del reporte determinísticamente desde el
  // preprocesado. Sin un `PreprocessedBalance` bien formado caemos al default
  // `COMPARATIVO_COMPLETO` (riqueza narrativa completa, backward compatible).
  const reportMode: ReportMode = ppForAgents
    ? deriveReportMode(ppForAgents)
    : 'COMPARATIVO_COMPLETO';

  return {
    effectiveRawData,
    effectiveCompany,
    preprocessed,
    ppForAgents,
    bindingTotalsBlock,
    reportMode,
    eliteForNiif,
    eliteForStrategy,
    eliteForGovernance,
    adjustmentsApplicationDetail,
    appliedAdjustments,
  };
}

/**
 * Stage 1: NIIF Analyst (3-pass chunked). Emite los SSE
 * stage_start/stage_complete (stage=1) y delega los stage_progress por-pass
 * al `runNiifAnalyst` interno.
 *
 * Devuelve el `NiifAnalysisResult` + el `context` (para que el caller pueda
 * encadenarlo a Strategy/Governance sin re-correr Stage 0).
 */
export async function runNiifPhase(
  request: FinancialReportRequest,
  options: OrchestrateFinancialOptions = {},
): Promise<{ niif: NiifAnalysisResult; context: FinancialPipelineContext }> {
  const { language, instructions } = request;
  const { onProgress } = options;

  const context = await prepareFinancialContext(request, options);

  const stageLabel = 'Analista Contable NIIF — Procesando datos y construyendo estados financieros';
  const completeLabel = 'Estados financieros NIIF generados';

  onProgress?.({ type: 'stage_start', stage: 1, label: stageLabel });

  const niif = await runNiifAnalyst(
    context.effectiveRawData,
    context.effectiveCompany,
    language,
    instructions,
    context.bindingTotalsBlock,
    context.ppForAgents,
    onProgress,
    context.eliteForNiif,
    undefined,
    context.reportMode,
  );

  if (!niifOutputMentionsBindingTotals(niif.fullContent, context.preprocessed)) {
    onProgress?.({
      type: 'stage_progress',
      stage: 1,
      detail:
        'Advertencia: el output NIIF no cita ninguno de los totales vinculantes pre-calculados. ' +
        'Los Agentes 2 y 3 recibiran igualmente los bindingTotals.',
    });
  }

  // Wave 5 — 2026-05-14: validator JSON-strict (E1..E9) sobre el output del
  // NIIF Analyst. Cruza los SEIS totales del periodo comparativo emitidos
  // por Pass-1 contra el preprocesador (tolerancia $0). Errores se emiten
  // como SSE `warning` — no rompemos pipelines en producción, pero la falla
  // queda visible en logs/UI y la telemetría puede alertar.
  if (niif.json) {
    const comparativeSnap = getComparativeSnapshot(context.preprocessed);
    const comparativeTotals = deriveControlTotalsFromSnapshot(comparativeSnap);
    const bindingComparativeTotalsCents = comparativeTotals
      ? buildComparativeAnchorsForValidator(comparativeTotals, comparativeSnap)
      : undefined;
    const cashAnchorCents =
      typeof comparativeSnap?.controlTotals?.efectivoCuenta11 === 'number'
        ? serializeMoneyCop(
            BigInt(Math.round(comparativeSnap.controlTotals.efectivoCuenta11 * 100)),
          )
        : undefined;
    void cashAnchorCents; // PUC 11 del primary ya se cruza en validateConsolidatedReport
    const jsonValidation = validateNiifReportJson(niif.json, {
      bindingComparativeTotalsCents,
    });
    if (!jsonValidation.ok && jsonValidation.errors.length > 0) {
      onProgress?.({
        type: 'warning',
        warnings: jsonValidation.errors.map(
          (e) => `[NIIF JSON validator E1..E9] ${e}`,
        ),
      });
    }
    if (jsonValidation.warnings.length > 0) {
      onProgress?.({
        type: 'warning',
        warnings: jsonValidation.warnings.map(
          (w) => `[NIIF JSON validator soft-check] ${w}`,
        ),
      });
    }
  }

  onProgress?.({ type: 'stage_complete', stage: 1, label: completeLabel });

  return { niif, context };
}

/**
 * Input para `runStrategyPhase` / `runGovernancePhase` cuando el caller ya
 * ejecuto Stage 0 + NIIF (el caso normal de los endpoints separados).
 *
 * El caller envia las cifras pre-calculadas (`bindingTotalsBlock`,
 * `preprocessed`) + el output del agente anterior. Asi cada endpoint es
 * stateless y la red no carga con re-procesos.
 */
export interface PhaseHandoffInput {
  /** Output del NIIF Analyst (Phase 1). */
  niifResult: NiifAnalysisResult;
  /** Bloque Markdown TOTALES VINCULANTES (pre-calculado por phase 1). */
  bindingTotals: string;
  /** PreprocessedBalance completo (forma del nuevo contrato T1). */
  preprocessed?: PreprocessedBalance;
  /** Metadata de la empresa (con `comparativePeriod` ya hidratado). */
  company: CompanyInfo;
  /** Idioma del reporte. */
  language: 'es' | 'en';
  /** Instrucciones adicionales del usuario. */
  instructions?: string;
  /** Contexto Elite — pasado opcionalmente (default: undefined → comportamiento legacy). */
  elite?: {
    comparativosImpracticables?: boolean;
    actividadInferida?: { sectorCIIU: string; descripcion: string; evidencia?: string };
  };
  /**
   * Modo del reporte v8.1 §2 — pre-derivado en `prepareFinancialContext`.
   * Default `'COMPARATIVO_COMPLETO'` cuando el endpoint legacy no lo provee.
   * F5/F6 leen este campo desde sus respectivos prompt builders.
   */
  reportMode?: ReportMode;
}

/**
 * Stage 2: Strategy Director. Consume el NIIF + bindingTotals y produce KPIs.
 * Emite SSE stage_start/stage_complete (stage=2).
 */
export async function runStrategyPhase(
  input: PhaseHandoffInput,
  options: Pick<OrchestrateFinancialOptions, 'onProgress'> = {},
): Promise<StrategicAnalysisResult> {
  const { niifResult, bindingTotals, preprocessed, company, language, instructions, elite, reportMode } = input;
  const { onProgress } = options;

  const stageLabel = 'Director de Estrategia — Analizando KPIs y proyecciones';
  const completeLabel = 'Dashboard ejecutivo y proyecciones completados';

  onProgress?.({ type: 'stage_start', stage: 2, label: stageLabel });

  const strategy = await runStrategyDirector(
    niifResult,
    company,
    language,
    instructions,
    bindingTotals,
    preprocessed,
    onProgress,
    elite,
    undefined,
    reportMode,
  );

  onProgress?.({ type: 'stage_complete', stage: 2, label: completeLabel });

  return strategy;
}

/**
 * Input adicional para Governance: ademas de NIIF requiere StrategyResult.
 */
export interface GovernancePhaseInput extends PhaseHandoffInput {
  /** Output del Strategy Director (Phase 2). */
  strategyResult: StrategicAnalysisResult;
}

/**
 * Stage 3: Governance Specialist. Consume NIIF + Strategy y produce notas +
 * acta. Emite SSE stage_start/stage_complete (stage=3).
 */
export async function runGovernancePhase(
  input: GovernancePhaseInput,
  options: Pick<OrchestrateFinancialOptions, 'onProgress'> = {},
): Promise<GovernanceResult> {
  const {
    niifResult,
    strategyResult,
    bindingTotals,
    preprocessed,
    company,
    language,
    instructions,
    elite,
    reportMode,
  } = input;
  const { onProgress } = options;

  const stageLabel = 'Especialista en Gobierno Corporativo — Redactando documentos legales';
  const completeLabel = 'Notas contables y acta de asamblea redactadas';

  onProgress?.({ type: 'stage_start', stage: 3, label: stageLabel });

  const governance = await runGovernanceSpecialist(
    niifResult,
    strategyResult,
    company,
    language,
    instructions,
    bindingTotals,
    preprocessed,
    onProgress,
    elite,
    undefined,
    reportMode,
  );

  onProgress?.({ type: 'stage_complete', stage: 3, label: completeLabel });

  return governance;
}

// ---------------------------------------------------------------------------
// Main entry point (legacy — composer secuencial)
// ---------------------------------------------------------------------------

/**
 * @deprecated Usa los 3 sub-orchestrators (`runNiifPhase`, `runStrategyPhase`,
 * `runGovernancePhase`) detras de los endpoints `/api/financial-report/{niif,
 * strategy,governance}` cuando necesites controlar latencia por fase. Esta
 * funcion sigue corriendo el pipeline completo en una sola request — utilizada
 * por `/api/financial-report` (legacy) y `/api/financial-report/export`.
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
  const { language, instructions } = request;
  const { onProgress } = options;

  // ---------------------------------------------------------------------------
  // Stage 0 + 1: prepareFinancialContext + NIIF Analyst (chunked 3 passes).
  // El sub-orchestrator `runNiifPhase` corre el preprocesado, el gate de
  // validacion, construye los bindingTotals + elite ctx, y luego ejecuta el
  // Analista NIIF emitiendo los SSE stage_start/stage_complete (stage=1).
  // ---------------------------------------------------------------------------
  const niifPhase = await runNiifPhase(request, options);
  const niifResult = niifPhase.niif;
  const ctx = niifPhase.context;

  // ---------------------------------------------------------------------------
  // Stage 2: Strategy Director — consume el output NIIF + bindingTotals.
  // ---------------------------------------------------------------------------
  const strategyResult = await runStrategyPhase(
    {
      niifResult,
      bindingTotals: ctx.bindingTotalsBlock,
      preprocessed: ctx.ppForAgents,
      company: ctx.effectiveCompany,
      language,
      instructions,
      elite: ctx.eliteForStrategy,
      reportMode: ctx.reportMode,
    },
    { onProgress },
  );

  // ---------------------------------------------------------------------------
  // Stage 3: Governance Specialist — consume NIIF + Strategy.
  // ---------------------------------------------------------------------------
  const governanceResult = await runGovernancePhase(
    {
      niifResult,
      strategyResult,
      bindingTotals: ctx.bindingTotalsBlock,
      preprocessed: ctx.ppForAgents,
      company: ctx.effectiveCompany,
      language,
      instructions,
      elite: ctx.eliteForGovernance,
      reportMode: ctx.reportMode,
    },
    { onProgress },
  );

  // Acceso conveniente a los campos del context para Stage 4 (consolidation +
  // validation + emittability gate).
  const {
    effectiveCompany,
    effectiveRawData,
    preprocessed,
    adjustmentsApplicationDetail,
    appliedAdjustments,
  } = ctx;

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

  // -------------------------------------------------------------------------
  // Pulido NIIF PYME Grupo 2 — gate `auditReportEmittable` (V1..V12).
  // Si CUALQUIER blocker aparece, el reporte se etiqueta como "no-emitible"
  // y el endpoint debe devolver la lista de blockers + ajustes sugeridos al
  // cliente, NO los EEFF aparentes.
  // -------------------------------------------------------------------------
  // Extraer metadata directamente del rawData (idempotente, determinista).
  // Si el upload route ya la inyectó en `preprocessed.extractedCompanyMetadata`
  // la preferimos; si no, la extraemos aquí.
  const extractedMeta =
    getExtractedMetadataFromPreprocessed(preprocessed) ??
    extractCompanyMetadata(effectiveRawData ?? '');
  const auditCompanyContext: AuditCompanyContext = {
    razonSocialFromFile: extractedMeta?.razonSocialFromFile ?? null,
    nitFromFile: extractedMeta?.nitFromFile ?? null,
    nit: effectiveCompany.nit ?? null,
    niifGroup: effectiveCompany.niifGroup ?? 2,
    tipoSocietario: normalizeTipoSocietario(effectiveCompany.entityType),
    estatutosRequierenReservaLegal: getEstatutosFlag(effectiveCompany),
  };

  const primarySnapshotForGate = getPrimarySnapshot(preprocessed);
  if (primarySnapshotForGate) {
    // `preprocessed` está tipado como `unknown` para mantener el contrato
    // desacoplado del shape exacto del preprocesador. Cast defensivo para
    // pasar los campos del Pulido NIIF PYME Grupo 2 que V14/V15 leen.
    const eliteCtx = preprocessed as {
      comparativos_impracticables?: boolean;
      actividadInferida?: import('@/lib/preprocessing/trial-balance').ActividadInferida;
      reclasificacionesNoCompensacion?: import('@/lib/preprocessing/trial-balance').ReclasificacionNoCompensacion[];
    };
    const emittableResult = auditReportEmittable(
      report,
      primarySnapshotForGate,
      auditCompanyContext,
      {
        comparativos_impracticables: eliteCtx?.comparativos_impracticables,
        actividadInferida: eliteCtx?.actividadInferida,
        reclasificacionesNoCompensacion: eliteCtx?.reclasificacionesNoCompensacion,
      },
    );
    report.emittability = {
      kind: emittableResult.emittable ? 'emittable' : 'no-emitible',
      blockers: emittableResult.blockers.map((b) => ({
        code: b.code,
        message: b.message,
        detail: b.detail,
      })),
      suggestedAdjustments: emittableResult.suggestedAdjustments,
    };

    if (!emittableResult.emittable) {
      onProgress?.({
        type: 'warning',
        warnings: [
          'Informe NO emitible — gate auditReportEmittable bloqueó la emisión.',
          ...emittableResult.blockers.map((b) => b.message),
        ],
      });
    }
  }

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
// Helpers para el gate auditReportEmittable
// ---------------------------------------------------------------------------

function getExtractedMetadataFromPreprocessed(
  preprocessed: unknown,
): ExtractedCompanyMetadata | null {
  if (!preprocessed || typeof preprocessed !== 'object') return null;
  const pp = preprocessed as { extractedCompanyMetadata?: ExtractedCompanyMetadata };
  return pp.extractedCompanyMetadata ?? null;
}

function normalizeTipoSocietario(
  raw: string | undefined,
): AuditCompanyContext['tipoSocietario'] {
  if (!raw) return undefined;
  const upper = raw.toUpperCase().trim();
  if (upper === 'SAS' || upper === 'S.A.S.' || upper === 'S.A.S') return 'SAS';
  if (upper === 'SA' || upper === 'S.A.' || upper === 'S.A') return 'SA';
  if (upper === 'LTDA' || upper === 'LTDA.') return 'LTDA';
  if (upper === 'EU' || upper === 'E.U.' || upper === 'E.U') return 'EU';
  if (upper === 'SCS' || upper === 'OTRO') return 'OTRO';
  return 'OTRO';
}

function getEstatutosFlag(
  company: FinancialReportRequest['company'],
): boolean | undefined {
  // El intake puede inyectar este flag; si no está, es `undefined` (tri-state).
  const c = company as unknown as { estatutosRequierenReservaLegal?: boolean };
  return typeof c.estatutosRequierenReservaLegal === 'boolean'
    ? c.estatutosRequierenReservaLegal
    : undefined;
}

// ---------------------------------------------------------------------------
// extractCompanyMetadata adapter — el upload route puede inyectar la metadata
// extraída del Excel en `preprocessed.extractedCompanyMetadata`. Re-exportamos
// la utility deterministic para callers que no usen el upload route.
// ---------------------------------------------------------------------------
export { extractCompanyMetadata };

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
