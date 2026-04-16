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
}

export async function synthesizeResponses(input: SynthesisInput): Promise<string> {
  const { originalQuery, specialistOutputs, language } = input;

  // If only one agent responded successfully, skip synthesis
  const validOutputs = specialistOutputs.filter(
    (so) => !so.result.content.includes('no pudo completar el analisis'),
  );
  if (validOutputs.length === 1) {
    return validOutputs[0].result.content;
  }

  // Build the specialist output blocks
  const blocks = specialistOutputs
    .map((so) => `[${so.agent.toUpperCase()}]:\n${so.result.content}`)
    .join('\n\n---\n\n');

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await withRetry(
      () =>
        openai.chat.completions.create({
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
        }),
      { label: 'synthesizer', maxAttempts: 2 },
    );

    return response.choices[0].message.content || '';
  } catch (error) {
    console.warn('[synthesizer] Failed after retries:', error instanceof Error ? error.message : error);
    // Fallback: concatenate outputs with headers instead of failing entirely
    return specialistOutputs
      .map((so) => `## ${so.agent}\n\n${so.result.content}`)
      .join('\n\n---\n\n');
  }
}
