// ---------------------------------------------------------------------------
// Vision extractor para cuadernos contables manuscritos (modulo Pyme).
// ---------------------------------------------------------------------------
// Recibe una foto (data URL o https URL de Vercel Blob) de una pagina de
// cuaderno contable colombiano y devuelve renglones estructurados.
//
// Implementacion: AI SDK v6 con `experimental_output: Output.object({ schema })`.
// Mismo patron canonico que `src/lib/agents/classifier.ts`. NO se pasa apiKey
// — el provider `@ai-sdk/openai` lo lee de `OPENAI_API_KEY` automaticamente.
//
// Anti-alucinacion estricta: el modelo prefiere devolver `null` o `entries: []`
// antes que inventar montos o descripciones. El orchestrator valida confidence
// y deja en `draft` los renglones de baja confianza para revision humana.
// ---------------------------------------------------------------------------

import 'server-only';
import { generateText, Output } from 'ai';
import { MODELS } from '@/lib/config/models';
import { ExtractionResultSchema, type ExtractionResult } from './schemas';
import type { ExtractionContext } from './types';

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------
// El prompt va inline porque este agente tiene un solo job. Carpeta separada
// `prompts/` solo se justifica cuando hay 2+ agentes que comparten estilo.
// ---------------------------------------------------------------------------

function buildSystemPrompt(ctx: ExtractionContext): string {
  const isEnglish = ctx.language === 'en';
  const currency = ctx.bookCurrency || 'COP';
  const isCOP = currency.toUpperCase() === 'COP';

  // Hint de categorias conocidas: si el usuario ya tiene un catalogo en su
  // libro, le pedimos al modelo que prefiera esos nombres exactos antes de
  // inventar uno nuevo. Sin hint, el modelo propone categorias concisas.
  const knownCategoriesHint =
    ctx.knownCategories && ctx.knownCategories.length > 0
      ? isEnglish
        ? `\n[EN] KNOWN CATEGORIES (prefer these exact names if the row matches one): ${ctx.knownCategories
            .map((c) => `"${c}"`)
            .join(', ')}.`
        : `\nCATEGORIAS CONOCIDAS (usa estos nombres exactos si el renglon encaja en una): ${ctx.knownCategories
            .map((c) => `"${c}"`)
            .join(', ')}.`
      : '';

  // Ejemplos de parseo de monto. COP usa punto como separador de miles y coma
  // decimal (`$1.500.000,50` = 1500000.5). Otras monedas (USD, EUR) suelen
  // usar coma como miles y punto decimal — adaptamos los ejemplos.
  const amountRules = isCOP
    ? `5. AMOUNT (parseo de pesos colombianos):
   - Punto = separador de miles. Coma = decimal.
   - "$1.500" → 1500
   - "1.500" → 1500
   - "$1.500,00" → 1500
   - "$1.500.000" → 1500000
   - "$1.500.000,50" → 1500000.5
   - "1500" → 1500
   - Tambien acepta formato coma-miles: "23,000" = 23000 (equivalente a "23.000").
   - NUNCA inventes un monto. Si esta borroso o tachado, devuelve amount=null y baja confidence a 0.3 o menos.`
    : `5. AMOUNT (parseo de monto en ${currency}):
   - Coma = separador de miles. Punto = decimal.
   - "$1,500" → 1500
   - "1,500.50" → 1500.5
   - "1,500,000" → 1500000
   - NUNCA inventes un monto. Si esta borroso o tachado, devuelve amount=null y baja confidence a 0.3 o menos.`;

  // El cuerpo principal del prompt va siempre en espanol (idioma primario del
  // proyecto y de los cuadernos de tenderos colombianos). Cuando ctx.language
  // === 'en' apendamos un bloque [EN] espejo para que el modelo entienda la
  // intencion del usuario angloparlante — pero la salida (descripciones,
  // categorias, notes) sigue en espanol porque el cuaderno fisico esta en
  // espanol y traducir introduciria errores.
  const englishMirror = isEnglish
    ? `

[EN] ROLE: You extract bookkeeping rows from photos of Colombian handwritten ledgers. Output JSON matching the schema. Output language is Spanish (the ledger is in Spanish — do not translate descriptions or categories). Same anti-hallucination rules apply: prefer null over guesses.`
    : '';

  // ---------------------------------------------------------------------------
  // FEW-SHOT EXAMPLES
  // Tres casos canonicos que cubren los documentos mas comunes del modulo Pyme:
  // (1) Recibo FORMA MULTIUSOS manuscrito — caso del bug "comoyo" vs "romero"
  // (2) Cuaderno libre de renglones manuscritos mezclados
  // (3) Tirilla termica POS impresa
  // Los ejemplos anclan la transcripcion literal y el parseo de fechas DD|MM|AA.
  // ---------------------------------------------------------------------------
  const fewShotExamples = `
--- FEW-SHOT EXAMPLES (sigue este patron exacto) ---

EJEMPLO 1 — Recibo FORMA MULTIUSOS manuscrito (regimen simplificado):
ENTRADA: foto de recibo "FORMA MULTIUSOS / REGIMEN SIMPLIFICADO" donde manuscrito dice:
  "20|03|26 | Cliente: Martha Velandia | Vendedor: Morea Natural"
  "2 | romero | 23.000 | 46.000"
  "1 | yerba buena | 20.000 | 20.000"
  "TOTAL: 146.000"
SALIDA:
{
  "pageDate": "2026-03-20",
  "entries": [
    {"date": null, "description": "romero (Morea Natural)", "amount": 46000, "kind": "ingreso", "category": "Ventas dia", "rawText": "2 romero 23.000 46.000", "confidence": 0.92},
    {"date": null, "description": "yerba buena (Morea Natural)", "amount": 20000, "kind": "ingreso", "category": "Ventas dia", "rawText": "1 yerba buena 20.000 20.000", "confidence": 0.92}
  ],
  "notes": ""
}
NOTA CRITICA: el texto manuscrito dice "romero" — NO "comoyo" ni nada parecido. TRANSCRIBI LITERAL lo que ves en la imagen. Si la caligrafia parece "romero", escribe "romero". Si hay ambiguedad, baja confidence a <0.7 en lugar de adivinar.

EJEMPLO 2 — Cuaderno manuscrito libre (sin estructura de tabla):
ENTRADA: foto de cuaderno con renglones manuscritos:
  "Lunes 5 mayo"
  "Venta tomate $50.000"
  "Compra harina $15.000"
  "Venta queso $30.000"
SALIDA:
{
  "pageDate": "2026-05-05",
  "entries": [
    {"date": null, "description": "Venta tomate", "amount": 50000, "kind": "ingreso", "category": "Ventas dia", "rawText": "Venta tomate $50.000", "confidence": 0.85},
    {"date": null, "description": "Compra harina", "amount": 15000, "kind": "egreso", "category": "Mercancia", "rawText": "Compra harina $15.000", "confidence": 0.85},
    {"date": null, "description": "Venta queso", "amount": 30000, "kind": "ingreso", "category": "Ventas dia", "rawText": "Venta queso $30.000", "confidence": 0.85}
  ],
  "notes": ""
}

EJEMPLO 3 — Tirilla termica POS (impresa, no manuscrita):
ENTRADA: tirilla termica:
  "TIENDA DONA ROSA"
  "Fecha 03/05/2026 14:32"
  "1x Pan integral    $4.500"
  "2x Leche Alqueria  $8.000"
  "TOTAL: $12.500"
SALIDA:
{
  "pageDate": "2026-05-03",
  "entries": [
    {"date": null, "description": "Pan integral (Tienda Dona Rosa)", "amount": 4500, "kind": "egreso", "category": "Mercancia", "rawText": "1x Pan integral $4.500", "confidence": 0.96},
    {"date": null, "description": "Leche Alqueria (Tienda Dona Rosa)", "amount": 8000, "kind": "egreso", "category": "Mercancia", "rawText": "2x Leche Alqueria $8.000", "confidence": 0.96}
  ],
  "notes": ""
}
--- FIN FEW-SHOT EXAMPLES ---`;

  return `Eres un extractor experto de renglones contables de cuadernos manuscritos colombianos. Tu unica tarea es leer una foto de una pagina de cuaderno y devolver los renglones estructurados como JSON.

1. ROLE: extraes ingresos y egresos de cuadernos de papel de tenderos, microempresas y negocios de barrio en Colombia. La caligrafia es informal, las paginas pueden estar arrugadas o con tinta corrida.

2. INPUT: una unica imagen (foto de celular) de una pagina de cuaderno contable.

3. OUTPUT: un objeto JSON con la forma:
   {
     "pageDate": "YYYY-MM-DD" | null,
     "entries": [{ "date", "description", "kind", "amount", "category", "confidence", "rawText" }],
     "notes": string | null
   }

4. PAGEDATE (fecha de cabecera de la pagina):
   - Si la pagina tiene una fecha en la cabecera ("15 de marzo 2026", "15/03/2026", "Marzo 15", "15-03-26", "20|03|26") interpretala y devuelvela como pageDate en formato YYYY-MM-DD.
   - Formato DD|MM|AA (separador barra o pipe): "20|03|26" → "2026-03-20". Si AA tiene 2 digitos, asumir 2026.
   - Si no hay fecha de cabecera, pageDate=null.
   - Para cada renglon individual: si NO ves una fecha escrita explicitamente en ese renglon, devuelve date=null. NO copies pageDate al renglon — el codigo cliente hereda esa fecha en JS, no tu.

${amountRules}

6. KIND (clasificacion ingreso vs egreso):
   - 'ingreso' si el renglon esta en columna de "ingreso", "venta", "ingresos", "entradas", "abonos", "cobro", "recibido", o si suma al total positivo del dia.
   - 'ingreso' si el documento es un recibo de venta del propio negocio (ej. "Vendedor: Morea Natural", "FORMA MULTIUSOS", "recibo de caja").
   - 'egreso' si esta en columna de "egreso", "gasto", "compras", "salidas", "pago", "pagado", "compre".
   - 'egreso' si el documento es una tirilla de compra en establecimiento externo (supermercado, ferreteria, etc.).
   - Cuaderno mixto: detecta keyword "venta/cobro/recibido" → ingreso; "compra/pago/gasto" → egreso.
   - Si NO hay forma de saber con certeza (renglon ambiguo en pagina sin columnas claras), asume kind='egreso' y baja confidence a 0.4 o menos.

7. CATEGORY (categoria sugerida):
   - Sugiere una categoria corta en espanol (max 120 caracteres). Ejemplos comunes: "Ventas dia", "Mercancia", "Arriendo", "Servicios publicos", "Salarios", "Transporte", "Domicilios", "Empaques", "Impuestos", "Bancos".
   - Si el renglon NO encaja claramente en ninguna categoria, devuelve category=null. NO inventes categorias forzadas.${knownCategoriesHint}

8. CONFIDENCE (0.0 a 1.0):
   - 1.0  → leiste todo perfectamente, sin dudas.
   - 0.7  → la mayoria es legible, una o dos palabras adivinadas.
   - 0.4  → estas adivinando partes importantes (monto, kind o descripcion).
   - <0.3 → mejor omitir el renglon completo que devolverlo. NO incluyas renglones con confidence < 0.3.
   - CRITICO: si una palabra es ambigua (no estoy seguro si dice "romero" o "comoyo"), usa confidence < 0.7 en lugar de inventar la palabra mas probable.

9. RAW TEXT (auditoria humana — OBLIGATORIO):
   - Copia textual de lo que viste escrito en ese renglon, tal cual, sin corregir ortografia ni puntuacion.
   - rawText SIEMPRE debe incluirse (permite validacion Levenshtein post-extraccion).
   - Si el renglon es ilegible pero notas que existe, omitelo (no lo incluyas en entries).

10. CASOS ESPECIALES (responde con entries vacios y notes especificas):
   - Si la foto NO es un cuaderno contable (selfie, paisaje, recibo individual, factura impresa, captura de pantalla, comprobante bancario): devuelve entries=[] y notes='no_ledger_detected'. NO inventes entries.
   - Si la foto esta demasiado borrosa, oscura o desenfocada para leer NADA: entries=[] y notes='image_too_blurry'.
   - Si la pagina tiene mas de 200 renglones: procesa solo los primeros 200 y devuelve notes='truncated_at_200'.
   - Si la pagina esta en blanco o solo tiene la cabecera: entries=[] y notes='empty_page'.

11. ANTI-ALUCINACION (reglas duras, no negociables):
   - TRANSCRIBIR LITERAL: si la imagen dice "romero", escribe "romero". NO inferir ni sustituir por palabras parecidas. Si NO puedes leer con certeza, baja confidence antes que inventar.
   - NUNCA escribas un monto que no veas escrito en la imagen. Si dudas, amount=null + confidence baja.
   - NUNCA inventes una descripcion. Copia lo que ves o omite el renglon.
   - NUNCA fabriques fechas. Si no hay fecha en el renglon, date=null.
   - Si un campo te genera duda razonable, prefiere null antes que adivinar.
   - El usuario revisa cada renglon manualmente — un null o un confidence bajo le dice "revisa esto", una invencion lo engaña.
${fewShotExamples}${englishMirror}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// gpt-5.4 es un reasoning model: los tokens de razonamiento interno CUENTAN
// contra max_completion_tokens (mapeado por AI SDK desde maxOutputTokens).
// Con 4096 el reasoning puede consumir ~3000 tokens dejando solo ~1000 para
// el JSON → JSON truncado → Zod falla silenciosamente → experimental_output null.
// 16000 da margen amplio: OCR de una pagina de cuaderno rara vez supera 2000
// tokens de output visible, y el reasoning tipico es 1000-3000.
// reasoningEffort:'medium' (subido desde 'low'): 'low' consumia tokens internos
// en introspeccion en lugar de transcribir literal, causando el bug "comoyo"
// en lugar de "romero". 'medium' mejora la transcripcion handwriting sin el
// overhead innecesario de 'high'.
const MAX_OUTPUT_TOKENS = 16_000;
const TIMEOUT_MS = 90_000;

/**
 * Extrae renglones contables de una foto de cuaderno usando GPT-4o Vision.
 *
 * @param imageDataUrl - data URL (`data:image/jpeg;base64,...`) o https URL.
 *                       Pasada directo al AI SDK como `{ type: 'image', image }`.
 * @param ctx          - Contexto del libro (idioma, moneda, categorias conocidas).
 * @returns ExtractionResult ya validado contra el schema Zod.
 *
 * Errores: nunca throwea por fallo de extraccion. Si el modelo falla dos veces
 * seguidas, devuelve `{ pageDate: null, entries: [], notes: 'extraction_failed: <msg>' }`
 * para que el orchestrator marque el upload como `failed` con mensaje legible.
 * Si throweara, el orchestrator no podria capturar el motivo y el upload se
 * quedaria en `processing` para siempre.
 */
export async function extractEntriesFromImage(
  imageDataUrl: string,
  ctx: ExtractionContext,
): Promise<ExtractionResult> {
  const system = buildSystemPrompt(ctx);

  const userTextEs =
    'Lee este cuaderno contable y extrae los renglones segun el schema. Devuelve JSON estricto.';
  const userTextEn =
    '[EN] Read this bookkeeping notebook and extract the rows per the schema. Return strict JSON. Output values stay in Spanish.';
  const userText = ctx.language === 'en' ? userTextEn : userTextEs;

  // Helper para una llamada individual. Lo reusamos para el retry.
  const runOnce = async (): Promise<ExtractionResult> => {
    const result = await generateText({
      model: MODELS.OCR,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            {
              type: 'image',
              image: imageDataUrl,
              // imageDetail:'high' fuerza el nivel de detalle maximo para
              // fotos de texto manuscrito tomadas con celular. Con 'auto'
              // (default) OpenAI sub-muestrea la imagen y pierde trazos
              // finos de letra — causa directa del bug "comoyo" vs "romero".
              // API real confirmada en @ai-sdk/openai src:
              //   part.providerOptions?.openai?.imageDetail → detail field
              providerOptions: {
                openai: { imageDetail: 'high' },
              },
            },
          ],
        },
      ],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // gpt-5.4 es reasoning model: reducimos el esfuerzo de razonamiento
      // porque OCR no requiere cadena de pensamiento larga. Esto libera mas
      // tokens disponibles para el JSON visible dentro del presupuesto total.
      providerOptions: {
        openai: { reasoningEffort: 'medium' },
      },
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      experimental_output: Output.object({ schema: ExtractionResultSchema }),
    });

    // experimental_output puede ser null si el JSON quedo truncado / el modelo
    // no emitio JSON valido. Lanzamos aqui para que el try/catch externo lo
    // capture y haga retry, en vez de retornar silenciosamente entries:[].
    if (result.experimental_output == null) {
      const finishReason = result.finishReason ?? 'unknown';
      const usageInfo = result.usage
        ? `inputTokens=${result.usage.inputTokens} outputTokens=${result.usage.outputTokens}`
        : 'usage=unavailable';
      throw new Error(
        `[vision-extractor] experimental_output null — finishReason=${finishReason} ${usageInfo}`,
      );
    }

    return result.experimental_output;
  };

  try {
    return await runOnce();
  } catch (firstErr) {
    const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    console.warn('[pyme/extraction] first attempt failed, retrying once:', firstMsg);

    try {
      return await runOnce();
    } catch (secondErr) {
      const secondMsg = secondErr instanceof Error ? secondErr.message : String(secondErr);
      console.error('[pyme/extraction] both attempts failed:', secondMsg);
      // Soft-fail: devolvemos un ExtractionResult valido con notes explicativo.
      // El orchestrator detecta `extraction_failed:` y marca el upload como
      // `failed` con este mensaje para que el usuario vea el motivo en UI.
      return {
        pageDate: null,
        entries: [],
        notes: `extraction_failed: ${secondMsg.slice(0, 900)}`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Cross-validation helper (exported for orchestrator / preprocessing use)
// ---------------------------------------------------------------------------

/**
 * Verifica si la suma de amounts coincide con un total declarado en el
 * documento (ej. linea "TOTAL: 146.000" en un recibo FORMA MULTIUSOS).
 *
 * Tolerancia: $500 COP (cubre redondeo manual del tendero).
 *
 * @param entries       - Renglones extraidos por extractEntriesFromImage.
 * @param declaredTotal - Total que aparece escrito en la imagen, ya parseado
 *                        a numero (null si el documento no tiene total visible).
 */
export function validateCrossSum(
  entries: Array<{ amount: number | null; kind: 'ingreso' | 'egreso' }>,
  declaredTotal: number | null,
): { ok: boolean; computedTotal: number; declaredTotal: number | null; deltaCop: number } {
  const computed = entries
    .filter((e) => e.amount != null)
    .reduce((sum, e) => sum + (e.amount ?? 0), 0);
  if (declaredTotal == null) {
    return { ok: true, computedTotal: computed, declaredTotal: null, deltaCop: 0 };
  }
  const delta = Math.abs(computed - declaredTotal);
  return { ok: delta <= 500, computedTotal: computed, declaredTotal, deltaCop: delta };
}
