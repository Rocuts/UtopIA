// ---------------------------------------------------------------------------
// Schemas Zod para extraccion Vision de cuadernos contables (modulo Pyme).
// ---------------------------------------------------------------------------
// Estos schemas se pasan a `experimental_output: Output.object({ schema })`
// del AI SDK v6 para forzar al modelo a devolver JSON estricto. La salida ya
// viene validada — si el modelo devuelve algo invalido, generateText lanza.
// ---------------------------------------------------------------------------

import { z } from 'zod';

// Cap duro en amount: 1 billon COP (10^12). Es ~250 millones USD — cualquier
// valor mayor es prompt-injection o lectura erronea. El zod schema rechaza
// el output del LLM si excede el cap, lo que provoca un retry del extractor
// y previene inflar totales con montos basura.
const MAX_AMOUNT = 1_000_000_000_000; // 1 trillion en numeracion corta = 1 billon en numeracion larga (COP)

export const ExtractedEntrySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  description: z.string().min(1).max(500),
  kind: z.enum(['ingreso', 'egreso']),
  amount: z.number().nonnegative().max(MAX_AMOUNT).nullable(),
  category: z.string().max(120).nullable(),
  confidence: z.number().min(0).max(1),
  rawText: z.string().max(1000).nullable(),
});

export const ExtractionResultSchema = z.object({
  pageDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  entries: z.array(ExtractedEntrySchema).max(200),
  notes: z.string().max(1000).nullable(),
});

export type ExtractedEntry = z.infer<typeof ExtractedEntrySchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
