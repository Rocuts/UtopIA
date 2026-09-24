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
import { articulosCitados } from '../validators/helpers';
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
  /**
   * Aviso cuando el escenario cita descuentos topeables sin desglose pero trae
   * el impuesto antes de descuentos: el impuesto se toma sin esos descuentos.
   */
  aviso: string | null;
}

export const TOPE_258_NO_VERIFICABLE_MOTIVO =
  'Descuentos de los Arts. 255, 256 o 257 sin impuesto antes de descuentos: el tope conjunto del 25% del Art. 258 E.T. no es verificable y el impuesto del escenario queda N/D.';

/**
 * Re-auditoría 2026-09-24 (NT-01): el escenario que invoca descuentos de los
 * Arts. 255, 256 o 257 E.T. sin desglose por artículo ni impuesto antes de
 * descuentos evitaba el tope: se publicaba el impuesto del modelo. Sin ese
 * dato el tope no es verificable y el escenario queda N/D.
 */
export const TOPE_258_SIN_DESGLOSE_MOTIVO =
  'El escenario invoca descuentos de los Arts. 255, 256 o 257 E.T. sin desglose por artículo ni impuesto antes de descuentos: el tope conjunto del 25% del Art. 258 E.T. no es verificable y el impuesto del escenario queda N/D.';

export const TOPE_258_SIN_DESGLOSE_AVISO =
  'El escenario invoca descuentos de los Arts. 255, 256 o 257 E.T. sin desglose por artículo: el impuesto del escenario se calculó sin esos descuentos (impuesto antes de descuentos).';

/** Artículos cuyos descuentos entran en el tope conjunto del Art. 258. */
const ARTICULOS_TOPEABLES = new Set(['255', '256', '257']);

/**
 * Rango de artículos «Arts. 255-257», «Arts. 254 a 258», «Articles 255 to
 * 257». Los dos extremos tienen tres dígitos: «Art. 258-1» o «Art. 240-1» son
 * artículos compuestos, no rangos (revisión adversarial de NT-01: «Arts.
 * 255-257 E.T.» se leía como un solo artículo «255-257» y el escenario
 * evitaba el tope).
 */
const RANGO_ARTICULOS =
  /\bArt(?:[íi]culos?|icles?|s)?\.?\s*(\d{3})\s*(?:[-–]|\bal?\b|\bto\b|\bhasta\b)\s*(\d{3})(?![\d-])/gi;

function rangoIncluyeTopeables(texto: string): boolean {
  for (const m of texto.matchAll(RANGO_ARTICULOS)) {
    const desde = Number(m[1]);
    const hasta = Number(m[2]);
    if (hasta > desde && desde <= 257 && hasta >= 255) return true;
  }
  return false;
}

/**
 * `true` si el escenario invoca descuentos topeables: cita los Arts. 255, 256
 * o 257 E.T. (sueltos, en enumeración o en un rango que los incluye) en sus
 * artículos aplicables o en su justificación. Citar sólo el Art. 258 (el
 * tope) o el 258-1 (fuera del tope) no cuenta.
 */
export function escenarioCitaDescuentosTopeables(e: {
  articulosAplicables?: readonly string[] | null;
  justificacion?: string | null;
}): boolean {
  const textos = [...(e.articulosAplicables ?? []), e.justificacion ?? ''];
  return textos.some(
    (t) => articulosCitados(t).some((n) => ARTICULOS_TOPEABLES.has(n)) || rangoIncluyeTopeables(t),
  );
}

function monto(v: string | null | undefined): bigint | null {
  if (v === null || v === undefined) return ZERO;
  if (!/^\d+$/.test(v)) return null; // negativo o no numérico ⇒ inválido
  return BigInt(v);
}

/**
 * Aplica el tope del Art. 258 a un escenario. `impuestoAntesDescuentos` null
 * sólo es admisible si el escenario no toma descuentos topeables.
 * `descuentos` null / campos null ⇒ el escenario no toma ese descuento, salvo
 * que `citaDescuentosTopeables` diga que el escenario los invoca: entonces el
 * desglose es obligatorio (sin impuesto antes de descuentos ⇒ N/D; con él, el
 * impuesto se toma sin descuentos).
 */
export function aplicarTope258Escenario(
  impuestoAntesDescuentos: string | null,
  descuentos: PlaneacionDescuentos | null | undefined,
  impuestoEscenarioModelo: string | null = null,
  opts: { citaDescuentosTopeables?: boolean } = {},
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
      aviso: null,
    };
  }
  const conTope = d255! + d256! + d257!;
  const sinTope = d254! + d258_1!;
  const sinDesglose = opts.citaDescuentosTopeables === true && conTope === ZERO;

  const antes = impuestoAntesDescuentos === null ? null : monto(impuestoAntesDescuentos);
  if (antes === null) {
    if (impuestoAntesDescuentos !== null) {
      return { impuestoEscenario: null, tope258: null, excesoTope258: null, motivo: 'Impuesto antes de descuentos inválido: impuesto N/D.', aviso: null };
    }
    if (conTope > ZERO || sinTope > ZERO) {
      return { impuestoEscenario: null, tope258: null, excesoTope258: null, motivo: TOPE_258_NO_VERIFICABLE_MOTIVO, aviso: null };
    }
    if (sinDesglose) {
      return { impuestoEscenario: null, tope258: null, excesoTope258: null, motivo: TOPE_258_SIN_DESGLOSE_MOTIVO, aviso: null };
    }
    // Sin descuentos no hay tope que verificar: el escenario es el del modelo.
    return { impuestoEscenario: impuestoEscenarioModelo, tope258: null, excesoTope258: null, motivo: null, aviso: null };
  }

  const tope = _internals_pctOf(antes, 25);
  const aplicadoConTope = conTope > tope ? tope : conTope;
  const neto = antes - sinTope - aplicadoConTope;
  return {
    impuestoEscenario: serializeMoneyCop(neto > ZERO ? neto : ZERO),
    tope258: serializeMoneyCop(tope),
    excesoTope258: serializeMoneyCop(conTope - aplicadoConTope),
    motivo: null,
    aviso: sinDesglose ? TOPE_258_SIN_DESGLOSE_AVISO : null,
  };
}
