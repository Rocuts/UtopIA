// ---------------------------------------------------------------------------
// Synthesizer — merges outputs from multiple specialist agents (T3 only)
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { buildSynthesizerPrompt } from '@/lib/agents/prompts/synthesizer.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { SpecialistResult } from '@/lib/agents/types';

interface SynthesisInput {
  originalQuery: string;
  specialistOutputs: { agent: string; result: SpecialistResult }[];
  language: 'es' | 'en';
  /** Callback for streaming partial content tokens */
  onStreamToken?: (delta: string) => void;
  /** Abort signal to cancel the call */
  abortSignal?: AbortSignal;
}

export async function synthesizeResponses(input: SynthesisInput): Promise<string> {
  const { originalQuery, specialistOutputs, language, onStreamToken, abortSignal } = input;

  // If only one agent responded successfully, skip synthesis.
  // When streaming, we still need to emit the already-accumulated content since
  // the upstream specialist streamed into a different message at the time.
  const validOutputs = specialistOutputs.filter(
    (so) => !so.result.content.includes('no pudo completar el analisis'),
  );
  if (validOutputs.length === 1) {
    const single = validOutputs[0].result.content;
    if (onStreamToken && single) onStreamToken(single);
    return single;
  }

  // Build the specialist output blocks
  const blocks = specialistOutputs
    .map((so) => `[${so.agent.toUpperCase()}]:\n${so.result.content}`)
    .join('\n\n---\n\n');

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    if (onStreamToken) {
      const streamResp = await withRetry(
        () =>
          openai.chat.completions.create(
            {
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: buildSynthesizerPrompt(language) },
                {
                  role: 'user',
                  content: `Original user query: ${originalQuery}\n\nSpecialist outputs:\n\n${blocks}`,
                },
              ],
              temperature: 0.1,
              max_tokens: 4096,
              stream: true,
            },
            { signal: abortSignal },
          ),
        { label: 'synthesizer_stream', maxAttempts: 2, signal: abortSignal },
      );
      let acc = '';
      for await (const chunk of streamResp) {
        abortSignal?.throwIfAborted?.();
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          acc += delta;
          onStreamToken(delta);
        }
      }
      return acc;
    }

    const response = await withRetry(
      () =>
        openai.chat.completions.create(
          {
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: buildSynthesizerPrompt(language) },
              {
                role: 'user',
                content: `Original user query: ${originalQuery}\n\nSpecialist outputs:\n\n${blocks}`,
              },
            ],
            temperature: 0.1,
            max_tokens: 4096,
          },
          { signal: abortSignal },
        ),
      { label: 'synthesizer', maxAttempts: 2, signal: abortSignal },
    );

    return response.choices[0].message.content || '';
  } catch (error) {
    console.warn('[synthesizer] Failed after retries:', error instanceof Error ? error.message : error);
    // Fallback: concatenate outputs with headers instead of failing entirely
    const fallback = specialistOutputs
      .map((so) => `## ${so.agent}\n\n${so.result.content}`)
      .join('\n\n---\n\n');
    if (onStreamToken) onStreamToken(fallback);
    return fallback;
  }
}
