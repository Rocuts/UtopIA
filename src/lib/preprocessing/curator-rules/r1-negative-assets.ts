// ---------------------------------------------------------------------------
// R1 — Saldos Incoherentes en Activos (Pulido Diamante: con mutación efectiva)
// ---------------------------------------------------------------------------
// Detecta cuentas de Clase 1 (Activo) con saldo NEGATIVO al cierre del periodo.
// Un activo con saldo crédito viola el principio NIIF de no-compensación
// (NIC 1, párr. 32) y suele indicar que la cuenta funciona en realidad como
// un pasivo transitorio (ej. sobregiros bancarios, anticipos de clientes
// mal codificados, retenciones acreditadas).
//
// CONTRATO POST PULIDO DIAMANTE:
//   - Para cuentas materiales (>= max(0.01% activo, $50.000)) la regla MUTA el
//     snapshot: mueve el saldo absoluto desde Clase 1 a una cuenta virtual
//     `2810ZZ-<originalCode>` inyectada en Clase 2, recalcula los control
//     totals (activo, pasivo, corrientes), y emite la `Reclassification`
//     marcada `applied: true`.
//   - Para cuentas NO materiales se emite SOLO un finding informativo (no se
//     muta el snapshot).
//   - La mutación es idempotente: correr R1 dos veces NO duplica reclasifi-
//     caciones (las cuentas virtuales `2810ZZ-*` que ya existen son ignoradas
//     en la siguiente pasada).
// ---------------------------------------------------------------------------

import type {
  ControlTotals,
  PUCClass,
  PeriodSnapshot,
  ValidatedAccount,
} from '../trial-balance';

import type { CuratorFinding, Reclassification } from './types';

const VIRTUAL_LIABILITY_PREFIX = '2810ZZ';
const VIRTUAL_LIABILITY_NAME = 'Otros pasivos transitorios (reclasificación curator)';

// ---------------------------------------------------------------------------
// Pulido NIIF PYME Grupo 2 — clase 12 (Inversiones) usa cuenta virtual
// distinta porque su naturaleza es de "ajuste de medición" (NIC 28 / NIC 39),
// no de pasivo transitorio operativo. Cuenta 2895 (Otros pasivos diversos)
// es semánticamente correcta para reclasificar reajustes fiscales con saldo
// crédito.
// ---------------------------------------------------------------------------
const VIRTUAL_LIABILITY_PREFIX_INVERSIONES = '2895VC';
const VIRTUAL_LIABILITY_NAME_INVERSIONES =
  'Otros pasivos diversos — reajuste fiscal Inversiones (reclasificación curator)';

/** Tolerancia: ignoramos saldos negativos triviales por redondeo. */
const NEGATIVE_TOLERANCE_COP = 100; // $100 COP

/**
 * Materialidad reducida para clase 12: cualquier saldo acreedor por encima de
 * $1.000 COP se reclasifica. Razón: los reajustes fiscales (cuenta 12053502)
 * son inmateriales en magnitud pero materiales en sentido contable
 * (incumplimiento NIC 1 párr. 32 si quedan en activo).
 */
const INVERSIONES_MATERIAL_FLOOR_COP = 1_000;

const ACTIVO_CORRIENTE_GROUPS = new Set(['11', '12', '13', '14']);
const ACTIVO_NO_CORRIENTE_GROUPS = new Set(['15', '16', '17', '18', '19']);
const PASIVO_CORRIENTE_GROUPS = new Set(['21', '22', '23', '24', '25', '26']);
const PASIVO_NO_CORRIENTE_GROUPS = new Set(['27', '28', '29']);

export interface R1Result {
  reclassifications: Reclassification[];
  findings: CuratorFinding[];
}

export function runR1(snapshot: PeriodSnapshot): R1Result {
  const out: R1Result = { reclassifications: [], findings: [] };

  const claseActivo = snapshot.classes.find((c: PUCClass) => c.code === 1);
  if (!claseActivo) return out;

  // Si el activo total es 0 (nada que reclasificar contra), ignoramos. La
  // regla se ancla en porcentaje de activo, así que sin activo no hay
  // material threshold definible.
  if (snapshot.controlTotals.activo === 0) return out;

  // Materialidad: max(0.01% activo, $50.000).
  const MATERIAL_THRESHOLD_COP = Math.max(
    Math.abs(snapshot.controlTotals.activo) * 0.0001,
    50_000,
  );

  // Filtrar cuentas con saldo negativo > tolerancia trivial. Excluir cuentas
  // virtuales que pudieran existir si R1 corrió antes (idempotencia).
  const negativos = claseActivo.accounts.filter(
    (a: ValidatedAccount) =>
      a.balance < -NEGATIVE_TOLERANCE_COP &&
      !a.code.startsWith(VIRTUAL_LIABILITY_PREFIX) &&
      !a.code.startsWith(VIRTUAL_LIABILITY_PREFIX_INVERSIONES),
  );
  if (negativos.length === 0) return out;

  // Localizar Clase 2 (Pasivo) — la creamos vacía si no existe (caso límite).
  let clasePasivo = snapshot.classes.find((c: PUCClass) => c.code === 2);
  if (!clasePasivo) {
    clasePasivo = {
      code: 2,
      name: 'Pasivo',
      auxiliaryTotal: 0,
      reportedTotal: null,
      discrepancy: 0,
      accounts: [],
    };
    snapshot.classes.push(clasePasivo);
  }

  // Particionar en materiales (mutamos) vs no-materiales (solo finding).
  // Para grupo 12 (Inversiones), la materialidad efectiva es $1.000 COP — los
  // reajustes fiscales pequeños siguen incumpliendo NIC 1 párr. 32 y deben
  // reclasificarse explícitamente.
  const isInversiones = (a: ValidatedAccount) => a.code.startsWith('12');
  const effectiveThreshold = (a: ValidatedAccount) =>
    isInversiones(a) ? INVERSIONES_MATERIAL_FLOOR_COP : MATERIAL_THRESHOLD_COP;
  const materiales = negativos.filter(
    (a) => Math.abs(a.balance) >= effectiveThreshold(a),
  );
  const noMateriales = negativos.filter(
    (a) => Math.abs(a.balance) < effectiveThreshold(a),
  );

  for (const acc of materiales) {
    const amountAbs = Math.abs(acc.balance);
    const originalBalance = acc.balance;
    const accIsInversiones = isInversiones(acc);
    const prefix = accIsInversiones
      ? VIRTUAL_LIABILITY_PREFIX_INVERSIONES
      : VIRTUAL_LIABILITY_PREFIX;
    const reclassifiedToName = accIsInversiones
      ? VIRTUAL_LIABILITY_NAME_INVERSIONES
      : VIRTUAL_LIABILITY_NAME;
    const virtualCode = `${prefix}-${acc.code}`;

    // 1. Anular la cuenta original en Clase 1 (queda en 0; no la removemos del
    //    array para preservar la trazabilidad — los renderers que filtren
    //    saldos != 0 lo ignorarán naturalmente).
    acc.balance = 0;

    // 2. Inyectar la cuenta virtual en Clase 2 (Pasivo) con el saldo absoluto.
    //    Si por alguna razón ya existe (ej. corrida previa de R1), sumamos.
    const existing = clasePasivo.accounts.find((a) => a.code === virtualCode);
    if (existing) {
      existing.balance += amountAbs;
    } else {
      const virtualAccount: ValidatedAccount = {
        code: virtualCode,
        name: `${reclassifiedToName} ← ${acc.code} ${acc.name}`,
        level: 'Auxiliar',
        balance: amountAbs,
        isLeaf: true,
      };
      clasePasivo.accounts.push(virtualAccount);
    }

    const justification = accIsInversiones
      ? `Saldo crédito en cuenta de Inversiones (clase 12) — típicamente reajuste ` +
        `fiscal de partidas medidas a costo (NIC 28 / NIIF para PYMES Sec. 14). ` +
        `Reclasificado a ${virtualCode} (Otros pasivos diversos) para preservar ` +
        `NIC 1 párr. 32 (no compensación). Revisar la naturaleza tributaria del reajuste.`
      : `Saldo crédito en cuenta de activo viola NIC 1 párr. 32 (no compensación). ` +
        `Reclasificado a ${virtualCode} para preservar ecuación patrimonial. ` +
        `Investigar origen del saldo (sobregiro, anticipo, retención).`;

    out.reclassifications.push({
      accountCode: acc.code,
      accountName: acc.name,
      originalBalanceCop: originalBalance,
      reclassifiedToCode: virtualCode,
      reclassifiedToName,
      amountCop: amountAbs,
      justification,
      applied: true,
      effectiveTransferCop: amountAbs,
      balanceFootnoteText: accIsInversiones
        ? 'Reclasificación por reajuste fiscal en Inversiones'
        : 'Reclasificación por saldo acreedor en cuenta de activo',
    });
  }

  // 3. Si efectivamente mutamos, recomputar control totals desde el snapshot.
  if (materiales.length > 0) {
    recomputeControlTotalsFromClasses(snapshot.controlTotals, snapshot.classes);

    // 4. Persistir las reclasificaciones aplicadas en el snapshot (campo del
    //    contrato de PeriodSnapshot post-Pulido-Diamante).
    snapshot.reclassifications = [
      ...(snapshot.reclassifications ?? []),
      ...out.reclassifications,
    ];
  }

  // 5. Findings — uno agregado para materiales (severity alto), uno informativo
  //    para no-materiales (severity informativo, sin mutación).
  if (out.reclassifications.length > 0) {
    const totalReclasificado = out.reclassifications.reduce((s, r) => s + r.amountCop, 0);
    const accountsList = out.reclassifications
      .map((r) => `${r.accountCode} (${r.accountName}) $${formatCOP(r.originalBalanceCop)}`)
      .join('; ');

    out.findings.push({
      code: 'CUR-R1',
      severity: 'alto',
      title: `Saldos incoherentes detectados en ${out.reclassifications.length} cuenta(s) de activo`,
      description:
        `Una o más cuentas de Clase 1 (Activo) presentan saldo crédito (negativo): ${accountsList}. ` +
        `El curator reclasificó automáticamente $${formatCOP(totalReclasificado)} a cuentas virtuales ` +
        `${VIRTUAL_LIABILITY_PREFIX}-* (${VIRTUAL_LIABILITY_NAME}) y recalculó los control totals.`,
      normReference: 'NIC 1 párr. 32 (no compensación)',
      recommendation:
        `Investigar el origen del saldo crédito en cada cuenta y, si corresponde, mover el saldo ` +
        `manualmente a la cuenta de pasivo apropiada (típicamente sobregiros 21xx, anticipos 28xx ` +
        `o retenciones 23xx/24xx).`,
      impact:
        `Los estados financieros oficiales no pueden presentar activos con saldo crédito. ` +
        `Sin este ajuste, la rentabilidad y los ratios financieros quedan distorsionados.`,
      period: snapshot.period,
    });
  }

  if (noMateriales.length > 0) {
    const list = noMateriales
      .map((a) => `${a.code} (${a.name}) $${formatCOP(a.balance)}`)
      .join('; ');
    out.findings.push({
      code: 'CUR-R1',
      severity: 'informativo',
      title: `Saldos negativos no materiales en activos (${noMateriales.length} cuenta(s))`,
      description:
        `Cuentas de Clase 1 con saldo crédito por debajo del umbral de materialidad ` +
        `($${formatCOP(MATERIAL_THRESHOLD_COP)}): ${list}. No se mutó el snapshot — ` +
        `revisar manualmente.`,
      normReference: 'NIC 1 párr. 32 (no compensación)',
      recommendation:
        'Auditar al cierre y, si el saldo crédito es legítimo, depurar la cuenta o reclasificar manualmente.',
      impact:
        'Inmaterial individualmente, pero la acumulación de pequeñas incoherencias degrada la calidad del balance.',
      period: snapshot.period,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recomputeControlTotalsFromClasses(
  totals: ControlTotals,
  classes: PUCClass[],
): void {
  const claseActivo = classes.find((c) => c.code === 1);
  const clasePasivo = classes.find((c) => c.code === 2);

  // Recalcular auxiliaryTotal de cada clase tras la mutación.
  if (claseActivo) {
    claseActivo.auxiliaryTotal = claseActivo.accounts.reduce((s, a) => s + a.balance, 0);
  }
  if (clasePasivo) {
    clasePasivo.auxiliaryTotal = clasePasivo.accounts.reduce((s, a) => s + a.balance, 0);
  }

  totals.activo = claseActivo?.auxiliaryTotal ?? 0;
  totals.pasivo = clasePasivo?.auxiliaryTotal ?? 0;

  totals.activoCorriente = sumByGroups(claseActivo, ACTIVO_CORRIENTE_GROUPS);
  totals.activoNoCorriente = sumByGroups(claseActivo, ACTIVO_NO_CORRIENTE_GROUPS);
  totals.pasivoCorriente = sumByGroups(clasePasivo, PASIVO_CORRIENTE_GROUPS);
  totals.pasivoNoCorriente = sumByGroups(clasePasivo, PASIVO_NO_CORRIENTE_GROUPS);

  // Sincronizar cents y raw para activo/pasivo si el parser los populó.
  // El gate `auditReportEmittable` lee cents — si quedan obsoletos tras la
  // mutación de R1, las V1/V2 fallan con falso negativo.
  if (totals.cents) {
    totals.cents.activo = BigInt(Math.round(totals.activo * 100));
    totals.cents.pasivo = BigInt(Math.round(totals.pasivo * 100));
  }
  if (totals.raw) {
    totals.raw.activo = formatCanonical(totals.activo);
    totals.raw.pasivo = formatCanonical(totals.pasivo);
  }
}

function formatCanonical(value: number): string {
  if (!Number.isFinite(value)) return '0.00';
  const cents = Math.round(value * 100);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const integer = Math.floor(abs / 100);
  const fraction = (abs % 100).toString().padStart(2, '0');
  return `${sign}${integer}.${fraction}`;
}

function sumByGroups(cl: PUCClass | undefined, groups: Set<string>): number {
  if (!cl) return 0;
  let sum = 0;
  for (const acc of cl.accounts) {
    // Tomamos los 2 primeros chars como grupo PUC. Para cuentas virtuales
    // `2810ZZ-*` los 2 primeros chars son '28' y caen en pasivo no corriente,
    // que es lo que queremos (Otros pasivos no clasificados de largo plazo).
    const grp = acc.code.length >= 2 ? acc.code.slice(0, 2) : acc.code;
    if (groups.has(grp)) sum += acc.balance;
  }
  return sum;
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
