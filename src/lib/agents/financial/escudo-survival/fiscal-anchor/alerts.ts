// ---------------------------------------------------------------------------
// Fiscal Anchor — Alertas
// ---------------------------------------------------------------------------
// Reglas determinísticas que cruzan F01..F10 + clase 54 + calendario y emiten
// banderas para el UI / dictamen. NUNCA texto literal — sólo i18n keys.
//
// Reglas:
//   A5_SIN_PROVISION  (error)   → impuestoCausado = 0 y F01 > 0 (la empresa
//                                 reporta utilidad pero no causó impuesto;
//                                 incumple Art. 240 E.T. + NIC 12 §46).
//   SALDO_A_FAVOR     (info)    → F04 < 0 (saldo a favor procedimentable
//                                 vía Art. 850 E.T.).
//   VENCIMIENTO_15D   (warning) → cualquier vencimiento.estado === 'proximo'.
//   F10_BAJA          (warning) → F10 < 10% (cobertura de retenciones baja;
//                                 expone a flujo de caja en cierre fiscal).
// ---------------------------------------------------------------------------

import type { CalendarioDian, FiscalAlerta } from './types';
import type { FiscalDerivedMetrics } from './internal-types';

const ZERO = BigInt(0);
const F10_UMBRAL_BAJO_PCT = 10;

export interface EvaluateFiscalAlertsInput {
  metrics: FiscalDerivedMetrics;
  /** Impuesto causado del periodo (Clase 54), en centavos. */
  impuestoCausadoCents: bigint;
  /** Calendario ya construido (para detectar vencimientos ≤ 15 días). */
  calendario: CalendarioDian;
}

export function evaluateFiscalAlerts(input: EvaluateFiscalAlertsInput): FiscalAlerta[] {
  const { metrics, impuestoCausadoCents, calendario } = input;
  const alertas: FiscalAlerta[] = [];

  // A5_SIN_PROVISION — utilidad sin impuesto causado.
  if (impuestoCausadoCents === ZERO && metrics.f01Cents > ZERO) {
    alertas.push({
      codigo: 'A5_SIN_PROVISION',
      severidad: 'error',
      mensaje: 'escudo.fiscal.alert.a5_sin_provision',
      norma: 'Art. 240 E.T. + NIC 12 §46',
    });
  }

  // SALDO_A_FAVOR — F04 negativa.
  if (metrics.f04Cents < ZERO) {
    alertas.push({
      codigo: 'SALDO_A_FAVOR',
      severidad: 'info',
      mensaje: 'escudo.fiscal.alert.saldo_a_favor',
      norma: 'Art. 850 E.T.',
    });
  }

  // VENCIMIENTO_15D — uno o más vencimientos a ≤ 15 días.
  const proximos = calendario.vencimientos.filter((v) => v.estado === 'proximo');
  if (proximos.length > 0) {
    alertas.push({
      codigo: 'VENCIMIENTO_15D',
      severidad: 'warning',
      mensaje: 'escudo.fiscal.alert.vencimiento_15d',
      norma: 'Resolución DIAN calendario tributario',
    });
  }

  // F10_BAJA — cobertura de retenciones < 10%. Sólo aplica cuando F02 > 0
  // (si no hay impuesto de referencia, F10 = 0 por construcción y no es
  // diagnóstico útil emitir esta alerta).
  if (metrics.f02Cents > ZERO && metrics.f10Pct < F10_UMBRAL_BAJO_PCT) {
    alertas.push({
      codigo: 'F10_BAJA',
      severidad: 'warning',
      mensaje: 'escudo.fiscal.alert.f10_baja',
      norma: 'Art. 365 E.T. (mecanismo de retención como anticipo)',
    });
  }

  // ICA_ESTIMACION_SIN_CIIU — ReteICA (Cta. 2368) como proxy del ICA causado.
  // Sin CIIU verificado del contribuyente no se puede aplicar tarifa cierta del
  // Decreto 352/2002 Bogotá. Se etiqueta como estimación operativa para no
  // exponer a Art. 647 E.T. por inexactitud. (Wave 8 dictamen §5).
  if (metrics.f07Cents > ZERO) {
    alertas.push({
      codigo: 'ICA_ESTIMACION_SIN_CIIU',
      severidad: 'info',
      mensaje: 'escudo.fiscal.alert.ica_estimacion_sin_ciiu',
      norma: 'Decreto Distrital 352/2002 Art. 27 + Acuerdo 65/2002',
    });
  }

  return alertas;
}
