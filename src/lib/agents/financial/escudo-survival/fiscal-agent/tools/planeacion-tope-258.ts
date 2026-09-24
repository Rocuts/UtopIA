// ---------------------------------------------------------------------------
// Capa 4 — Módulo 4 — Tool: tope conjunto del Art. 258 E.T. por escenario
// ---------------------------------------------------------------------------
//
// Fase 2 de la auditoría 2026-09-24 (pendiente #8). Art. 258 E.T. (mod. Art.
// 106 Ley 1819/2016): «Los descuentos de que tratan los artículos 255, 256 y
// 257 del Estatuto Tributario tomados en su conjunto no podrán exceder del 25%
// del impuesto sobre la renta a cargo del contribuyente en el respectivo año
// gravable.» El Art. 254 (impuestos pagados en el exterior) tiene su propio
// límite y el Art. 258-1 (IVA de activos fijos reales productivos) no entra en
// el tope conjunto. Misma regla que `recomputeConciliacion` (Módulo 2).
//
//   impuesto = max(0, antes − 254 − 258-1 − min(255 + 256 + 257, 25% × antes))
//
// Cero LLM, cero red.
// ---------------------------------------------------------------------------

import { serializeMoneyCop } from '@/lib/agents/financial/contracts/money';
import { _internals_pctOf } from './conciliacion-builder';

const ZERO = BigInt(0);

export interface PlaneacionDescuentos {
  /** Impuestos pagados en el exterior (Art. 254) — fuera del tope conjunto. */
  art254Cents: string | null;
  /** Inversiones en control y mejoramiento del medio ambiente (Art. 255). */
  art255Cents: string | null;
  /** Inversiones en CTeI (Art. 256). */
  art256Cents: string | null;
  /** Donaciones a entidades del régimen especial (Art. 257). */
  art257Cents: string | null;
  /** IVA en activos fijos reales productivos (Art. 258-1) — fuera del tope. */
  art258_1Cents: string | null;
}

export interface Tope258Resultado {
  /** Impuesto del escenario recalculado; null si no es verificable. */
  impuestoEscenario: string | null;
  /** 25% del impuesto antes de descuentos; null sin esa base. */
  tope258: string | null;
  /** Descuentos 255/256/257 por encima del tope (no aplicables); null sin base. */
  excesoTope258: string | null;
  /** Motivo en español cuando el escenario queda N/D por el tope. */
  motivo: string | null;
}

export const TOPE_258_NO_VERIFICABLE_MOTIVO =
  'Descuentos de los Arts. 255, 256 o 257 sin impuesto antes de descuentos: el tope conjunto del 25% del Art. 258 E.T. no es verificable y el impuesto del escenario queda N/D.';

function monto(v: string | null | undefined): bigint | null {
  if (v === null || v === undefined) return ZERO;
  if (!/^\d+$/.test(v)) return null; // negativo o no numérico ⇒ inválido
  return BigInt(v);
}

/**
 * Aplica el tope del Art. 258 a un escenario. `impuestoAntesDescuentos` null
 * sólo es admisible si el escenario no toma descuentos topeables.
 * `descuentos` null / campos null ⇒ el escenario no toma ese descuento.
 */
export function aplicarTope258Escenario(
  impuestoAntesDescuentos: string | null,
  descuentos: PlaneacionDescuentos | null | undefined,
  impuestoEscenarioModelo: string | null = null,
): Tope258Resultado {
  const d254 = monto(descuentos?.art254Cents);
  const d255 = monto(descuentos?.art255Cents);
  const d256 = monto(descuentos?.art256Cents);
  const d257 = monto(descuentos?.art257Cents);
  const d258_1 = monto(descuentos?.art258_1Cents);
  if ([d254, d255, d256, d257, d258_1].some((x) => x === null)) {
    return {
      impuestoEscenario: null,
      tope258: null,
      excesoTope258: null,
      motivo: 'Descuentos del escenario con montos inválidos (negativos o no numéricos): impuesto N/D.',
    };
  }
  const conTope = d255! + d256! + d257!;
  const sinTope = d254! + d258_1!;

  const antes = impuestoAntesDescuentos === null ? null : monto(impuestoAntesDescuentos);
  if (antes === null) {
    if (impuestoAntesDescuentos !== null) {
      return { impuestoEscenario: null, tope258: null, excesoTope258: null, motivo: 'Impuesto antes de descuentos inválido: impuesto N/D.' };
    }
    if (conTope > ZERO || sinTope > ZERO) {
      return { impuestoEscenario: null, tope258: null, excesoTope258: null, motivo: TOPE_258_NO_VERIFICABLE_MOTIVO };
    }
    // Sin descuentos no hay tope que verificar: el escenario es el del modelo.
    return { impuestoEscenario: impuestoEscenarioModelo, tope258: null, excesoTope258: null, motivo: null };
  }

  const tope = _internals_pctOf(antes, 25);
  const aplicadoConTope = conTope > tope ? tope : conTope;
  const neto = antes - sinTope - aplicadoConTope;
  return {
    impuestoEscenario: serializeMoneyCop(neto > ZERO ? neto : ZERO),
    tope258: serializeMoneyCop(tope),
    excesoTope258: serializeMoneyCop(conTope - aplicadoConTope),
    motivo: null,
  };
}
