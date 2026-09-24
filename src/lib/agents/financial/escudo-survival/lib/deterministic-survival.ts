// ---------------------------------------------------------------------------
// Modo Supervivencia (ruta /api/escudo-survival) — cifras deterministas
// ---------------------------------------------------------------------------
// Auditoría 2026-09. Los cinco agentes LLM producían cifras que tienen cálculo
// determinista disponible o que no tienen base verificable. Estas funciones
// las fijan DESPUÉS de la llamada al modelo:
//   - tributario-modulos-06: TET contable = impuesto causado (clase 54) / UAI
//     (antes UAI × 35% / UAI = 35% siempre ⇒ «rojo» para toda UAI > 0); TTD
//     = null (sin ID/UD, igual que CCV del Agente Fiscal); nivel de alerta
//     derivado de la TET contable (null si no es medible).
//   - tributario-modulos-02: el escudo de retenciones no publica «saldo a
//     favor proyectado» (sin declaración no hay saldo determinable).
//   - tributario-modulos-07: bancarización del Art. 771-5 N/D sin el flujo
//     de pagos en efectivo del año (el saldo de caja no lo mide).
//   - tributario-calc-01: el Art. 36-3 E.T. está derogado (Ley 2277/2022 art.
//     96): capitalizar utilidades tributa como distribución.
// ---------------------------------------------------------------------------

import { TTD_UNAVAILABLE_REASON } from '../fiscal-agent/tools/ccv-calculator';
import type { SurvivalAnchorTotals } from './extract-totals';
import type {
  AlertLevel,
  AntiDianResult,
  DividendOptimizerResult,
  RetentionShieldResult,
  TetCalculatorResult,
} from '../types';
import { TET_ALERTA_AMARILLA, TET_ALERTA_ROJA } from '../types';

export interface TetContable {
  tet: number | null;
  nivelAlerta: AlertLevel | null;
  impuestoProyectado: number;
  uai: number;
}

/** TET contable = impuesto causado / UAI; null si UAI ≤ 0 (no hay base). */
export function computeTetContable(anchors: SurvivalAnchorTotals): TetContable {
  const uai = anchors.utilidadAntesImpuestos;
  const impuesto = anchors.impuestoCausado;
  if (!(uai > 0)) {
    return { tet: null, nivelAlerta: null, impuestoProyectado: impuesto, uai };
  }
  const tet = Math.round((impuesto / uai) * 10_000) / 10_000;
  const nivelAlerta: AlertLevel =
    tet > TET_ALERTA_ROJA ? 'rojo' : tet >= TET_ALERTA_AMARILLA ? 'amarillo' : 'verde';
  return { tet, nivelAlerta, impuestoProyectado: impuesto, uai };
}

export const TET_NO_MEDIBLE_MOTIVO =
  'TET contable no medible: la utilidad antes de impuestos es ≤ $0. No se asigna nivel de alerta.';

export function enforceTet(json: TetCalculatorResult, anchors: SurvivalAnchorTotals): TetCalculatorResult {
  const t = computeTetContable(anchors);
  const warnings = [...json.warnings, TTD_UNAVAILABLE_REASON];
  if (t.tet === null) warnings.push(TET_NO_MEDIBLE_MOTIVO);
  return {
    ...json,
    data: {
      ...json.data,
      tet: t.tet,
      ttd: null,
      nivelAlerta: t.nivelAlerta,
      impuestoProyectado: t.impuestoProyectado,
      uai: t.uai,
    },
    warnings,
  };
}

export const SALDO_FAVOR_ND_MOTIVO =
  'Saldo a favor no determinable: retenciones menos impuesto contable es una estimación; el saldo a favor sale de la declaración de renta (Arts. 26, 807 y 850 E.T.).';

export function enforceRetention(
  json: RetentionShieldResult,
  anchors: SurvivalAnchorTotals,
): RetentionShieldResult {
  return {
    ...json,
    data: {
      ...json.data,
      retencionesAcumuladas: anchors.creditoRenta,
      impuestoProyectado: anchors.impuestoCausado,
      saldoAFavorProyectado: null,
      // Sin saldo declarado no se recomienda solicitar devolución.
      acciones: json.data.acciones.filter((a) => a.tipo !== 'devolucion'),
    },
    warnings: [...json.warnings, SALDO_FAVOR_ND_MOTIVO],
  };
}

export const BANCARIZACION_ND_MOTIVO =
  'Bancarización (Art. 771-5 E.T.) no determinable: el balance de prueba no trae los pagos en efectivo del año ni el total pagado; el saldo de caja (1105) es un stock, no un flujo. Para cuantificar se requiere el auxiliar de caja o el detalle de pagos por transacción.';

export function enforceAntiDian(json: AntiDianResult): AntiDianResult {
  return {
    ...json,
    data: {
      ...json.data,
      pagosEfectivoTotal: null,
      // Sin detalle por transacción no hay pagos individuales identificables.
      pagosNoDeduciblesIndividuales: [],
      excesoNoDeducibleGeneral: null,
      mayorImpuestoEstimado: null,
    },
    warnings: [...json.warnings, BANCARIZACION_ND_MOTIVO],
  };
}

export const ART_36_3_DEROGADO_MOTIVO =
  'El Art. 36-3 E.T. fue derogado desde el 1-ene-2023 (Ley 2277 de 2022, art. 96; DIAN Concepto 2769 de 2026): capitalizar utilidades tributa como distribución (Arts. 48-49, 242 y 242-1 E.T.). El escenario de capitalización tiene la misma carga del socio que distribuir.';

/**
 * Capitalizar = distribuir en acciones o cuotas ⇒ misma carga del socio. Se
 * copian impuesto, neto y ahorro del escenario de distribución a los de
 * capitalización e híbrido (conservando el fortalecimiento patrimonial).
 */
export function enforceDividend(json: DividendOptimizerResult): DividendOptimizerResult {
  const e = json.data.escenarios;
  const d = e.distribuirTotal;
  return {
    ...json,
    data: {
      ...json.data,
      escenarios: {
        distribuirTotal: d,
        capitalizarTotal: { ...e.capitalizarTotal, impuestoSocio: d.impuestoSocio, netoSocio: d.netoSocio, ahorroSocio: d.ahorroSocio },
        hibrido50_50: { ...e.hibrido50_50, impuestoSocio: d.impuestoSocio, netoSocio: d.netoSocio, ahorroSocio: d.ahorroSocio },
      },
      norma: json.data.norma === 'Art. 242-1 E.T.' ? 'Art. 242-1 E.T.' : 'Art. 242 E.T.',
    },
    warnings: [...json.warnings, ART_36_3_DEROGADO_MOTIVO],
  };
}
