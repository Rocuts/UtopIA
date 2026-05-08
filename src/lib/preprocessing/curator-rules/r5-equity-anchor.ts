// ---------------------------------------------------------------------------
// R5 — Anclaje patrimonial (Balance ↔ ECP)
// ---------------------------------------------------------------------------
// El Balance presenta un Total Patrimonio que típicamente proviene de la
// suma de cuentas Clase 3. El Estado de Cambios en el Patrimonio (ECP) lo
// reconstruye desde un saldo inicial + movimientos del periodo y termina en
// un "Saldo Final ECP" que DEBE coincidir con el Total Patrimonio del Balance
// (NIC 1, párr. 106). En la práctica suele aparecer una pequeña brecha por
// redondeo, ajustes de convergencia NIIF o revaluaciones; R5 la absorbe en
// una línea automática `Ajustes de Convergencia / Resultados Acumulados`
// imputada a una cuenta virtual `3710ZZ`.
//
// La regla MUTA el snapshot:
//   - `controlTotals.patrimonio` queda anclado al `ecpClosingBalance` (la
//     versión autoritativa: ECP).
//   - `equityBreakdown.convergenceAdjustment` recibe el gap (con signo).
//   - `snapshot.equityAnchorAdjustment` lo refleja a nivel snapshot.
//
// Solo dispara si la brecha excede `max(|activo| * 0.0001, $1.000)`.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '../trial-balance';

import type { ConvergenceAdjustment, CuratorFinding } from './types';

const VIRTUAL_EQUITY_CODE = '3710ZZ';
const VIRTUAL_EQUITY_NAME =
  'Ajustes de Convergencia / Resultados Acumulados (curator)';
const LEDGER_LINE_LABEL = 'Ajustes de Convergencia / Resultados Acumulados';

export interface R5Result {
  convergenceAdjustment?: ConvergenceAdjustment;
  findings: CuratorFinding[];
}

export function runR5(
  snapshot: PeriodSnapshot,
  _prev: PeriodSnapshot | null,
): R5Result {
  void _prev;

  const eb = snapshot.equityBreakdown;
  const components: number[] = [];
  if (eb.capitalAutorizado !== undefined) components.push(eb.capitalAutorizado);
  if (eb.capitalSuscritoPagado !== undefined) components.push(eb.capitalSuscritoPagado);
  if (eb.reservaLegal !== undefined) components.push(eb.reservaLegal);
  if (eb.otrasReservas !== undefined) components.push(eb.otrasReservas);
  if (eb.utilidadEjercicio !== undefined) components.push(eb.utilidadEjercicio);
  if (eb.utilidadesAcumuladas !== undefined) components.push(eb.utilidadesAcumuladas);

  // Sin componentes detectados, el ECP no es construible — no aplicamos.
  if (components.length === 0) return { findings: [] };

  // Guard contra interacción con R8 (Cierre Virtual): si R8 ya cuadró la
  // ecuación contable (Activo = Pasivo + Patrimonio), R5 NO debe re-anclar
  // al breakdown — el breakdown puede no reflejar cuentas Clase 3 fuera
  // del mapeo conocido (ej. 3795 "ajustes pendientes"), y forzar la
  // igualdad rompería el cuadre que R8 logró. R5 fue diseñado para casos
  // donde el balance crudo no incluía la utilidad del ejercicio; ese rol
  // ahora lo cubre R8 autoritativamente.
  const equationGap =
    snapshot.controlTotals.activo -
    snapshot.controlTotals.pasivo -
    snapshot.controlTotals.patrimonio;
  const equationTolerance = Math.max(
    Math.abs(snapshot.controlTotals.activo) * 0.0001,
    1000,
  );
  if (
    snapshot.virtualCloseAdjustment !== undefined &&
    Math.abs(equationGap) <= equationTolerance
  ) {
    return { findings: [] };
  }

  const ecpClosingBalance = components.reduce((s, n) => s + n, 0);
  const balanceEquity = snapshot.controlTotals.patrimonio;
  const gap = ecpClosingBalance - balanceEquity;

  // Tolerancia: max(|activo| * 0.0001, $1.000).
  const tolerance = Math.max(
    Math.abs(snapshot.controlTotals.activo) * 0.0001,
    1000,
  );

  if (Math.abs(gap) <= tolerance) {
    return { findings: [] };
  }

  // Mutación: anclar el patrimonio al ECP, registrar gap, emitir finding.
  snapshot.equityBreakdown.convergenceAdjustment = gap;
  snapshot.controlTotals.patrimonio = ecpClosingBalance;
  snapshot.equityAnchorAdjustment = gap;

  const adjustment: ConvergenceAdjustment = {
    gapCop: gap,
    balanceEquity,
    ecpClosingBalance,
    reconciledEquity: ecpClosingBalance,
    virtualAccountCode: VIRTUAL_EQUITY_CODE,
    virtualAccountName: VIRTUAL_EQUITY_NAME,
    ledgerLineLabel: LEDGER_LINE_LABEL,
    justification:
      'Anclaje patrimonial NIC 1 párr. 106 — alineamiento Saldo Final ECP con Total Patrimonio Balance.',
  };

  const finding: CuratorFinding = {
    code: 'CUR-R5',
    severity: 'alto',
    title: 'Brecha de anclaje patrimonial Balance ↔ ECP absorbida en Resultados Acumulados',
    description:
      `Brecha entre Saldo Final ECP ($${formatCOP(ecpClosingBalance)}) y Total Patrimonio Balance ` +
      `($${formatCOP(balanceEquity)}) absorbida en Resultados Acumulados. Ajuste: $${formatCOP(gap)} ` +
      `imputado a cuenta virtual ${VIRTUAL_EQUITY_CODE} (${VIRTUAL_EQUITY_NAME}).`,
    normReference: 'NIC 1 párr. 106',
    recommendation:
      `Documentar el origen del ajuste de convergencia en notas a los estados financieros. ` +
      `Validar que la brecha provenga de transición NIIF, redondeos o revaluaciones legítimas.`,
    impact:
      `Sin este anclaje, el Balance y el ECP presentarían cifras inconsistentes — el contador ` +
      `público no podría firmarlos. La línea automática preserva la auditabilidad del ajuste.`,
    period: snapshot.period,
  };

  return { convergenceAdjustment: adjustment, findings: [finding] };
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
