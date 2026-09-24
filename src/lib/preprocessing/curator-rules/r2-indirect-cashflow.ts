// ---------------------------------------------------------------------------
// R2 — Estado de Flujos de Efectivo (método indirecto, NIC 7)
// ---------------------------------------------------------------------------
// Si el preprocessing no recibe datos operativos crudos (i.e. el balance solo
// trae saldos finales pero no movimientos), la regla reconstruye el flujo de
// efectivo por método indirecto a partir de la VARIACIÓN de saldos entre el
// periodo T y T-1.
//
// Estructura NIC 7 ajustada al PUC colombiano (Decreto 2650/1993). Auditoría
// 2026-09 (niif-preproceso-16): TODA cuenta de las clases 1-3 cae en un
// renglón, de modo que la suma del EFE es por construcción la variación de la
// caja (grupo 11) cuando ambos balances cuadran. Antes sólo se modelaban
// 13/14/15/21-25/31-33/36-37 y R6 escondía el resto en "capital de trabajo".
//
//   Operación : utilidad neta
//               + D&A y deterioros no monetarios (Δ correctoras de 15-18:
//                 1592, 1597, 1598, 1599, 1698, 1699, 1798, 1899 …)
//               − Δ13 deudores − Δ14 inventarios
//               + Δ22 proveedores + Δ23 cuentas por pagar (sin 2360)
//               + Δ24 impuestos + Δ25 laborales
//               + Δ26 pasivos estimados, Δ27 diferidos, Δ28 otros pasivos
//   Inversión : − Δ15 PPE bruto
//               − Δ12 inversiones − Δ16/17/18 brutos − Δ19 + Δ38
//                 (valorizaciones y su superávit son no monetarias: se netean)
//   Financiación: Δ21 obligaciones financieras + Δ29 bonos
//               + Δ31-35 capital, superávit, reservas, revalorización
//               + movimiento de resultados acumulados sin el resultado del año
//               − dividendos pagados (sólo con evidencia 2360/35)
//
// Dividendos (auditoría 2026-09, niif-preproceso-15): con las cuentas
// virtuales de R8 (3605VC = resultado del año, 3710VC = resultado anterior
// reclasificado) incluidas, Δ(36+37) − utilidad del año = traslado del
// resultado anterior − dividendos decretados … y como el traslado ya está
// dentro de 36+37, esa diferencia ES −(dividendos decretados). La fórmula
// anterior excluía las virtuales y restaba la utilidad del AÑO en vez de
// sumar la del año anterior. Los dividendos PAGADOS = decretados − Δ2360:
// Δ2360 sale de la operación y entra a financiación (NIC 7 ¶34).
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '../trial-balance';

import { r1OriginGroup } from './balance-groups';
import { isContraAsset } from './contra-asset-registry';
import { hasDividendEvidenceAccounts } from './dividend-evidence';
import type { CashFlowStatement, CuratorFinding } from './types';

export interface R2Result {
  cashFlowIndirecto?: CashFlowStatement;
  findings: CuratorFinding[];
}

const RECONCILIATION_TOLERANCE_PCT = 0.05; // 5% del Δ efectivo
const MIN_RECONCILIATION_TOLERANCE = 100_000; // o $100k mínimo

/** Grupos de activo no corriente cuyas correctoras son D&A / deterioro. */
const LONG_LIVED_GROUPS = ['15', '16', '17', '18'];

export function runR2(snapshot: PeriodSnapshot, prev: PeriodSnapshot | null): R2Result {
  // Bug 3 fix (2026-05-08): cuando NO hay periodo comparativo, R2 igual emite
  // un EFE PARCIAL asumiendo prev = 0 para todos los saldos. Esto NO es
  // contablemente correcto (las "variaciones" son saldos finales completos),
  // pero permite al Agente 1 NIIF presentar las líneas de capital de trabajo
  // (ΔInventario, ΔProveedores, etc.) con un valor de partida en lugar de
  // omitirlas. El finding marca explícitamente la limitación con severity
  // 'medio' (no 'alto') porque la falta de comparativo es dato faltante,
  // no error contable.
  if (!prev) {
    return runR2SinglePeriod(snapshot);
  }

  const d = computeDeltas(snapshot, prev);
  const utilidadNeta = snapshot.controlTotals.utilidadNeta;
  const flows = classifyFlows(d, utilidadNeta, hasDividendEvidenceAccounts(snapshot), true);

  const observedChangeInCash =
    snapshot.controlTotals.efectivoCuenta11 - prev.controlTotals.efectivoCuenta11;
  const reconciliationGap = flows.netChangeInCash - observedChangeInCash;

  const tolerance = Math.max(
    Math.abs(observedChangeInCash) * RECONCILIATION_TOLERANCE_PCT,
    MIN_RECONCILIATION_TOLERANCE,
  );
  const reconciled = Math.abs(reconciliationGap) <= tolerance;

  const cashFlowIndirecto: CashFlowStatement = {
    period: snapshot.period,
    comparativePeriod: prev.period,
    operating: flows.operating,
    investing: flows.investing,
    financing: flows.financing,
    netChangeInCash: flows.netChangeInCash,
    observedChangeInCash,
    reconciliationGap,
    reconciled,
    inferred: true,
  };

  const finding: CuratorFinding = {
    code: 'CUR-R2',
    severity: reconciled ? 'medio' : 'alto',
    title: 'Estado de Flujos de Efectivo generado por método indirecto',
    description:
      `Se construyó el Estado de Flujos de Efectivo (NIC 7) por método indirecto a partir de la ` +
      `variación de saldos entre ${prev.period} y ${snapshot.period}, dado que no se recibieron datos ` +
      `operativos directos. Variación neta de efectivo calculada: $${formatCOP(flows.netChangeInCash)}. ` +
      `Variación observada en cuenta 11: $${formatCOP(observedChangeInCash)}. ` +
      `Brecha: $${formatCOP(reconciliationGap)} (${reconciled ? 'cuadra' : 'NO cuadra'} dentro de tolerancia $${formatCOP(tolerance)}).`,
    normReference: 'NIC 7 — Estado de Flujos de Efectivo',
    recommendation: reconciled
      ? 'Validar el flujo con el módulo de tesorería si está disponible. La inferencia es razonable.'
      : 'La reconciliación contra el cambio observado en caja falla. Una brecha con todos los grupos ' +
        'PUC clasificados indica que alguno de los dos balances no cuadra (ver hallazgos de R8).',
    impact: reconciled
      ? 'Permite presentar el ECE oficial sin requerir un libro de tesorería separado.'
      : 'Sin reconciliación, el ECE oficial requiere ajuste manual antes de la firma del Contador.',
    period: snapshot.period,
  };

  return { cashFlowIndirecto, findings: [finding] };
}

// ---------------------------------------------------------------------------
// Variaciones por cuenta con grupo efectivo
// ---------------------------------------------------------------------------

interface AccountDelta {
  /** Clase PUC efectiva ('1', '2', '3'). */
  cls: string;
  /** Grupo PUC efectivo (2 dígitos). */
  group: string;
  /** Código real de la cuenta (para prefijos de 4/6 dígitos). */
  code: string;
  delta: number;
  contra: boolean;
}

/**
 * Variación T − T-1 por cuenta de las clases 1-3. Las cuentas virtuales de R1
 * (`2105ZZ-111005`, `2805ZZ-130505`, `2895VC-120505`, …) son un saldo
 * crédito de ACTIVO presentado como pasivo: en el EFE se clasifican con el
 * grupo de su origen. Una virtual de origen 11 es un sobregiro y se presenta
 * en financiación (el efectivo del EFE es el del balance, sin sobregiros).
 */
function computeDeltas(snapshot: PeriodSnapshot, prev: PeriodSnapshot | null): AccountDelta[] {
  const balanceMap = (snap: PeriodSnapshot | null) => {
    const map = new Map<string, number>();
    if (!snap) return map;
    for (const cl of snap.classes) {
      if (cl.code < 1 || cl.code > 3) continue;
      for (const acc of cl.accounts) map.set(acc.code, (map.get(acc.code) ?? 0) + acc.balance);
    }
    return map;
  };
  const t = balanceMap(snapshot);
  const tMinus1 = balanceMap(prev);
  const out: AccountDelta[] = [];
  for (const code of new Set<string>([...t.keys(), ...tMinus1.keys()])) {
    const delta = (t.get(code) ?? 0) - (tMinus1.get(code) ?? 0);
    const origin = r1OriginGroup(code);
    if (origin !== null) {
      // Virtual de R1: pasivo que representa un activo con saldo crédito.
      out.push(
        origin === '11'
          ? { cls: '2', group: '21', code, delta, contra: false } // sobregiro → financiación
          : { cls: '1', group: origin, code, delta: -delta, contra: false },
      );
      continue;
    }
    out.push({
      cls: code.charAt(0),
      group: code.slice(0, 2),
      code,
      delta,
      contra: code.startsWith('1') && isContraAsset(code),
    });
  }
  return out;
}

interface ClassifiedFlows {
  operating: CashFlowStatement['operating'];
  investing: CashFlowStatement['investing'];
  financing: CashFlowStatement['financing'];
  netChangeInCash: number;
}

function classifyFlows(
  deltas: AccountDelta[],
  utilidadNeta: number,
  hayEvidenciaDividendos: boolean,
  dividendsInferable: boolean,
): ClassifiedFlows {
  const sum = (pred: (a: AccountDelta) => boolean) =>
    deltas.filter(pred).reduce((s, a) => s + a.delta, 0);
  const inGroups = (cls: string, groups: string[]) => (a: AccountDelta) =>
    a.cls === cls && groups.includes(a.group);

  // --- Operación ---------------------------------------------------------
  // D&A y deterioros: aumento de las correctoras de activos de largo plazo.
  // Son saldos crédito (negativos): el aumento ABSOLUTO se suma a la utilidad.
  const deltaContraLargoPlazo = sum(
    (a) => a.cls === '1' && a.contra && LONG_LIVED_GROUPS.includes(a.group),
  );
  const depreciacionAmortizacion = -deltaContraLargoPlazo;
  const deltaCxC = sum(inGroups('1', ['13']));
  const deltaInv = sum(inGroups('1', ['14']));
  const deltaProv = sum(inGroups('2', ['22']));
  const delta2360 = sum((a) => a.cls === '2' && a.code.startsWith('2360'));
  const deltaCxP = sum(inGroups('2', ['23'])) - delta2360;
  const deltaImp = sum(inGroups('2', ['24']));
  const deltaLab = sum(inGroups('2', ['25']));
  const deltaOtrosPasivosOp = sum(
    (a) =>
      a.cls === '2' &&
      !['21', '22', '23', '24', '25', '29'].includes(a.group),
  );

  const operatingTotal =
    utilidadNeta +
    depreciacionAmortizacion -
    deltaCxC -
    deltaInv +
    deltaProv +
    deltaCxP +
    deltaImp +
    deltaLab +
    deltaOtrosPasivosOp;

  // --- Inversión ---------------------------------------------------------
  // Grupo 15 bruto (sin correctoras, que ya entraron como D&A).
  const deltaPPEBruto = sum((a) => a.cls === '1' && a.group === '15' && !a.contra);
  // Resto del activo no corriente / inversiones (brutos) y valorizaciones.
  const deltaOtrosActivos = sum(
    (a) =>
      a.cls === '1' &&
      !['11', '13', '14', '15'].includes(a.group) &&
      !(a.contra && LONG_LIVED_GROUPS.includes(a.group)),
  );
  // Superávit por valorizaciones (38) es la contrapartida no monetaria de 19.
  const deltaSuperavitValorizaciones = sum(inGroups('3', ['38']));
  const investingOtros = -deltaOtrosActivos + deltaSuperavitValorizaciones;
  const investingTotal = -deltaPPEBruto + investingOtros;

  // --- Financiación ------------------------------------------------------
  const deltaOblFin = sum(inGroups('2', ['21', '29']));
  const deltaCapital = sum(
    (a) => a.cls === '3' && !['36', '37', '38'].includes(a.group),
  );
  // Resultados acumulados sin el resultado del año, INCLUIDAS las virtuales de
  // R8: 3605VC (= utilidad del año) y 3710VC (resultado anterior
  // reclasificado). Δ(36+37) − utilidad = −(dividendos decretados) ± otros
  // movimientos de resultados acumulados.
  const movimientoResultadosAcumulados = sum(inGroups('3', ['36', '37'])) - utilidadNeta;

  let dividendosEstimados = 0;
  let varCapitalReservas = deltaCapital + movimientoResultadosAcumulados;
  if (dividendsInferable && hayEvidenciaDividendos) {
    // Pagados = decretados − Δ2360 (NIC 7 ¶34: financiación).
    const candidato = movimientoResultadosAcumulados + delta2360;
    dividendosEstimados = Math.min(0, candidato);
    varCapitalReservas = deltaCapital + (candidato - dividendosEstimados);
  } else {
    // Sin evidencia de distribución no hay renglón de dividendos (NIC 7 ¶43):
    // el movimiento de resultados acumulados (p. ej. apropiación a reservas,
    // que se netea con Δ33) queda en capital y reservas. Δ2360 = 0 aquí salvo
    // en modo sin comparativo, donde tampoco se infieren dividendos.
    varCapitalReservas += delta2360;
  }
  const financingTotal = deltaOblFin + varCapitalReservas + dividendosEstimados;

  return {
    operating: {
      utilidadNeta,
      depreciacionAmortizacion,
      varCuentasPorCobrar: -deltaCxC,
      varInventarios: -deltaInv,
      varProveedores: deltaProv,
      varCuentasPorPagar: deltaCxP,
      varImpuestosPorPagar: deltaImp,
      varObligacionesLaborales: deltaLab,
      varOtrosPasivosOperativos: deltaOtrosPasivosOp,
      total: operatingTotal,
    },
    investing: {
      varPPE: -deltaPPEBruto,
      otros: investingOtros,
      total: investingTotal,
    },
    financing: {
      varObligacionesFinancieras: deltaOblFin,
      varCapitalReservas,
      dividendosEstimados,
      total: financingTotal,
    },
    netChangeInCash: operatingTotal + investingTotal + financingTotal,
  };
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}

// ---------------------------------------------------------------------------
// Bug 3 fix (2026-05-08) — R2 single-period mode
// ---------------------------------------------------------------------------
// Cuando `prev === null` (no hay comparativo), generamos un EFE PARCIAL
// asumiendo que prev tiene saldos en 0. Las "variaciones" se vuelven los
// saldos finales completos del periodo actual. NIIF NIC 7 no permite esto
// como EFE oficial — pero permite al renderer downstream presentar las
// líneas de capital de trabajo en lugar de omitirlas silenciosamente.
//
// Sin comparativo NO se infieren dividendos (NIC 7 ¶43): con prev = 0, el
// "movimiento" de resultados acumulados es el saldo completo (p. ej. pérdidas
// acumuladas), no una distribución.
//
// El finding marca explícitamente:
//   - severity: 'medio' (NO 'alto') — falta de comparativo es dato faltante,
//     no error contable.
//   - reconciled: false (siempre, por construcción).
//   - inferred: true.
// ---------------------------------------------------------------------------
function runR2SinglePeriod(snapshot: PeriodSnapshot): R2Result {
  const d = computeDeltas(snapshot, null);
  const utilidadNeta = snapshot.controlTotals.utilidadNeta;
  const flows = classifyFlows(d, utilidadNeta, false, false);

  const observedChangeInCash = snapshot.controlTotals.efectivoCuenta11; // prev = 0
  const reconciliationGap = flows.netChangeInCash - observedChangeInCash;

  const cashFlowIndirecto: CashFlowStatement = {
    period: snapshot.period,
    comparativePeriod: '(sin_comparativo)',
    operating: flows.operating,
    investing: flows.investing,
    financing: flows.financing,
    netChangeInCash: flows.netChangeInCash,
    observedChangeInCash,
    reconciliationGap,
    reconciled: false, // por construcción: prev=0 no es un EFE oficial
    inferred: true,
  };

  const finding: CuratorFinding = {
    code: 'CUR-R2',
    severity: 'medio',
    title:
      'EFE generado en modo single-period (sin balance comparativo) — variaciones asumen prev = 0',
    description:
      `No se cargó balance del periodo anterior. R2 generó un EFE PARCIAL asumiendo que ` +
      `todos los saldos del periodo anterior eran 0; las "variaciones" en realidad son los saldos ` +
      `finales completos del periodo ${snapshot.period}. Esto NO es un EFE oficial NIIF — sirve ` +
      `solo para que el renderer pueda presentar las líneas de capital de trabajo (ΔInventario, ` +
      `ΔProveedores, etc.) con un valor de partida en lugar de omitirlas. ` +
      `Variación neta calculada: $${formatCOP(flows.netChangeInCash)}; saldo cierre PUC 11: ` +
      `$${formatCOP(snapshot.controlTotals.efectivoCuenta11)}.`,
    normReference: 'NIC 7 — Estado de Flujos de Efectivo (método indirecto)',
    recommendation:
      `Para emitir un EFE oficial firmable, cargar el balance comparativo del periodo anterior ` +
      `y reejecutar el pipeline. Mientras tanto, el EFE actual se etiqueta explícitamente como ` +
      `"parcial sin comparativo" en el reporte.`,
    impact:
      'El EFE actual NO es firmable como documento oficial NIIF. El renderer debe declarar ' +
      'explícitamente "EFE no calculable por método indirecto sin balance comparativo. Pendiente: ' +
      'cargar balance del año anterior."',
    period: snapshot.period,
  };

  return { cashFlowIndirecto, findings: [finding] };
}
