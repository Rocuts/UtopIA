// ---------------------------------------------------------------------------
// Repair Chat — applyAdjustments util (Phase 2, pure)
// ---------------------------------------------------------------------------
// Aplica ajustes contables determinísticamente sobre un PreprocessedBalance,
// reconstruyendo controlTotals, summary, equityBreakdown y la jerarquia de
// cuentas (hojas + ancestros). Sin side effects: clona todo lo que toca.
//
// Esta misma util es invocada por:
//   - tools del repair chat (preview de propose_adjustment, recheck_validation)
//   - financial orchestrator (post-preprocesamiento, antes del Stage 1)
// asi el reporte final refleja exactamente lo que el usuario aprobo en el chat.
// ---------------------------------------------------------------------------

import type {
  PreprocessedBalance,
  PUCClass,
  ValidatedAccount,
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

function cloneBalance(pp: PreprocessedBalance): PreprocessedBalance {
  return {
    period: pp.period,
    classes: pp.classes.map(cloneClass),
    summary: { ...pp.summary },
    controlTotals: { ...pp.controlTotals },
    equityBreakdown: { ...pp.equityBreakdown },
    validation: {
      blocking: pp.validation.blocking,
      reasons: [...pp.validation.reasons],
      suggestedAccounts: [...pp.validation.suggestedAccounts],
      adjustments: [...pp.validation.adjustments],
    },
    discrepancies: pp.discrepancies.map((d) => ({ ...d })),
    missingAccounts: [...pp.missingAccounts],
    auxiliaryCount: pp.auxiliaryCount,
    totalRowCount: pp.totalRowCount,
    validationReport: pp.validationReport,
    cleanData: pp.cleanData,
  };
}

/**
 * Retorna el siguiente nivel jerarquico PUC clasico:
 *   1 -> 2 -> 4 -> 6 -> 8 (Auxiliar). Codigos atipicos retornan null.
 */
function nextHierarchyLength(len: number): number | null {
  if (len === 1) return 2;
  if (len === 2) return 4;
  if (len === 4) return 6;
  if (len === 6) return 8;
  return null;
}

// ---------------------------------------------------------------------------
// applyAdjustments
// ---------------------------------------------------------------------------

/**
 * Aplica los `adjustments` con status === 'applied' al `balance`, en orden de
 * llegada. Devuelve un objeto NUEVO con balance reconstruido y un resumen de
 * cuentas afectadas. Los ajustes con otros status se ignoran.
 *
 * Decisiones de diseno (documentadas tambien en el reporte de Phase 2):
 *   - Las cuentas nuevas se crean como hojas (`isLeaf = true`) en la clase
 *     derivada del primer digito del codigo. El nivel se infiere por longitud
 *     (Clase / Grupo / Cuenta / Subcuenta / Auxiliar). El `previousBalance`
 *     queda en `undefined`.
 *   - Cuando un ajuste apunta a una cuenta hoja existente, se SUMA el `amount`
 *     (signed) a su balance.
 *   - Cuando un ajuste apunta a un codigo no-hoja (Clase/Grupo/Cuenta/Subcuenta),
 *     se trata como hoja nueva en ese mismo codigo (ya hay precedente: el
 *     preprocessor admite Subcuentas huerfanas como hojas). Esto puede crear
 *     superposicion con descendientes existentes — decidida como aceptable
 *     para Phase 2 porque el contrato del agente exige proponer codigos hoja
 *     concretos.
 *   - controlTotals, summary y equityBreakdown se RECALCULAN desde cero a
 *     partir de las hojas resultantes. La ecuacion patrimonial se evalua
 *     con la misma tolerancia (100 COP) que usa el preprocessor.
 *   - validation, discrepancies, missingAccounts y validationReport NO se
 *     mutan aqui — el caller debe usar `revalidate()` cuando necesite el
 *     estado de salud post-ajustes.
 *
 * Es pura: no muta `balance` ni los `Adjustment[]` recibidos.
 */
export function applyAdjustments(
  balance: PreprocessedBalance,
  adjustments: Adjustment[],
): AdjustmentApplication {
  const next = cloneBalance(balance);
  const affected: AdjustmentApplicationAffected[] = [];

  for (const adj of adjustments) {
    if (!adj || adj.status !== 'applied') continue;

    const code = normalizeCode(adj.accountCode);
    const amount = Number(adj.amount);
    if (!code || !Number.isFinite(amount) || amount === 0) continue;
    const classDigit = classDigitFromCode(code);
    if (classDigit === null) continue;

    // ---------------------------------------------------------------------
    // 1. Localizar / crear la clase
    // ---------------------------------------------------------------------
    let cls = next.classes.find((c) => c.code === classDigit);
    if (!cls) {
      cls = {
        code: classDigit,
        name: PUC_CLASS_NAMES[classDigit] || `Clase ${classDigit}`,
        auxiliaryTotal: 0,
        reportedTotal: null,
        discrepancy: 0,
        accounts: [],
      };
      next.classes.push(cls);
    }

    // ---------------------------------------------------------------------
    // 2. Buscar la cuenta hoja por code exacto
    // ---------------------------------------------------------------------
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
      });
    }
  }

  // -------------------------------------------------------------------------
  // 3. Recalcular auxiliaryTotal por clase + summary + controlTotals
  // -------------------------------------------------------------------------
  for (const cls of next.classes) {
    cls.auxiliaryTotal = cls.accounts.reduce(
      (s, a) => s + (Number(a.balance) || 0),
      0,
    );
    if (cls.reportedTotal !== null) {
      cls.discrepancy = Math.abs(cls.auxiliaryTotal - cls.reportedTotal);
    }
  }

  const getClassTotal = (c: number) =>
    next.classes.find((cl) => cl.code === c)?.auxiliaryTotal ?? 0;

  const totalAssets = getClassTotal(1);
  const totalLiabilities = getClassTotal(2);
  const totalEquity = getClassTotal(3);
  const totalRevenue = getClassTotal(4);
  const totalExpenses = getClassTotal(5);
  const totalCosts = getClassTotal(6);
  const totalProduction = getClassTotal(7);
  const netIncome =
    totalRevenue - totalExpenses - totalCosts - totalProduction;

  const equationBalance = totalAssets - totalLiabilities - totalEquity;
  const equationBalanced = Math.abs(equationBalance) < 100;

  next.summary = {
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

  // -------------------------------------------------------------------------
  // 4. controlTotals — incluyendo segregacion Big Four (PUC 11/13/23/24/25)
  // -------------------------------------------------------------------------
  const sumByGroupPrefixes = (
    classDigit: string,
    groupSet: Set<string>,
  ): number => {
    let total = 0;
    const cls = next.classes.find((c) => String(c.code) === classDigit);
    if (!cls) return 0;
    for (const acc of cls.accounts) {
      const norm = normalizeCode(acc.code);
      if (!norm.startsWith(classDigit)) continue;
      const grp = norm.length >= 2 ? norm.slice(0, 2) : norm;
      if (groupSet.has(grp)) total += Number(acc.balance) || 0;
    }
    return total;
  };

  next.controlTotals = {
    activo: totalAssets,
    activoCorriente: sumByGroupPrefixes('1', ACTIVO_CORRIENTE_GROUPS),
    activoNoCorriente: sumByGroupPrefixes('1', ACTIVO_NO_CORRIENTE_GROUPS),
    pasivo: totalLiabilities,
    pasivoCorriente: sumByGroupPrefixes('2', PASIVO_CORRIENTE_GROUPS),
    pasivoNoCorriente: sumByGroupPrefixes('2', PASIVO_NO_CORRIENTE_GROUPS),
    patrimonio: totalEquity,
    ingresos: totalRevenue,
    gastos: totalExpenses + totalCosts + totalProduction,
    utilidadNeta: netIncome,
    efectivoCuenta11: sumByGroupPrefixes('1', new Set(['11'])),
    deudoresCuenta13: sumByGroupPrefixes('1', new Set(['13'])),
    cuentasPorPagar23: sumByGroupPrefixes('2', new Set(['23'])),
    impuestosCuenta24: sumByGroupPrefixes('2', new Set(['24'])),
    obligacionesLaborales25: sumByGroupPrefixes('2', new Set(['25'])),
  };

  // -------------------------------------------------------------------------
  // 5. equityBreakdown — recalculado desde las hojas Clase 3 resultantes
  // -------------------------------------------------------------------------
  next.equityBreakdown = recomputeEquityBreakdown(next.classes);

  // auxiliaryCount queda como suma de hojas resultantes (cualquier cuenta
  // creada por un ajuste cuenta como hoja).
  next.auxiliaryCount = next.classes.reduce(
    (s, c) => s + c.accounts.length,
    0,
  );

  return { balance: next, affected };
}

// ---------------------------------------------------------------------------
// equityBreakdown re-compute (mismas convenciones del preprocessor)
// ---------------------------------------------------------------------------

function recomputeEquityBreakdown(
  classes: PUCClass[],
): PreprocessedBalance['equityBreakdown'] {
  const out: PreprocessedBalance['equityBreakdown'] = {};
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
// revalidate — chequeo ligero post-aplicacion
// ---------------------------------------------------------------------------

/**
 * Re-valida un PreprocessedBalance ya con ajustes aplicados. Es deliberadamente
 * mas simple que el preprocessor original: chequea ecuacion patrimonial y
 * reporta utilidad neta. Tolerancias consistentes con report-validator:
 *   - blocking: |diff| > 1% del activo o $10K (lo mayor)
 *   - warning : |diff| > $1K
 */
export function revalidate(balance: PreprocessedBalance): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const ct = balance.controlTotals;
  const diff = ct.activo - (ct.pasivo + ct.patrimonio);
  const absDiff = Math.abs(diff);

  const blockingTol = Math.max(Math.abs(ct.activo) * 0.01, 10_000);
  const warningTol = 1_000;

  if (absDiff > blockingTol) {
    errors.push(
      `Ecuacion patrimonial descuadrada: Activo (${fmtCop(ct.activo)}) ` +
        `!= Pasivo (${fmtCop(ct.pasivo)}) + Patrimonio (${fmtCop(ct.patrimonio)}). ` +
        `Diferencia: ${fmtCop(diff)}.`,
    );
  } else if (absDiff > warningTol) {
    warnings.push(
      `Ecuacion patrimonial con diferencia menor: ${fmtCop(diff)} ` +
        `(< 1% del activo). Probable redondeo.`,
    );
  }

  // Cross-check utilidad: si Clase 3 trae 3605, debe ~= utilidadNeta
  const utilEjercicio = balance.equityBreakdown.utilidadEjercicio;
  if (typeof utilEjercicio === 'number') {
    const utilDiff = ct.utilidadNeta - utilEjercicio;
    if (Math.abs(utilDiff) > 1_000) {
      warnings.push(
        `Utilidad neta P&L (${fmtCop(ct.utilidadNeta)}) difiere de la ` +
          `utilidad del ejercicio en patrimonio (${fmtCop(utilEjercicio)}): ` +
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
