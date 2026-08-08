// ---------------------------------------------------------------------------
// callStructuredTool — runtime compartido de las tools LLM de chat
// ---------------------------------------------------------------------------
//
// POR QUE EXISTE (auditoria 2026-08):
// Las tres tools que llaman al modelo desde `src/lib/tools/` (analisis de
// documentos, evaluacion de riesgo y borrador de respuesta DIAN) invocaban
// `generateText` a pelo y despues hacian `JSON.parse(result.text)`. Ese camino
// tenia tres agujeros, y los tres terminan en lo mismo: entregarle al usuario
// una respuesta incompleta como si estuviera completa.
//
//   1. NADIE MIRABA `finishReason`. Si el modelo cortaba por `length`, el JSON
//      quedaba truncado; en el mejor caso `JSON.parse` lanzaba y caiamos al
//      fallback (bien), pero en el peor el corte ocurria despues de una llave
//      de cierre valida — p.ej. un borrador DIAN con `citedArticles` a medias —
//      y el objeto parseaba limpio. El contador firmaba un escrito mutilado.
//      Lo mismo con `content-filter`: output vacio o parcial, cero senal.
//   2. NO HABIA VALIDACION DE CONTRATO. Solo `Array.isArray(x)` y
//      `typeof y === 'string'`. Un `severity: "catastrofico"` o un
//      `category: "inventada"` viajaban intactos hasta el renderer, que los
//      mapea a estilos por clave y se queda mudo.
//   3. NO HABIA TELEMETRIA. Estas llamadas no dejaban fila en `agent_telemetry`,
//      asi que las alertas de docs/TELEMETRY.md (finishReason != stop > 1% -> P0,
//      costo diario) se calculaban ignorandolas por completo.
//
// La politica aqui es la misma del pipeline financiero (`callFinancialAgent`),
// reducida a lo que una tool de chat necesita:
//   - `experimental_output: Output.object({ schema })` — JSON strict del provider
//     en vez de "responde SOLO con JSON" en prosa.
//   - `withRetry` para el fallo transitorio.
//   - `assertFinishedCleanlyOrThrow` — un corte NO se entrega, se convierte en
//     error para que el caller caiga a su fallback explicito y avisado.
//   - `schema.safeParse` explicito sobre el output.
//   - Telemetria fire-and-forget.
//
// NOTA STRICT MODE: los schemas que se pasan aqui viajan al provider como
// `response_format: json_schema` con `strict: true` (default de
// `@ai-sdk/openai`). Por eso deben cumplir docs/spec/zod-strict-mode-2026.md
// (`.nullable()` siempre; nunca `.optional()` / `.default()` / `z.record()`).
// El guard `npm run lint:strict-mode` escanea este directorio por eso mismo.
// ---------------------------------------------------------------------------

import { generateText, Output, type LanguageModel } from 'ai';
import type { z } from 'zod';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanlyOrThrow } from '@/lib/agents/financial/utils/finish-reason-check';

export interface StructuredToolCallOptions<TSchema extends z.ZodTypeAny> {
  /** Nombre legible de la tool — logs y columna `agent_name` de telemetria. */
  toolName: string;
  /** LanguageModel de `@ai-sdk/openai`. NUNCA se pasa apiKey. */
  model: LanguageModel;
  /** Schema Zod strict-mode del output. */
  schema: TSchema;
  /** System prompt. */
  system: string;
  /** Contenido dinamico del turno. */
  userContent: string;
  /** Techo de tokens de salida. */
  maxOutputTokens: number;
  /** Temperatura. Default 0.1 (estas tools quieren determinismo). */
  temperature?: number;
  /** Intentos maximos, incluido el primero. Default 2. */
  maxAttempts?: number;
}

/** Identificador del modelo para telemetria, sin acoplarse al shape del SDK. */
function resolveModelId(model: LanguageModel): string {
  if (typeof model === 'string') return model;
  return (model as { modelId?: string }).modelId ?? 'unknown';
}

/**
 * Lectura defensiva de `experimental_output`.
 *
 * AI SDK v6 lo expone como GETTER que LANZA `NoOutputGeneratedError` cuando el
 * output interno es null. Tocarlo sin try/catch hace escapar ese error por
 * fuera del flujo previsto — el mismo modo de fallo que se corrigio en
 * `callFinancialAgent`.
 */
function safeOutput(result: unknown): unknown {
  try {
    return (result as { experimental_output?: unknown }).experimental_output;
  } catch {
    return null;
  }
}

/**
 * Invoca al modelo con contrato JSON strict y devuelve el objeto ya validado.
 *
 * LANZA si el modelo no termino limpiamente, si el output vino vacio, o si no
 * cumple el schema. Lanzar es deliberado: cada caller tiene un fallback
 * explicito que ADEMAS le dice al usuario que la salida es de respaldo. Es
 * justo lo contrario de devolver un objeto a medias sin avisar.
 */
export async function callStructuredTool<TSchema extends z.ZodTypeAny>(
  opts: StructuredToolCallOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const {
    toolName,
    model,
    schema,
    system,
    userContent,
    maxOutputTokens,
    temperature = 0.1,
    maxAttempts = 2,
  } = opts;

  const t0 = Date.now();

  const result = await withRetry(
    () =>
      generateText({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        temperature,
        maxOutputTokens,
        experimental_output: Output.object({ schema }),
      }),
    { maxAttempts, baseDelayMs: 1000, maxDelayMs: 2000, label: `tool:${toolName}` },
  );

  // Telemetria ANTES de cualquier throw: una llamada que corto por `length` es
  // exactamente la que hay que poder contar en el dashboard. Si solo midieramos
  // el camino feliz, la alerta "finishReason != stop > 1%" seria estructuralmente
  // incapaz de dispararse.
  const usage = (result as unknown as { usage?: Record<string, number | undefined> }).usage ?? {};
  recordToolTelemetry({
    agentName: `tool:${toolName}`,
    modelId: resolveModelId(model),
    finishReason: result.finishReason,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    reasoningTokens: usage.reasoningTokens ?? null,
    cachedInputTokens: usage.cachedInputTokens ?? null,
    elapsedMs: Date.now() - t0,
  });

  assertFinishedCleanlyOrThrow(result, `tool:${toolName}`);

  const raw = safeOutput(result);
  if (raw === undefined || raw === null) {
    throw new Error(
      `[tool:${toolName}] el modelo no produjo output estructurado ` +
        `(finishReason=${result.finishReason}). Subir maxOutputTokens o acortar el input.`,
    );
  }

  // Defensa en profundidad sobre la validacion del propio SDK: el output de
  // estas tools termina en un borrador que el contribuyente firma. Re-validar
  // cuesta microsegundos y convierte "el provider cambio de comportamiento" en
  // un error atrapable en vez de un documento mal formado.
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join(' | ');
    throw new Error(
      `[tool:${toolName}] el output del modelo no cumple el schema (finishReason=` +
        `${result.finishReason}). Issues: ${issues}`,
    );
  }

  return parsed.data as z.infer<TSchema>;
}

interface ToolTelemetryRow {
  agentName: string;
  modelId: string;
  finishReason: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  elapsedMs: number;
}

/**
 * Fire-and-forget de verdad: import dinamico (no arrastramos `pg` al grafo de
 * quien solo importa una tool), promesa sin `await` y `catch` final. La
 * telemetria NUNCA puede romper ni retrasar la respuesta al usuario.
 */
function recordToolTelemetry(row: ToolTelemetryRow): void {
  const task = (async () => {
    try {
      const { persistAgentTelemetry } = await import('@/lib/db/telemetry');
      await persistAgentTelemetry({ ...row, fallbackUsed: false });
    } catch (err) {
      console.error(`[${row.agentName}] telemetria no persistida:`, err);
    }
  })();

  // En Vercel la instancia puede evictarse en cuanto la respuesta termina y el
  // insert quedaria a medias. Fuera de Vercel el import falla y la promesa se
  // resuelve sola.
  void (async () => {
    try {
      const { waitUntil } = await import('@vercel/functions');
      waitUntil(task);
    } catch {
      /* entorno sin runtime Vercel */
    }
  })();
}
