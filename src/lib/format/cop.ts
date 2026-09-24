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

import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';

export const COP_LOCALE = 'es-CO';
export const COP_CURRENCY = 'COP';

const fmtNoCurrency = new Intl.NumberFormat(COP_LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtInteger = new Intl.NumberFormat(COP_LOCALE, {
  maximumFractionDigits: 0,
});

/**
 * Monto JS (número o string NUMERIC "1234567.89") → centavos BigInt. Los
 * strings de hasta 2 decimales se convierten sin pasar por `Number` (exacto
 * por encima de 2^53); el resto redondea al centavo. `null` si no es finito.
 */
function toCentavos(value: string | number): bigint | null {
  if (typeof value === 'string') {
    const m = value.trim().match(/^(-)?(\d+)(?:\.(\d{1,2}))?$/);
    if (m) {
      const cents = BigInt(m[2]) * BigInt(100) + BigInt(((m[3] ?? '') + '00').slice(0, 2));
      return m[1] ? -cents : cents;
    }
  }
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n * 100));
}

/**
 * "1234567.89" or 1234567.89 → "$1.234.567,89" (Colombian format, the same
 * output as `formatCopFromCents`). Negatives in parentheses, the NIIF
 * convention of the financial statements, the Excel export and the charts:
 * "($1.234,56)" — before it printed Intl's "-$ 1.234,56", with a space and a
 * minus sign (reportes-export-19).
 * Returns "—" for nullish or non-numeric input so callers don't need to guard.
 */
export function formatCOP(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const cents = toCentavos(value);
  if (cents === null) return '—';
  return formatCopFromCents(cents);
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
 * Interpreta un monto tecleado en formato colombiano y lo devuelve como string
 * numérico JS (el que acepta el servicio contable, NUMERIC(20,2)), o `null`
 * cuando la entrada NO es interpretable sin adivinar.
 *
 *   "1.234.567,89"       → "1234567.89"
 *   "1.500.000,00"       → "1500000.00"
 *   "850.000"            → "850000"      (punto + 3 dígitos = miles es-CO)
 *   "1.234.567"          → "1234567"
 *   "1234567,89"         → "1234567.89"
 *   "1234567.89"         → "1234567.89"  (forma JS/NUMERIC: punto + 1-2 decimales)
 *   "$ 1.234.567,89 COP" → "1234567.89"
 *   "(1.234,56)"         → "-1234.56"    (paréntesis contable = negativo)
 *   "" / "  "            → "0"           (celda sin diligenciar)
 *   "1,234,567" / "1,234.56" / "12.3456" → null (en-US o ambiguo)
 *
 * Por qué: la versión anterior trataba "sólo puntos" como decimal JS, así que
 * "850.000" (ochocientos cincuenta mil) quedaba en 850 y "1.234.567" fallaba y
 * se convertía en "0" en silencio. En es-CO el punto NUNCA es decimal: un punto
 * seguido de grupos de exactamente 3 dígitos es separador de miles. La única
 * forma con punto decimal que se acepta es la del servidor (1-2 decimales), que
 * no puede confundirse con un grupo de miles.
 */
export function parseCOPStrict(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return '0';
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    const asText = String(input);
    return /^-?\d+(\.\d+)?$/.test(asText) ? asText : null;
  }

  let s = input.trim();
  if (s === '') return '0';

  // Símbolos de moneda, código ISO y espacios (incluye NBSP de Intl).
  s = s.replace(/\$/g, '').replace(/COP/gi, '').replace(/[\s\u00a0]+/g, '');
  if (s === '') return '0';

  let negative = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) {
    negative = true;
    s = paren[1];
  }
  if (s.startsWith('-')) {
    if (negative) return null; // "(-5)": doble signo, ambiguo
    negative = true;
    s = s.slice(1);
  }
  if (s === '') return null;

  let intPart: string;
  let decPart = '';
  const GROUPED = /^[1-9]\d{0,2}(\.\d{3})+$/; // miles es-CO: 1.234.567
  if (s.includes(',')) {
    const m = s.match(/^(\d+|[1-9]\d{0,2}(?:\.\d{3})+),(\d{1,2})$/);
    if (!m) return null;
    intPart = m[1].replace(/\./g, '');
    decPart = m[2];
  } else if (s.includes('.')) {
    if (GROUPED.test(s)) {
      intPart = s.replace(/\./g, '');
    } else {
      const m = s.match(/^(\d+)\.(\d{1,2})$/);
      if (!m) return null;
      intPart = m[1];
      decPart = m[2];
    }
  } else if (/^\d+$/.test(s)) {
    intPart = s;
  } else {
    return null;
  }

  intPart = intPart.replace(/^0+(?=\d)/, '');
  const isZero = /^0+$/.test(intPart) && /^0*$/.test(decPart);
  const body = decPart ? `${intPart}.${decPart}` : intPart;
  return negative && !isZero ? `-${body}` : body;
}

/**
 * Contrato legado (string, nunca null) de `parseCOP`: misma interpretación que
 * `parseCOPStrict`, pero una entrada no interpretable devuelve "0".
 *
 * @deprecated para formularios que envían dinero: usar `parseCOPStrict` y
 *   bloquear el envío cuando devuelve `null`. Un "0" silencioso convierte un
 *   error de tecleo en un asiento por otro valor.
 */
export function parseCOP(input: string | number | null | undefined): string {
  return parseCOPStrict(input) ?? '0';
}

/**
 * Monto es-CO → centavos MoneyCop (string entero con signo), aritmética BigInt
 * exacta (sin pasar por `Number`, válido por encima de 2^53). `null` si la
 * entrada no es interpretable.
 *
 *   "1.500.000,00" → "150000000"   "850.000" → "85000000"
 */
export function parseCOPToCentavos(input: string | number | null | undefined): string | null {
  const s = parseCOPStrict(input);
  if (s === null) return null;
  const negative = s.startsWith('-');
  const abs = negative ? s.slice(1) : s;
  const [intPart, fracRaw = ''] = abs.split('.');
  const cents =
    BigInt(intPart || '0') * BigInt(100) + BigInt((fracRaw + '00').slice(0, 2) || '0');
  return (negative ? -cents : cents).toString();
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
