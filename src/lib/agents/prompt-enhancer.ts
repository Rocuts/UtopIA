// ---------------------------------------------------------------------------
// Prompt enhancer — transforms raw user queries into top-tier prompts
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { ENHANCER_PROMPT } from '@/lib/agents/prompts/enhancer.prompt';
import { MODELS } from '@/lib/config/models';
import type { NITContext } from '@/lib/security/pii-filter';
import type { QueryClassification, EnhancedQuery, AgentDomain } from '@/lib/agents/types';

export async function enhancePrompt(
  userMessage: string,
  conversationHistory: { role: string; content: string }[],
  classification: QueryClassification,
  nitContext: NITContext | null,
): Promise<EnhancedQuery> {
  const recentContext = conversationHistory
    .slice(-6)
    .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
    .join('\n');

  let nitHint = '';
  if (nitContext) {
    const type = nitContext.presumedType === 'persona_juridica' ? 'persona juridica' : 'persona natural';
    nitHint = `NIT context: last digit ${nitContext.lastDigit}, type ${type}.`;
  }

  let raw = '';
  try {
    const { text } = await generateText({
      model: MODELS.SYNTHESIZER,
      messages: [
        {
          role: 'system',
          content:
            ENHANCER_PROMPT +
            '\n\nRespond ONLY with a valid JSON object. No prose, no markdown, no code fences.',
        },
        {
          role: 'user',
          content: `Classification: tier=${classification.tier}, domains=${classification.domains.join(',')}, intent=${classification.intent}
${nitHint}

Recent conversation:
${recentContext || '(new conversation)'}

User message to enhance:
${userMessage}`,
        },
      ],
      temperature: 0.2,
      maxOutputTokens: 600,
    });
    raw = text;
  } catch (err) {
    // El enhancer es best-effort: si el LLM falla, la consulta T2/T3 sigue
    // con el mensaje original en vez de morir aqui.
    console.warn('[prompt-enhancer] generateText failed, using original message:', err instanceof Error ? err.message : err);
    return { enhanced: userMessage, extractedEntities: {} };
  }

  try {
    const parsed = JSON.parse(raw || '{}') as {
      enhanced?: string;
      extractedEntities?: EnhancedQuery['extractedEntities'];
      subQueries?: { domain?: string; query?: string }[];
    };

    const VALID_DOMAINS: Set<string> = new Set(['tax', 'accounting', 'documents', 'strategy', 'litigation']);
    const subQueries =
      classification.tier === 'T3' && parsed.subQueries
        ? parsed.subQueries
            .filter((sq): sq is { domain: string; query: string } =>
              Boolean(sq.domain && sq.query && VALID_DOMAINS.has(sq.domain)),
            )
            .map((sq) => ({ domain: sq.domain as AgentDomain, query: sq.query }))
        : undefined;

    return {
      enhanced: parsed.enhanced || userMessage,
      extractedEntities: parsed.extractedEntities || {},
      subQueries,
    };
  } catch {
    // Fallback: return the original message unchanged
    return { enhanced: userMessage, extractedEntities: {} };
  }
}
