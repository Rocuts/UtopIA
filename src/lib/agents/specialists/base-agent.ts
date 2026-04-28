// ---------------------------------------------------------------------------
// Base specialist agent — shared tool-calling loop with retry & resilience
// ---------------------------------------------------------------------------
// Migrado a AI SDK v6 (Vercel AI Gateway). Conserva el loop manual con
// MAX_TOOL_ROUNDS, retry y semánticas de onStreamToken / abortSignal.
//
// Decisión: las tools del registry NO traen `execute`. Eso significa que
// `generateText` / `streamText` devuelven `toolCalls` sin invocarlas — el loop
// de aquí abajo las despacha manualmente vía `executeTool(name, args, ctx)`,
// inyectando el `ToolExecContext` por-llamada (documentos cargados, ERP, etc.).
// Es la mejor regresión-cero respecto al loop original con `openai`.
// ---------------------------------------------------------------------------

import { generateText, streamText, type ModelMessage, type ToolResultPart } from 'ai';
import { executeTool, getToolsForAgent, type AgentName, type ToolExecContext } from '@/lib/agents/tools/registry';
import { withRetry } from '@/lib/agents/utils/retry';
import { MODELS } from '@/lib/config/models';
import { DOCUMENT_MAX_CHARS } from '@/lib/validation/schemas';
import type { SpecialistContext, SpecialistResult, ProgressEvent } from '@/lib/agents/types';

const MAX_TOOL_ROUNDS = 6;

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
   * Manages el tool-calling loop manualmente con retry sobre fallos transitorios.
   *
   * Cuando `ctx.onStreamToken` está provisto Y este especialista es el único
   * responsable (sin synthesizer downstream), su completación final post-tools
   * se streamea token-a-token a través del callback.
   */
  async execute(query: string, ctx: SpecialistContext): Promise<SpecialistResult> {
    const tools = getToolsForAgent(this.name);
    const systemPrompt = this.buildSystemPrompt(ctx);

    // Inject uploaded document content so the specialist always has access to it.
    // Refactor T1+T5: limite unico via DOCUMENT_MAX_CHARS (antes 80_000 hardcoded).
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

    let webSearchUsed = false;
    const webSources: string[] = [];
    let riskAssessment: SpecialistResult['riskAssessment'] | undefined;
    let sanctionCalculation: SpecialistResult['sanctionCalculation'] | undefined;

    const toolExecCtx: ToolExecContext = {
      documentContext: ctx.documentContext,
      erpConnections: ctx.erpConnections,
    };

    const shouldStream = !!ctx.onStreamToken && this.supportsStreaming;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      ctx.abortSignal?.throwIfAborted?.();

      // Cada ronda: una sola "step" del modelo. Sin `stopWhen`, el AI SDK
      // devuelve solo el primer paso — exactamente lo que el loop manual
      // necesita (texto final O un set de tool calls, nunca ambos en la misma
      // ronda).
      let finalText: string;
      let toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;

      if (shouldStream) {
        // Streaming path: streamText() — consumimos textStream para tokens y
        // luego await de toolCalls / text para el cierre de la ronda.
        const result = await withRetry(
          () =>
            Promise.resolve(
              streamText({
                model: MODELS.CHAT,
                messages,
                tools,
                toolChoice: 'auto',
                temperature: 0.1,
                abortSignal: ctx.abortSignal,
              }),
            ),
          { label: `${this.name}_round_${round}_stream`, maxAttempts: 3, signal: ctx.abortSignal },
        );

        let acc = '';
        for await (const delta of result.textStream) {
          ctx.abortSignal?.throwIfAborted?.();
          acc += delta;
          ctx.onStreamToken?.(delta);
        }

        toolCalls = await result.toolCalls;
        finalText = acc || (await result.text);
      } else {
        // Non-streaming path
        const result = await withRetry(
          () =>
            generateText({
              model: MODELS.CHAT,
              messages,
              tools,
              toolChoice: 'auto',
              temperature: 0.1,
              abortSignal: ctx.abortSignal,
            }),
          { label: `${this.name}_round_${round}`, maxAttempts: 3, signal: ctx.abortSignal },
        );
        toolCalls = result.toolCalls;
        finalText = result.text;
      }

      if (toolCalls.length > 0) {
        // El modelo pidió tools — empujamos el assistant message con los
        // tool-call parts (más texto previo si el modelo emitió razonamiento
        // antes de llamar la tool) y luego un tool message con resultados.
        const assistantParts: Array<
          | { type: 'text'; text: string }
          | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
        > = [];
        if (finalText && finalText.trim()) {
          assistantParts.push({ type: 'text', text: finalText });
        }
        for (const tc of toolCalls) {
          assistantParts.push({
            type: 'tool-call',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: tc.input,
          });
        }
        messages.push({ role: 'assistant', content: assistantParts });

        const toolResultParts: ToolResultPart[] = [];

        for (const toolCall of toolCalls) {
          // `input` viene ya parseado y validado por Zod (no necesita JSON.parse).
          const args = (toolCall.input as Record<string, unknown> | undefined) ?? {};

          ctx.onProgress?.({
            type: 'agent_working',
            agent: this.displayName,
            status: toolCall.toolName,
          } as ProgressEvent);

          try {
            const result = await withRetry(
              () => executeTool(toolCall.toolName, args, toolExecCtx),
              { label: `tool_${toolCall.toolName}`, maxAttempts: 2 },
            );
            toolResultParts.push({
              type: 'tool-result',
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              output: { type: 'text', value: result.content },
            });

            // Collect metadata
            if (result.meta?.webSearchUsed) webSearchUsed = true;
            if (result.meta?.webSources) webSources.push(...result.meta.webSources);
            if (result.meta?.riskAssessment) {
              const ra = result.meta.riskAssessment;
              riskAssessment = {
                level: ra.level,
                score: ra.score,
                factors: ra.factors.map((f) => ({ description: f.description, severity: f.severity })),
                recommendations: ra.recommendations,
              };
            }
            if (result.meta?.sanctionCalculation) {
              const sc = result.meta.sanctionCalculation;
              sanctionCalculation = {
                amount: sc.amount,
                formula: sc.formula,
                article: sc.article,
                explanation: sc.explanation,
              };
            }
          } catch (toolError) {
            console.warn(
              `[${this.name}] Tool ${toolCall.toolName} failed after retries:`,
              toolError instanceof Error ? toolError.message : toolError,
            );
            toolResultParts.push({
              type: 'tool-result',
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              output: {
                type: 'error-text',
                value: `Error al ejecutar ${toolCall.toolName}: ${toolError instanceof Error ? toolError.message : 'error desconocido'}. Intenta responder con la informacion disponible o usa otra herramienta.`,
              },
            });
          }
        }

        messages.push({ role: 'tool', content: toolResultParts });
        continue;
      }

      // Modelo terminó con texto — devolver resultado.
      return {
        content: finalText,
        webSearchUsed,
        webSources: [...new Set(webSources)],
        riskAssessment,
        sanctionCalculation,
      };
    }

    // Safety fallback: max rounds hit, hacer una llamada final sin tools.
    // Stream también el fallback para que el usuario reciba tokens aunque
    // se haya agotado el presupuesto de rondas.
    if (shouldStream) {
      const result = await withRetry(
        () =>
          Promise.resolve(
            streamText({
              model: MODELS.CHAT,
              messages,
              temperature: 0.1,
              abortSignal: ctx.abortSignal,
            }),
          ),
        { label: `${this.name}_final_stream`, maxAttempts: 2, signal: ctx.abortSignal },
      );
      let acc = '';
      for await (const delta of result.textStream) {
        ctx.abortSignal?.throwIfAborted?.();
        acc += delta;
        ctx.onStreamToken?.(delta);
      }
      return {
        content: acc || (await result.text),
        webSearchUsed,
        webSources: [...new Set(webSources)],
        riskAssessment,
        sanctionCalculation,
      };
    }

    const finalResponse = await withRetry(
      () =>
        generateText({
          model: MODELS.CHAT,
          messages,
          temperature: 0.1,
          abortSignal: ctx.abortSignal,
        }),
      { label: `${this.name}_final`, maxAttempts: 2, signal: ctx.abortSignal },
    );

    return {
      content: finalResponse.text,
      webSearchUsed,
      webSources: [...new Set(webSources)],
      riskAssessment,
      sanctionCalculation,
    };
  }
}
