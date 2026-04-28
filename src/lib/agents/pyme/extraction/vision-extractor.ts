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
   - Si la pagina tiene una fecha en la cabecera ("15 de marzo 2026", "15/03/2026", "Marzo 15", "15-03-26") interpretala y devuelvela como pageDate en formato YYYY-MM-DD.
   - Si no hay fecha de cabecera, pageDate=null.
   - Para cada renglon individual: si NO ves una fecha escrita explicitamente en ese renglon, devuelve date=null. NO copies pageDate al renglon — el codigo cliente hereda esa fecha en JS, no tu.

${amountRules}

6. KIND (clasificacion ingreso vs egreso):
   - 'ingreso' si el renglon esta en columna de "ingreso", "venta", "ingresos", "entradas", "abonos", "cobro", "recibido", o si suma al total positivo del dia.
   - 'egreso' si esta en columna de "egreso", "gasto", "compras", "salidas", "pago", "pagado", "compre".
   - Si NO hay forma de saber con certeza (renglon ambiguo en pagina sin columnas claras), asume kind='egreso' y baja confidence a 0.4 o menos. La mayoria de cuadernos de tenderos registran mas egresos que ingresos cuando el renglon es ambiguo.

7. CATEGORY (categoria sugerida):
   - Sugiere una categoria corta en espanol (max 120 caracteres). Ejemplos comunes: "Ventas dia", "Mercancia", "Arriendo", "Servicios publicos", "Salarios", "Transporte", "Domicilios", "Empaques", "Impuestos", "Bancos".
   - Si el renglon NO encaja claramente en ninguna categoria, devuelve category=null. NO inventes categorias forzadas.${knownCategoriesHint}

8. CONFIDENCE (0.0 a 1.0):
   - 1.0  → leiste todo perfectamente, sin dudas.
   - 0.7  → la mayoria es legible, una o dos palabras adivinadas.
   - 0.4  → estas adivinando partes importantes (monto, kind o descripcion).
   - <0.3 → mejor omitir el renglon completo que devolverlo. NO incluyas renglones con confidence < 0.3.

9. RAW TEXT (auditoria humana):
   - Copia textual de lo que viste escrito en ese renglon, tal cual, sin corregir ortografia ni puntuacion.
   - Si el renglon es ilegible pero notas que existe, omitelo (no lo incluyas en entries).

10. CASOS ESPECIALES (responde con entries vacios y notes especificas):
   - Si la foto NO es un cuaderno contable (selfie, paisaje, recibo individual, factura impresa, captura de pantalla, comprobante bancario): devuelve entries=[] y notes='no_ledger_detected'. NO inventes entries.
   - Si la foto esta demasiado borrosa, oscura o desenfocada para leer NADA: entries=[] y notes='image_too_blurry'.
   - Si la pagina tiene mas de 200 renglones: procesa solo los primeros 200 y devuelve notes='truncated_at_200'.
   - Si la pagina esta en blanco o solo tiene la cabecera: entries=[] y notes='empty_page'.

11. ANTI-ALUCINACION (reglas duras, no negociables):
   - NUNCA escribas un monto que no veas escrito en la imagen. Si dudas, amount=null + confidence baja.
   - NUNCA inventes una descripcion. Copia lo que ves o omite el renglon.
   - NUNCA fabriques fechas. Si no hay fecha en el renglon, date=null.
   - Si un campo te genera duda razonable, prefiere null antes que adivinar.
   - El usuario revisa cada renglon manualmente — un null o un confidence bajo le dice "revisa esto", una invencion lo engaña.${englishMirror}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MAX_OUTPUT_TOKENS = 4096;
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
            { type: 'image', image: imageDataUrl },
          ],
        },
      ],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      experimental_output: Output.object({ schema: ExtractionResultSchema }),
    });

    // experimental_output ya viene parseado y validado contra el schema.
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
