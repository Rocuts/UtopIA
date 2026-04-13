// ---------------------------------------------------------------------------
// Synthesizer — merges outputs from multiple specialist agents (T3 only)
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { buildSynthesizerPrompt } from '@/lib/agents/prompts/synthesizer.prompt';
import type { SpecialistResult } from '@/lib/agents/types';

interface SynthesisInput {
  originalQuery: string;
  specialistOutputs: { agent: string; result: SpecialistResult }[];
  language: 'es' | 'en';
}

export async function synthesizeResponses(input: SynthesisInput): Promise<string> {
  const { originalQuery, specialistOutputs, language } = input;

  // Build the specialist output blocks
  const blocks = specialistOutputs
    .map((so) => `[${so.agent.toUpperCase()} AGENT]:\n${so.result.content}`)
    .join('\n\n---\n\n');

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: buildSynthesizerPrompt(language) },
      {
        role: 'user',
        content: `Original user query: ${originalQuery}

Specialist outputs:

${blocks}`,
      },
    ],
    temperature: 0.1,
    max_tokens: 4096,
  });

  return response.choices[0].message.content || '';
}
