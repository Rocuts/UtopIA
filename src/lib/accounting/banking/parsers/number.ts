// ---------------------------------------------------------------------------
// parsers/number.ts — Parseo canónico de importes de extractos bancarios
// ---------------------------------------------------------------------------
//
// POR QUÉ EXISTE ESTE MÓDULO
// --------------------------
// Colombia escribe `1.234.567,89`: PUNTO para miles, COMA para decimales. Y en
// la práctica los extractos de Bancolombia / Davivienda / Banco de Bogotá
// exportan los montos SIN centavos (`1.234.567`, `$3.450.000`), porque el peso
// no se maneja con fracciones en banca minorista.
//
// La heurística anterior (csv.ts) desambiguaba SOLO por posición relativa del
// último punto vs la última coma: si no había coma, asumía que el punto era
// decimal. Resultado: `"1.234.567"` → `1.23`. Un extracto entero dividido por
// un millón, sin excepción ni warning — la conciliación bancaria reportaba una
// diferencia igual al 100% del extracto y la atribuía a "partidas no
// conciliadas" en vez de a un parseo roto.
//
// La desambiguación correcta NO es posicional sino MORFOLÓGICA: un separador
// seguido de exactamente TRES dígitos es un separador de miles (en cualquiera
// de las dos convenciones); uno seguido de 1-2 dígitos es decimal. Con dos
// separadores distintos presentes, el que aparece de último es el decimal.
//
// Devuelve `null` (no `0`) cuando la cadena no es un número: un `|| 0` silencioso
// convierte basura en un movimiento de $0 que nadie audita. El caller decide si
// emite warning y omite la fila.
// ---------------------------------------------------------------------------

/**
 * Parsea un importe monetario tolerando las convenciones ES-CO y EN-US.
 *
 * Acepta:
 *   - `1.234.567,89` / `1.234.567`  (ES-CO: punto=miles, coma=decimal)
 *   - `1,234,567.89` / `1,234,567`  (EN-US)
 *   - `1234567.89` / `1234567`      (sin separador de miles)
 *   - `1'234.567`                   (apóstrofo de millones usado en LatAm)
 *   - `$ 3.450.000`, `COP 1.000`    (símbolo/código de moneda y espacios)
 *   - `-1.234.567`, `(1.234.567)`, `1.234.567-` (signo prefijo, contable, sufijo)
 *
 * @returns el número, o `null` si la cadena no representa un importe legible.
 *          Una cadena vacía también devuelve `null` — la semántica de "columna
 *          vacía = 0" es decisión del caller, no de este parser.
 */
export function parseMoneyAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;

  let s = String(raw);

  // El apóstrofo de millones (1'234.567) cumple el MISMO rol que el punto de
  // miles: normalizarlo a punto deja la cadena en forma ES-CO canónica.
  s = s.replace(/['’`´]/g, '.');
  // Símbolos/códigos de moneda y espacios no aportan información numérica.
  // `\s` cubre NBSP, narrow-NBSP y BOM, que Excel inyecta al exportar.
  s = s.replace(/(?:COP|USD|EUR)/gi, '').replace(/[$€\s]/g, '');

  if (!s) return null;

  // Signo: negativo puede venir como prefijo, sufijo (exportes SAP/AS400) o
  // entre paréntesis (convención contable).
  let negative = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) {
    negative = true;
    s = paren[1];
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }

  // A partir de aquí solo se admiten dígitos y separadores. Cualquier otra
  // cosa ("N/A", "1O00", "saldo") es ilegible → null, nunca 0.
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;

  let normalized: string;

  if (dots > 0 && commas > 0) {
    // Ambos separadores presentes: el ÚLTIMO es el decimal, el otro es miles.
    const decimalSep = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    const [intPart, ...rest] = s.split(decimalSep);
    if (rest.length !== 1) return null; // dos separadores decimales → ilegible
    normalized = `${intPart.split(thousandSep).join('')}.${rest[0]}`;
  } else if (dots === 0 && commas === 0) {
    normalized = s;
  } else {
    const sep = dots > 0 ? '.' : ',';
    const parts = s.split(sep);
    const groupsOk =
      /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p));

    if (parts.length > 2) {
      // Varios separadores iguales: solo tiene sentido como miles.
      if (!groupsOk) return null;
      normalized = parts.join('');
    } else if (groupsOk) {
      // Un separador seguido de exactamente 3 dígitos (`1.234`, `12.500`,
      // `123.456`) → miles. Es la forma dominante en extractos colombianos,
      // donde los montos casi nunca traen centavos.
      normalized = parts.join('');
    } else {
      // 1-2 dígitos (o agrupación inválida) tras el separador → decimal.
      normalized = parts.join('.');
    }
  }

  if (!/^\d*\.?\d*$/.test(normalized) || !/\d/.test(normalized)) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}
