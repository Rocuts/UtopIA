// ---------------------------------------------------------------------------
// Base specialist agent — ToolLoopAgent (AI SDK v6) wrapper
// ---------------------------------------------------------------------------
// Migrado a ToolLoopAgent (patrón canónico AI SDK v6). El loop manual con
// MAX_TOOL_ROUNDS desapareció: ahora la iteración la maneja el SDK gracias a
// `stopWhen: stepCountIs(20)` (default) y a que cada tool del registry tiene
// su propio `execute`.
//
// Per-request context (`ToolExecContext` con documentos cargados, conexiones
// ERP) viaja vía `experimental_context`: ToolLoopAgent lo inyecta a `options`
// de cada tool execute. Por eso construimos un nuevo `ToolLoopAgent` por
// llamada (config liviana, no es un coste real) — así cada request ve su
// propio bag y collectors.
//
// La API pública (`BaseSpecialist`, `execute(query, ctx)`, `SpecialistResult`)
// se preserva; orchestrator.ts y synthesizer.ts no requieren cambios.
// ---------------------------------------------------------------------------

import {
  ToolLoopAgent,
  stepCountIs,
  type ModelMessage,
  type Tool,
} from 'ai';
import {
  getToolsForAgent,
  type AgentName,
  type ToolSideEffectSink,
  type ToolRuntimeBag,
} from '@/lib/agents/tools/registry';
import { withRetry } from '@/lib/agents/utils/retry';
import { MODELS } from '@/lib/config/models';
import { DOCUMENT_MAX_CHARS } from '@/lib/validation/schemas';
import { agentStepLogger } from '@/lib/observability/agent-logger';
import type { SpecialistContext, SpecialistResult, ProgressEvent } from '@/lib/agents/types';

/**
 * Step ceiling for ToolLoopAgent. Más generoso que el viejo MAX_TOOL_ROUNDS=6
 * porque cada step es a la vez (texto final | tool call), no una "ronda" del
 * loop manual. 20 es el default oficial del SDK; lo dejamos explícito para
 * documentar la intención.
 */
const MAX_AGENT_STEPS = 20;

export abstract class BaseSpecialist {
  abstract readonly name: AgentName;
  abstract readonly displayName: string;

  /** Build the system prompt for this specialist */
  abstract buildSystemPrompt(ctx: SpecialistContext): string;

  /** Whether this specialist should stream its final reply to the caller. */
  get supportsStreaming(): boolean {
    return true;
  }

  /**
   * Run the specialist on a query within the given context.
   *
   * Internamente:
   * - Construye el set de tools para este especialista (vía registry, ya con
   *   `execute` enlazado al dispatcher central).
   * - Crea un `ToolLoopAgent` per-call con `experimental_context` que lleva
   *   el `ToolExecContext` y un `sink` para metadatos accesorios (web sources,
   *   risk, sanction).
   * - Si `ctx.onStreamToken` está provisto Y el agente soporta streaming,
   *   usa `agent.stream()` y bombea tokens; si no, `agent.generate()`.
   * - `onStepFinish` dispara progreso al UI (`agent_working` con tool name) y
   *   telemetría estructurada (`agent-logger.ts`).
   */
  async execute(query: string, ctx: SpecialistContext): Promise<SpecialistResult> {
    const tools = getToolsForAgent(this.name);
    const systemPrompt = this.buildSystemPrompt(ctx);

    // Inject uploaded document content so the specialist always has access to it.
    const docInjection: ModelMessage[] = [];
    if (ctx.documentContext && ctx.documentContext.trim()) {
      const truncated = ctx.documentContext.length > DOCUMENT_MAX_CHARS;
      const preview = truncated
        ? ctx.documentContext.slice(0, DOCUMENT_MAX_CHARS)
        : ctx.documentContext;
      if (truncated) {
        console.warn(
          `[base-agent:${this.name}] documento truncado de ${ctx.documentContext.length} a ${DOCUMENT_MAX_CHARS} chars (DOCUMENT_MAX_CHARS)`,
        );
      }
      docInjection.push({
        role: 'system',
        content:
          'DOCUMENTO CARGADO POR EL USUARIO — CONTENIDO EXTRAIDO:\n' +
          'El usuario ha subido un documento. A continuacion se encuentra el texto extraido. ' +
          'DEBES usar esta informacion para responder cualquier pregunta sobre el documento. ' +
          'Para un analisis estructurado (cifras, riesgos, articulos), usa analyze_document.\n\n' +
          preview +
          (truncated
            ? '\n\n[... documento truncado. Usa analyze_document para el analisis completo ...]'
            : ''),
      });
    }

    const messages: ModelMessage[] = [
      { role: 'system', content: systemPrompt },
      ...docInjection,
      // Include recent conversation for context (last 10 messages)
      ...ctx.conversationHistory.slice(-10).map<ModelMessage>((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: query },
    ];

    // Side-effect collector. Lives en el `experimental_context` y es mutado
    // por los `execute` de cada tool en `registry.ts`.
    const sink: ToolSideEffectSink = {
      webSearchUsed: false,
      webSources: [],
    };
    const runtimeBag: ToolRuntimeBag = {
      ctx: {
        documentContext: ctx.documentContext,
        erpConnections: ctx.erpConnections,
      },
      sink,
    };

    const stepLogger = agentStepLogger({ agent: this.name });

    // ToolLoopAgent per-call. La construcción es config plana — no incurre
    // en coste de runtime real.
    const agent = new ToolLoopAgent<never, Record<string, Tool>>({
      model: MODELS.CHAT,
      tools,
      stopWhen: stepCountIs(MAX_AGENT_STEPS),
      temperature: 0.1,
      experimental_context: runtimeBag,
      onStepFinish: (event) => {
        // 1) Progress: emite `agent_working` por cada tool invocada en el step.
        for (const call of event.toolCalls ?? []) {
          ctx.onProgress?.({
            type: 'agent_working',
            agent: this.displayName,
            status: call.toolName,
          } as ProgressEvent);
        }
        // 2) Telemetría estructurada (latencia, tokens, finishReason).
        try {
          stepLogger(event);
        } catch {
          /* never break the agent loop on logger error */
        }
      },
    });

    const shouldStream = !!ctx.onStreamToken && this.supportsStreaming;

    try {
      if (shouldStream) {
        const result = await withRetry(
          () =>
            Promise.resolve(
              agent.stream({
                messages,
                abortSignal: ctx.abortSignal,
              }),
            ),
          { label: `${this.name}_stream`, maxAttempts: 3, signal: ctx.abortSignal },
        );

        let acc = '';
        for await (const delta of result.textStream) {
          ctx.abortSignal?.throwIfAborted?.();
          if (delta) {
            acc += delta;
            ctx.onStreamToken?.(delta);
          }
        }

        // Si por la razón que sea el textStream quedó vacío (p. ej. el modelo
        // terminó tras una secuencia de tool calls sin texto final), recurrimos
        // a `result.text` que ya está resuelto por el SDK.
        const finalText = acc || (await result.text);

        return buildSpecialistResult(finalText, sink);
      }

      const result = await withRetry(
        () =>
          agent.generate({
            messages,
            abortSignal: ctx.abortSignal,
          }),
        { label: `${this.name}_generate`, maxAttempts: 3, signal: ctx.abortSignal },
      );

      return buildSpecialistResult(result.text, sink);
    } catch (err) {
      console.error(
        `[base-agent:${this.name}] agent execution failed:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }
}

function buildSpecialistResult(content: string, sink: ToolSideEffectSink): SpecialistResult {
  return {
    content,
    webSearchUsed: sink.webSearchUsed,
    webSources: [...new Set(sink.webSources)],
    riskAssessment: sink.riskAssessment
      ? {
          level: sink.riskAssessment.level,
          score: sink.riskAssessment.score,
          factors: sink.riskAssessment.factors.map((f) => ({
            description: f.description,
            severity: f.severity,
          })),
          recommendations: sink.riskAssessment.recommendations,
        }
      : undefined,
    sanctionCalculation: sink.sanctionCalculation
      ? {
          amount: sink.sanctionCalculation.amount,
          formula: sink.sanctionCalculation.formula,
          article: sink.sanctionCalculation.article,
          explanation: sink.sanctionCalculation.explanation,
        }
      : undefined,
  };
}
