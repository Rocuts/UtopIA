// ---------------------------------------------------------------------------
// Query classifier — determines cost tier (T1/T2/T3) and domain(s)
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { CLASSIFIER_PROMPT } from '@/lib/agents/prompts/classifier.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { QueryClassification, CostTier, AgentDomain } from '@/lib/agents/types';

// ---------------------------------------------------------------------------
// Regex pre-filter: skip LLM entirely for obvious T1 messages
// ---------------------------------------------------------------------------

const T1_PATTERNS = [
  /^(hola|buenas?\s*(tardes|noches|dias)?|hey|hello|hi)\s*[!.,]?\s*$/i,
  /^(gracias|muchas\s+gracias|thanks|thank\s+you|thx)\s*[!.,]?\s*$/i,
  /^(ok|okay|entendido|perfecto|listo|claro|de\s+acuerdo|dale|vale)\s*[!.,]?\s*$/i,
  /^(si|no|s[ií]|correcto|exacto|exactamente|asi\s+es)\s*[!.,]?\s*$/i,
  /^(bye|adios|adi[oó]s|chao|hasta\s+luego)\s*[!.,]?\s*$/i,
];

function isObviousT1(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length > 80) return false;
  return T1_PATTERNS.some((p) => p.test(trimmed));
}

// ---------------------------------------------------------------------------
// LLM-based classifier
// ---------------------------------------------------------------------------

export async function classifyQuery(
  userMessage: string,
  conversationHistory: { role: string; content: string }[],
  useCase: string,
): Promise<QueryClassification> {
  // Fast path: obvious greetings / confirmations
  if (isObviousT1(userMessage)) {
    return { tier: 'T1', domains: [], intent: 'greeting_or_confirmation', confidence: 0.99 };
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const recentContext = conversationHistory
    .slice(-4)
    .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
    .join('\n');

  let raw: string;
  try {
    const response = await withRetry(
      () =>
        openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: CLASSIFIER_PROMPT },
            {
              role: 'user',
              content: `Use case hint: ${useCase || 'none'}

Recent conversation:
${recentContext || '(new conversation)'}

Current user message:
${userMessage}`,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: 150,
        }),
      { label: 'classifier', maxAttempts: 3 },
    );
    raw = response.choices[0].message.content || '{}';
  } catch (llmError) {
    console.warn('[classifier] LLM call failed after retries:', llmError instanceof Error ? llmError.message : llmError);
    return { tier: 'T2', domains: ['tax'] as AgentDomain[], intent: 'classifier_error_fallback', confidence: 0.3 };
  }

  try {
    const parsed = JSON.parse(raw) as {
      tier?: string;
      domains?: string[];
      intent?: string;
      confidence?: number;
    };

    const tier = (['T1', 'T2', 'T3'].includes(parsed.tier || '') ? parsed.tier : 'T2') as CostTier;
    const VALID_DOMAINS: Set<string> = new Set(['tax', 'accounting', 'documents', 'strategy']);
    const validDomains = (parsed.domains || []).filter(
      (d): d is AgentDomain => VALID_DOMAINS.has(d),
    );

    // Ensure T2/T3 have at least one domain
    const domains =
      tier !== 'T1' && validDomains.length === 0 ? (['tax'] as AgentDomain[]) : validDomains;

    return {
      tier,
      domains,
      intent: parsed.intent || 'unknown',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
    };
  } catch {
    // Fallback: treat as T2 tax (safe default)
    return { tier: 'T2', domains: ['tax'], intent: 'parse_error_fallback', confidence: 0.5 };
  }
}
