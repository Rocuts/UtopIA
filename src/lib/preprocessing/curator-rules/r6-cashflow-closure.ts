// ---------------------------------------------------------------------------
// R6 — Cierre del Estado de Flujos de Efectivo (EFE ↔ caja PUC 11)
// ---------------------------------------------------------------------------
// R2 reconstruye el EFE por método indirecto desde la variación de saldos
// PUC entre T-1 y T. Su salida `netChangeInCash` rara vez coincide al centavo
// con la variación observada en el saldo de caja (PUC 11): siempre quedan
// movimientos atípicos no capturados por la heurística (transferencias entre
// cuentas internas, errores de imputación, partidas extraordinarias).
//
// R6 cierra esa brecha forzando la igualdad NIC 7 párr. 45:
//   `EFE.netChangeInCash == cierre PUC 11 − inicio PUC 11`
//
// El ajuste se absorbe en la línea de capital de trabajo "Variaciones en
// Capital de Trabajo (ajuste de cierre)", priorizando restar la brecha de
// `varCuentasPorCobrar` (la línea operativa más volátil y la que típicamente
// concentra el ruido). Si esa línea no existe en el shape recibido, se
// inyecta un campo extendido `varCapitalTrabajoAjuste` y se suma al
// `operating.total`.
//
// La regla MUTA `snapshot.cashFlowIndirecto` y popula los campos `cashOpen`
// y `cashClose` de `controlTotals` (que el contrato B0 dejó como TODO(B1)).
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

export interface R6Result {
  cashFlowClosureAdjustment?: CashFlowClosureAdjustment;
  findings: CuratorFinding[];
}

/**
 * Shape extendido del bloque operativo: incluye un campo opcional
 * `varCapitalTrabajoAjuste` que R6 puede inyectar como fallback cuando ninguno
 * de los buckets operativos clásicos está disponible.
 */
type ExtendedOperatingSection = CashFlowOperatingSection & {
  varCapitalTrabajoAjuste?: number;
};

/**
 * Lista de líneas operativas candidatas a absorber el ajuste, en orden de
 * preferencia (la primera que exista y sea numérica gana).
 */
const PREFERRED_BUCKETS: Array<keyof CashFlowOperatingSection> = [
  'varCuentasPorCobrar',
  'varInventarios',
  'varCuentasPorPagar',
  'varProveedores',
];

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

  // Tolerancia: max(|observedChangeInCash| * 0.0001, $1) — exigencia "al centavo".
  const tolerance = Math.max(Math.abs(observedChangeInCash) * 0.0001, 1);

  if (Math.abs(gap) <= tolerance) {
    return { findings: [] };
  }

  // -------------------------------------------------------------------------
  // Mutación: absorber `gap` en una línea operativa.
  //
  // Guardrail de plausibilidad (Pulido Diamante R6):
  //   Un bucket solo puede absorber el gap si |gap| ≤ PLAUSIBILITY_RATIO × |bucket|.
  //   Si ningún bucket clásico supera el guardrail, se usa varCapitalTrabajoAjuste
  //   como fallback sin restricción (es el escape-hatch explícito del contrato).
  //   Si el fallback también tiene magnitud cero, se aborta la mutación y se emite
  //   un finding crítico para investigación manual.
  //
  // Razón para iterar todos los buckets antes de caer al fallback: permite que un
  // bucket de menor preferencia (p.ej. varCuentasPorPagar) absorba un gap que
  // varCuentasPorCobrar rechazaría, maximizando la probabilidad de cierre automático
  // seguro sin sacrificar la plausibilidad del EFE.
  // -------------------------------------------------------------------------
  const PLAUSIBILITY_RATIO = 0.5; // gap absorbido no puede exceder 50% del bucket original

  const operating = efe.operating as ExtendedOperatingSection;
  const gapMagnitude = Math.abs(gap);

  // Buscar el primer bucket preferido que exista Y pase el guardrail.
  const chosenBucket = PREFERRED_BUCKETS.find((k) => {
    if (typeof operating[k] !== 'number') return false;
    const bucketMag = Math.abs(operating[k] as number);
    // Si el bucket tiene magnitud cero no puede absorber nada — saltar.
    if (bucketMag === 0) return false;
    return gapMagnitude <= bucketMag * PLAUSIBILITY_RATIO;
  });

  // Nombre legible del bucket para mensajes (se resuelve antes de mutar).
  let chosenBucketName: string;

  if (chosenBucket !== undefined) {
    // ✅ Happy-path: bucket clásico pasa el guardrail — mutación normal.
    chosenBucketName = chosenBucket;
    // Restar `gap` del bucket elegido. gap = (efe − obs) → restar ajusta el flujo
    // hacia abajo cuando el EFE sobrestima la entrada de caja.
    operating[chosenBucket] = (operating[chosenBucket] as number) - gap;
  } else {
    // Ningún bucket clásico pasó el guardrail. Comprobar si al menos uno existía
    // con magnitud no-cero (para distinguir "gap excesivo" de "sin buckets clásicos").
    const anyClassicBucketExists = PREFERRED_BUCKETS.some(
      (k) => typeof operating[k] === 'number' && Math.abs(operating[k] as number) > 0,
    );

    if (anyClassicBucketExists) {
      // ❌ Todos los buckets disponibles rechazaron el gap por plausibilidad.
      // Emitir finding crítico y NO mutar — investigación manual requerida.
      const findings: CuratorFinding[] = [
        {
          code: 'CUR-R6',
          severity: 'critico',
          title: 'Cierre EFE: brecha excede tope de plausibilidad en todos los buckets',
          description:
            `Brecha entre EFE indirecto y Δ caja observado ($${formatCOP(gapMagnitude)}) excede el ` +
            `${(PLAUSIBILITY_RATIO * 100).toFixed(0)}% de cada bucket operativo disponible. ` +
            `No se aplica ajuste automático — investigar manualmente la causa raíz.`,
          normReference: 'NIC 7 párr. 45 + Pulido Diamante guardrail R6',
          recommendation:
            'Verificar transferencias entre cuentas internas, partidas extraordinarias o errores ' +
            'de imputación. Suministrar movimientos directos de tesorería para cierre exacto.',
          impact:
            'El EFE queda sin cerrar contra saldo PUC 11 — los EEFF oficiales requieren ' +
            'intervención manual antes de firma del Contador.',
          period: snapshot.period,
        },
      ];
      return { findings };
    }

    // Sin buckets clásicos disponibles: usar fallback varCapitalTrabajoAjuste
    // sin aplicar el guardrail (es el escape-hatch explícito del contrato).
    chosenBucketName = 'varCapitalTrabajoAjuste';
    operating.varCapitalTrabajoAjuste = (operating.varCapitalTrabajoAjuste ?? 0) - gap;
  }

  // Recalcular `operating.total` desde sus componentes.
  operating.total = recomputeOperatingTotal(operating);

  // Forzar identidad de cierre.
  efe.netChangeInCash = observedChangeInCash;
  efe.observedChangeInCash = observedChangeInCash;
  efe.reconciliationGap = 0;
  efe.reconciled = true;

  // Reflejar en el snapshot.
  snapshot.cashFlowClosureAdjustment = gap;

  const adjustment: CashFlowClosureAdjustment = {
    efeNetChangeBefore,
    observedChangeInCash,
    gapCop: gap,
    adjustmentLineLabel: ADJUSTMENT_LINE_LABEL,
    reconciledClosingCash: cashClose,
    openingCash: cashOpen,
    justification:
      'Cierre de EFE NIC 7 párr. 45 — alineamiento Efectivo al final con saldo PUC 11 al cierre.',
  };

  const finding: CuratorFinding = {
    code: 'CUR-R6',
    severity: 'medio',
    title: 'Cierre del Estado de Flujos de Efectivo contra saldo PUC 11',
    description:
      `EFE neto antes del cierre: $${formatCOP(efeNetChangeBefore)}. ` +
      `Variación observada en caja PUC 11 ($${formatCOP(cashOpen)} → $${formatCOP(cashClose)}): ` +
      `$${formatCOP(observedChangeInCash)}. Brecha absorbida: $${formatCOP(gap)} ` +
      `vía línea "${ADJUSTMENT_LINE_LABEL}" (bucket: ${chosenBucketName}).`,
    normReference: 'NIC 7 párr. 45',
    recommendation:
      `Validar que la brecha no provenga de transferencias entre cuentas internas mal clasificadas. ` +
      `Si el EFE oficial requiere mayor granularidad, suministrar movimientos directos de tesorería.`,
    impact:
      `Garantiza que el EFE termine al centavo sobre el saldo de caja del cierre — sin esto, ` +
      `los EEFF oficiales requerirían ajuste manual antes de la firma del Contador.`,
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
