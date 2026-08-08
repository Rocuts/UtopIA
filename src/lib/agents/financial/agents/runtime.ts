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
  /**
   * Callback opcional para emitir telemetría (e.g. al SSE consumer). Se invoca
   * justo antes del return con el `meta` final. El caller (cada agent.ts)
   * decide qué hacer con él — típicamente emitir el SSE event `agent_telemetry`
   * vía su propio `onProgress`. No bloquea: si el callback lanza, propaga.
   *
   * NO es el canal de persistencia: la fila de `agent_telemetry` la escribe
   * este runtime directamente (ver `persistAgentTelemetry`). Antes se esperaba
   * que cada agente cableara la persistencia aquí y ninguno lo hacía.
   */
  onTelemetry?: (meta: CallFinancialAgentResult<TSchema>['meta']) => void;
  /**
   * Aviso de degradación. Se invoca cuando el agente entrega un resultado
   * producido con `reasoningEffort='low'` tras agotar el effort solicitado.
   * El caller debe propagarlo al SSE (`FinancialProgressEvent` type `warning`)
   * para que la UI marque la sección como generada en modo degradado: el
   * cliente firma este reporte ante la DIAN y tiene derecho a saberlo.
   */
  onDegraded?: (info: { agentName: string; requestedEffort: ReasoningEffort; message: string }) => void;
  /**
   * Tenant dueño de la llamada (telemetría). Si se omite se toma del
   * `AsyncLocalStorage` que abra el route handler con `runWithTelemetryContext`.
   */
  workspaceId?: string | null;
  /** Reporte asociado, si el orchestrator ya creó la fila. */
  reportId?: string | null;
}

export interface CallFinancialAgentResult<TSchema extends z.ZodTypeAny> {
  /** Output validado y tipado contra el schema. */
  json: z.infer<TSchema>;
  /** Telemetría observable. */
  meta: {
    agentName: string;
    /** Modelo efectivamente usado (para costo y dashboards). */
    modelId: string;
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
    /**
     * Reasoning tokens consumidos por el PRIMER pase, cuando el auto-fallback
     * se activó (`fallbackUsed=true`). Es la señal diagnóstica clave: dice
     * cuánto razonamiento gastó GPT-5 antes de quedarse sin budget. Si suele
     * acercarse al `maxOutputTokens` del slot, subir el budget.
     * `undefined` cuando no hubo fallback o el provider no expone `usage`.
     */
    firstPassReasoningTokens?: number;
    /**
     * `finishReason` del PRIMER pase fallido (típicamente `'length'`). Se
     * captura solo cuando el auto-fallback se activa — antes esta señal se
     * perdía porque `meta.finishReason` reflejaba el segundo pase exitoso.
     */
    firstPassFinishReason?: string;
    /**
     * `true` si hubo un reintento al MISMO `reasoningEffort` antes de degradar.
     * Cubre el caso de JSON no parseable (el getter `experimental_output`
     * lanza `NoObjectGeneratedError`, que `safeOutput` traga FUERA de
     * `withRetry`, así que la rama retryable de `retry.ts` nunca lo veía).
     */
    retriedSameEffort?: boolean;
    /**
     * `true` si el resultado se generó con effort degradado. Alias semántico de
     * `fallbackUsed` pensado para consumidores de UI: un dictamen `high`
     * entregado en modo `low` NO es de calidad plena.
     */
    degraded: boolean;
  };
}

/** Id del modelo detrás de un `LanguageModel` del AI SDK (string o instancia). */
function resolveModelId(model: LanguageModel): string {
  if (typeof model === 'string') return model;
  return (model as { modelId?: string }).modelId ?? 'unknown';
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
      { maxAttempts, baseDelayMs: 2000, maxDelayMs: 2000, label: `financial-agent:${agentName}:${effort}`, signal },
    );

  /**
   * Lectura segura de `experimental_output`. AI SDK v6 lo expone como GETTER
   * que LANZA `NoOutputGeneratedError` cuando el output interno es null
   * (ver node_modules/ai/dist/index.js L4886-4898). Tocar el getter sin
   * try/catch hacia escapar el error antes de que llegáramos a nuestro
   * auto-fallback — el bug Pass-1 "No output generated" observado en prod
   * tras Wave 2 (2026-05-12/13) era exactamente esto.
   */
  const safeOutput = (r: unknown): unknown => {
    try {
      return (r as { experimental_output?: unknown }).experimental_output;
    } catch {
      return null;
    }
  };

  /** `true` si el pase no produjo output utilizable (bug length / stop vacío). */
  const isEmptyPass = (r: Awaited<ReturnType<typeof runPass>>): boolean => {
    const out = safeOutput(r);
    if (out !== undefined && out !== null) return false;
    // Tras Wave 2 la detección incluye finishReason='stop' con output null — el
    // reasoning model puede agotar el budget interno sin marcar 'length'.
    return r.finishReason === 'length' || r.finishReason === 'stop';
  };

  const passDiagnostics = (r: Awaited<ReturnType<typeof runPass>>) => {
    const usage = (r as unknown as { usage?: Record<string, number | undefined> }).usage ?? {};
    return { reasoningTokens: usage.reasoningTokens, finishReason: r.finishReason };
  };

  let result = await runPass(reasoningEffort);
  let fallbackUsed = false;
  let retriedSameEffort = false;
  // Captura del PRIMER pase fallido. Antes se perdía esta señal porque
  // `result` quedaba sobrescrito por el segundo pase. Es el indicador
  // diagnóstico clave (cuánto reasoning consumió GPT-5 antes de morir con
  // finish_reason=length).
  let firstPassMeta: { reasoningTokens?: number; finishReason: string } | null = null;

  if (isEmptyPass(result)) {
    firstPassMeta = passDiagnostics(result);

    console.warn(
      `[callFinancialAgent:${agentName}] sin output con effort=${reasoningEffort} ` +
        `(finishReason=${firstPassMeta.finishReason}, reasoningTokens=${firstPassMeta.reasoningTokens ?? 'n/a'}).`,
    );

    // Un output vacío tiene DOS causas distintas y merecen respuestas distintas:
    //
    //  - `finishReason='length'`: el reasoning se comió el budget. Repetir al
    //    mismo effort volvería a chocar contra el mismo techo — solo quemaría
    //    otro pase de 60-180s y su costo. Se degrada de una.
    //  - `finishReason='stop'` con output null: típicamente JSON no parseable.
    //    `safeOutput` se traga ese `NoObjectGeneratedError` FUERA de `withRetry`,
    //    así que la rama retryable de retry.ts nunca lo veía y el agente se
    //    degradaba por un fallo transitorio. Aquí sí vale reintentar al MISMO
    //    effort antes de bajar la calidad.
    if (firstPassMeta.finishReason !== 'length') {
      console.warn(
        `[callFinancialAgent:${agentName}] reintentando al MISMO effort antes de degradar.`,
      );
      result = await runPass(reasoningEffort);
      retriedSameEffort = true;
    }

    // Solo si seguimos sin output degradamos a 'low' (libera ~8K tokens
    // internos para output). Bajar desde 'low' o 'minimal' no aporta nada.
    if (isEmptyPass(result) && (reasoningEffort === 'medium' || reasoningEffort === 'high')) {
      const message =
        `El agente "${agentName}" no pudo generar salida con effort=${reasoningEffort} ` +
        `y esta sección se generó con razonamiento reducido (effort='low'). ` +
        `Revísela antes de firmarla.`;
      console.warn(`[callFinancialAgent:${agentName}] auto-fallback a effort='low'. ${message}`);
      result = await runPass('low');
      fallbackUsed = true;
      // El aviso se emite aunque el pase 'low' termine fallando: el caller ya
      // sabe que hubo degradación. Nunca dejamos que un callback de UI tumbe
      // el pipeline.
      try {
        opts.onDegraded?.({ agentName, requestedEffort: reasoningEffort, message });
      } catch (err) {
        console.error(`[callFinancialAgent:${agentName}] onDegraded lanzó:`, err);
      }
    }
  }

  assertFinishedCleanlyOrThrow(result, agentName);

  const rawOutput = safeOutput(result);
  if (rawOutput === undefined || rawOutput === null) {
    throw new Error(
      `callFinancialAgent[${agentName}]: experimental_output vacío ` +
        `(finishReason=${result.finishReason}, fallbackUsed=${fallbackUsed}). ` +
        `Probable causa: prompt + bindingTotals demasiado grande para el budget del slot, ` +
        `o el modelo emitió JSON no parseable. Subir maxOutputTokens del slot o simplificar prompt.`,
    );
  }

  // Validación explícita contra el schema Zod — defensa en profundidad sobre
  // la validación del AI SDK. Un output que no cumpla el contrato debe fallar
  // AQUÍ con issues accionables, nunca propagarse río abajo con un cast ciego.
  const parsed = schema.safeParse(rawOutput);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join(' | ');
    throw new Error(
      `callFinancialAgent[${agentName}]: output del LLM no cumple el schema Zod ` +
        `(finishReason=${result.finishReason}, fallbackUsed=${fallbackUsed}). Issues: ${issues}`,
    );
  }
  const json = parsed.data as z.infer<TSchema>;

  // Telemetría — los nombres exactos en `usage` dependen del provider;
  // accedemos con optional chaining sobre `unknown` para no acoplar a versiones.
  const usage = (result as unknown as { usage?: Record<string, number | undefined> }).usage ?? {};

  const meta: CallFinancialAgentResult<TSchema>['meta'] = {
    agentName,
    modelId: resolveModelId(model),
    finishReason: result.finishReason,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    cachedInputTokens: usage.cachedInputTokens,
    elapsedMs: Date.now() - t0,
    fallbackUsed,
    firstPassReasoningTokens: firstPassMeta?.reasoningTokens,
    firstPassFinishReason: firstPassMeta?.finishReason,
    retriedSameEffort,
    degraded: fallbackUsed,
  };

  // Persistencia de telemetría — se cablea AQUÍ, no en los ~40 callsites: es el
  // único punto por el que pasan todas las llamadas LLM del pipeline. Sin esto
  // la tabla `agent_telemetry` quedaba vacía y las alertas de
  // docs/TELEMETRY.md (fallback >3%, finishReason!=stop >1%, costo >$50/día)
  // se evaluaban sobre cero filas.
  //
  // Fire-and-forget de verdad: import dinámico (no arrastramos `pg` al grafo de
  // módulos de quien solo importa el runtime), promesa sin `await` y `catch`
  // final — ni la latencia ni los fallos de DB tocan el pipeline.
  const telemetryTask = (async () => {
    try {
      const { persistAgentTelemetry } = await import('@/lib/db/telemetry');
      await persistAgentTelemetry({
        workspaceId: opts.workspaceId ?? null,
        reportId: opts.reportId ?? null,
        agentName: meta.agentName,
        modelId: meta.modelId,
        inputTokens: meta.inputTokens ?? null,
        outputTokens: meta.outputTokens ?? null,
        reasoningTokens: meta.reasoningTokens ?? null,
        cachedInputTokens: meta.cachedInputTokens ?? null,
        elapsedMs: meta.elapsedMs,
        finishReason: meta.finishReason,
        fallbackUsed: meta.fallbackUsed,
        firstPassReasoningTokens: meta.firstPassReasoningTokens ?? null,
        firstPassFinishReason: meta.firstPassFinishReason ?? null,
      });
    } catch (err) {
      console.error(`[callFinancialAgent:${agentName}] telemetría no persistida:`, err);
    }
  })();

  // En Vercel la instancia puede evictarse en cuanto la respuesta termina y el
  // insert quedaría a medias. `waitUntil` lo mantiene vivo SIN bloquear el
  // return. Fuera de Vercel (dev, tests) el import falla y seguimos con el
  // fire-and-forget puro.
  void (async () => {
    try {
      const { waitUntil } = await import('@vercel/functions');
      waitUntil(telemetryTask);
    } catch {
      /* entorno sin runtime Vercel — la promesa igual se resuelve sola. */
    }
  })();

  opts.onTelemetry?.(meta);

  return { json, meta };
}
