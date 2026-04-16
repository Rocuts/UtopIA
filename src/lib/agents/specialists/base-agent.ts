// ---------------------------------------------------------------------------
// Base specialist agent — shared tool-calling loop with retry & resilience
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { executeTool, getToolsForAgent, type AgentName, type ToolExecContext } from '@/lib/agents/tools/registry';
import { withRetry } from '@/lib/agents/utils/retry';
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
   * Manages the OpenAI tool-calling loop internally with retry on transient failures.
   *
   * When `ctx.onStreamToken` is provided AND this specialist is the sole responder
   * (no downstream synthesizer), its final, post-tool-calls completion is streamed
   * token-by-token through the callback.
   */
  async execute(query: string, ctx: SpecialistContext): Promise<SpecialistResult> {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const tools = getToolsForAgent(this.name);
    const systemPrompt = this.buildSystemPrompt(ctx);

    // Inject uploaded document content so the specialist always has access to it
    const docInjection: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (ctx.documentContext && ctx.documentContext.trim()) {
      const DOC_PREVIEW_LIMIT = 30_000;
      const truncated = ctx.documentContext.length > DOC_PREVIEW_LIMIT;
      const preview = truncated
        ? ctx.documentContext.slice(0, DOC_PREVIEW_LIMIT)
        : ctx.documentContext;
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

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...docInjection,
      // Include recent conversation for context (last 10 messages)
      ...ctx.conversationHistory.slice(-10).map((m) => ({
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

      let choice: OpenAI.Chat.Completions.ChatCompletion['choices'][number];

      if (shouldStream) {
        // Streaming path — stream tokens AND accumulate tool_calls if present.
        // Tool-call rounds won't emit content deltas; only the final answer streams to the user.
        const streamResp = await withRetry(
          () =>
            openai.chat.completions.create(
              {
                model: 'gpt-4o-mini',
                messages,
                tools,
                tool_choice: 'auto',
                temperature: 0.1,
                stream: true,
              },
              { signal: ctx.abortSignal },
            ),
          { label: `${this.name}_round_${round}_stream`, maxAttempts: 3, signal: ctx.abortSignal },
        );

        let acc = '';
        let finishReason: OpenAI.Chat.Completions.ChatCompletion['choices'][number]['finish_reason'] | null = null;
        // Partial tool_call objects keyed by index (OpenAI delta format).
        const toolCallAcc: Record<number, {
          id?: string;
          type: 'function';
          function: { name: string; arguments: string };
        }> = {};

        for await (const chunk of streamResp) {
          ctx.abortSignal?.throwIfAborted?.();
          const delta = chunk.choices[0]?.delta;
          const fr = chunk.choices[0]?.finish_reason;
          if (fr) finishReason = fr;

          if (delta?.content) {
            acc += delta.content;
            ctx.onStreamToken?.(delta.content);
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallAcc[idx]) {
                toolCallAcc[idx] = {
                  id: tc.id,
                  type: 'function',
                  function: { name: '', arguments: '' },
                };
              }
              if (tc.id) toolCallAcc[idx].id = tc.id;
              if (tc.function?.name) toolCallAcc[idx].function.name += tc.function.name;
              if (tc.function?.arguments) toolCallAcc[idx].function.arguments += tc.function.arguments;
            }
          }
        }

        const aggregatedToolCalls = Object.keys(toolCallAcc)
          .map(k => toolCallAcc[Number(k)])
          .filter(tc => tc.id && tc.function.name);

        choice = {
          index: 0,
          finish_reason: finishReason ?? (aggregatedToolCalls.length > 0 ? 'tool_calls' : 'stop'),
          logprobs: null,
          message: {
            role: 'assistant',
            content: acc || null,
            refusal: null,
            tool_calls: aggregatedToolCalls.length > 0
              ? aggregatedToolCalls.map(tc => ({
                  id: tc.id!,
                  type: 'function' as const,
                  function: { name: tc.function.name, arguments: tc.function.arguments },
                }))
              : undefined,
          } as OpenAI.Chat.Completions.ChatCompletionMessage,
        };
      } else {
        // Non-streaming path (unchanged)
        const response = await withRetry(
          () =>
            openai.chat.completions.create(
              {
                model: 'gpt-4o-mini',
                messages,
                tools,
                tool_choice: 'auto',
                temperature: 0.1,
              },
              { signal: ctx.abortSignal },
            ),
          { label: `${this.name}_round_${round}`, maxAttempts: 3, signal: ctx.abortSignal },
        );
        choice = response.choices[0];
      }

      if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
        messages.push(choice.message);

        for (const toolCall of choice.message.tool_calls) {
          if (toolCall.type !== 'function') continue;

          let args: Record<string, unknown>;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Error: Invalid tool arguments.',
            });
            continue;
          }

          ctx.onProgress?.({
            type: 'agent_working',
            agent: this.displayName,
            status: toolCall.function.name,
          } as ProgressEvent);

          try {
            const result = await withRetry(
              () => executeTool(toolCall.function.name, args, toolExecCtx),
              { label: `tool_${toolCall.function.name}`, maxAttempts: 2 },
            );
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result.content });

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
              `[${this.name}] Tool ${toolCall.function.name} failed after retries:`,
              toolError instanceof Error ? toolError.message : toolError,
            );
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error al ejecutar ${toolCall.function.name}: ${toolError instanceof Error ? toolError.message : 'error desconocido'}. Intenta responder con la informacion disponible o usa otra herramienta.`,
            });
          }
        }
        continue;
      }

      // Model finished — return result
      return {
        content: choice.message.content || '',
        webSearchUsed,
        webSources: [...new Set(webSources)],
        riskAssessment,
        sanctionCalculation,
      };
    }

    // Safety fallback: max rounds hit, do one final call without tools.
    // Stream the fallback too so the user gets tokens even if the model ran out of rounds.
    if (shouldStream) {
      const streamResp = await withRetry(
        () =>
          openai.chat.completions.create(
            {
              model: 'gpt-4o-mini',
              messages,
              temperature: 0.1,
              stream: true,
            },
            { signal: ctx.abortSignal },
          ),
        { label: `${this.name}_final_stream`, maxAttempts: 2, signal: ctx.abortSignal },
      );
      let acc = '';
      for await (const chunk of streamResp) {
        ctx.abortSignal?.throwIfAborted?.();
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          acc += delta;
          ctx.onStreamToken?.(delta);
        }
      }
      return {
        content: acc,
        webSearchUsed,
        webSources: [...new Set(webSources)],
        riskAssessment,
        sanctionCalculation,
      };
    }

    const finalResponse = await withRetry(
      () =>
        openai.chat.completions.create(
          {
            model: 'gpt-4o-mini',
            messages,
            temperature: 0.1,
          },
          { signal: ctx.abortSignal },
        ),
      { label: `${this.name}_final`, maxAttempts: 2, signal: ctx.abortSignal },
    );

    return {
      content: finalResponse.choices[0].message.content || '',
      webSearchUsed,
      webSources: [...new Set(webSources)],
      riskAssessment,
      sanctionCalculation,
    };
  }
}
