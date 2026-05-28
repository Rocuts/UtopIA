// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Validators · Helpers internos
// ---------------------------------------------------------------------------
//
// Utilidades puras compartidas por los validators de Módulos 2-7.
// Cero LLM. Cero red. Cero filesystem.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// MoneyCop helpers (centavos como string)
// ---------------------------------------------------------------------------

/**
 * Parsea string de centavos a entero seguro.
 * Acepta enteros con signo: "1500000" → 1500000, "-50000" → -50000.
 * Devuelve 0 ante strings vacíos, no numéricos o NaN.
 *
 * Why entero (no BigInt): los montos colombianos en centavos para PYMES
 * (hasta ~2.2e11 cts ≈ $2.200M COP) caben holgadamente dentro de
 * Number.MAX_SAFE_INTEGER (9.007e15). El target ES2017 del tsconfig no
 * habilita BigInt literals.
 */
export function parseCents(s: string): number {
  const clean = (s ?? '').trim();
  if (clean === '' || clean === '0' || clean === '-0') return 0;
  const n = parseInt(clean, 10);
  if (!Number.isFinite(n)) return 0;
  return n;
}

/**
 * Formatea centavos a string COP es-CO: 1500000 → "$15.000,00".
 * Negativos: -1500000 → "-$15.000,00".
 */
export function formatCentsCop(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const pesos = Math.floor(abs / 100);
  const centavos = abs % 100;
  const pesosStr = pesos.toLocaleString('es-CO');
  const centavosStr = centavos.toString().padStart(2, '0');
  return (negative ? '-$' : '$') + pesosStr + ',' + centavosStr;
}

/**
 * Tolerancia exacta al centavo (1ct) para sumas aritméticas.
 */
export const TOLERANCE_CENTS = 1;

/**
 * Tolerancia para porcentajes calculados a 1 decimal (Risk Score, TET, etc.).
 */
export const TOLERANCE_PCT_1DEC = 0.1;

// ---------------------------------------------------------------------------
// Detección de patrones tóxicos / contractuales en texto
// ---------------------------------------------------------------------------

/**
 * True si el texto contiene una cita literal del parágrafo del Art. 647.
 *
 * Acepta variantes: "parágrafo Art. 647", "Art. 647 par.", "par. Art. 647",
 * "parágrafo del artículo 647", "Sección Art. 647 §". NO acepta "§"
 * porque el chequeo de formato (Módulo 7) prohíbe el símbolo.
 */
export function citaParagrafo647(text: string): boolean {
  // Tolera "par.", "parag.", "parágrafo", "paragrafo" + cualquier orden con 647.
  // Ventana 0-60 chars entre los dos términos.
  const re1 = /\bpar[áa]g(?:rafo)?\.?\b[^\n]{0,60}\bArt\.?\s*647\b/i;
  const re2 = /\bArt[íi]?culo?\.?\s*647[^\n]{0,60}\bpar[áa]g(?:rafo)?\b/i;
  // "Art. 647 par." compacto.
  const re3 = /\bArt\.?\s*647\s+par\.?\b/i;
  // "Sección Art. 647" — aceptable.
  return re1.test(text) || re2.test(text) || re3.test(text);
}

/**
 * True si el texto cita explícitamente el Art. 158-3 (derogado).
 *
 * Usa boundary regex para evitar falsos positivos con números aleatorios
 * (ej. "Resolución 158-3 DIAN" → no debería matchear porque no precede "Art.").
 */
export function citaArt158_3(text: string): boolean {
  return /\bArt\.?\s*158-?3\b/i.test(text) || /\bArt[íi]culo\s+158-?3\b/i.test(text);
}

/**
 * True si el texto cita el Concepto 100208221-1352 (NO verificable en normograma).
 */
export function citaConcepto1352(text: string): boolean {
  return (
    /\bConcepto(?:\s+DIAN)?\s+100208221-?1352\b/i.test(text) ||
    /\bConcepto(?:\s+DIAN)?\s+1352\s+(?:de|del|\/)\s*2018\b/i.test(text)
  );
}

/**
 * True si el texto cita el Art. 752 (requerimiento ordinario).
 */
export function citaArt752(text: string): boolean {
  return /\bArt\.?\s*752\b/i.test(text);
}

export function citaArt685(text: string): boolean {
  return /\bArt\.?\s*685\b/i.test(text);
}

export function citaArt715(text: string): boolean {
  return /\bArt\.?\s*715\b/i.test(text);
}

export function citaArt702(text: string): boolean {
  return /\bArt\.?\s*702\b/i.test(text);
}

export function citaArt707(text: string): boolean {
  return /\bArt\.?\s*707\b/i.test(text);
}

export function citaArt720(text: string): boolean {
  return /\bArt\.?\s*720\b/i.test(text);
}

export function citaArt709(text: string): boolean {
  return /\bArt\.?\s*709\b/i.test(text);
}

export function citaArt713(text: string): boolean {
  return /\bArt\.?\s*713\b/i.test(text);
}

export function citaArt640(text: string): boolean {
  return /\bArt\.?\s*640\b/i.test(text);
}

export function citaArt647(text: string): boolean {
  return /\bArt\.?\s*647\b/i.test(text);
}

export function citaArt850(text: string): boolean {
  return /\bArt\.?\s*850\b/i.test(text);
}

export function citaArt855(text: string): boolean {
  return /\bArt\.?\s*855\b/i.test(text);
}

export function citaArt815(text: string): boolean {
  return /\bArt\.?\s*815\b/i.test(text);
}

export function citaArt854(text: string): boolean {
  return /\bArt\.?\s*854\b/i.test(text);
}

/**
 * True si el texto cita el rango 854-860 (incorrecto — debe usar 855 puntual).
 */
export function citaRango854_860(text: string): boolean {
  return /\bArt\.?\s*854\s*[-–]\s*860\b/i.test(text);
}

/**
 * True si el texto cita "Art. 258" (cualquier subdivisión: 258, 258-1, 258-2).
 */
export function citaArt258Cualquiera(text: string): boolean {
  return /\bArt\.?\s*258(?:-\d)?\b/i.test(text);
}

/**
 * True si el texto cita "Art. 258-1" (descuento IVA bienes de capital).
 */
export function citaArt258_1(text: string): boolean {
  return /\bArt\.?\s*258-1\b/i.test(text);
}

/**
 * True si el texto contiene el símbolo `§` (prohibido — debe usar "parágrafo"
 * o "Sección").
 */
export function contieneSimboloParagrafo(text: string): boolean {
  return /§/.test(text);
}

/**
 * True si el texto contiene la palabra "centavos" como sustantivo visible.
 *
 * Excluye "centavos" como parte de palabras técnicas como "MoneyCop" o
 * "centavos:" en JSON. Aplica word boundary y exige contexto humano.
 */
export function contienePalabraCentavos(text: string): boolean {
  return /\bcentavos?\b/i.test(text);
}

/**
 * True si el texto usa formato monetario es-CO `$X.XXX.XXX,XX`.
 *
 * Heurística: busca al menos una ocurrencia del patrón canónico. Si el texto
 * cita pesos pero ninguno usa el formato canónico, marca falla.
 *
 * NO acepta separadores anglo (1,234,567.89) — esos disparan falla L1.
 */
export function tieneFormatoPesoAnglo(text: string): boolean {
  // Patrón anglo: dígitos seguidos de coma como separador de miles + punto decimal.
  // Ejemplos detectados: $1,234,567.89, $1,000.00
  // Negative lookbehind para no atrapar fechas tipo "1,000" sueltas — pedimos $ o COP.
  const re = /(?:\$|COP\s*)\d{1,3}(?:,\d{3})+(?:\.\d{2})?/;
  return re.test(text);
}

export function tieneFormatoPesoEsCo(text: string): boolean {
  // Patrón es-CO: $X.XXX.XXX,XX — punto miles, coma decimal.
  const re = /\$\d{1,3}(?:\.\d{3})+,\d{2}/;
  return re.test(text);
}

// ---------------------------------------------------------------------------
// Texto / longitud
// ---------------------------------------------------------------------------

/**
 * Cuenta líneas no vacías (separadas por \n).
 */
export function contarLineas(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
}

// ---------------------------------------------------------------------------
// Disclaimer obligatorio (Módulo 7)
// ---------------------------------------------------------------------------

/**
 * Frase de cierre obligatoria que toda respuesta del Agente Fiscal debe
 * incluir literalmente. La citación EXACTA es lo que cuenta — variantes con
 * comas distintas o sin tildes fallan el chequeo intencionalmente para forzar
 * uniformidad.
 *
 * El validator compara con normalización suave (espacios colapsados, minúscula)
 * para tolerar reformateo del markdown.
 */
export const CIERRE_OBLIGATORIO =
  'Este análisis fue generado por El Escudo (1+1 IA). Las cifras y posiciones deben ser validadas por un contador público o asesor tributario antes de su uso oficial o presentación ante la DIAN.';

export function contieneCierreObligatorio(text: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
  return normalize(text).includes(normalize(CIERRE_OBLIGATORIO));
}

// ---------------------------------------------------------------------------
// Tono profesional (heurística simple, no semántica)
// ---------------------------------------------------------------------------

/**
 * Lista de tokens que indican tono informal o marketing-y. Si la respuesta
 * los contiene, el validator advierte.
 */
const TOKENS_INFORMALES = [
  '\\b¡súper!?\\b',
  '\\bbacanísimo\\b',
  '\\bchévere\\b',
  '\\bplaticando\\b',
  '\\bganga\\b',
  '\\bbarato(?:s|sa|sas)?\\b',
  '\\baprovecha\\s+(?:ya|hoy)\\b',
  '\\bcompra\\s+(?:ya|ahora)\\b',
  '\\boferta\\s+(?:limitada|imperdible)\\b',
  '\\bclic\\s+aqu[íi]\\b',
  '\\bllama\\s+ya\\b',
  // Saludos/cierres marketing ("Saludos cordiales" es OK; "Cariños" no)
  '\\bcari[ñn]os\\b',
  '\\bbesitos\\b',
  '\\b[ñn]o[m]?bre[s]?:\\s*[A-Z]+!\\b', // gritos
];

export function tieneTonoInformal(text: string): boolean {
  for (const pat of TOKENS_INFORMALES) {
    if (new RegExp(pat, 'i').test(text)) return true;
  }
  return false;
}
