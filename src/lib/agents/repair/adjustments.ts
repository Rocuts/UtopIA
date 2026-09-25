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
import {
  clientesNetosDeHojas,
  curatorFindingToDiscrepancy,
  extractEquityBreakdown,
  ingresosClase4Cents,
  isRentaCreditAccount,
  refreshDerivedKpis,
} from '@/lib/preprocessing/trial-balance';
import { runR8 } from '@/lib/preprocessing/curator-rules/r8-virtual-close';
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
      // Subconjuntos de `reasons` que el orquestador nunca degrada (integridad
      // de la lectura y bloqueos post-R8 del curator). Sin copiarlos, un
      // balance con ajustes perdía la marca y el Bridge los levantaba.
      ...(snap.validation.integrityReasons
        ? { integrityReasons: [...snap.validation.integrityReasons] }
        : {}),
      ...(snap.validation.curatorBlockingReasons
        ? { curatorBlockingReasons: [...snap.validation.curatorBlockingReasons] }
        : {}),
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
 *     RECALCULAN desde cero a partir de las hojas resultantes, y R8 (Cierre
 *     Virtual) se re-ejecuta sobre ellas: 3605VC/3710VC, los hallazgos CUR-R8
 *     y el bloqueo `[CUR-R8]` de `validation` reflejan el balance AJUSTADO.
 *   - El resto de validation, discrepancies, missingExpectedAccounts y
 *     validationReport NO se mutan aqui — el caller debe usar `revalidate()`
 *     cuando necesite el estado de salud post-ajustes.
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
    resyncVirtualClose(snap);
  }
  // KPIs derivados con la misma función del preprocesador (IW2). Se refrescan
  // TODOS los periodos en orden: los promedios del periodo siguiente dependen
  // del patrimonio y el activo del anterior.
  if (dirtySnapshots.size > 0) {
    next.periods.forEach((snap, i) => refreshDerivedKpis(snap, i > 0 ? next.periods[i - 1] : null));
  }

  return { balance: next, affected };
}

// ---------------------------------------------------------------------------
// resyncVirtualClose — R8 sobre el snapshot ajustado
// ---------------------------------------------------------------------------
// El preprocesador ancló 3605VC a la utilidad PRE-ajuste. Un ajuste a las
// clases 4-7 cambia la utilidad y, sin volver a correr R8, el patrimonio
// conservaba el resultado anterior: la ecuación quedaba descuadrada por el
// monto del ajuste y el bloqueo CUR-R8 del balance original seguía vigente
// aunque el ajuste lo hubiera resuelto. Hasta la auditoría 2026-09 R8
// absorbía ese residual en 3710VC y el desfase no se veía.
//
// R8 es idempotente (reemplaza sus cuentas virtuales y sus propios bloqueos
// `[CUR-R8]`), así que se re-ejecuta con la misma regla del preprocesador:
// si el ajuste explica el descuadre, el bloqueo se retira; si no, queda con
// el residual post-ajuste exacto al centavo. Sus hallazgos reemplazan los
// CUR-R8 del curator y de `discrepancies`. Las demás reglas del curator no se
// re-ejecutan (sus bloqueos se conservan: ver `curatorBlockingReasons`).
// ---------------------------------------------------------------------------

function resyncVirtualClose(snap: PeriodSnapshot): void {
  const { virtualCloseAdjustment, findings } = runR8(snap);
  if (snap.curator) {
    snap.curator = {
      ...snap.curator,
      virtualCloseAdjustment,
      findings: [...snap.curator.findings.filter((f) => f.code !== 'CUR-R8'), ...findings],
    };
  }
  snap.discrepancies = [
    ...snap.discrepancies.filter((d) => !d.location.startsWith('[CURATOR CUR-R8 ')),
    ...findings.map((f) => curatorFindingToDiscrepancy(f, snap)),
  ];
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

  // Devoluciones 4175 e ingresos operacionales (41 − 4175) con la MISMA
  // función del preprocesador (`ingresosClase4Cents`). Antes este bloque era un
  // espejo manual: si divergía, un ajuste de reparación reescribía el P&L con
  // otro criterio que el preprocesador y el bloque vinculante dejaba de
  // cuadrar. La guarda NIA 240 de más abajo sigue siendo la del preprocesador.
  const ZERO_BIG = BigInt(0);
  const hojas = snap.classes.flatMap((c) =>
    c.accounts.map((a) => ({ code: normalizeCode(a.code), balance: Number(a.balance) || 0 })),
  );
  const {
    ingresosBrutoCents,
    totalDevolucionesCents,
    ingresosNetosCents,
    ingresosOperacionalesNetosCents,
  } = ingresosClase4Cents(hojas);
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

  const gastosTotales = totalExpenses + totalCosts + totalProduction;
  const efectivoCuenta11 = sumByGroupPrefixes('1', new Set(['11']));
  const ingresosOperacionalesNetos = Number(ingresosOperacionalesNetosCents) / 100;
  const utilidadBruta = ingresosOperacionalesNetos - (totalCosts + totalProduction);

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

  // Saldo a favor del impuesto de renta — MISMA regla del preprocesador
  // (niif-preproceso-19): créditos de renta de la lista blanca
  // `isRentaCreditAccount` (135505, 135515, 135595 de renta y 1805 sólo si su
  // nombre indica un impuesto) menos el pasivo 2404, en centavos y sólo si es
  // positivo. El detector anterior (5404 → 1805 → 1355 bruto) publicaba obras
  // de arte, ReteIVA o ReteICA como saldo a favor tras cualquier ajuste.
  const sumCentsWhere = (classDigit: number, pred: (code: string, name: string) => boolean): bigint => {
    const cls = snap.classes.find((c) => c.code === classDigit);
    if (!cls) return ZERO_BIG;
    let acc = ZERO_BIG;
    for (const a of cls.accounts) {
      if (pred(normalizeCode(a.code), a.name ?? '')) acc += toCents(Number(a.balance) || 0);
    }
    return acc;
  };
  const saldoAFavorCents =
    sumCentsWhere(1, isRentaCreditAccount) - sumCentsWhere(2, (code) => code.startsWith('2404'));
  const saldoAFavorImpuesto = saldoAFavorCents > ZERO_BIG ? Number(saldoAFavorCents) / 100 : 0;

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
    saldoAFavorImpuesto: saldoAFavorCents > ZERO_BIG ? saldoAFavorCents : ZERO_BIG,
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
    // Spread PRIMERO: preserva los campos que este modulo NO recalcula
    // (impuestoRentaNeto R16, cashOpen del comparativo, ...). Las claves
    // explicitas de abajo SI se recalculan desde los saldos ajustados y
    // sobreescriben al spread; los ratios y promedios los refresca
    // `refreshDerivedKpis` al final de `applyAdjustments`.
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
    // Sub-bloque P&L de soporte de los KPIs (IW2): antes quedaba con su valor
    // pre-ajuste y un ajuste al grupo 41 dejaba EBIT, márgenes y los ingresos
    // operacionales que publican los entregables desfasados de la utilidad.
    ingresosOperacionalesNetos,
    otrosIngresosNoOperacionales: Number(ingresosNetosCents - ingresosOperacionalesNetosCents) / 100,
    utilidadBruta,
    ebit: utilidadBruta - sumByGroupPrefixes('5', new Set(['51'])) - sumByGroupPrefixes('5', new Set(['52'])),
    inventarios14: sumByGroupPrefixes('1', new Set(['14'])),
    proveedores22: sumByGroupPrefixes('2', new Set(['22'])),
    costoVentas6: totalCosts,
    costoProduccion7: totalProduction,
    gastoFinanciero5305: Number(
      hojas
        .filter((h) => h.code.startsWith('5305'))
        .reduce((acc, h) => acc + toCents(h.balance), ZERO_BIG),
    ) / 100,
    clientesNetos: clientesNetosDeHojas(hojas),
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

/**
 * Desglose del patrimonio con la MISMA regla del preprocesador
 * (`extractEquityBreakdown`, niif-preproceso-13): grupo 31 completo como
 * capital suscrito y pagado (310505 informativo), 32 superávit de capital,
 * 3305 / resto del 33 reservas, 34 revalorización, 35 dividendos en acciones,
 * 36 (3605 y 3610) resultado del ejercicio, 37 completo acumuladas, 38
 * valorizaciones y el resto de la clase 3 aparte. Las cuentas de la clase son
 * hojas (preprocesador o ajuste), así que se marcan transaccionales para que
 * el extractor no las vuelva a filtrar por nivel.
 */
function recomputeEquityBreakdown(
  classes: PUCClass[],
): PeriodSnapshot['equityBreakdown'] {
  const cls3 = classes.find((c) => c.code === 3);
  if (!cls3) return {};
  return extractEquityBreakdown(
    cls3.accounts.map((a) => ({
      code: normalizeCode(a.code),
      name: a.name,
      level: a.level,
      transactional: true,
      balance: Number(a.balance) || 0,
    })),
    [],
  );
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
