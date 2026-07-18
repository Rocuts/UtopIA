// ---------------------------------------------------------------------------
// Fiscal Anchor — Calculator
// ---------------------------------------------------------------------------
// Deriva las 10 cifras fiscales (F01..F10) en BigInt centavos + porcentajes.
//
// Identidades:
//   F01 = UAI contable (utilidadAntesImpuestos, NO utilidad neta).
//   F02 = round(F01 × 35 / 100) — impuesto de referencia tarifa general
//         persona jurídica (Art. 240 E.T.). 0 si F01 ≤ 0 (no aplica anticipo
//         sobre pérdida fiscal — la base presunta se evalúa en otra capa).
//   F03 = retencionesAFavorCents (input crudo del extractor).
//   F04 = F02 − F03  (positivo = a pagar, negativo = saldo a favor Art. 850).
//   F05..F08 = inputs crudos del extractor (ya absolutos).
//   F09 = (impuestoCausado / F01) × 100, 1 decimal. 0 si F01 ≤ 0.
//   F10 = (F03 / F02) × 100, 1 decimal. 0 si F02 ≤ 0.
//
// Redondeo: F02 al centavo entero (BigInt-safe multiplicación antes de dividir).
// Porcentajes: round-half-away con 1 decimal vía Math.round(x*10)/10.
// ---------------------------------------------------------------------------

import type { FiscalDerivedMetrics, FiscalRawBase } from './internal-types';

const TARIFA_RENTA_PCT = BigInt(35);
const CIEN = BigInt(100);
const ZERO = BigInt(0);

export interface DeriveFiscalAnchorInput {
  /** Utilidad Antes de Impuestos del preprocesador (en centavos BigInt). */
  uaiCents: bigint;
  /** Impuesto causado del periodo (Clase 54), en centavos BigInt. */
  impuestoCausadoCents: bigint;
  /** Bases crudas del extractor. */
  raw: FiscalRawBase;
}

/**
 * Multiplicación porcentual cent-exact. `(amount × pct) / 100`, redondeando
 * al centavo entero. Para porcentajes enteros (35) el resultado es exacto
 * a nivel cent; el redondeo solo importa cuando la base es impar.
 */
function pctOfCents(amountCents: bigint, pct: bigint): bigint {
  if (amountCents <= ZERO) return ZERO;
  const numerator = amountCents * pct;
  // round-half-away-from-zero al dividir por 100
  const quotient = numerator / CIEN;
  const remainder = numerator % CIEN;
  if (remainder * BigInt(2) >= CIEN) return quotient + BigInt(1);
  return quotient;
}

/**
 * Calcula un porcentaje en number con 1 decimal a partir de dos BigInt
 * en centavos. Devuelve 0 si el denominador es 0 o negativo.
 */
function ratioPct1Decimal(numeratorCents: bigint, denominatorCents: bigint): number {
  if (denominatorCents <= ZERO) return 0;
  // Promovemos a número solo al final; escalamos ×10000 en BigInt para
  // conservar DOS dígitos tras el decimal visible antes de redondear —
  // con ×1000 la división entera truncaba el segundo decimal y violaba el
  // contrato round-half-away del header (14,2857% salía 14,2 y no 14,3).
  const scaled = (numeratorCents * BigInt(10_000)) / denominatorCents;
  return Math.round(Number(scaled) / 10) / 10;
}

export function deriveFiscalAnchorMetrics(
  input: DeriveFiscalAnchorInput,
): FiscalDerivedMetrics {
  const { uaiCents, impuestoCausadoCents, raw } = input;

  const f01Cents = uaiCents;
  const f02Cents = pctOfCents(uaiCents, TARIFA_RENTA_PCT);
  const f03Cents = raw.retencionesAFavorCents;
  const f04Cents = f02Cents - f03Cents;
  const f05Cents = raw.ivaPorPagarCents;
  const f06Cents = raw.reteFuentePorPagarCents;
  const f07Cents = raw.icaPorPagarCents;
  const f08Cents = raw.totalPasivosFiscalesCents;

  const f09Pct = ratioPct1Decimal(impuestoCausadoCents, f01Cents);
  const f10Pct = ratioPct1Decimal(f03Cents, f02Cents);

  return {
    f01Cents,
    f02Cents,
    f03Cents,
    f04Cents,
    f05Cents,
    f06Cents,
    f07Cents,
    f08Cents,
    f09Pct,
    f10Pct,
  };
}
