/**
 * COP (Colombian Peso) formatting helpers.
 *
 * Why a single module:
 *   - Display math everywhere in /workspace/contabilidad uses the same locale,
 *     fraction digits, and parser. Inline `Intl.NumberFormat` calls drift fast.
 *   - The accounting service receives numeric strings (Postgres NUMERIC(20,2)),
 *     so the parser converts ES-format input ("1.234.567,89") to JS-format
 *     ("1234567.89") losslessly before POSTing.
 *
 * Note: `Intl.NumberFormat` is created once per call here to keep the API small;
 * for hot loops, callers can hold a single Intl instance themselves.
 */

export const COP_LOCALE = 'es-CO';
export const COP_CURRENCY = 'COP';

const fmt = new Intl.NumberFormat(COP_LOCALE, {
  style: 'currency',
  currency: COP_CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtNoCurrency = new Intl.NumberFormat(COP_LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtInteger = new Intl.NumberFormat(COP_LOCALE, {
  maximumFractionDigits: 0,
});

/**
 * "1234567.89" or 1234567.89 → "$ 1.234.567,89" (Colombian format).
 * Returns "—" for nullish or non-numeric input so callers don't need to guard.
 */
export function formatCOP(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return fmt.format(n);
}

/**
 * Same as formatCOP but without the "$" symbol — used inside table cells where
 * the column header already conveys "currency".
 */
export function formatPesos(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return fmtNoCurrency.format(n);
}

/**
 * Integer COP (no decimals) — for KPI tiles and skim views.
 */
export function formatPesosInteger(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return fmtInteger.format(n);
}

/**
 * Convert a user-typed Colombian-format string to a JS-numeric string the
 * accounting service can parse:
 *
 *   "1.234.567,89"       → "1234567.89"
 *   "1234567,89"         → "1234567.89"
 *   "1234567.89"         → "1234567.89"   (already JS format)
 *   "$ 1.234.567,89 COP" → "1234567.89"
 *   "  "                 → "0"
 *
 * The function:
 *   - strips currency symbols and whitespace,
 *   - removes thousands dots (".") only when a comma is present (es-CO style),
 *   - converts the decimal comma to a dot.
 *
 * It is intentionally permissive: callers should validate the result with
 * `Number.isFinite(Number(parsed))` before POSTing if the input was
 * untrusted user text.
 */
export function parseCOP(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '0';
  if (typeof input === 'number') return Number.isFinite(input) ? String(input) : '0';

  let s = input.trim();
  if (s === '') return '0';

  // Strip currency symbols and ISO codes.
  s = s.replace(/\$/g, '').replace(/COP/gi, '').replace(/\s+/g, '');
  if (s === '') return '0';

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Spanish format: dots are thousand separators, comma is decimal.
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // Only a comma → it's the decimal separator.
    s = s.replace(',', '.');
  }
  // Only a dot → already in JS-numeric form (e.g. "1234567.89").

  // Final guard: numeric chars + optional leading sign + at most one dot.
  if (!/^-?\d+(\.\d+)?$/.test(s)) return '0';
  return s;
}

/**
 * Convenience: parse a user input and return a JS number (NaN-safe).
 * Returns 0 for invalid input — callers that need strict validation should
 * use parseCOP() and Number.isFinite() themselves.
 */
export function parseCOPToNumber(input: string | number | null | undefined): number {
  const s = parseCOP(input);
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sum a list of numeric strings using 2-decimal precision (centavos).
 * Returns the result as a string with exactly 2 decimal digits.
 *
 * We do the sum in centavos (BigInt) so the JS-number rounding doesn't
 * accumulate across many lines. This matches the server's validate.ts
 * approach.
 */
export function sumCOPStrings(values: Array<string | number | null | undefined>): string {
  // BigInt() calls (not 0n literals) so we stay compatible with the
  // project's ES2017 TS target.
  const ZERO = BigInt(0);
  const HUNDRED = BigInt(100);
  const TEN = BigInt(10);
  let cents = ZERO;
  for (const v of values) {
    const s = parseCOP(typeof v === 'number' ? String(v) : v ?? '0');
    if (s === '0') continue;
    // s is "-?\d+(\.\d+)?". Convert to BigInt centavos.
    const neg = s.startsWith('-');
    const abs = neg ? s.slice(1) : s;
    const [intPart, fracPartRaw = ''] = abs.split('.');
    const fracPadded = (fracPartRaw + '00').slice(0, 2);
    const part = BigInt(intPart || '0') * HUNDRED + BigInt(fracPadded || '0');
    cents = neg ? cents - part : cents + part;
  }
  const negTotal = cents < ZERO;
  const absCents = negTotal ? -cents : cents;
  const intPart = absCents / HUNDRED;
  const fracPart = absCents % HUNDRED;
  const fracStr = fracPart < TEN ? `0${fracPart.toString()}` : fracPart.toString();
  return `${negTotal ? '-' : ''}${intPart.toString()}.${fracStr}`;
}
