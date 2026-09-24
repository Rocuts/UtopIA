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

/**
 * «Tarifa de renta» / «tarifa del impuesto de renta» sin sujeto explícito
 * (revisión de la fase 2, tributario-modulos-22): en el Escudo (personas
 * jurídicas) es la tarifa del Art. 240, salvo que la línea hable de personas
 * naturales, socios o dividendos (Art. 241, tarifa marginal hasta 39%).
 */
const RE_TARIFA_RENTA_SIN_SUJETO =
  /\btarifa\s+(?:del\s+impuesto\s+)?(?:de|sobre\s+la)\s+renta\b(?!\s+(?:para\s+|de\s+)?(?:las\s+)?(?:personas\s+jur[ií]dicas|PJ|sociedades)\b)[^\n%]{0,40}?\b(3[0-4](?:[.,]\d+)?\s*%)/gi;

const CONTEXTO_PERSONA_NATURAL =
  /personas?\s+naturales?|\bPN\b|Art\.?\s*241\b|\bmarginal\b|\bsocios?\b|\bdividendos?\b|\baccionistas?\b/i;

/** La línea cita la tarifa como dato histórico, no como tarifa vigente. */
const CONTEXTO_HISTORICO =
  /\banterior(?:es)?\b|\bantes\s+de\b|\bpas[óo]\s+del?\b|\bhist[óo]ric|\bderogad|\bya\s+no\b/i;

function lineaDe(texto: string, index: number): string {
  const ini = texto.lastIndexOf('\n', index) + 1;
  const fin = texto.indexOf('\n', index);
  return texto.slice(ini, fin < 0 ? texto.length : fin);
}

export function detectarTarifasPjAnteriores(texto: string): string[] {
  const out: string[] = [];
  for (const m of texto.matchAll(RE_TARIFA_PJ_ANTERIOR)) {
    if (!CONTEXTO_HISTORICO.test(lineaDe(texto, m.index ?? 0))) out.push(m[1]);
  }
  for (const m of texto.matchAll(RE_TARIFA_RENTA_SIN_SUJETO)) {
    const linea = lineaDe(texto, m.index ?? 0);
    if (!CONTEXTO_PERSONA_NATURAL.test(linea) && !CONTEXTO_HISTORICO.test(linea)) out.push(m[1]);
  }
  return out;
}
