// ---------------------------------------------------------------------------
// `callFinancialAgent` — runtime canónico para agentes LLM financieros (GPT-5.4)
// ---------------------------------------------------------------------------
//
// Patrón outcome-first GPT-5.4 (best practice OpenAI 2026):
//
//   1. SYSTEM PROMPT usa CTCO + XML tags estructurales — no numeración
//      procedural (Paso 1, Paso 2…) — y NO incluye el output schema en prosa.
//      El schema se enforza vía `experimental_output: Output.object({ schema })`,
//      no vía instrucciones de "responde en JSON con campos x, y, z".
//
//   2. RESERVED LANGUAGE: `ALWAYS / NEVER / MUST` se reservan para safety rails
//      (anti-hallucination, anti-PII, defensa Art. 647 E.T.). Para juicio
//      contable se usa `If X then Y otherwise Z` — el reasoning model encuentra
//      mejor respuesta cuando no se le ata las manos.
//
//   3. CACHE-FRIENDLY LAYOUT: el system prompt debe componerse así:
//        [estable al inicio]
//          - Guardarrail anti-hallucination
//          - Contexto normativo Colombia 2026
//          - <task> y <success_criteria>
//        [dinámico al final]
//          - <context> con PreprocessedBalance / TOTALES VINCULANTES
//          - <constraints> específicos de la empresa
//      Esto maximiza el prompt-cache automático de GPT-5.4 (40-80% mejor que
//      Chat Completions tradicional).
//
//   4. REASONING_EFFORT calibrado por slot (NO usar default en todos los
//      agentes). Ver `MODELS_CONFIG` en `src/lib/config/models.ts`.
//        - `minimal` / `low`  : classifier, OCR, validators de bajo nivel
//        - `medium` (default) : NIIF Analyst, Strategy, Governance, Audit
//        - `high`             : Tax Optimizer, Valuation Synth, Fiscal Opinion
//
//   5. AI SDK v6 ya usa Responses API por default desde v5 — `providerOptions
//      .openai.store` controla la persistencia de reasoning entre turnos.
//      Default: `true` para pipelines secuenciales (NIIF -> Strategy -> Gov),
//      donde reutilizar reasoning del turno anterior reduce latencia y mejora
//      coherencia.
//
// CONTRATO CON CONSUMERS:
//   `callFinancialAgent` devuelve `{ json, meta }`. El JSON ya viene validado
//   contra el schema Zod. `meta` expone telemetría (reasoning tokens, cache
//   hit rate, finish reason) para auditoría y observabilidad.
//
//   Los renderers downstream que necesiten Markdown legacy deben llamar al
//   renderer determinístico correspondiente (ver `./renderer.ts`) — el LLM
//   nunca compone Markdown directamente.
// ---------------------------------------------------------------------------

import { generateText, Output, type LanguageModel } from 'ai';
import type { z } from 'zod';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanlyOrThrow } from '../utils/finish-reason-check';

// ---------------------------------------------------------------------------
// Opciones públicas
// ---------------------------------------------------------------------------

/**
 * Esfuerzo de razonamiento para reasoning models (familia GPT-5.4).
 *
 * - `minimal` : latencia mínima, sin cadena de razonamiento. Para tareas
 *               deterministas (extracción simple, routing).
 * - `low`     : razonamiento corto (~1-2k tokens). Para validaciones, OCR.
 * - `medium`  : default. Razonamiento balanceado (~5-10k tokens). Default OpenAI.
 * - `high`    : razonamiento profundo (~20k+ tokens). Solo para dictámenes
 *               estratégicos donde el costo se justifica.
 */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/**
 * Verbosity del texto de salida — controla cuánto detalle prosaico genera
 * el modelo en campos string libres. No afecta a campos estructurados
 * (donde el schema manda).
 */
export type TextVerbosity = 'low' | 'medium' | 'high';

export interface CallFinancialAgentOptions<TSchema extends z.ZodTypeAny> {
  /** Identificador legible del agente — usado solo para logging. */
  agentName: string;
  /** Instancia LanguageModel — viene de `MODELS.FINANCIAL_PIPELINE`, etc. */
  model: LanguageModel;
  /** Schema Zod estricto. DEBE usar `.nullable()` para opcionales (strict mode). */
  schema: TSchema;
  /** System prompt outcome-first. Cache-friendly: estable al inicio, dinámico al final. */
  system: string;
  /** User content — datos dinámicos por request (balance, fixture, instrucciones). */
  userContent: string;
  /** Token budget máximo para la respuesta. Mapea a `max_completion_tokens` en GPT-5.4. */
  maxOutputTokens: number;
  /** Reasoning effort — default `medium`. */
  reasoningEffort?: ReasoningEffort;
  /** Text verbosity — default `medium`. */
  textVerbosity?: TextVerbosity;
  /** Persistir reasoning entre turnos (Responses API). Default `true`. */
  store?: boolean;
  /** Metadata opcional para Responses API (tracing, billing). */
  metadata?: Record<string, string>;
  /** AbortSignal para cancelación temprana (timeout SSE, etc.). */
  signal?: AbortSignal;
  /** Intentos máximos (incluye el primero). Default 3 — coincide con `withRetry`. */
  maxAttempts?: number;
}

export interface CallFinancialAgentResult<TSchema extends z.ZodTypeAny> {
  /** Output validado y tipado contra el schema. */
  json: z.infer<TSchema>;
  /** Telemetría observable. */
  meta: {
    agentName: string;
    finishReason: string;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
    elapsedMs: number;
    /**
     * `true` si la salvaguarda contra `finish_reason=length` se activó y el
     * agente se ejecutó con `effort='low'`. Útil para observabilidad — si
     * sucede frecuentemente, considerar subir `maxOutputTokens` del slot.
     */
    fallbackUsed: boolean;
  };
}

// ---------------------------------------------------------------------------
// Función pública
// ---------------------------------------------------------------------------

/**
 * Invoca un agente financiero LLM con contrato JSON-strict y devuelve el
 * objeto tipado. Centraliza:
 *   - Reintento por error transitorio (`withRetry`).
 *   - Validación del finish reason (`assertFinishedCleanlyOrThrow`).
 *   - Pase de `providerOptions.openai` específico de reasoning models.
 *   - Telemetría unificada.
 *
 * Devuelve `{ json, meta }`. Lanza si el modelo no termina limpiamente, si
 * el schema no se cumple, o si se exceden los retries.
 */
export async function callFinancialAgent<TSchema extends z.ZodTypeAny>(
  opts: CallFinancialAgentOptions<TSchema>,
): Promise<CallFinancialAgentResult<TSchema>> {
  const {
    agentName,
    model,
    schema,
    system,
    userContent,
    maxOutputTokens,
    reasoningEffort = 'medium',
    textVerbosity = 'medium',
    store = true,
    metadata,
    signal,
    maxAttempts = 3,
  } = opts;

  const t0 = Date.now();

  /**
   * Ejecuta una pasada al modelo con un `reasoningEffort` específico. Se llama
   * dos veces como mucho: primero con el effort solicitado por el caller, y si
   * el modelo devuelve `finish_reason=length` con output vacío (bug conocido
   * GPT-5: el reasoning agotó el budget), una segunda vez con effort
   * degradado a `low` — libera ~8K tokens internos para output.
   */
  const runPass = async (effort: ReasoningEffort) =>
    withRetry(
      () =>
        generateText({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
          temperature: 0,
          maxOutputTokens,
          experimental_output: Output.object({ schema }),
          abortSignal: signal,
          providerOptions: {
            openai: {
              store,
              reasoningEffort: effort,
              textVerbosity,
              ...(metadata ? { metadata } : {}),
            },
          },
        }),
      { maxAttempts, label: `financial-agent:${agentName}:${effort}`, signal },
    );

  let result = await runPass(reasoningEffort);
  let fallbackUsed = false;

  // Salvaguarda contra el bug `finish_reason=length` + textLen=0 propio de los
  // reasoning models GPT-5: si el reasoning consumió todo el budget, reintentar
  // UNA vez con effort='low' (solo si el caller pidió medium/high — bajar
  // desde 'low' o 'minimal' no aporta).
  const hitLengthBug =
    result.finishReason === 'length' &&
    (result.experimental_output === undefined || result.experimental_output === null);

  if (hitLengthBug && (reasoningEffort === 'medium' || reasoningEffort === 'high')) {
    console.warn(
      `[callFinancialAgent:${agentName}] hit finish_reason=length con effort=${reasoningEffort}; ` +
        `reintentando con effort='low' (auto-fallback).`,
    );
    result = await runPass('low');
    fallbackUsed = true;
  }

  assertFinishedCleanlyOrThrow(result, agentName);

  const json = result.experimental_output as z.infer<TSchema>;
  if (json === undefined || json === null) {
    throw new Error(`callFinancialAgent[${agentName}]: experimental_output vacío`);
  }

  // Telemetría — los nombres exactos en `usage` dependen del provider;
  // accedemos con optional chaining sobre `unknown` para no acoplar a versiones.
  const usage = (result as unknown as { usage?: Record<string, number | undefined> }).usage ?? {};

  return {
    json,
    meta: {
      agentName,
      finishReason: result.finishReason,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      cachedInputTokens: usage.cachedInputTokens,
      elapsedMs: Date.now() - t0,
      fallbackUsed,
    },
  };
}
