// ---------------------------------------------------------------------------
// R8 — Cierre Virtual (Autonomía de Cierre)
// ---------------------------------------------------------------------------
// Traslada el resultado del ejercicio que sigue en las clases 4-7 al
// patrimonio (cuenta virtual 3605VC), para que un balance de prueba exportado
// antes del asiento de cierre pueda presentarse sin esperar al contador.
//
// Contrato (ver `types.ts > VirtualCloseAdjustment` para la lista completa):
//   - Con actividad P&L, SIEMPRE ancla la utilidad del P&G en 3605VC.
//   - El grupo 36 del CSV (3605 utilidad / 3610 pérdida del ejercicio) se
//     anula: si coincide con el P&G es el mismo resultado; si difiere, es un
//     resultado anterior no trasladado y se reclasifica a 3710VC.
//   - SÓLO cierra la diferencia explicada por ese traslado. Cualquier otro
//     residual de Activo − Pasivo − Patrimonio (≠ 0 al centavo) queda visible
//     como descuadre BLOQUEANTE con su monto. Auditoría 2026-09
//     (niif-preproceso-06): la versión anterior llevaba TODO el residual a
//     3710VC, de modo que una cuenta omitida o un error de captura se
//     presentaba como patrimonio y la ecuación "cuadraba" por construcción.
//   - Idempotente: ejecutar R8 dos veces sobre el mismo snapshot deja el
//     mismo resultado (las cuentas virtuales `3605VC` / `3710VC` ya existentes
//     se REEMPLAZAN, no se acumulan).
//   - Trazabilidad: la cuenta 36 original (si traía saldo) queda con
//     `balance: 0` pero NO se elimina del array.
//
// Por qué R8 corre ANTES que R5:
//   R5 contrasta el desglose patrimonial (ECP) con el total de la clase 3. Sin
//   R8, vería un patrimonio sin la utilidad del periodo.
// ---------------------------------------------------------------------------

import type {
  ControlTotals,
  PUCClass,
  PeriodSnapshot,
  ValidatedAccount,
} from '../trial-balance';

import {
  ACTIVO_CORRIENTE_GROUPS,
  ACTIVO_NO_CORRIENTE_GROUPS,
  sumByGroups,
  sumCurrentLiabilities,
  sumNonCurrentLiabilities,
} from './balance-groups';
import { addCuratorBlocker, clearCuratorBlockers } from './curator-blockers';
import {
  centsToCanonical,
  equationGapCents,
  pesosToCents,
  sumClassCents,
  syncControlTotals,
} from './sync-control-totals';
import type { CuratorFinding, VirtualCloseAdjustment } from './types';

const VIRTUAL_CURRENT_CODE = '3605VC';
const VIRTUAL_CURRENT_NAME = 'Resultado del Ejercicio (Corte Actual)';
const VIRTUAL_RETAINED_CODE = '3710VC';
const VIRTUAL_RETAINED_NAME =
  'Resultados Acumulados — Cierre Virtual (curator R8)';

/** Grupo PUC 36 — Resultados del ejercicio (3605 utilidad, 3610 pérdida). */
const RESULT_GROUP_PREFIX = '36';

/** Tolerancia para considerar la utilidad del CSV "coincidente" con el cálculo
 *  dinámico (no requiere reclasificación). $1.000 COP cubre redondeos típicos.
 *  Sólo decide la INTERPRETACIÓN del grupo 36 (resultado del periodo vs.
 *  resultado anterior); no autoriza a absorber diferencias: el residual de la
 *  ecuación se evalúa después al centavo exacto. */
const UTILIDAD_MATCH_TOL = 1000;

const ZERO_CENTS = BigInt(0);

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
  // 3. Idempotencia: si ya existen 3605VC / 3710VC de una corrida previa, se
  //    anulan antes de recomputar. El saldo de 3710VC es la reclasificación
  //    de un grupo 36 histórico que la corrida previa ya anuló en el CSV: se
  //    devuelve a la bolsa del grupo 36 para que esta corrida decida igual.
  // -------------------------------------------------------------------------
  const previousAdjustment = snapshot.virtualCloseAdjustment;
  let carriedRetained = 0;
  for (const acc of clasePatrimonio.accounts) {
    if (acc.code === VIRTUAL_RETAINED_CODE) {
      carriedRetained += acc.balance;
      acc.balance = 0;
    } else if (acc.code === VIRTUAL_CURRENT_CODE) {
      acc.balance = 0;
    }
  }

  // -------------------------------------------------------------------------
  // 4. Saldo del grupo 36 del CSV: 3605 (utilidad) y 3610 (pérdida del
  //    ejercicio). PUC D. 2650/1993: ambas son "Resultados del ejercicio".
  //    Auditoría 2026-09 (niif-preproceso-12): leer sólo 3605 duplicaba la
  //    pérdida registrada en 3610 y fabricaba una utilidad acumulada ficticia.
  // -------------------------------------------------------------------------
  const csvResultAccounts = clasePatrimonio.accounts.filter(
    (a) => a.code.startsWith(RESULT_GROUP_PREFIX) && !isVirtualCode(a.code) && a.balance !== 0,
  );
  const csvUtilidadEjercicio =
    csvResultAccounts.reduce((sum, a) => sum + a.balance, 0) + carriedRetained;
  const utilidadGap = Math.abs(csvUtilidadEjercicio - dynamicNetIncome);

  // Interpretación del grupo 36 — dos hipótesis, evaluadas al centavo sobre
  // la brecha del balance ANTES del traslado (A − P − K, con la
  // reclasificación de una corrida previa devuelta al grupo 36):
  //   H1 "es el resultado del periodo": se reemplaza por 3605VC.
  //        residual = brecha − utilidad + grupo36
  //   H2 "es un resultado anterior no trasladado": se reclasifica a 3710VC.
  //        residual = brecha − utilidad
  // Si alguna hipótesis explica la brecha EXACTAMENTE, se usa esa (así un
  // 3605 del año anterior que coincide por azar con la utilidad del año no
  // se confunde con ella). Si ninguna la explica, decide la tolerancia de
  // coincidencia y el residual queda bloqueante.
  const gapBeforeCents =
    sumClassCents(snapshot.classes.find((c) => c.code === 1)) -
    sumClassCents(snapshot.classes.find((c) => c.code === 2)) -
    sumClassCents(clasePatrimonio) -
    pesosToCents(carriedRetained);
  const utilidadCents = pesosToCents(dynamicNetIncome);
  const grupo36Cents = pesosToCents(csvUtilidadEjercicio);
  const residualIfPriorResult = gapBeforeCents - utilidadCents;
  const residualIfCurrentResult = gapBeforeCents - utilidadCents + grupo36Cents;
  const reclassifiedFrom3605 =
    grupo36Cents !== ZERO_CENTS &&
    (residualIfPriorResult === ZERO_CENTS
      ? true
      : residualIfCurrentResult === ZERO_CENTS
        ? false
        : utilidadGap > UTILIDAD_MATCH_TOL);
  const reclassifiedAmount = reclassifiedFrom3605 ? csvUtilidadEjercicio : 0;

  // -------------------------------------------------------------------------
  // 5. Anular el grupo 36 del CSV: el sistema reemplaza autoritativamente el
  //    resultado del periodo por su cálculo dinámico (3605VC). Hacerlo
  //    siempre — incluso cuando hay match — evita que el patrimonio contenga
  //    la utilidad dos veces.
  // -------------------------------------------------------------------------
  for (const acc of csvResultAccounts) {
    acc.balance = 0;
  }

  // -------------------------------------------------------------------------
  // 6. Inyectar 3605VC con la utilidad dinámica y, si el grupo 36 traía un
  //    resultado anterior no trasladado, 3710VC con ese monto.
  // -------------------------------------------------------------------------
  upsertVirtualAccount(
    clasePatrimonio,
    VIRTUAL_CURRENT_CODE,
    VIRTUAL_CURRENT_NAME,
    dynamicNetIncome,
  );
  if (reclassifiedFrom3605) {
    upsertVirtualAccount(
      clasePatrimonio,
      VIRTUAL_RETAINED_CODE,
      VIRTUAL_RETAINED_NAME,
      reclassifiedAmount,
    );
  }

  // -------------------------------------------------------------------------
  // 7. Recalcular control totals (number + cents + raw) desde las clases.
  // -------------------------------------------------------------------------
  recomputeControlTotalsFromClasses(snapshot.controlTotals, snapshot.classes);

  // -------------------------------------------------------------------------
  // 8. Residual de la ecuación, EXACTO en centavos (misma representación que
  //    el gate V1 y que el API v1). El traslado del resultado es lo único que
  //    R8 puede explicar: cualquier residual ≠ 0 es un descuadre del balance
  //    recibido (cuenta omitida, subcuenta que no suma a su cuenta, error de
  //    captura) y NO se convierte en patrimonio.
  // -------------------------------------------------------------------------
  const residualCents = equationGapCents(snapshot.controlTotals);
  const residualGapBeforeCents = Number(residualCents) / 100;
  const residualRaw = centsToCanonical(residualCents);
  const blocking = residualCents !== ZERO_CENTS;

  // -------------------------------------------------------------------------
  // 9. equityBreakdown: el resultado del ejercicio es el dinámico y la
  //    reclasificación del grupo 36 histórico es resultado de ejercicios
  //    anteriores (Art. 151 C.Co. lee `utilidadesAcumuladas` para las
  //    pérdidas pendientes de enjugar). Idempotente: se descuenta lo sumado
  //    en una corrida previa.
  // -------------------------------------------------------------------------
  snapshot.equityBreakdown.utilidadEjercicio = dynamicNetIncome;
  const previousReclass = previousAdjustment?.reclassifiedFrom3605
    ? previousAdjustment.reclassifiedAmount
    : 0;
  if (reclassifiedFrom3605 || previousReclass !== 0) {
    snapshot.equityBreakdown.utilidadesAcumuladas =
      (snapshot.equityBreakdown.utilidadesAcumuladas ?? 0) - previousReclass + reclassifiedAmount;
  }

  // -------------------------------------------------------------------------
  // 10. Sincronizar summary con controlTotals (el renderer Excel lee summary;
  //     los pilares leen controlTotals). `equationBalanced` se decide al
  //     centavo: una tolerancia en pesos dejaba pasar residuales que el gate
  //     V1 (tolerancia 0n) luego rechazaba.
  // -------------------------------------------------------------------------
  snapshot.summary.totalEquity = snapshot.controlTotals.patrimonio;
  snapshot.summary.equationBalance = residualGapBeforeCents;
  snapshot.summary.equationBalanced = !blocking;

  clearCuratorBlockers(snapshot, 'CUR-R8');

  // -------------------------------------------------------------------------
  // 11. Construir el adjustment + finding(s).
  // -------------------------------------------------------------------------
  // Wave 2.F4 — Parte 3 ramificación R8: bifurcación de la nota según
  // `periodoTipo`. Si el período es 'cerrado' (Enero-Diciembre), la falta de
  // traslado en 3605 es un ERROR de cierre que el contador DEBE corregir
  // antes de firmar EEFF definitivos (nota OBLIGATORIA). Si es 'parcial',
  // el ajuste es práctica habitual de corte intermedio (nota EXPLICATIVA).
  // 'indeterminado' usa la nota EXPLICATIVA por defecto (fallback seguro).
  // -------------------------------------------------------------------------
  const periodoTipo = snapshot.periodoTipo ?? 'indeterminado';
  const justificationBase =
    'Cierre Virtual: traslado automático de utilidad transitoria (Clase 4 − 5 − 6 − 7) ' +
    'a Patrimonio sin requerir asiento de cierre del contador. El traslado sólo explica ' +
    'la diferencia originada en el resultado del ejercicio; cualquier otro descuadre ' +
    'queda visible y bloquea la emisión.';
  const justificationNotaPeriodo =
    periodoTipo === 'cerrado'
      ? ` NOTA OBLIGATORIA — AJUSTE DE CIERRE (cuenta 3605, año cerrado ${snapshot.period}): ` +
        `el sistema detectó que la cuenta 3605 no contiene el traslado del resultado del periodo, ` +
        `lo cual es un ERROR de cierre contable en un año fiscal completo (Enero-Diciembre). ` +
        `El sistema aplicó el ajuste automáticamente para efectos del informe NIIF; el contador ` +
        `responsable DEBE corregir el asiento de cierre antes de firmar los EEFF definitivos.`
      : ` NOTA EXPLICATIVA — AJUSTE DE CIERRE (cuenta 3605, periodo ` +
        `${periodoTipo === 'parcial' ? 'parcial' : 'sin tipo confirmado'}): ` +
        `el presente balance corresponde a un corte intermedio del año fiscal. Es práctica habitual ` +
        `que la cuenta 3605 no contenga la utilidad del periodo hasta el cierre definitivo. El ` +
        `sistema aplicó el ajuste automáticamente solo para efectos de presentación de este informe.`;

  const adjustment: VirtualCloseAdjustment = {
    dynamicNetIncome,
    csvUtilidadEjercicio,
    utilidadGap,
    reclassifiedFrom3605,
    reclassifiedAmount,
    residualGapBeforeCents,
    centsAdjustment: 0,
    unexplainedResidual: residualGapBeforeCents,
    unexplainedResidualRaw: residualRaw,
    blocking,
    reconciledEquity: snapshot.controlTotals.patrimonio,
    virtualCurrentCode: VIRTUAL_CURRENT_CODE,
    virtualCurrentName: VIRTUAL_CURRENT_NAME,
    virtualRetainedCode: VIRTUAL_RETAINED_CODE,
    virtualRetainedName: VIRTUAL_RETAINED_NAME,
    justification: justificationBase + justificationNotaPeriodo,
  };

  // Marcar el ajuste a nivel snapshot (acceso rápido por renderers).
  snapshot.virtualCloseAdjustment = adjustment;

  // Finding informativo (siempre, por diseño la regla SIEMPRE actúa).
  findings.push({
    code: 'CUR-R8',
    severity: 'informativo',
    title: 'Cierre Virtual aplicado — resultado del ejercicio trasladado al patrimonio',
    description:
      `Utilidad del ejercicio calculada dinámicamente: $${formatCOP(dynamicNetIncome)}. ` +
      `Inyectada en cuenta virtual ${VIRTUAL_CURRENT_CODE} (${VIRTUAL_CURRENT_NAME}) en Clase 3. ` +
      (reclassifiedFrom3605
        ? `Saldo previo del grupo 36 ($${formatCOP(csvUtilidadEjercicio)}) reclasificado a ` +
          `${VIRTUAL_RETAINED_CODE} (${VIRTUAL_RETAINED_NAME}). `
        : '') +
      `Total Patrimonio post-R8: $${formatCOP(snapshot.controlTotals.patrimonio)}.`,
    normReference: 'Marco Conceptual NIIF — Reconocimiento (4.37–4.53); NIC 1 párr. 16',
    recommendation:
      'El cierre virtual permite emitir reportes a cualquier corte temporal sin esperar al ' +
      'asiento contable de fin de ejercicio. El contador puede revisar la cuenta 3605VC para validar la utilidad inferida.',
    impact:
      'Sin el cierre virtual, balances exportados antes del asiento de cierre mostrarían la ' +
      'utilidad atrapada en clases 4-7 sin trasladar a patrimonio.',
    period: snapshot.period,
  });

  // Descuadre no explicado por el resultado del ejercicio → BLOQUEANTE.
  if (blocking) {
    // Si la brecha previa al traslado era 0, el balance recibido ya cuadraba
    // sin las clases 4-7: el resultado está en otra cuenta de patrimonio o el
    // P&G no corresponde al mismo corte.
    const alreadyBalancedWithoutResult = gapBeforeCents === ZERO_CENTS;
    const hint = alreadyBalancedWithoutResult
      ? ' El balance recibido ya cuadraba SIN el resultado de las clases 4-7: el resultado del ' +
        'ejercicio parece estar incluido en otra cuenta de patrimonio (p. ej. 37xx) o las ' +
        'clases 4-7 no corresponden al mismo corte.'
      : '';
    const message =
      `[${snapshot.period}] Descuadre no explicado por el resultado del ejercicio: tras trasladar ` +
      `la utilidad de las clases 4-7 ($${formatCOPExact(dynamicNetIncome)}) al patrimonio` +
      (reclassifiedFrom3605
        ? ` y reclasificar el saldo previo del grupo 36 ($${formatCOPExact(reclassifiedAmount)})`
        : '') +
      `, Activo − Pasivo − Patrimonio = $${formatCOPExact(residualGapBeforeCents)}. ` +
      `El cierre virtual no absorbe esta diferencia.${hint} Revise cuentas omitidas, ` +
      `subcuentas que no suman a su cuenta o errores de captura en el archivo.`;
    addCuratorBlocker(snapshot, 'CUR-R8', message);
    findings.push({
      code: 'CUR-R8',
      severity: 'critico',
      title: 'Descuadre del balance no explicado por el resultado del ejercicio',
      description: message,
      normReference:
        'NIC 1 párr. 15 y 54 (presentación razonable del estado de situación financiera)',
      recommendation:
        'Corregir el archivo de origen (o confirmar los saldos con el contador) y volver a ' +
        'procesar. El sistema no convierte diferencias no identificadas en patrimonio.',
      impact:
        `El informe no es emitible: la ecuación Activo = Pasivo + Patrimonio no cierra por ` +
        `$${formatCOPExact(residualGapBeforeCents)}.`,
      period: snapshot.period,
    });
  }

  // Finding adicional severidad media si hubo reclasificación material (auditor
  // lo debe revisar — puede indicar cierre histórico vs nuevo periodo).
  if (reclassifiedFrom3605) {
    findings.push({
      code: 'CUR-R8',
      severity: 'medio',
      title: 'Saldo histórico del grupo 36 reclasificado a Resultados Acumulados',
      description:
        `El balance de prueba traía $${formatCOP(csvUtilidadEjercicio)} en el grupo 36 (3605/3610 — ` +
        `Resultados del ejercicio) que no coincide con la utilidad dinámica del periodo ` +
        `($${formatCOP(dynamicNetIncome)}, gap = $${formatCOP(utilidadGap)}). El curator ` +
        `interpretó el saldo previo como resultado de ejercicios anteriores y lo reclasificó a ` +
        `${VIRTUAL_RETAINED_CODE}.`,
      normReference: 'NIC 1 párr. 81-87 (presentación de resultados del periodo)',
      recommendation:
        `Auditar el origen del saldo en 36 al momento de la exportación: (a) si corresponde a ` +
        `un resultado del periodo previo NO trasladado a 3705/3710, manualmente reclasificar; ` +
        `(b) si es un cierre de fin de año ya consolidado, distribuirlo formalmente a reservas y dividendos.`,
      impact:
        'Sin reclasificación, el patrimonio incluiría dos veces la utilidad (la histórica de 36 + la dinámica calculada).',
      period: snapshot.period,
    });
  }

  return { virtualCloseAdjustment: adjustment, findings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cuentas inyectadas por el curator (`3605VC`, `3710VC`, `2105ZZ-…`). */
function isVirtualCode(code: string): boolean {
  return /VC|ZZ/i.test(code);
}

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
  totals.pasivoCorriente = sumCurrentLiabilities(clasePasivo);
  totals.pasivoNoCorriente = sumNonCurrentLiabilities(clasePasivo);

  // R8 mueve el resultado del ejercicio a patrimonio: es la mutación que más
  // desplaza los totales. Sin esta sincronización, `cents` y `raw` conservaban
  // los valores PRE-cierre y el gate comparaba el reporte contra un patrimonio
  // que ya no existía.
  syncControlTotals(totals, classes);
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}

/** Formato con centavos: los residuales bloqueantes se reportan exactos. */
function formatCOPExact(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
