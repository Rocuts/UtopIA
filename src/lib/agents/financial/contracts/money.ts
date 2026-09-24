// ---------------------------------------------------------------------------
// Helpers para convertir entre MoneyCop (string en centavos) y otras formas
// ---------------------------------------------------------------------------
// Las cifras viajan como string en el contrato JSON-strict (ver `base.ts`).
// Cualquier código que necesite operar aritméticamente las convierte a BigInt
// con `parseMoneyCop` y formatea con `formatCopFromCents` cuando renderiza.
// ---------------------------------------------------------------------------

/**
 * Parsea un MoneyCop a BigInt (centavos). Lanza si el string no cumple el
 * regex `^-?\d+$`. Las formas no canónicas que el regex admite ('-0', ceros a
 * la izquierda) se normalizan aquí: `BigInt('-0') === 0n`, `BigInt('007') ===
 * 7n`; toda aritmética y comparación posterior se hace en BigInt y la
 * serialización (`serializeMoneyCop`) es siempre canónica.
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
 * @param cents     Centavos como bigint o number. Un `number` debe ser un
 *                  ENTERO SEGURO de centavos (|n| ≤ 2^53 − 1): el helper no
 *                  redondea (Math.round es asimétrico con medios negativos:
 *                  −1,5 → −1 y 1,5 → 2) ni imprime en silencio una cifra que
 *                  `number` ya no representa al centavo. NaN, ±Infinity, no
 *                  enteros y enteros inseguros lanzan RangeError
 *                  (niif-contrato-22). Para montos grandes, bigint/MoneyCop.
 * @param absolute  Si true, presenta valor absoluto (regla NIIF Analyst).
 *                  Si false, mantiene el signo y usa paréntesis para negativos
 *                  (convención NIIF: `($1.234,56)`).
 */
export function formatCopFromCents(cents: bigint | number, absolute = false): string {
  const ZERO = BigInt(0);
  if (typeof cents === 'number' && !Number.isSafeInteger(cents)) {
    throw new RangeError(
      `formatCopFromCents: los centavos como number deben ser un entero seguro (recibido ${
        Number.isFinite(cents) ? (Number.isInteger(cents) ? 'entero > 2^53' : 'no entero') : String(cents)
      }); use bigint (MoneyCop).`,
    );
  }
  const big = typeof cents === 'bigint' ? cents : BigInt(cents);
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
 * Porcentaje entero de un MoneyCop, redondeado hacia ABAJO (floor, hacia −∞).
 * Floor-bias deliberado para defensa Art. 647 (un descuento nunca
 * sobreestimado). `pct` es entero (ej. 25). Los llamadores lo usan con montos
 * no negativos (donación, impuesto, utilidad del ejercicio, capital); con un
 * monto negativo el resultado es el floor matemático (−101 × 50 % = −51), no
 * el truncamiento hacia cero que hacía la división BigInt (−50,
 * niif-contrato-22).
 */
export function pctFloorMoneyCop(value: string, pct: number): string {
  if (!Number.isInteger(pct) || pct < 0) {
    throw new Error(`pctFloorMoneyCop: pct debe ser entero >= 0 (recibido ${pct}).`);
  }
  const product = parseMoneyCop(value) * BigInt(pct);
  const hundred = BigInt(100);
  const quotient = product / hundred;
  // BigInt trunca hacia cero: con resto negativo se baja un centavo más.
  const floored = product % hundred < BigInt(0) ? quotient - BigInt(1) : quotient;
  return serializeMoneyCop(floored);
}

/** Menor de dos MoneyCop (comparación en centavos). Empate → devuelve `a`. */
export function minMoneyCop(a: string, b: string): string {
  return parseMoneyCop(a) <= parseMoneyCop(b) ? a : b;
}
