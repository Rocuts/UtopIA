// ---------------------------------------------------------------------------
// Base specialist agent — shared tool-calling loop
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { executeTool, getToolsForAgent, type AgentName, type ToolExecContext } from '@/lib/agents/tools/registry';
import type { SpecialistContext, SpecialistResult, ProgressEvent } from '@/lib/agents/types';

const MAX_TOOL_ROUNDS = 6;

export abstract class BaseSpecialist {
  abstract readonly name: AgentName;
  abstract readonly displayName: string;

  /** Build the system prompt for this specialist */
  abstract buildSystemPrompt(ctx: SpecialistContext): string;

  /**
   * Run the specialist on a query within the given context.
   * Manages the OpenAI tool-calling loop internally.
   */
  async execute(query: string, ctx: SpecialistContext): Promise<SpecialistResult> {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const tools = getToolsForAgent(this.name);
    const systemPrompt = this.buildSystemPrompt(ctx);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      // Include recent conversation for context (last 6 messages max)
      ...ctx.conversationHistory.slice(-6).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: query },
    ];

    let webSearchUsed = false;
    const webSources: string[] = [];
    let riskAssessment: SpecialistResult['riskAssessment'] | undefined;
    let sanctionCalculation: SpecialistResult['sanctionCalculation'] | undefined;

    const toolExecCtx: ToolExecContext = { documentContext: ctx.documentContext };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.1,
      });

      const choice = response.choices[0];

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
            const result = await executeTool(toolCall.function.name, args, toolExecCtx);
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
          } catch {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error al ejecutar ${toolCall.function.name}. Informa al usuario que hubo un problema tecnico.`,
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

    // Safety fallback: max rounds hit, do one final call without tools
    const finalResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.1,
    });

    return {
      content: finalResponse.choices[0].message.content || '',
      webSearchUsed,
      webSources: [...new Set(webSources)],
      riskAssessment,
      sanctionCalculation,
    };
  }
}
