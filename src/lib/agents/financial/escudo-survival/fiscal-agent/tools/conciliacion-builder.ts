// ---------------------------------------------------------------------------
// Capa 4 — Módulo 2 — Tool: Conciliación Borrador Skeleton
// ---------------------------------------------------------------------------
//
// Genera el esqueleto determinístico de la conciliación fiscal (UAI contable
// → renta líquida gravable → impuesto bruto → descuentos → impuesto neto →
// retenciones → saldo final). El LLM rellena las líneas no triviales (gastos
// no deducibles particulares, rentas exentas aplicables) sobre este esqueleto.
//
// Cero LLM, cero red, cero filesystem.
// ---------------------------------------------------------------------------

import {
  parseMoneyCop,
  serializeMoneyCop,
} from '@/lib/agents/financial/contracts/money';
import type { FiscalAnchorBlock } from '../../fiscal-anchor/types';

const ZERO = BigInt(0);
const CIEN = BigInt(100);

/**
 * Tarifa general PJ — Art. 240 E.T. 35%.
 * Sectores especiales (financiero +5pp = 40%, hidro +3pp = 38%, zona franca
 * 20%/35% híbrida) los maneja el LLM porque requieren contexto sectorial.
 */
const TARIFA_GENERAL_PCT = 35;

export interface ConciliacionSkeleton {
  uaiContable: string;
  /** Renta líquida gravable = UAI (el LLM ajusta con adiciones/deducciones). */
  rentaLiquidaGravableBase: string;
  tarifaPct: number;
  /** Impuesto bruto base = UAI × tarifa. */
  impuestoBrutoBase: string;
  /** F03 — retenciones y anticipos a favor. */
  retencionesYAnticipos: string;
  /** Saldo final SIN adiciones / deducciones / descuentos (skeleton). */
  saldoFinalBase: string;
  /** Disclaimer obligatorio. */
  disclaimer: string;
}

function pctOf(amountCents: bigint, pct: number): bigint {
  if (amountCents <= ZERO) return ZERO;
  const pctBig = BigInt(Math.round(pct * 100)); // 2 decimales de tarifa
  const numerator = amountCents * pctBig;
  const DIV = BigInt(10_000); // 100 (pct base) × 100 (decimales)
  const quotient = numerator / DIV;
  const remainder = numerator % DIV;
  return remainder * BigInt(2) >= DIV ? quotient + BigInt(1) : quotient;
}

/**
 * Construye el esqueleto numérico de la conciliación a partir del Âncora.
 * El LLM consume este esqueleto + datos del balance para emitir las líneas
 * de adiciones, deducciones, rentas exentas y descuentos contextuales.
 */
export function buildConciliacionSkeleton(
  anchor: FiscalAnchorBlock,
): ConciliacionSkeleton {
  const uaiCents = parseMoneyCop(anchor.f01);
  const f03Cents = parseMoneyCop(anchor.f03);
  const impuestoBrutoBase = pctOf(uaiCents, TARIFA_GENERAL_PCT);
  const saldoFinalBase = impuestoBrutoBase - f03Cents;

  return {
    uaiContable: serializeMoneyCop(uaiCents),
    rentaLiquidaGravableBase: serializeMoneyCop(uaiCents),
    tarifaPct: TARIFA_GENERAL_PCT,
    impuestoBrutoBase: serializeMoneyCop(impuestoBrutoBase),
    retencionesYAnticipos: serializeMoneyCop(f03Cents),
    saldoFinalBase: serializeMoneyCop(saldoFinalBase),
    disclaimer:
      'Esta conciliación es un BORRADOR generado a partir del balance preprocesado. Las adiciones, deducciones, rentas exentas y descuentos requieren revisión del contador público y/o revisor fiscal antes de su uso oficial. Las diferencias de criterio razonables están amparadas por el parágrafo del Art. 647 E.T.',
  };
}

// Wrapper interno para que el centavo absoluto vea la luz cuando se requiera.
export function _internals_pctOf(cents: bigint, pct: number): bigint {
  return pctOf(cents, pct);
}

export const TARIFA_GENERAL_PCT_VAL = TARIFA_GENERAL_PCT;
export { CIEN as _CIEN_DEBUG };
