// ---------------------------------------------------------------------------
// Helpers para convertir entre MoneyCop (string en centavos) y otras formas
// ---------------------------------------------------------------------------
// Las cifras viajan como string en el contrato JSON-strict (ver `base.ts`).
// Cualquier código que necesite operar aritméticamente las convierte a BigInt
// con `parseMoneyCop` y formatea con `formatCopFromCents` cuando renderiza.
// ---------------------------------------------------------------------------

/**
 * Parsea un MoneyCop a BigInt (centavos). Lanza si el string no cumple el
 * regex `^-?\d+$`.
 */
export function parseMoneyCop(value: string): bigint {
  if (!/^-?\d+$/.test(value)) {
    // Don't include raw value in message — it may appear in logs.
    throw new Error(`parseMoneyCop: valor inválido (len=${value.length}) — debe ser entero serializado`);
  }
  return BigInt(value);
}

/** BigInt (centavos) -> MoneyCop string. */
export function serializeMoneyCop(cents: bigint): string {
  return cents.toString(10);
}

/**
 * Formatea centavos a presentación COP colombiana: `$1.234.567,89`.
 *
 * @param cents     Centavos como bigint o number (number solo para totales chicos).
 * @param absolute  Si true, presenta valor absoluto (regla NIIF Analyst).
 *                  Si false, mantiene el signo y usa paréntesis para negativos
 *                  (convención NIIF: `($1.234,56)`).
 */
export function formatCopFromCents(cents: bigint | number, absolute = false): string {
  const ZERO = BigInt(0);
  const big = typeof cents === 'bigint' ? cents : BigInt(Math.round(cents));
  const isNegative = big < ZERO;
  const abs = isNegative ? -big : big;
  const wholeCents = abs.toString().padStart(3, '0');
  const wholePart = wholeCents.slice(0, -2) || '0';
  const decimalPart = wholeCents.slice(-2);
  const withSep = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const formatted = `$${withSep},${decimalPart}`;
  if (absolute) return formatted;
  return isNegative ? `(${formatted})` : formatted;
}

/** Suma una colección de MoneyCop strings y devuelve un MoneyCop. */
export function sumMoneyCop(values: readonly string[]): string {
  let acc = BigInt(0);
  for (const v of values) acc += parseMoneyCop(v);
  return serializeMoneyCop(acc);
}

/** Resta b de a en centavos. */
export function subMoneyCop(a: string, b: string): string {
  return serializeMoneyCop(parseMoneyCop(a) - parseMoneyCop(b));
}

/** Verifica igualdad exacta dentro de una tolerancia (en centavos). */
export function moneyCopEquals(a: string, b: string, toleranceCents: bigint = BigInt(0)): boolean {
  const ZERO = BigInt(0);
  const diff = parseMoneyCop(a) - parseMoneyCop(b);
  const abs = diff < ZERO ? -diff : diff;
  return abs <= toleranceCents;
}

/**
 * Porcentaje entero de un MoneyCop, TRUNCADO hacia abajo (floor para valores
 * positivos: BigInt divide truncando hacia cero). Floor-bias deliberado para
 * defensa Art. 647 (un descuento nunca sobreestimado). `pct` es entero (ej. 25).
 * Pensado para montos NO negativos (donación, impuesto).
 */
export function pctFloorMoneyCop(value: string, pct: number): string {
  if (!Number.isInteger(pct) || pct < 0) {
    throw new Error(`pctFloorMoneyCop: pct debe ser entero >= 0 (recibido ${pct}).`);
  }
  return serializeMoneyCop((parseMoneyCop(value) * BigInt(pct)) / BigInt(100));
}

/** Menor de dos MoneyCop (comparación en centavos). Empate → devuelve `a`. */
export function minMoneyCop(a: string, b: string): string {
  return parseMoneyCop(a) <= parseMoneyCop(b) ? a : b;
}
