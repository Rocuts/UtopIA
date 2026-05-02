// ---------------------------------------------------------------------------
// Agente categorizador — refina la categoria de un entry contable pyme.
// ---------------------------------------------------------------------------
// Modelo: MODELS.CHAT (gpt-5.4-mini por defecto). Output forzado via
// `experimental_output: Output.object({ schema })` igual que el classifier.
// Para batches > 1 entry, una sola llamada con un array de items para evitar
// N round-trips.
// ---------------------------------------------------------------------------

import 'server-only';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { MODELS } from '@/lib/config/models';
import { buildCategorizerPrompt } from '@/lib/agents/pyme/prompts/categorizer.prompt';
import type { ExtractedEntry } from '@/lib/agents/pyme/extraction/schemas';

// ---------------------------------------------------------------------------
// Schema de salida (un solo entry categorizado)
// ---------------------------------------------------------------------------

const CategorizedSchema = z.object({
  category: z.string().min(1).max(120),
  pucHint: z.string().max(20).nullable(),
  rationale: z.string().max(200),
});

export type CategorizedEntry = z.infer<typeof CategorizedSchema>;

// Schema cuando llamamos en batch — el modelo devuelve un objeto con `items`.
const CategorizedBatchSchema = z.object({
  items: z.array(CategorizedSchema),
});

interface CategorizerContext {
  language: 'es' | 'en';
  knownCategories: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Renderiza un entry como bloque legible para el modelo. Mantenemos el JSON
 * crudo para que el modelo vea la estructura exacta — los modelos pequenos
 * categorizan mejor con datos estructurados que con prosa libre.
 */
function entryToPrompt(entry: ExtractedEntry): string {
  return JSON.stringify(
    {
      description: entry.description,
      kind: entry.kind,
      amount: entry.amount,
      draftCategory: entry.category,
      rawText: entry.rawText,
    },
    null,
    2,
  );
}

/**
 * Fallback usado cuando el modelo devuelve menos items que los esperados.
 * Anti-alucinacion: en vez de inventar, ponemos "Otros".
 */
function fallbackCategorized(): CategorizedEntry {
  return {
    category: 'Otros',
    pucHint: null,
    rationale: 'fallback — el modelo no devolvio una categoria para este renglon',
  };
}

// ---------------------------------------------------------------------------
// Single-entry categorizer
// ---------------------------------------------------------------------------

export async function categorizeEntry(
  entry: ExtractedEntry,
  ctx: CategorizerContext,
): Promise<CategorizedEntry> {
  const systemPrompt = buildCategorizerPrompt({
    language: ctx.language,
    knownCategories: ctx.knownCategories,
  });

  const userContent =
    (ctx.language === 'en' ? 'Entry to categorize:\n' : 'Renglon a categorizar:\n') +
    entryToPrompt(entry);

  const result = await generateText({
    model: MODELS.CHAT,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
    maxOutputTokens: 256,
    experimental_output: Output.object({ schema: CategorizedSchema }),
  });

  return result.experimental_output;
}

// ---------------------------------------------------------------------------
// Batch categorizer
// ---------------------------------------------------------------------------

/**
 * Categoriza una lista de entries en una sola llamada.
 *
 * - Lista vacia -> retorna [] sin tocar el modelo.
 * - 1 entry      -> delega en `categorizeEntry`.
 * - >1 entries   -> 1 llamada con array. Si el modelo devuelve
 *                   diferente cantidad, rellenamos con "Otros" y log warn.
 */
export async function categorizeEntriesBatch(
  entries: ExtractedEntry[],
  ctx: CategorizerContext,
): Promise<CategorizedEntry[]> {
  if (entries.length === 0) return [];
  if (entries.length === 1) {
    const single = await categorizeEntry(entries[0], ctx);
    return [single];
  }

  const systemPrompt = buildCategorizerPrompt({
    language: ctx.language,
    knownCategories: ctx.knownCategories,
  });

  const header =
    ctx.language === 'en'
      ? `You will receive ${entries.length} entries. Return EXACTLY ${entries.length} categorized items, in the SAME ORDER, inside { "items": [...] }.`
      : `Recibiras ${entries.length} renglones. Devuelve EXACTAMENTE ${entries.length} items categorizados, en el MISMO ORDEN, dentro de { "items": [...] }.`;

  const body = entries
    .map((e, i) => `--- ${i + 1} ---\n${entryToPrompt(e)}`)
    .join('\n');

  const result = await generateText({
    model: MODELS.CHAT,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${header}\n\n${body}` },
    ],
    temperature: 0.2,
    // ~30 entries x ~50 tokens output = ~1500 tokens; 2048 da margen.
    maxOutputTokens: 2048,
    experimental_output: Output.object({ schema: CategorizedBatchSchema }),
  });

  const items = result.experimental_output.items;

  if (items.length === entries.length) return items;

  // Discrepancia de longitud: rellenamos con fallback "Otros" para los que falten.
  console.warn(
    `[pyme-categorizer] Batch length mismatch: input=${entries.length} output=${items.length}. Filling missing slots with "Otros".`,
  );

  const out: CategorizedEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    out.push(items[i] ?? fallbackCategorized());
  }
  return out;
}
