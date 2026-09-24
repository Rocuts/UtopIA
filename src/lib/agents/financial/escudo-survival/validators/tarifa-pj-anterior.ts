// ---------------------------------------------------------------------------
// Escudo — C3.5: tarifas de renta PJ de regímenes anteriores, sólo en contexto
// ---------------------------------------------------------------------------
// Lo usa survival-validators.ts (check `tarifa_general_correcta`). Fuente:
// Art. 240 E.T. (src/data/tax_docs/et_articulo_240_renta_juridica.md).
// ---------------------------------------------------------------------------

/**
 * Tarifa de renta de PERSONAS JURÍDICAS (Art. 240 E.T.) expresada con un valor
 * de los regímenes anteriores a la Ley 2277/2022 (30%-34%). Exige el contexto
 * «tarifa general / nominal / corporativa», «tarifa de renta de personas
 * jurídicas / PJ / sociedades» o «tarifa del Art. 240» (no 240-1) antes del
 * porcentaje, en la misma frase y sin otro «%» intermedio.
 */
const RE_TARIFA_PJ_ANTERIOR =
  /(?:\btarifa\s+(?:general|nominal|corporativa)\b(?!\s+del?\s+IVA)|\btarifa\s+de\s+renta\s+(?:para\s+|de\s+)?(?:(?:las\s+)?personas\s+jur[ií]dicas|PJ|(?:las\s+)?sociedades)\b|\btarifa\s+del\s+Art\.?\s*240\b(?!-))[^\n%]{0,40}?\b(3[0-4](?:[.,]\d+)?\s*%)/gi;

export function detectarTarifasPjAnteriores(texto: string): string[] {
  return Array.from(texto.matchAll(RE_TARIFA_PJ_ANTERIOR), (m) => m[1]);
}
