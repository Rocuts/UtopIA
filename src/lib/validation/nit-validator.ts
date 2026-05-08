// ---------------------------------------------------------------------------
// NIT Validator — Dígito de Verificación DIAN (Colombia)
// ---------------------------------------------------------------------------
// El dígito de verificación (DV) del NIT colombiano se calcula con un vector
// de pesos primos:
//
//   pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
//
// Algoritmo (DIAN — Numeral 1.2 del Concepto 014481/2010):
//   1. Tomar el cuerpo del NIT (sin DV) en orden y emparejar el último dígito
//      con el peso 3 (índice 0 del vector), el penúltimo con peso 7, etc.
//   2. Multiplicar dígito × peso correspondiente y sumar.
//   3. Calcular `mod = suma % 11`.
//   4. Si mod < 2, el DV es `mod`. Si mod ≥ 2, el DV es `11 - mod`.
//
// Esta implementación es determinística y NO depende de servicios externos.
// ---------------------------------------------------------------------------

const NIT_DV_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71] as const;

/**
 * Calcula el dígito de verificación del NIT a partir del cuerpo (sin DV).
 *
 * @param nitBodyDigits Sólo dígitos, sin puntos / espacios / guión-DV.
 * @returns DV (entero 0-10) — un DV de 10 indica que el NIT no es asignable
 *          según DIAN; en la práctica los NITs válidos tienen DV 0-9.
 * @throws  Si el body no es exclusivamente dígitos o excede 15 caracteres
 *          (límite del vector de pesos).
 */
export function computeNITCheckDigit(nitBodyDigits: string): number {
  if (typeof nitBodyDigits !== 'string') {
    throw new TypeError('NIT body must be a string of digits');
  }
  const cleaned = nitBodyDigits.trim();
  if (cleaned.length === 0) {
    throw new RangeError('NIT body is empty');
  }
  if (!/^\d+$/.test(cleaned)) {
    throw new RangeError(`NIT body must contain only digits, got: "${cleaned}"`);
  }
  if (cleaned.length > NIT_DV_WEIGHTS.length) {
    throw new RangeError(
      `NIT body length ${cleaned.length} exceeds maximum supported (${NIT_DV_WEIGHTS.length})`,
    );
  }

  // Emparejar el último dígito con peso[0]=3, penúltimo con peso[1]=7, etc.
  const reversed = cleaned.split('').reverse();
  let sum = 0;
  for (let i = 0; i < reversed.length; i++) {
    sum += parseInt(reversed[i], 10) * NIT_DV_WEIGHTS[i];
  }

  const mod = sum % 11;
  return mod < 2 ? mod : 11 - mod;
}

/**
 * Valida un NIT completo contra su DV.
 *
 * Acepta variantes con puntos / espacios y guión-DV: `"901.714.014-6"`,
 * `"901714014-6"`, `"901714014 6"`. Devuelve `false` si el body o el DV no
 * son válidos numéricamente o si el DV calculado no coincide con el provisto.
 *
 * @param nitWithDV NIT como aparece en facturas/RUT, con o sin formato.
 * @returns `true` si el DV verifica, `false` en cualquier otro caso.
 */
export function validateNITCheckDigit(nitWithDV: string | null | undefined): boolean {
  if (!nitWithDV || typeof nitWithDV !== 'string') return false;
  const cleaned = nitWithDV.trim().replace(/\s+/g, '');
  if (cleaned.length === 0) return false;

  // Separamos body y DV usando el último guión / punto antes de un dígito
  // único final. Si no hay separador, el último dígito es DV.
  const dashSplit = cleaned.split(/[-]/);
  let body: string;
  let dvProvided: string;

  if (dashSplit.length === 2 && /^\d$/.test(dashSplit[1])) {
    body = dashSplit[0].replace(/[.,\s]/g, '');
    dvProvided = dashSplit[1];
  } else {
    // Sin guión: tomamos último dígito como DV. Sólo aceptamos si TODO el
    // string (post-limpieza) es dígitos consecutivos.
    const allDigits = cleaned.replace(/[.,\s]/g, '');
    if (!/^\d+$/.test(allDigits) || allDigits.length < 2) return false;
    body = allDigits.slice(0, -1);
    dvProvided = allDigits.slice(-1);
  }

  if (!/^\d+$/.test(body) || !/^\d$/.test(dvProvided)) return false;
  if (body.length < 4 || body.length > NIT_DV_WEIGHTS.length) return false;

  let computed: number;
  try {
    computed = computeNITCheckDigit(body);
  } catch {
    return false;
  }

  return computed === parseInt(dvProvided, 10);
}

/**
 * Helper público: extrae el body (sin DV) de un NIT con cualquier formato.
 * Devuelve `null` si la entrada no es parseable.
 */
export function extractNITBody(nitWithDV: string | null | undefined): string | null {
  if (!nitWithDV) return null;
  const cleaned = String(nitWithDV).trim().replace(/\s+/g, '');
  const dashSplit = cleaned.split(/[-]/);
  if (dashSplit.length === 2 && /^\d$/.test(dashSplit[1])) {
    const body = dashSplit[0].replace(/[.,\s]/g, '');
    return /^\d+$/.test(body) ? body : null;
  }
  const allDigits = cleaned.replace(/[.,\s]/g, '');
  if (!/^\d+$/.test(allDigits) || allDigits.length < 2) return null;
  return allDigits.slice(0, -1);
}
