// ---------------------------------------------------------------------------
// R6 — Cierre del Estado de Flujos de Efectivo (EFE ↔ caja PUC 11)
// ---------------------------------------------------------------------------
// R2 reconstruye el EFE por método indirecto clasificando TODA cuenta de las
// clases 1-3, así que cuando los dos balances cuadran su variación neta es la
// variación de la caja al centavo (NIC 7 párr. 45). Lo único que puede quedar
// es ruido de redondeo.
//
// Auditoría 2026-09 (niif-preproceso-15/-16): la versión anterior absorbía
// cualquier brecha "plausible" (hasta el 50 % de un renglón) en una línea de
// capital de trabajo. Así, dividendos mal calculados o compras de intangibles
// terminaban como flujo operativo y ambos errores se compensaban. Contrato
// vigente:
//   - |brecha| < $0,005            → ruido de coma flotante: se alinea.
//   - |brecha| ≤ $1                → redondeo: se absorbe en la línea
//                                    explícita "Variaciones en Capital de
//                                    Trabajo (ajuste de cierre)".
//   - |brecha| > $1                → NO se toca el EFE. La brecha queda
//                                    visible (`reconciled = false`) y se
//                                    reporta; con R2 completo sólo aparece si
//                                    alguno de los balances no cuadra.
//
// La regla popula siempre `controlTotals.cashOpen` / `cashClose`.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '../trial-balance';

import type {
  CashFlowClosureAdjustment,
  CashFlowOperatingSection,
  CashFlowStatement,
  CuratorFinding,
} from './types';

const ADJUSTMENT_LINE_LABEL =
  'Variaciones en Capital de Trabajo (ajuste de cierre)';

/** Ruido de coma flotante: por debajo de medio centavo. */
const FLOAT_NOISE = 0.005;
/** Tope de redondeo que R6 puede absorber (pesos). */
const ROUNDING_TOL = 1;

export interface R6Result {
  cashFlowClosureAdjustment?: CashFlowClosureAdjustment;
  findings: CuratorFinding[];
}

/**
 * Shape extendido del bloque operativo: incluye el campo opcional
 * `varCapitalTrabajoAjuste` donde R6 registra el redondeo absorbido.
 */
type ExtendedOperatingSection = CashFlowOperatingSection & {
  varCapitalTrabajoAjuste?: number;
};

export function runR6(
  snapshot: PeriodSnapshot,
  prev: PeriodSnapshot | null,
): R6Result {
  // Sin EFE construido por R2, no hay nada que cerrar.
  const efe = snapshot.cashFlowIndirecto;
  if (!efe) return { findings: [] };

  const efeNetChangeBefore = efe.netChangeInCash;
  const cashClose = snapshot.controlTotals.efectivoCuenta11;
  const cashOpen = prev ? prev.controlTotals.efectivoCuenta11 : 0;

  // Popular los campos de ancla (resuelve el TODO(B1) del contrato).
  snapshot.controlTotals.cashClose = cashClose;
  snapshot.controlTotals.cashOpen = cashOpen;

  const observedChangeInCash = cashClose - cashOpen;
  const gap = efeNetChangeBefore - observedChangeInCash;
  const gapMagnitude = Math.abs(gap);

  // Sin comparativo el EFE es parcial por construcción: no se "cierra".
  const isSinglePeriod = efe.comparativePeriod === '(sin_comparativo)';

  if (gapMagnitude < FLOAT_NOISE) {
    efe.netChangeInCash = observedChangeInCash;
    efe.observedChangeInCash = observedChangeInCash;
    efe.reconciliationGap = 0;
    // Sin comparativo el EFE sigue siendo parcial (no oficial) aunque sume.
    if (!isSinglePeriod) efe.reconciled = true;
    return { findings: [] };
  }

  if (isSinglePeriod || gapMagnitude > ROUNDING_TOL) {
    // Brecha material: NO se absorbe en ninguna línea operativa.
    efe.reconciled = false;
    efe.reconciliationGap = gap;
    if (isSinglePeriod) return { findings: [] };
    return {
      findings: [
        {
          code: 'CUR-R6',
          severity: 'alto',
          title: 'EFE indirecto no concilia con la caja PUC 11 — brecha visible',
          description:
            `Variación neta del EFE indirecto: $${formatCOP(efeNetChangeBefore)}. Variación ` +
            `observada en caja PUC 11 ($${formatCOP(cashOpen)} → $${formatCOP(cashClose)}): ` +
            `$${formatCOP(observedChangeInCash)}. Brecha: $${formatCOP(gap)}. El sistema no la ` +
            `absorbe en capital de trabajo: con todos los grupos PUC clasificados, una brecha ` +
            `material indica que alguno de los balances no cuadra.`,
          normReference: 'NIC 7 párr. 45',
          recommendation:
            'Revisar los hallazgos de cuadratura (R8) de ambos periodos o suministrar ' +
            'movimientos directos de tesorería.',
          impact:
            'El EFE no puede presentarse como conciliado con el efectivo del Estado de ' +
            'Situación Financiera.',
          period: snapshot.period,
        },
      ],
    };
  }

  // Redondeo (≤ $1): se registra en la línea explícita de ajuste de cierre.
  const operating = efe.operating as ExtendedOperatingSection;
  operating.varCapitalTrabajoAjuste = (operating.varCapitalTrabajoAjuste ?? 0) - gap;
  operating.total = recomputeOperatingTotal(operating);

  efe.netChangeInCash = observedChangeInCash;
  efe.observedChangeInCash = observedChangeInCash;
  efe.reconciliationGap = 0;
  efe.reconciled = true;
  snapshot.cashFlowClosureAdjustment = gap;

  const adjustment: CashFlowClosureAdjustment = {
    efeNetChangeBefore,
    observedChangeInCash,
    gapCop: gap,
    adjustmentLineLabel: ADJUSTMENT_LINE_LABEL,
    reconciledClosingCash: cashClose,
    openingCash: cashOpen,
    justification:
      'Redondeo ≤ $1 absorbido para conciliar el EFE con el saldo PUC 11 al cierre (NIC 7 párr. 45).',
  };

  const finding: CuratorFinding = {
    code: 'CUR-R6',
    severity: 'informativo',
    title: 'Redondeo del Estado de Flujos de Efectivo contra saldo PUC 11',
    description:
      `EFE neto antes del ajuste: $${formatCOP(efeNetChangeBefore)}. Variación observada en ` +
      `caja PUC 11: $${formatCOP(observedChangeInCash)}. Diferencia de redondeo absorbida: ` +
      `$${gap.toFixed(2)} vía línea "${ADJUSTMENT_LINE_LABEL}".`,
    normReference: 'NIC 7 párr. 45',
    recommendation: 'Sin acción: diferencia de redondeo.',
    impact: 'Ninguno material.',
    period: snapshot.period,
  };

  return { cashFlowClosureAdjustment: adjustment, findings: [finding] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recomputeOperatingTotal(op: ExtendedOperatingSection): number {
  return (
    op.utilidadNeta +
    op.depreciacionAmortizacion +
    op.varCuentasPorCobrar +
    op.varInventarios +
    op.varProveedores +
    op.varCuentasPorPagar +
    op.varImpuestosPorPagar +
    op.varObligacionesLaborales +
    (op.varOtrosPasivosOperativos ?? 0) +
    (op.varCapitalTrabajoAjuste ?? 0)
  );
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}

// Re-export para satisfacer eventual lectura externa.
export type { CashFlowStatement };
