// ---------------------------------------------------------------------------
// Aritmética determinista para valoración (centavos BigInt + tasas escaladas)
// ---------------------------------------------------------------------------
// Convención MoneyCop: montos en centavos como BigInt. Las tasas porcentuales
// (WACC, g, Ke…) se representan como fracción escalada por RATE_SCALE (1e6),
// es decir, con precisión de 0,0001 puntos porcentuales. Con esa representación
// los factores de descuento, el valor terminal y el valor presente se calculan
// con BigInt exacto y un único redondeo (half away from zero) por cifra
// publicada. Nada de `number` sobre montos: 2^53 centavos ≈ $90 billones.
// ---------------------------------------------------------------------------

export const ZERO = BigInt(0);
export const ONE = BigInt(1);
const TWO = BigInt(2);

/** Escala de las tasas: 1 = 1e-6 (fracción). 1% = 10.000 unidades. */
export const RATE_SCALE = BigInt(1_000_000);

/** Porcentaje (ej. 12.5) → fracción escalada (ej. 125000n). Redondeo a 0,0001 pp. */
export function percentToScaled(percent: number): bigint {
  if (!Number.isFinite(percent)) {
    throw new Error('percentToScaled: porcentaje no finito');
  }
  return BigInt(Math.round(percent * 10_000));
}

/** Fracción escalada → porcentaje `number` (sólo para presentación). */
export function scaledToPercent(scaled: bigint): number {
  return Number(scaled) / 10_000;
}

/** Redondea un porcentaje a la precisión de trabajo (0,0001 pp). */
export function roundPercent(percent: number): number {
  return scaledToPercent(percentToScaled(percent));
}

/** Valor absoluto BigInt. */
export function absBig(v: bigint): bigint {
  return v < ZERO ? -v : v;
}

/**
 * División entera con redondeo half-away-from-zero. `den` ≠ 0.
 * Ej.: 5/2 → 3, −5/2 → −3, 4/3 → 1.
 */
export function divRoundHalfUp(num: bigint, den: bigint): bigint {
  if (den === ZERO) throw new Error('divRoundHalfUp: división por cero');
  const negative = (num < ZERO) !== (den < ZERO);
  const n = absBig(num);
  const d = absBig(den);
  const q = (n * TWO + d) / (TWO * d);
  return negative ? -q : q;
}

/** base^exp para BigInt con exp entero ≥ 0. */
export function powBig(base: bigint, exp: number): bigint {
  if (!Number.isInteger(exp) || exp < 0) throw new Error('powBig: exponente inválido');
  let acc = ONE;
  for (let i = 0; i < exp; i++) acc *= base;
  return acc;
}

/**
 * Valor presente exacto de `amountCents` descontado `periods` años a la tasa
 * escalada `rateScaled`: amount × S^t / (S + r)^t, redondeado al centavo.
 */
export function presentValueCents(amountCents: bigint, rateScaled: bigint, periods: number): bigint {
  const den = powBig(RATE_SCALE + rateScaled, periods);
  if (den <= ZERO) throw new Error('presentValueCents: tasa ≤ −100%');
  return divRoundHalfUp(amountCents * powBig(RATE_SCALE, periods), den);
}

/** amountCents × (1 + rate), redondeado al centavo. */
export function growCents(amountCents: bigint, rateScaled: bigint): bigint {
  return divRoundHalfUp(amountCents * (RATE_SCALE + rateScaled), RATE_SCALE);
}

/** amountCents × rate (fracción escalada), redondeado al centavo. */
export function applyRateCents(amountCents: bigint, rateScaled: bigint): bigint {
  return divRoundHalfUp(amountCents * rateScaled, RATE_SCALE);
}

/**
 * Multiplica centavos por un múltiplo decimal (ej. 6.5x) con precisión 1e-4.
 * Ej.: 1.000.000 × 6.5 → 6.500.000.
 */
export function multiplyByMultiple(amountCents: bigint, multiple: number): bigint {
  if (!Number.isFinite(multiple)) throw new Error('multiplyByMultiple: múltiplo no finito');
  const scaled = BigInt(Math.round(multiple * 10_000));
  return divRoundHalfUp(amountCents * scaled, BigInt(10_000));
}

/** Menor / mayor de una lista no vacía de BigInt. */
export function minBig(values: readonly bigint[]): bigint {
  if (values.length === 0) throw new Error('minBig: lista vacía');
  return values.reduce((a, b) => (b < a ? b : a));
}

export function maxBig(values: readonly bigint[]): bigint {
  if (values.length === 0) throw new Error('maxBig: lista vacía');
  return values.reduce((a, b) => (b > a ? b : a));
}

/**
 * ¿Difieren materialmente dos montos? Tolerancia: max($1, 0,1% del recalculado).
 * Se usa sólo para decidir si una cifra emitida por el LLM se lista como
 * discrepancia; la cifra publicada es SIEMPRE la recalculada.
 */
export function moneyDiffers(reported: bigint, recomputed: bigint): boolean {
  const diff = absBig(reported - recomputed);
  const relTol = absBig(recomputed) / BigInt(1000);
  const tol = relTol > BigInt(100) ? relTol : BigInt(100);
  return diff > tol;
}

/** ¿Difieren dos porcentajes más de 0,01 pp? */
export function percentDiffers(reported: number, recomputed: number): boolean {
  return Math.abs(reported - recomputed) > 0.01 + 1e-9;
}
