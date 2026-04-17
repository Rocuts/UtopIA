// ---------------------------------------------------------------------------
// Synthesizer — merges outputs from multiple specialist agents (T3 only)
// ---------------------------------------------------------------------------

import { generateText, streamText } from 'ai';
import { buildSynthesizerPrompt } from '@/lib/agents/prompts/synthesizer.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { MODELS } from '@/lib/config/models';
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

  const messages = [
    { role: 'system' as const, content: buildSynthesizerPrompt(language) },
    {
      role: 'user' as const,
      content: `Original user query: ${originalQuery}\n\nSpecialist outputs:\n\n${blocks}`,
    },
  ];

  try {
    if (onStreamToken) {
      // withRetry solo protege la conexion inicial — si el stream falla a medio
      // camino no reintentamos para no duplicar tokens al cliente. Mismo
      // comportamiento que el codigo OpenAI SDK previo.
      const stream = await withRetry(
        () =>
          Promise.resolve(
            streamText({
              model: MODELS.SYNTHESIZER,
              messages,
              temperature: 0.1,
              maxOutputTokens: 4096,
              abortSignal,
            }),
          ),
        { label: 'synthesizer_stream', maxAttempts: 2, signal: abortSignal },
      );
      let acc = '';
      for await (const delta of stream.textStream) {
        abortSignal?.throwIfAborted?.();
        if (delta) {
          acc += delta;
          onStreamToken(delta);
        }
      }
      return acc;
    }

    const { text } = await withRetry(
      () =>
        generateText({
          model: MODELS.SYNTHESIZER,
          messages,
          temperature: 0.1,
          maxOutputTokens: 4096,
          abortSignal,
        }),
      { label: 'synthesizer', maxAttempts: 2, signal: abortSignal },
    );

    return text || '';
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
