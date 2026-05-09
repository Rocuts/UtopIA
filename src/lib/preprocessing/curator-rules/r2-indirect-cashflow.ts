// ---------------------------------------------------------------------------
// R2 — Estado de Flujos de Efectivo (método indirecto, NIC 7)
// ---------------------------------------------------------------------------
// Si el preprocessing no recibe datos operativos crudos (i.e. el balance solo
// trae saldos finales pero no movimientos), la regla reconstruye el flujo de
// efectivo por método indirecto a partir de la VARIACIÓN de saldos entre el
// periodo T y T-1.
//
// Estructura NIC 7 ajustada al PUC colombiano (Decreto 2650/1993):
//   - Operativas: Utilidad Neta + Depreciación ± Δ AC operativos ± Δ PC operativos
//   - Inversión:  Δ Clase 15 (PPE bruto)
//   - Financiación: Δ Clase 21 (oblig fin) + Δ Clases 31/32/33 (capital+reservas)
//                   - dividendos estimados (Δ utilidades acumuladas − utilidad T)
//
// La reconciliación se cruza con el Δ saldo PUC 11 (efectivo y equivalentes)
// observado entre T y T-1 — si el cuadre falla, marcamos `reconciled=false`
// pero igual exponemos el flujo (los agentes deciden cómo presentarlo).
// ---------------------------------------------------------------------------

import type { PUCClass, PeriodSnapshot } from '../trial-balance';

import type { CashFlowStatement, CuratorFinding } from './types';

export interface R2Result {
  cashFlowIndirecto?: CashFlowStatement;
  findings: CuratorFinding[];
}

const RECONCILIATION_TOLERANCE_PCT = 0.05; // 5% del Δ efectivo
const MIN_RECONCILIATION_TOLERANCE = 100_000; // o $100k mínimo

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

  // Δ saldos por grupo PUC (T − T-1).
  const deltaByGroup = computeDeltaByGroup(snapshot, prev);

  // Bloque operativo
  const utilidadNeta = snapshot.controlTotals.utilidadNeta;
  // Depreciación acumulada — usamos los grupos 1592/1595/1598 (Δ saldos negativos).
  const depreciacion =
    deltaByGroup.subaccount('1592') +
    deltaByGroup.subaccount('1595') +
    deltaByGroup.subaccount('1598');
  // Estos saldos suelen ser créditos (negativos); el aumento ABSOLUTO es lo que
  // sumamos a la utilidad neta para reversar el gasto no monetario.
  const depreciacionAmortizacion = -depreciacion;

  // ΔAC operativos: aumento de activo → uso de efectivo (resta).
  const deltaCxC = deltaByGroup.classGroup('1', '13');
  const deltaInv = deltaByGroup.classGroup('1', '14');

  // ΔPC operativos: aumento de pasivo → fuente de efectivo (suma).
  const deltaProv = deltaByGroup.classGroup('2', '22');
  const deltaCxP = deltaByGroup.classGroup('2', '23');
  const deltaImp = deltaByGroup.classGroup('2', '24');
  const deltaLab = deltaByGroup.classGroup('2', '25');

  const operatingTotal =
    utilidadNeta +
    depreciacionAmortizacion +
    -deltaCxC +
    -deltaInv +
    deltaProv +
    deltaCxP +
    deltaImp +
    deltaLab;

  // Inversión
  const deltaPPE_bruto = deltaByGroup.classGroup('1', '15') - depreciacion;
  // Aumento PPE bruto → uso (resta).
  const investingTotal = -deltaPPE_bruto;

  // Financiación
  const deltaOblFin = deltaByGroup.classGroup('2', '21');
  const deltaCapital =
    deltaByGroup.classGroup('3', '31') +
    deltaByGroup.classGroup('3', '32') +
    deltaByGroup.classGroup('3', '33');
  // Dividendos estimados: Δ utilidades acumuladas − utilidad neta del periodo.
  // Si las utilidades acumuladas crecieron MENOS que la utilidad neta, hubo
  // distribución (dividendo).
  const deltaUtilAcum =
    deltaByGroup.classGroup('3', '36') + deltaByGroup.classGroup('3', '37');
  const dividendosEstimados = Math.min(0, deltaUtilAcum - utilidadNeta);
  const financingTotal = deltaOblFin + deltaCapital + dividendosEstimados;

  const netChangeInCash = operatingTotal + investingTotal + financingTotal;
  const observedChangeInCash =
    snapshot.controlTotals.efectivoCuenta11 - prev.controlTotals.efectivoCuenta11;
  const reconciliationGap = netChangeInCash - observedChangeInCash;

  const tolerance = Math.max(
    Math.abs(observedChangeInCash) * RECONCILIATION_TOLERANCE_PCT,
    MIN_RECONCILIATION_TOLERANCE,
  );
  const reconciled = Math.abs(reconciliationGap) <= tolerance;

  const cashFlowIndirecto: CashFlowStatement = {
    period: snapshot.period,
    comparativePeriod: prev.period,
    operating: {
      utilidadNeta,
      depreciacionAmortizacion,
      varCuentasPorCobrar: -deltaCxC,
      varInventarios: -deltaInv,
      varProveedores: deltaProv,
      varCuentasPorPagar: deltaCxP,
      varImpuestosPorPagar: deltaImp,
      varObligacionesLaborales: deltaLab,
      total: operatingTotal,
    },
    investing: {
      varPPE: -deltaPPE_bruto,
      otros: 0,
      total: investingTotal,
    },
    financing: {
      varObligacionesFinancieras: deltaOblFin,
      varCapitalReservas: deltaCapital,
      dividendosEstimados,
      total: financingTotal,
    },
    netChangeInCash,
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
      `operativos directos. Variación neta de efectivo calculada: $${formatCOP(netChangeInCash)}. ` +
      `Variación observada en cuenta 11: $${formatCOP(observedChangeInCash)}. ` +
      `Brecha: $${formatCOP(reconciliationGap)} (${reconciled ? 'cuadra' : 'NO cuadra'} dentro de tolerancia $${formatCOP(tolerance)}).`,
    normReference: 'NIC 7 — Estado de Flujos de Efectivo',
    recommendation: reconciled
      ? 'Validar el flujo con el módulo de tesorería si está disponible. La inferencia es razonable.'
      : 'La reconciliación contra el cambio observado en caja falla. Revisar movimientos atípicos en cuentas 15 (PPE), 21 (oblig. financieras) o partidas extraordinarias que el método indirecto no captura.',
    impact: reconciled
      ? 'Permite presentar el ECE oficial sin requerir un libro de tesorería separado.'
      : 'Sin reconciliación, el ECE oficial requiere ajuste manual antes de la firma del Contador.',
    period: snapshot.period,
  };

  return { cashFlowIndirecto, findings: [finding] };
}

// ---------------------------------------------------------------------------
// Helpers de variación de saldos por grupo PUC
// ---------------------------------------------------------------------------

interface DeltaByGroup {
  /** Variación total para cuentas que empiezan con `classDigit` y grupo de 2 dígitos. */
  classGroup(classDigit: string, group: string): number;
  /** Variación total para cuentas que empiezan con `subaccountPrefix` (4 dígitos). */
  subaccount(prefix: string): number;
}

function computeDeltaByGroup(snapshot: PeriodSnapshot, prev: PeriodSnapshot): DeltaByGroup {
  // Construimos un mapa code → balance para T y T-1, sumando hojas.
  const balanceMap = (snap: PeriodSnapshot) => {
    const map = new Map<string, number>();
    for (const cl of snap.classes) {
      for (const acc of cl.accounts) map.set(acc.code, acc.balance);
    }
    return map;
  };
  const t = balanceMap(snapshot);
  const tMinus1 = balanceMap(prev);
  const allCodes = new Set<string>([...t.keys(), ...tMinus1.keys()]);
  const deltas = new Map<string, number>();
  for (const code of allCodes) {
    deltas.set(code, (t.get(code) ?? 0) - (tMinus1.get(code) ?? 0));
  }

  return {
    classGroup(classDigit, group) {
      let total = 0;
      for (const [code, delta] of deltas) {
        if (!code.startsWith(classDigit)) continue;
        if (code.length >= 2 && code.slice(0, 2) === group) total += delta;
      }
      return total;
    },
    subaccount(prefix) {
      let total = 0;
      for (const [code, delta] of deltas) {
        if (code.startsWith(prefix)) total += delta;
      }
      return total;
    },
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
// El finding marca explícitamente:
//   - severity: 'medio' (NO 'alto') — falta de comparativo es dato faltante,
//     no error contable.
//   - reconciled: false (siempre, por construcción).
//   - inferred: true.
// ---------------------------------------------------------------------------
function runR2SinglePeriod(snapshot: PeriodSnapshot): R2Result {
  // Mapa code → balance del periodo actual.
  const balances = new Map<string, number>();
  for (const cl of snapshot.classes) {
    for (const acc of cl.accounts) balances.set(acc.code, acc.balance);
  }

  // Suma por (clase, grupo) o subcuenta, asumiendo prev = 0 (Δ = balance final).
  const sumByClassGroup = (classDigit: string, group: string): number => {
    let total = 0;
    for (const [code, bal] of balances) {
      if (!code.startsWith(classDigit)) continue;
      if (code.length >= 2 && code.slice(0, 2) === group) total += bal;
    }
    return total;
  };
  const sumBySubaccount = (prefix: string): number => {
    let total = 0;
    for (const [code, bal] of balances) {
      if (code.startsWith(prefix)) total += bal;
    }
    return total;
  };

  const utilidadNeta = snapshot.controlTotals.utilidadNeta;
  const depreciacion =
    sumBySubaccount('1592') + sumBySubaccount('1595') + sumBySubaccount('1598');
  const depreciacionAmortizacion = -depreciacion;

  const deltaCxC = sumByClassGroup('1', '13');
  const deltaInv = sumByClassGroup('1', '14');
  const deltaProv = sumByClassGroup('2', '22');
  const deltaCxP = sumByClassGroup('2', '23');
  const deltaImp = sumByClassGroup('2', '24');
  const deltaLab = sumByClassGroup('2', '25');

  const operatingTotal =
    utilidadNeta +
    depreciacionAmortizacion +
    -deltaCxC +
    -deltaInv +
    deltaProv +
    deltaCxP +
    deltaImp +
    deltaLab;

  const deltaPPE_bruto = sumByClassGroup('1', '15') - depreciacion;
  const investingTotal = -deltaPPE_bruto;

  const deltaOblFin = sumByClassGroup('2', '21');
  const deltaCapital =
    sumByClassGroup('3', '31') +
    sumByClassGroup('3', '32') +
    sumByClassGroup('3', '33');
  const deltaUtilAcum =
    sumByClassGroup('3', '36') + sumByClassGroup('3', '37');
  const dividendosEstimados = Math.min(0, deltaUtilAcum - utilidadNeta);
  const financingTotal = deltaOblFin + deltaCapital + dividendosEstimados;

  const netChangeInCash = operatingTotal + investingTotal + financingTotal;
  const observedChangeInCash = snapshot.controlTotals.efectivoCuenta11; // prev = 0
  const reconciliationGap = netChangeInCash - observedChangeInCash;

  const cashFlowIndirecto: CashFlowStatement = {
    period: snapshot.period,
    comparativePeriod: '(sin_comparativo)',
    operating: {
      utilidadNeta,
      depreciacionAmortizacion,
      varCuentasPorCobrar: -deltaCxC,
      varInventarios: -deltaInv,
      varProveedores: deltaProv,
      varCuentasPorPagar: deltaCxP,
      varImpuestosPorPagar: deltaImp,
      varObligacionesLaborales: deltaLab,
      total: operatingTotal,
    },
    investing: {
      varPPE: -deltaPPE_bruto,
      otros: 0,
      total: investingTotal,
    },
    financing: {
      varObligacionesFinancieras: deltaOblFin,
      varCapitalReservas: deltaCapital,
      dividendosEstimados,
      total: financingTotal,
    },
    netChangeInCash,
    observedChangeInCash,
    reconciliationGap,
    reconciled: false, // por construcción: prev=0 nunca cuadra con un balance real
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
      `Variación neta calculada: $${formatCOP(netChangeInCash)}; saldo cierre PUC 11: ` +
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
