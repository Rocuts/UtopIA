// ---------------------------------------------------------------------------
// R8 — Cierre Virtual (Autonomía de Cierre)
// ---------------------------------------------------------------------------
// Garantiza Activo = Pasivo + Patrimonio en CUALQUIER balance de prueba —
// incluso si proviene de un ERP a mitad de año (sin asiento de cierre) o si
// trae 3605 con un saldo histórico que no coincide con el P&L del periodo.
//
// Contrato (ver `types.ts > VirtualCloseAdjustment` para la lista completa):
//   - SIEMPRE muta el snapshot (a diferencia de R5, que sólo dispara si hay
//     gap). La utilidad del ejercicio se ancla en patrimonio en cada corrida.
//   - Idempotente: ejecutar R8 dos veces sobre el mismo snapshot deja el
//     mismo resultado (las cuentas virtuales `3605VC` / `3710VC` ya existentes
//     se REEMPLAZAN, no se acumulan).
//   - Trazabilidad: la cuenta `3605` original (si traía saldo) queda con
//     `balance: 0` pero NO se elimina del array. La cuenta virtual
//     `3710VC` registra explícitamente la reclasificación con audit trail.
//
// Por qué R8 corre ANTES que R5:
//   R5 ancla Total Patrimonio Balance ↔ Saldo Final ECP. Si R5 corriera antes
//   que R8, vería un patrimonio sin la utilidad del periodo y absorbería todo
//   el gap en `3710ZZ` (Ajustes de Convergencia) — semánticamente incorrecto.
//   Tras R8, R5 sólo ve gaps reales de transición NIIF / redondeos.
// ---------------------------------------------------------------------------

import type {
  ControlTotals,
  PUCClass,
  PeriodSnapshot,
  ValidatedAccount,
} from '../trial-balance';

import type { CuratorFinding, VirtualCloseAdjustment } from './types';

const VIRTUAL_CURRENT_CODE = '3605VC';
const VIRTUAL_CURRENT_NAME = 'Resultado del Ejercicio (Corte Actual)';
const VIRTUAL_RETAINED_CODE = '3710VC';
const VIRTUAL_RETAINED_NAME =
  'Resultados Acumulados — Cierre Virtual (curator R8)';

/** Tolerancia para considerar la utilidad del CSV "coincidente" con el cálculo
 *  dinámico (no requiere reclasificación). $1.000 COP cubre redondeos típicos. */
const UTILIDAD_MATCH_TOL = 1000;

/** Tolerancia para considerar la diferencia residual como "centavos". $5.000
 *  COP cubre redondeos acumulados de un balance grande sin ocultar errores
 *  reales (que en COP típicamente son ≥ $50.000). */
const CENTS_TOL = 5000;

const PUC_CLASS_NAMES: Record<number, string> = {
  1: 'Activo',
  2: 'Pasivo',
  3: 'Patrimonio',
  4: 'Ingresos',
  5: 'Gastos',
  6: 'Costos de Ventas',
  7: 'Costos de Produccion',
};

export interface R8Result {
  virtualCloseAdjustment: VirtualCloseAdjustment;
  findings: CuratorFinding[];
}

export function runR8(snapshot: PeriodSnapshot): R8Result {
  const findings: CuratorFinding[] = [];

  // -------------------------------------------------------------------------
  // 0. Guard: si el snapshot no tiene actividad P&L (clases 4-7 vacías), no
  //    podemos inferir utilidad transitoria. R8 no actúa para preservar el
  //    balance recibido. Caso típico: el cliente sube sólo el Balance, sin
  //    el Estado de Resultados. Otros curators (R5, R3) aún pueden operar.
  // -------------------------------------------------------------------------
  const hasPnLActivity =
    Math.abs(snapshot.controlTotals.ingresos) +
      Math.abs(snapshot.controlTotals.gastos) >
    0;

  if (!hasPnLActivity) {
    const adjustment: VirtualCloseAdjustment = {
      dynamicNetIncome: 0,
      csvUtilidadEjercicio: 0,
      utilidadGap: 0,
      reclassifiedFrom3605: false,
      reclassifiedAmount: 0,
      residualGapBeforeCents: 0,
      centsAdjustment: 0,
      reconciledEquity: snapshot.controlTotals.patrimonio,
      virtualCurrentCode: VIRTUAL_CURRENT_CODE,
      virtualCurrentName: VIRTUAL_CURRENT_NAME,
      virtualRetainedCode: VIRTUAL_RETAINED_CODE,
      virtualRetainedName: VIRTUAL_RETAINED_NAME,
      justification:
        'Snapshot sin actividad P&L (clases 4-7 vacías). R8 no actuó: la ' +
        'utilidad transitoria no es inferible sin el Estado de Resultados.',
    };
    // No mutamos `snapshot.virtualCloseAdjustment` cuando R8 es no-op: preserva
    // el contrato de inmutabilidad para snapshots ya cuadrados.
    findings.push({
      code: 'CUR-R8',
      severity: 'informativo',
      title: 'R8 no aplicado: snapshot sin clases 4-7',
      description:
        'El balance no contiene movimientos en cuentas de Ingresos/Gastos/Costos. ' +
        'R8 no puede calcular la utilidad transitoria. El patrimonio recibido se preserva.',
      normReference: 'NIC 1 párr. 81-87',
      recommendation:
        'Verificar que el balance de prueba incluya las clases 4-7 (Estado de ' +
        'Resultados). Sin ellas, los reportes financieros pueden estar incompletos.',
      impact:
        'Sin clases 4-7 no se puede validar que el patrimonio refleje correctamente la utilidad del periodo.',
      period: snapshot.period,
    });
    return { virtualCloseAdjustment: adjustment, findings };
  }

  // -------------------------------------------------------------------------
  // 1. Calcular utilidad dinámica desde controlTotals (ya derivada de Clases
  //    4-5-6-7 en buildSnapshotForPeriod).
  // -------------------------------------------------------------------------
  const dynamicNetIncome = snapshot.controlTotals.utilidadNeta;

  // -------------------------------------------------------------------------
  // 2. Localizar (o crear) Clase 3 — Patrimonio.
  // -------------------------------------------------------------------------
  let clasePatrimonio = snapshot.classes.find((c) => c.code === 3);
  if (!clasePatrimonio) {
    clasePatrimonio = {
      code: 3,
      name: PUC_CLASS_NAMES[3]!,
      auxiliaryTotal: 0,
      reportedTotal: null,
      discrepancy: 0,
      accounts: [],
    };
    snapshot.classes.push(clasePatrimonio);
  }

  // -------------------------------------------------------------------------
  // 3. Idempotencia: si ya existen 3605VC / 3710VC de una corrida previa,
  //    los anulamos a 0 antes de recomputar (luego se reescriben).
  // -------------------------------------------------------------------------
  for (const acc of clasePatrimonio.accounts) {
    if (acc.code === VIRTUAL_CURRENT_CODE || acc.code === VIRTUAL_RETAINED_CODE) {
      acc.balance = 0;
    }
  }

  // -------------------------------------------------------------------------
  // 4. Detectar saldo en cuenta 3605 del CSV. Lectura del view: cualquier
  //    cuenta cuyo código empiece con "3605" y que NO sea la virtual `3605VC`.
  // -------------------------------------------------------------------------
  const csv3605Accounts = clasePatrimonio.accounts.filter(
    (a) =>
      a.code.startsWith('3605') &&
      a.code !== VIRTUAL_CURRENT_CODE &&
      a.balance !== 0,
  );
  const csvUtilidadEjercicio = csv3605Accounts.reduce(
    (sum, a) => sum + a.balance,
    0,
  );
  const utilidadGap = Math.abs(csvUtilidadEjercicio - dynamicNetIncome);
  const reclassifiedFrom3605 =
    utilidadGap > UTILIDAD_MATCH_TOL && csvUtilidadEjercicio !== 0;
  const reclassifiedAmount = reclassifiedFrom3605 ? csvUtilidadEjercicio : 0;

  // -------------------------------------------------------------------------
  // 5. SIEMPRE anular el saldo de cuentas 3605 del CSV: el sistema reemplaza
  //    autoritativamente por su cálculo dinámico (3605VC inyectada abajo).
  //    Hacerlo siempre — incluso cuando hay match — evita que el patrimonio
  //    contenga la utilidad dos veces (una en 3605 real + otra en 3605VC).
  // -------------------------------------------------------------------------
  for (const acc of csv3605Accounts) {
    acc.balance = 0;
  }

  // -------------------------------------------------------------------------
  // 6. Inyectar / actualizar cuenta virtual 3605VC con la utilidad dinámica.
  // -------------------------------------------------------------------------
  upsertVirtualAccount(
    clasePatrimonio,
    VIRTUAL_CURRENT_CODE,
    VIRTUAL_CURRENT_NAME,
    dynamicNetIncome,
  );

  // -------------------------------------------------------------------------
  // 7. Recalcular control totals tras inyección de 3605VC y limpieza de 3605.
  //    NOTA: aún no inyectamos 3710VC (se hace tras computar el residual).
  // -------------------------------------------------------------------------
  recomputeControlTotalsFromClasses(snapshot.controlTotals, snapshot.classes);

  // -------------------------------------------------------------------------
  // 8. Computar diferencia residual: Activo − (Pasivo + Patrimonio).
  //    Tras anular 3605 viejo e inyectar 3605VC, el residual captura:
  //      - Sustitución 3605 viejo ↔ utilidad dinámica (cuando reclassified).
  //      - Utilidad escondida en 37xx que debió quedar en 36xx (post-cierre
  //        donde el balance ya cuadraba antes de R8 — la inyección de 3605VC
  //        debe compensarse contra acumulados para mantener cuadre).
  //      - Redondeos acumulados.
  //    SIEMPRE absorbemos el residual en 3710VC (la cuenta virtual del
  //    cierre virtual). Si la magnitud es material (>1% activo), emitimos
  //    finding 'alto' para que el auditor revise.
  // -------------------------------------------------------------------------
  const residualGapBeforeCents =
    snapshot.controlTotals.activo -
    snapshot.controlTotals.pasivo -
    snapshot.controlTotals.patrimonio;

  const centsAdjustment = residualGapBeforeCents;

  if (centsAdjustment !== 0) {
    upsertVirtualAccount(
      clasePatrimonio,
      VIRTUAL_RETAINED_CODE,
      VIRTUAL_RETAINED_NAME,
      centsAdjustment,
    );
    recomputeControlTotalsFromClasses(snapshot.controlTotals, snapshot.classes);
  }

  // -------------------------------------------------------------------------
  // 9. Sobreescribir equityBreakdown.utilidadEjercicio (autoritativo).
  //    Los downstream (pilares, agentes, Excel) ahora ven el cálculo dinámico.
  //
  //    NOTA crítica: NO sumamos `centsAdjustment` a `utilidadesAcumuladas`
  //    en el breakdown. La cuenta virtual `3710VC` ya está en `classes[3]`
  //    y se refleja en `controlTotals.patrimonio` (vía
  //    `recomputeControlTotalsFromClasses`). Sumarlo al breakdown causaba
  //    doble conteo en R5 (que reconstruye `ecpClosingBalance` desde el
  //    breakdown). En su lugar, R5 lee `snapshot.virtualCloseAdjustment` y
  //    añade `centsAdjustment` al sumar componentes patrimoniales.
  // -------------------------------------------------------------------------
  snapshot.equityBreakdown.utilidadEjercicio = dynamicNetIncome;

  // -------------------------------------------------------------------------
  // 10. Sincronizar summary.totalEquity con controlTotals.patrimonio (el
  //     renderer Excel lee summary; los pilares leen controlTotals).
  // -------------------------------------------------------------------------
  snapshot.summary.totalEquity = snapshot.controlTotals.patrimonio;
  snapshot.summary.equationBalance =
    snapshot.controlTotals.activo -
    snapshot.controlTotals.pasivo -
    snapshot.controlTotals.patrimonio;
  snapshot.summary.equationBalanced =
    Math.abs(snapshot.summary.equationBalance) < 100;

  // -------------------------------------------------------------------------
  // 11. Construir el adjustment + finding(s).
  // -------------------------------------------------------------------------
  const adjustment: VirtualCloseAdjustment = {
    dynamicNetIncome,
    csvUtilidadEjercicio,
    utilidadGap,
    reclassifiedFrom3605,
    reclassifiedAmount,
    residualGapBeforeCents,
    centsAdjustment,
    reconciledEquity: snapshot.controlTotals.patrimonio,
    virtualCurrentCode: VIRTUAL_CURRENT_CODE,
    virtualCurrentName: VIRTUAL_CURRENT_NAME,
    virtualRetainedCode: VIRTUAL_RETAINED_CODE,
    virtualRetainedName: VIRTUAL_RETAINED_NAME,
    justification:
      'Cierre Virtual: traslado automático de utilidad transitoria (Clase 4 − 5 − 6 − 7) ' +
      'a Patrimonio, garantizando ecuación contable Activo = Pasivo + Patrimonio sin requerir ' +
      'asiento de cierre del contador. Compatible con balances de cualquier ERP en cualquier corte temporal.',
  };

  // Marcar el ajuste a nivel snapshot (acceso rápido por renderers).
  snapshot.virtualCloseAdjustment = adjustment;

  // Finding informativo (siempre, por diseño la regla SIEMPRE actúa).
  findings.push({
    code: 'CUR-R8',
    severity: 'informativo',
    title: 'Cierre Virtual aplicado — Patrimonio cuadrado en tiempo real',
    description:
      `Utilidad del ejercicio calculada dinámicamente: $${formatCOP(dynamicNetIncome)}. ` +
      `Inyectada en cuenta virtual ${VIRTUAL_CURRENT_CODE} (${VIRTUAL_CURRENT_NAME}) en Clase 3. ` +
      (reclassifiedFrom3605
        ? `Saldo previo en 3605 ($${formatCOP(csvUtilidadEjercicio)}) reclasificado a ${VIRTUAL_RETAINED_CODE} ` +
          `(${VIRTUAL_RETAINED_NAME}). `
        : '') +
      (centsAdjustment !== 0 && !reclassifiedFrom3605
        ? `Ajuste de centavos: $${formatCOP(centsAdjustment)} absorbido en ${VIRTUAL_RETAINED_CODE}. `
        : '') +
      `Total Patrimonio post-R8: $${formatCOP(snapshot.controlTotals.patrimonio)}.`,
    normReference: 'Marco Conceptual NIIF — Reconocimiento (4.37–4.53); NIC 1 párr. 16',
    recommendation:
      'El cierre virtual permite emitir reportes a cualquier corte temporal sin esperar al ' +
      'asiento contable de fin de ejercicio. El contador puede revisar la cuenta 3605VC para validar la utilidad inferida.',
    impact:
      'Sin el cierre virtual, balances exportados a mitad de año mostrarían descuadre en la ecuación ' +
      'patrimonial (utilidad atrapada en clases 4-7 sin trasladar a patrimonio). El cierre virtual elimina ' +
      'esta dependencia operativa con el contador.',
    period: snapshot.period,
  });

  // Finding adicional severidad alta si el ajuste de centavos es material
  // (>1% del activo). Significa que la utilidad estaba escondida en otra
  // cuenta de patrimonio o el balance tenía un descuadre real previo a R8.
  const materialThreshold = Math.max(
    Math.abs(snapshot.controlTotals.activo) * 0.01,
    1_000_000,
  );
  if (Math.abs(centsAdjustment) > materialThreshold && !reclassifiedFrom3605) {
    findings.push({
      code: 'CUR-R8',
      severity: 'alto',
      title: 'Ajuste material en Resultados Acumulados durante Cierre Virtual',
      description:
        `R8 absorbió $${formatCOP(centsAdjustment)} en cuenta virtual ${VIRTUAL_RETAINED_CODE} ` +
        `tras inyectar la utilidad dinámica de $${formatCOP(dynamicNetIncome)}. La magnitud supera ` +
        `el 1% del activo ($${formatCOP(materialThreshold)}), lo cual sugiere que la utilidad del ` +
        `periodo estaba escondida en otra cuenta de patrimonio (típicamente 3705/3710 acumulados) ` +
        `o que el balance tenía un descuadre previo no detectado.`,
      normReference: 'NIC 1 párr. 81-87 (presentación de resultados del periodo)',
      recommendation:
        `Auditar el patrimonio del balance original: identificar si la utilidad del ejercicio ` +
        `quedó previamente trasladada a Resultados Acumulados (3705/3710) sin pasar por 3605, ` +
        `y si corresponde, ajustar manualmente para preservar la trazabilidad.`,
      impact:
        'El usuario verá la utilidad correctamente en "Resultado del Ejercicio (Corte Actual)" ' +
        'y un ajuste compensatorio en Resultados Acumulados, pero el origen contable del saldo previo merece auditoría.',
      period: snapshot.period,
    });
  }

  // Finding adicional severidad media si hubo reclasificación material (auditor
  // lo debe revisar — puede indicar cierre histórico vs nuevo periodo).
  if (reclassifiedFrom3605) {
    findings.push({
      code: 'CUR-R8',
      severity: 'medio',
      title: 'Saldo histórico de 3605 reclasificado a Resultados Acumulados',
      description:
        `El balance de prueba traía $${formatCOP(csvUtilidadEjercicio)} en cuenta 3605 (Utilidad del Ejercicio) ` +
        `que no coincide con la utilidad dinámica del periodo ($${formatCOP(dynamicNetIncome)}, ` +
        `gap = $${formatCOP(utilidadGap)}). El curator interpretó el saldo previo como utilidad ` +
        `acumulada de ejercicios anteriores y lo reclasificó a ${VIRTUAL_RETAINED_CODE}.`,
      normReference: 'NIC 1 párr. 81-87 (presentación de resultados del periodo)',
      recommendation:
        `Auditar el origen del saldo en 3605 al momento de la exportación: (a) si corresponde a ` +
        `una utilidad del periodo previo NO trasladada a 3705/3710, manualmente reclasificar; ` +
        `(b) si es un cierre de fin de año ya consolidado, distribuirlo formalmente a reservas y dividendos.`,
      impact:
        'Sin reclasificación, el patrimonio incluiría dos veces la utilidad (la histórica de 3605 + la dinámica calculada).',
      period: snapshot.period,
    });
  }

  return { virtualCloseAdjustment: adjustment, findings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function upsertVirtualAccount(
  clase: PUCClass,
  code: string,
  name: string,
  balance: number,
): void {
  const existing = clase.accounts.find((a) => a.code === code);
  if (existing) {
    existing.balance = balance;
    existing.name = name;
  } else {
    const virtualAccount: ValidatedAccount = {
      code,
      name,
      level: 'Auxiliar',
      balance,
      isLeaf: true,
    };
    clase.accounts.push(virtualAccount);
  }
}

const ACTIVO_CORRIENTE_GROUPS = new Set(['11', '12', '13', '14']);
const ACTIVO_NO_CORRIENTE_GROUPS = new Set(['15', '16', '17', '18', '19']);
const PASIVO_CORRIENTE_GROUPS = new Set(['21', '22', '23', '24', '25', '26']);
const PASIVO_NO_CORRIENTE_GROUPS = new Set(['27', '28', '29']);

function recomputeControlTotalsFromClasses(
  totals: ControlTotals,
  classes: PUCClass[],
): void {
  const claseActivo = classes.find((c) => c.code === 1);
  const clasePasivo = classes.find((c) => c.code === 2);
  const clasePatrimonio = classes.find((c) => c.code === 3);

  if (claseActivo) {
    claseActivo.auxiliaryTotal = claseActivo.accounts.reduce((s, a) => s + a.balance, 0);
  }
  if (clasePasivo) {
    clasePasivo.auxiliaryTotal = clasePasivo.accounts.reduce((s, a) => s + a.balance, 0);
  }
  if (clasePatrimonio) {
    clasePatrimonio.auxiliaryTotal = clasePatrimonio.accounts.reduce(
      (s, a) => s + a.balance,
      0,
    );
  }

  totals.activo = claseActivo?.auxiliaryTotal ?? 0;
  totals.pasivo = clasePasivo?.auxiliaryTotal ?? 0;
  totals.patrimonio = clasePatrimonio?.auxiliaryTotal ?? 0;

  totals.activoCorriente = sumByGroups(claseActivo, ACTIVO_CORRIENTE_GROUPS);
  totals.activoNoCorriente = sumByGroups(claseActivo, ACTIVO_NO_CORRIENTE_GROUPS);
  totals.pasivoCorriente = sumByGroups(clasePasivo, PASIVO_CORRIENTE_GROUPS);
  totals.pasivoNoCorriente = sumByGroups(clasePasivo, PASIVO_NO_CORRIENTE_GROUPS);
}

function sumByGroups(cl: PUCClass | undefined, groups: Set<string>): number {
  if (!cl) return 0;
  let sum = 0;
  for (const acc of cl.accounts) {
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
