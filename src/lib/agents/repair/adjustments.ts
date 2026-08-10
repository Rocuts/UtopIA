// ---------------------------------------------------------------------------
// Repair Chat — applyAdjustments util (Phase 2 + multiperiodo T1+T5, pure)
// ---------------------------------------------------------------------------
// Aplica ajustes contables determinísticamente sobre un PreprocessedBalance,
// reconstruyendo controlTotals, summary, equityBreakdown y la jerarquia de
// cuentas (hojas + ancestros) de cada PeriodSnapshot afectado. Sin side
// effects: clona todo lo que toca.
//
// Esta misma util es invocada por:
//   - tools del repair chat (preview de propose_adjustment, recheck_validation)
//   - financial orchestrator (post-preprocesamiento, antes del Stage 1)
// asi el reporte final refleja exactamente lo que el usuario aprobo en el chat.
//
// Multiperiodo (T1 contract):
//   - PreprocessedBalance ahora expone `periods: PeriodSnapshot[]` mas dos
//     accesos `primary` y `comparative`. Cada snapshot tiene su propio
//     `classes`, `controlTotals`, `equityBreakdown`, `summary`, etc.
//   - `Adjustment.period` (opcional) ancla el ajuste a un snapshot. Si se
//     omite, default = `primary.period`.
//   - Ajustes con `period` que no exista en `periods[*].period` se ignoran
//     silenciosamente para no contaminar otro snapshot — la UI debio haberlo
//     validado antes de mandar el replay.
// ---------------------------------------------------------------------------

import type {
  PreprocessedBalance,
  PeriodSnapshot,
  PUCClass,
  ValidatedAccount,
  ControlTotalsCents,
  ControlTotalsRaw,
} from '@/lib/preprocessing/trial-balance';
import type { Adjustment } from './types';

// ---------------------------------------------------------------------------
// PUC class names (mirror del preprocessor — duplicado intencional para
// no exportar el mapa privado de trial-balance.ts)
// ---------------------------------------------------------------------------
const PUC_CLASS_NAMES: Record<number, string> = {
  1: 'Activo',
  2: 'Pasivo',
  3: 'Patrimonio',
  4: 'Ingresos',
  5: 'Gastos',
  6: 'Costos de Ventas',
  7: 'Costos de Produccion',
  8: 'Cuentas de Orden Deudoras',
  9: 'Cuentas de Orden Acreedoras',
};

// Misma clasificacion corriente / no corriente que usa el preprocessor.
const ACTIVO_CORRIENTE_GROUPS = new Set(['11', '12', '13', '14']);
const ACTIVO_NO_CORRIENTE_GROUPS = new Set(['15', '16', '17', '18', '19']);
const PASIVO_CORRIENTE_GROUPS = new Set(['21', '22', '23', '24', '25', '26']);
const PASIVO_NO_CORRIENTE_GROUPS = new Set(['27', '28', '29']);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AdjustmentApplicationAffected {
  adjustmentId: string;
  accountCode: string;
  accountName: string;
  oldBalance: number;
  newBalance: number;
  isNewAccount: boolean;
  /** Periodo del snapshot donde se aplico el ajuste. */
  period: string;
}

export interface AdjustmentApplication {
  /** Nuevo PreprocessedBalance con ajustes incorporados (clonado). */
  balance: PreprocessedBalance;
  /** Resumen plano de cuentas afectadas, en el orden en que se procesaron. */
  affected: AdjustmentApplicationAffected[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeCode(code: string): string {
  return String(code ?? '').replace(/[.\-\s]/g, '');
}

function levelLabelFromLength(len: number): string {
  if (len === 1) return 'Clase';
  if (len === 2 || len === 3) return 'Grupo';
  if (len === 4 || len === 5) return 'Cuenta';
  if (len === 6 || len === 7) return 'Subcuenta';
  return 'Auxiliar';
}

/**
 * Clase PUC derivada del primer digito del codigo (1..9). Si no es digito
 * valido, retorna null y el caller debe rechazar el ajuste.
 */
function classDigitFromCode(code: string): number | null {
  if (!code || !/^\d/.test(code)) return null;
  const d = parseInt(code[0], 10);
  if (!Number.isFinite(d) || d < 1 || d > 9) return null;
  return d;
}

function cloneClass(cls: PUCClass): PUCClass {
  return {
    code: cls.code,
    name: cls.name,
    auxiliaryTotal: cls.auxiliaryTotal,
    reportedTotal: cls.reportedTotal,
    discrepancy: cls.discrepancy,
    accounts: cls.accounts.map((a) => ({ ...a })),
  };
}

function cloneSnapshot(snap: PeriodSnapshot): PeriodSnapshot {
  return {
    // Spread PRIMERO: preserva los campos que el preprocessor/curator
    // enriquecen y que este modulo NO recalcula — `virtualCloseAdjustment`
    // (sin el, el Bridge de Cuadratura del orchestrator se desactiva tras
    // aplicar cualquier ajuste), `curator`, `findings`, `periodoTipo`,
    // `cashFlowIndirecto`, audits R9-R15, etc. Las claves explicitas de
    // abajo sobreescriben con copias profundas las estructuras mutables.
    ...snap,
    classes: snap.classes.map(cloneClass),
    summary: { ...snap.summary },
    controlTotals: { ...snap.controlTotals },
    equityBreakdown: { ...snap.equityBreakdown },
    validation: {
      blocking: snap.validation.blocking,
      reasons: [...snap.validation.reasons],
      suggestedAccounts: [...snap.validation.suggestedAccounts],
      adjustments: [...snap.validation.adjustments],
    },
    discrepancies: snap.discrepancies.map((d) => ({ ...d })),
    missingExpectedAccounts: [...snap.missingExpectedAccounts],
  };
}

function cloneBalance(pp: PreprocessedBalance): PreprocessedBalance {
  // Clonamos cada snapshot UNA sola vez y reusamos las referencias para que
  // `primary` y `comparative` apunten a las mismas instancias dentro de
  // `periods` (consistencia del contrato T1).
  const clonedPeriods = pp.periods.map(cloneSnapshot);
  const findClone = (target: PeriodSnapshot | null): PeriodSnapshot | null => {
    if (!target) return null;
    return clonedPeriods.find((s) => s.period === target.period) ?? cloneSnapshot(target);
  };

  return {
    // Spread PRIMERO: preserva campos cross-period que no recalculamos aqui
    // (p.ej. metadata extraida, flags futuros del preprocessor). Las claves
    // explicitas sobreescriben con copias frescas las estructuras mutables.
    ...pp,
    periods: clonedPeriods,
    primary: findClone(pp.primary) ?? clonedPeriods[0],
    comparative: findClone(pp.comparative),
    rawRows: pp.rawRows.map((r) => ({ ...r })),
    reclasificacionesNoCompensacion: pp.reclasificacionesNoCompensacion.map((r) => ({ ...r })),
  };
}

// ---------------------------------------------------------------------------
// applyAdjustments — multiperiodo
// ---------------------------------------------------------------------------

/**
 * Aplica los `adjustments` con status === 'applied' al `balance`, en orden de
 * llegada. Devuelve un objeto NUEVO con cada `PeriodSnapshot` reconstruido y
 * un resumen de cuentas afectadas (con `period`). Los ajustes con otros status
 * se ignoran.
 *
 * Decisiones de diseno:
 *   - Si `adj.period` es undefined → snapshot destino = `primary`.
 *   - Si `adj.period` matchea un `periods[i].period` → ese snapshot.
 *   - Si `adj.period` no existe → ajuste descartado silenciosamente (la UI
 *     debio validarlo). Esto evita contaminar el snapshot equivocado.
 *   - Las cuentas nuevas se crean como hojas (`isLeaf = true`) en la clase
 *     derivada del primer digito del codigo. El nivel se infiere por longitud
 *     (Clase / Grupo / Cuenta / Subcuenta / Auxiliar). El `previousBalance`
 *     queda en `undefined`.
 *   - Cuando un ajuste apunta a una cuenta hoja existente, se SUMA el `amount`
 *     (signed) a su balance.
 *   - controlTotals, summary y equityBreakdown del snapshot afectado se
 *     RECALCULAN desde cero a partir de las hojas resultantes.
 *   - validation, discrepancies, missingExpectedAccounts y validationReport
 *     NO se mutan aqui — el caller debe usar `revalidate()` cuando necesite
 *     el estado de salud post-ajustes.
 *
 * Es pura: no muta `balance` ni los `Adjustment[]` recibidos.
 */
export function applyAdjustments(
  balance: PreprocessedBalance,
  adjustments: Adjustment[],
): AdjustmentApplication {
  const next = cloneBalance(balance);
  const affected: AdjustmentApplicationAffected[] = [];

  // Indice por period para resolver el snapshot destino en O(1).
  const snapshotByPeriod = new Map<string, PeriodSnapshot>();
  for (const snap of next.periods) {
    snapshotByPeriod.set(snap.period, snap);
  }

  // Track de snapshots que efectivamente recibieron ajustes para recomputar
  // solo esos al final.
  const dirtySnapshots = new Set<PeriodSnapshot>();

  for (const adj of adjustments) {
    if (!adj || adj.status !== 'applied') continue;

    const code = normalizeCode(adj.accountCode);
    const amount = Number(adj.amount);
    if (!code || !Number.isFinite(amount) || amount === 0) continue;
    const classDigit = classDigitFromCode(code);
    if (classDigit === null) continue;

    // -------------------------------------------------------------------
    // Resolver snapshot destino: adj.period > primary.period
    // -------------------------------------------------------------------
    const targetPeriod = adj.period ?? next.primary.period;
    const snap = snapshotByPeriod.get(targetPeriod);
    if (!snap) {
      // Periodo desconocido — ignoramos. Logueamos para que el cliente sepa
      // que el ajuste no se aplico (aparece en server logs).
      console.warn(
        `[repair/adjustments] adj ${adj.id} apunta a period="${targetPeriod}" que no existe en preprocessed.periods. Ignorado.`,
      );
      continue;
    }

    // -------------------------------------------------------------------
    // 1. Localizar / crear la clase en el snapshot destino
    // -------------------------------------------------------------------
    let cls = snap.classes.find((c) => c.code === classDigit);
    if (!cls) {
      cls = {
        code: classDigit,
        name: PUC_CLASS_NAMES[classDigit] || `Clase ${classDigit}`,
        auxiliaryTotal: 0,
        reportedTotal: null,
        discrepancy: 0,
        accounts: [],
      };
      snap.classes.push(cls);
    }

    // -------------------------------------------------------------------
    // 2. Buscar la cuenta hoja por code exacto
    // -------------------------------------------------------------------
    const idx = cls.accounts.findIndex((a) => normalizeCode(a.code) === code);

    if (idx >= 0) {
      const old = cls.accounts[idx];
      const oldBalance = Number(old.balance) || 0;
      const newBalance = oldBalance + amount;
      const updated: ValidatedAccount = {
        ...old,
        balance: newBalance,
      };
      cls.accounts[idx] = updated;
      affected.push({
        adjustmentId: adj.id,
        accountCode: old.code,
        accountName: old.name,
        oldBalance,
        newBalance,
        isNewAccount: false,
        period: snap.period,
      });
    } else {
      const fallbackName =
        (adj.accountName && adj.accountName.trim()) || `Cuenta ${code}`;
      const created: ValidatedAccount = {
        code,
        name: fallbackName,
        level: levelLabelFromLength(code.length),
        balance: amount,
        isLeaf: true,
      };
      cls.accounts.push(created);
      cls.accounts.sort((a, b) => a.code.localeCompare(b.code));
      affected.push({
        adjustmentId: adj.id,
        accountCode: code,
        accountName: fallbackName,
        oldBalance: 0,
        newBalance: amount,
        isNewAccount: true,
        period: snap.period,
      });
    }

    dirtySnapshots.add(snap);
  }

  // -------------------------------------------------------------------------
  // 3. Recalcular auxiliaryTotal / summary / controlTotals / equityBreakdown
  //    para cada snapshot afectado.
  // -------------------------------------------------------------------------
  for (const snap of dirtySnapshots) {
    recomputeSnapshotTotals(snap);
  }

  return { balance: next, affected };
}

// ---------------------------------------------------------------------------
// recomputeSnapshotTotals — encapsula los pasos 3..5 originales aplicados a un
// PeriodSnapshot. MUTA el snapshot recibido (caller ya hizo clone).
// ---------------------------------------------------------------------------

function recomputeSnapshotTotals(snap: PeriodSnapshot): void {
  // 1. auxiliaryTotal por clase
  for (const cls of snap.classes) {
    cls.auxiliaryTotal = cls.accounts.reduce(
      (s, a) => s + (Number(a.balance) || 0),
      0,
    );
    if (cls.reportedTotal !== null) {
      cls.discrepancy = Math.abs(cls.auxiliaryTotal - cls.reportedTotal);
    }
  }

  const getClassTotal = (c: number) =>
    snap.classes.find((cl) => cl.code === c)?.auxiliaryTotal ?? 0;

  const totalAssets = getClassTotal(1);
  const totalLiabilities = getClassTotal(2);
  const totalEquity = getClassTotal(3);
  const totalRevenue = getClassTotal(4);
  const totalExpenses = getClassTotal(5);
  const totalCosts = getClassTotal(6);
  const totalProduction = getClassTotal(7);

  // Devoluciones 4175 — ESPEJO EXACTO de `trial-balance.ts`, incluida la guarda
  // NIA 240 de más abajo. Este bloque es una segunda implementación de la misma
  // regla contable: si diverge, un ajuste de reparación reescribe el P&L con
  // otro criterio que el preprocesador y el bloque vinculante deja de cuadrar.
  // La duplicación sin sincronizar ya fue la causa raíz de esta familia de
  // defectos, así que cualquier cambio allí se replica aquí — arriba Y abajo.
  const ZERO_BIG = BigInt(0);
  const absBig = (v: bigint): bigint => (v < ZERO_BIG ? -v : v);
  const cls4 = snap.classes.find((c) => c.code === 4);
  let sumOrdinariasCents = ZERO_BIG;
  let sumDevolucionesFirmadaCents = ZERO_BIG;
  if (cls4) {
    for (const acc of cls4.accounts) {
      const c = toCents(Number(acc.balance) || 0);
      if (normalizeCode(acc.code).startsWith('4175')) {
        sumDevolucionesFirmadaCents += c;
      } else {
        sumOrdinariasCents += c;
      }
    }
  }
  const ingresosBrutoCents = absBig(sumOrdinariasCents);
  const totalDevolucionesCents = absBig(sumDevolucionesFirmadaCents);
  const ingresosNetosCents = ingresosBrutoCents - totalDevolucionesCents;
  const totalDevoluciones = Number(totalDevolucionesCents) / 100;
  const ingresosNetos = Number(ingresosNetosCents) / 100;

  // `ingresosNetos`, NO `totalRevenue` — mismo motivo que en el preprocesador:
  // bajo convención de magnitudes la Σ de la clase vale bruto + devoluciones e
  // infla la utilidad en 2 × devoluciones sobre un ancla dura.
  const netIncome =
    ingresosNetos - totalExpenses - totalCosts - totalProduction;

  // Guarda NIA 240 — la mitad declarativa del espejo. Sin esto, un ajuste que
  // deje las devoluciones por encima de los ingresos ordinarios publicaba un
  // ingreso neto NEGATIVO con `blocking = false` y cero avisos.
  if (totalDevolucionesCents > ingresosBrutoCents) {
    const motivo =
      `[${snap.period}] Devoluciones 4175 (${fmtCop(totalDevoluciones)}) mayores que los ` +
      `ingresos ordinarios de Clase 4 (${fmtCop(Number(ingresosBrutoCents) / 100)}). ` +
      `El ingreso neto resultante es negativo: ${fmtCop(ingresosNetos)}.`;
    if (!snap.validation.reasons.includes(motivo)) {
      snap.validation.reasons.push(motivo);
    }
    snap.validation.blocking = true;
    const yaReportada = snap.discrepancies.some((d) =>
      d.location.includes('Devoluciones 4175'),
    );
    if (!yaReportada) {
      snap.discrepancies.push({
        location: `Devoluciones 4175 [${snap.period}]`,
        reported: Number(ingresosBrutoCents) / 100,
        calculated: totalDevoluciones,
        difference: ingresosNetos,
        description: motivo,
      });
    }
  } else {
    // El ajuste puede haber SANEADO la anomalía: si ya no se cumple, se retira
    // el motivo y la discrepancia para no dejar un bloqueo permanente.
    snap.validation.reasons = snap.validation.reasons.filter(
      (r) => !r.includes('Devoluciones 4175'),
    );
    snap.discrepancies = snap.discrepancies.filter(
      (d) => !d.location.includes('Devoluciones 4175'),
    );
    snap.validation.blocking = snap.validation.reasons.length > 0;
  }

  const equationBalance = totalAssets - totalLiabilities - totalEquity;
  const equationBalanced = Math.abs(equationBalance) < 100;

  snap.summary = {
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalRevenue,
    totalExpenses,
    totalCosts,
    totalProduction,
    netIncome,
    equationBalance,
    equationBalanced,
  };

  // controlTotals — incluyendo segregacion Big Four (PUC 11/13/23/24/25)
  const sumByGroupPrefixes = (
    classDigit: string,
    groupSet: Set<string>,
  ): number => {
    let total = 0;
    const cls = snap.classes.find((c) => String(c.code) === classDigit);
    if (!cls) return 0;
    for (const acc of cls.accounts) {
      const norm = normalizeCode(acc.code);
      if (!norm.startsWith(classDigit)) continue;
      const grp = norm.length >= 2 ? norm.slice(0, 2) : norm;
      if (groupSet.has(grp)) total += Number(acc.balance) || 0;
    }
    return total;
  };

  // Suma de cuentas por prefijo de codigo dentro de una clase (mirror de
  // `sumLeavesPrecise` + filtros por startsWith del preprocessor).
  const sumByCodePrefix = (classDigit: number, prefix: string): number => {
    const cls = snap.classes.find((c) => c.code === classDigit);
    if (!cls) return 0;
    let total = 0;
    for (const acc of cls.accounts) {
      if (normalizeCode(acc.code).startsWith(prefix)) {
        total += Number(acc.balance) || 0;
      }
    }
    return total;
  };

  const gastosTotales = totalExpenses + totalCosts + totalProduction;
  const efectivoCuenta11 = sumByGroupPrefixes('1', new Set(['11']));

  // -------------------------------------------------------------------------
  // cents + raw — recomputados desde los saldos AJUSTADOS, replicando las
  // mismas formulas de `buildSnapshotForPeriod` (trial-balance.ts §5.1).
  // Sin esto, el bloque vinculante pierde UAI/impuesto y el gate
  // `auditReportEmittable` compararia contra anclas pre-ajuste obsoletas.
  // El preprocessor tambien deriva cents via toCents(floatTotal), asi que
  // este mirror tiene exactamente la misma precision que el original.
  // -------------------------------------------------------------------------
  const impuestoCausado = sumByGroupPrefixes('5', new Set(['54']));
  // `ingresosNetos` — espejo de `trial-balance.ts`.
  const utilidadAntesImpuestos = ingresosNetos - (gastosTotales - impuestoCausado);

  // Saldo a favor del impuesto de renta — mismo detector del preprocessor:
  // 5404 acreedor (negativo en clase 5) > 1805 > 1355 > 0.
  const saldo5404 = sumByCodePrefix(5, '5404');
  const saldo1805 = sumByCodePrefix(1, '1805');
  const saldo1355 = sumByCodePrefix(1, '1355');
  let saldoAFavorImpuesto = 0;
  if (saldo5404 < 0) {
    saldoAFavorImpuesto = Math.abs(saldo5404);
  } else if (saldo1805 > 0) {
    saldoAFavorImpuesto = saldo1805;
  } else if (saldo1355 > 0) {
    saldoAFavorImpuesto = saldo1355;
  }

  // `ingresosNetos`, `totalDevoluciones` y sus centavos se calculan arriba,
  // junto a `netIncome` y su guarda, porque todo el P&L cuelga de ellos.

  const cents: ControlTotalsCents = {
    activo: toCents(totalAssets),
    pasivo: toCents(totalLiabilities),
    patrimonio: toCents(totalEquity),
    ingresos: toCents(totalRevenue),
    gastos: toCents(gastosTotales),
    utilidadNeta: toCents(netIncome),
    utilidadAntesImpuestos: toCents(utilidadAntesImpuestos),
    impuestoCausado: toCents(impuestoCausado),
    efectivoCuenta11: toCents(efectivoCuenta11),
    saldoAFavorImpuesto: toCents(saldoAFavorImpuesto),
    totalDevoluciones: totalDevolucionesCents,
    ingresosNetos: ingresosNetosCents,
  };

  const raw: ControlTotalsRaw = {
    activo: toRawString(totalAssets),
    pasivo: toRawString(totalLiabilities),
    patrimonio: toRawString(totalEquity),
    ingresos: toRawString(totalRevenue),
    gastos: toRawString(gastosTotales),
    utilidadNeta: toRawString(netIncome),
    utilidadAntesImpuestos: toRawString(utilidadAntesImpuestos),
    impuestoCausado: toRawString(impuestoCausado),
    efectivoCuenta11: toRawString(efectivoCuenta11),
    saldoAFavorImpuesto: toRawString(saldoAFavorImpuesto),
    totalDevoluciones: toRawString(totalDevoluciones),
    ingresosNetos: toRawString(ingresosNetos),
  };

  const prevTotals = snap.controlTotals;
  snap.controlTotals = {
    // Spread PRIMERO: preserva los campos derivados que este modulo NO
    // recalcula (KPIs Wave 2.F4: ebit, ratios, promedios; impuestoRentaNeto
    // R16; cashOpen del comparativo, ...). Mantienen su valor pre-ajuste —
    // mejor contrato que perderlos (el bloque vinculante y los renderers los
    // citan), aunque pueden quedar marginalmente desfasados si un ajuste
    // toca sus cuentas base. Las claves explicitas de abajo SI se recalculan
    // desde los saldos ajustados y sobreescriben al spread.
    ...prevTotals,
    activo: totalAssets,
    activoCorriente: sumByGroupPrefixes('1', ACTIVO_CORRIENTE_GROUPS),
    activoNoCorriente: sumByGroupPrefixes('1', ACTIVO_NO_CORRIENTE_GROUPS),
    pasivo: totalLiabilities,
    pasivoCorriente: sumByGroupPrefixes('2', PASIVO_CORRIENTE_GROUPS),
    pasivoNoCorriente: sumByGroupPrefixes('2', PASIVO_NO_CORRIENTE_GROUPS),
    patrimonio: totalEquity,
    ingresos: totalRevenue,
    gastos: gastosTotales,
    utilidadNeta: netIncome,
    efectivoCuenta11,
    deudoresCuenta13: sumByGroupPrefixes('1', new Set(['13'])),
    cuentasPorPagar23: sumByGroupPrefixes('2', new Set(['23'])),
    impuestosCuenta24: sumByGroupPrefixes('2', new Set(['24'])),
    obligacionesLaborales25: sumByGroupPrefixes('2', new Set(['25'])),
    totalDevoluciones,
    ingresosNetos,
    cents,
    raw,
  };
  // cashClose es alias semantico del saldo final de caja (= efectivoCuenta11).
  // Solo lo refrescamos si el preprocessor lo habia populado (contrato R6).
  if (typeof prevTotals.cashClose === 'number') {
    snap.controlTotals.cashClose = efectivoCuenta11;
  }

  // equityBreakdown — recalculado desde las hojas Clase 3 resultantes.
  // `convergenceAdjustment` (gap absorbido por R5) no es derivable de las
  // hojas: lo preservamos del breakdown previo para no romper el contrato.
  const prevConvergence = snap.equityBreakdown?.convergenceAdjustment;
  snap.equityBreakdown = recomputeEquityBreakdown(snap.classes);
  if (typeof prevConvergence === 'number') {
    snap.equityBreakdown.convergenceAdjustment = prevConvergence;
  }
}

// ---------------------------------------------------------------------------
// Mirrors de precision del preprocessor (privados en trial-balance.ts —
// duplicados intencionales, misma justificacion que PUC_CLASS_NAMES).
// ---------------------------------------------------------------------------

/** Mirror exacto de `toCents` del preprocessor. */
function toCents(value: number): bigint {
  if (!Number.isFinite(value)) return BigInt(0);
  return BigInt(Math.round(value * 100));
}

/** Mirror exacto de `toRawString` del preprocessor. */
function toRawString(value: number): string {
  if (!Number.isFinite(value)) return '0.00';
  const cents = Math.round(value * 100);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const integer = Math.floor(abs / 100);
  const fraction = (abs % 100).toString().padStart(2, '0');
  return `${sign}${integer}.${fraction}`;
}

// ---------------------------------------------------------------------------
// equityBreakdown re-compute (mismas convenciones del preprocessor)
// ---------------------------------------------------------------------------

function recomputeEquityBreakdown(
  classes: PUCClass[],
): PeriodSnapshot['equityBreakdown'] {
  const out: PeriodSnapshot['equityBreakdown'] = {};
  const cls3 = classes.find((c) => c.code === 3);
  if (!cls3) return out;

  const sumLeavesUnder = (prefix: string): number => {
    return cls3.accounts.reduce((s, a) => {
      const code = normalizeCode(a.code);
      return code.startsWith(prefix) ? s + (Number(a.balance) || 0) : s;
    }, 0);
  };

  const v3105 = sumLeavesUnder('3105');
  if (v3105 !== 0) out.capitalAutorizado = v3105;

  const v3115 = sumLeavesUnder('3115');
  const v3120 = sumLeavesUnder('3120');
  if (v3115 !== 0 || v3120 !== 0) {
    out.capitalSuscritoPagado = v3115 + v3120;
  }

  const v3305 = sumLeavesUnder('3305');
  if (v3305 !== 0) out.reservaLegal = v3305;

  // Otras reservas: hojas bajo grupo 33 excluyendo prefijo 3305
  let otrasRes = 0;
  for (const a of cls3.accounts) {
    const code = normalizeCode(a.code);
    if (
      code.startsWith('33') &&
      !code.startsWith('3305') &&
      Number(a.balance) !== 0
    ) {
      otrasRes += Number(a.balance) || 0;
    }
  }
  if (otrasRes !== 0) out.otrasReservas = otrasRes;

  const v3605 = sumLeavesUnder('3605');
  if (v3605 !== 0) out.utilidadEjercicio = v3605;

  const v3610 = sumLeavesUnder('3610');
  const v3705 = sumLeavesUnder('3705');
  const v3710 = sumLeavesUnder('3710');
  if (v3610 !== 0 || v3705 !== 0 || v3710 !== 0) {
    out.utilidadesAcumuladas = v3610 + v3705 + v3710;
  }

  return out;
}

// ---------------------------------------------------------------------------
// revalidate — chequeo ligero post-aplicacion sobre el snapshot `primary`.
// Multiperiodo: por defecto evalua el primary, pero acepta un snapshot
// explicito para validar otros periodos (util en tools que iteran).
// ---------------------------------------------------------------------------

/**
 * Re-valida un PreprocessedBalance ya con ajustes aplicados. Es deliberadamente
 * mas simple que el preprocessor original: chequea ecuacion patrimonial sobre
 * el snapshot `primary` (o el snapshot dado por el caller) y reporta utilidad
 * neta. Tolerancias consistentes con report-validator:
 *   - blocking: |diff| > 1% del activo o $10K (lo mayor)
 *   - warning : |diff| > $1K
 */
export function revalidate(
  balance: PreprocessedBalance,
  snapshot?: PeriodSnapshot,
): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const target = snapshot ?? balance.primary;
  const ct = target.controlTotals;
  const diff = ct.activo - (ct.pasivo + ct.patrimonio);
  const absDiff = Math.abs(diff);

  const blockingTol = Math.max(Math.abs(ct.activo) * 0.01, 10_000);
  const warningTol = 1_000;

  if (absDiff > blockingTol) {
    errors.push(
      `Ecuacion patrimonial descuadrada (${target.period}): Activo (${fmtCop(ct.activo)}) ` +
        `!= Pasivo (${fmtCop(ct.pasivo)}) + Patrimonio (${fmtCop(ct.patrimonio)}). ` +
        `Diferencia: ${fmtCop(diff)}.`,
    );
  } else if (absDiff > warningTol) {
    warnings.push(
      `Ecuacion patrimonial con diferencia menor (${target.period}): ${fmtCop(diff)} ` +
        `(< 1% del activo). Probable redondeo.`,
    );
  }

  // Cross-check utilidad: si Clase 3 trae 3605, debe ~= utilidadNeta
  const utilEjercicio = target.equityBreakdown.utilidadEjercicio;
  if (typeof utilEjercicio === 'number') {
    const utilDiff = ct.utilidadNeta - utilEjercicio;
    if (Math.abs(utilDiff) > 1_000) {
      warnings.push(
        `Utilidad neta P&L (${fmtCop(ct.utilidadNeta)}) difiere de la ` +
          `utilidad del ejercicio en patrimonio (${fmtCop(utilEjercicio)}) en ${target.period}: ` +
          `${fmtCop(utilDiff)}.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function fmtCop(n: number): string {
  if (!Number.isFinite(n)) return 'N/D';
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (n < 0 ? '-$' : '$') + formatted;
}
