// ---------------------------------------------------------------------------
// Serialización XLSX → CSV para /api/upload.
// ---------------------------------------------------------------------------
// ExcelJS entrega cada fila como un array sparse con shapes heterogéneos por
// celda (fórmulas, hipervínculos, rich text, errores, Date). Aquí se convierten
// a texto y se unen como CSV que `parseTrialBalanceCSV` pueda leer sin
// ambigüedad:
//
//  - Escape RFC 4180: un campo con coma, comilla o punto y coma va entre
//    comillas y las comillas internas se duplican. Sin esto, "Propiedades,
//    planta y equipo" o "Retención 2,5%" parten la fila y el saldo se lee de
//    otra columna (ingesta-05). El parser (`parseLine`) ya respeta comillas.
//  - Saltos de línea y tabuladores dentro de una celda se reemplazan por un
//    espacio: el parser corta por líneas antes de leer campos y detecta el
//    separador buscando un tabulador en el encabezado.
//  - Números: los enteros se emiten tal cual (los códigos PUC llegan como
//    celdas numéricas y `11050501.00` se convertiría en el código
//    `1105050100`). Los no enteros se redondean a 2 decimales: el valor
//    IEEE-754 crudo de una fórmula (`300.29999999999995`) tiene más de dos
//    decimales y el parser de texto lo leería como separador de miles.
//  - Con la unidad CONFIRMADA en miles o millones (P4-a) dos decimales de la
//    unidad no son centavos (0,01 millones = $10.000): el reproceso de
//    /api/upload pide precisión `full` y el parser reexpresa desde ese texto.
// ---------------------------------------------------------------------------

/**
 * Precisión de las celdas numéricas no enteras: `cents` (importes en pesos,
 * redondeo al centavo) o `full` (importes en miles / millones confirmados:
 * todos los decimales significativos del valor almacenado).
 */
export type XlsxNumberPrecision = 'cents' | 'full';

/** Redondeo a centavos simétrico respecto al signo (evita -2.345 → -2.34). */
function roundToCents(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100)) / 100;
}

/**
 * Convierte un número de celda a texto sin notación científica ni ruido
 * binario. Devuelve '' para NaN/Infinity.
 */
export function formatXlsxNumber(value: number, precision: XlsxNumberPrecision = 'cents'): string {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) {
    // `String(1e21)` produce notación exponencial; BigInt conserva los dígitos.
    return Math.abs(value) < 1e21 ? String(value === 0 ? 0 : value) : BigInt(value).toString();
  }
  if (precision === 'full') return fullPrecisionDecimal(value);
  const rounded = roundToCents(value);
  // Tras redondear puede quedar entero (5.999 → 6) o -0.
  if (rounded === 0) return '0';
  return String(rounded);
}

/**
 * Decimal completo de una celda en miles / millones (P4-a): 15 cifras
 * significativas quitan el ruido binario de una fórmula (`0.1 + 0.2` →
 * `0.3`) sin perder los pesos ni los centavos del valor almacenado
 * (4232,848882125 millones = $4.232.848.882,13; a dos decimales eran
 * $4.232.850.000). Sin notación exponencial. Un decimal de EXACTAMENTE tres
 * cifras (`1.234`) lo leería el parser como separador de miles (1234): un
 * cero final lo desambigua (`1.2340`).
 */
function fullPrecisionDecimal(value: number): string {
  const clean = Number(value.toPrecision(15));
  if (clean === 0) return '0';
  let text = expandExponent(String(clean));
  if (/\.\d{3}$/.test(text)) text += '0';
  return text;
}

/** `1.5e-7` → `0.00000015`; `1.2e+21` → `1200000000000000000000`. */
function expandExponent(text: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (!m) return text;
  const [, sign, int, frac = '', exp] = m;
  const digits = int + frac;
  const point = int.length + parseInt(exp, 10);
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * Convierte una celda de ExcelJS a texto plano (sin escape CSV).
 *
 * Mapeo:
 *  - null/undefined -> ''
 *  - string        -> as-is
 *  - number        -> `formatXlsxNumber`
 *  - boolean       -> 'true' / 'false'
 *  - Date          -> YYYY-MM-DD (formato estable)
 *  - formula       -> .result (valor calculado)
 *  - rich text     -> concatenación de .richText[].text
 *  - hyperlink     -> .text (etiqueta visible)
 *  - error         -> .error (ej. '#DIV/0!')
 *  - otros objetos -> '' (en lugar de '[object Object]')
 */
export function xlsxCellToText(v: unknown, precision: XlsxNumberPrecision = 'cents'): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return formatXlsxNumber(v, precision);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if ('result' in obj) return xlsxCellToText(obj.result, precision);
    if (Array.isArray(obj.richText)) {
      return obj.richText
        .map((piece) =>
          piece && typeof piece === 'object' && 'text' in piece
            ? String((piece as { text: unknown }).text ?? '')
            : '',
        )
        .join('');
    }
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.error === 'string') return obj.error;
    return '';
  }
  return '';
}

/**
 * Escapa un campo según RFC 4180. Los saltos de línea y tabuladores se
 * reemplazan por un espacio (ver cabecera del módulo).
 */
export function csvEscapeField(raw: string): string {
  const s = raw.replace(/[\r\n\t]+/g, ' ');
  if (/[",;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Serializa una fila de ExcelJS (`row.values`, base 1) a una línea CSV.
 *
 * `isFirstLine` marca la primera línea emitida de la hoja: el parser elige el
 * separador buscando `;` o tabulador en ESA línea sin mirar comillas, así que
 * en ella un `;` dentro de una celda se reemplaza por un espacio para que la
 * detección siga siendo `,`.
 */
export function xlsxRowToCsvLine(
  values: unknown[],
  isFirstLine = false,
  precision: XlsxNumberPrecision = 'cents',
): string {
  const cells: string[] = [];
  // `row.values` es sparse (índice 0 vacío y huecos en celdas vacías): se
  // recorre por índice para que un hueco produzca un campo vacío.
  for (let i = 1; i < values.length; i++) {
    let text = xlsxCellToText(values[i], precision);
    if (isFirstLine) text = text.replace(/;/g, ' ');
    cells.push(csvEscapeField(text));
  }
  return cells.join(',');
}

/**
 * Nombre de hoja seguro para la etiqueta `[period=…]`: sin corchetes ni saltos
 * de línea, que romperían el delimitador del bloque.
 */
export function sanitizeSheetLabel(name: string): string {
  const cleaned = name.replace(/[[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || 'Hoja';
}
