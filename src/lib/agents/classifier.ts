// ---------------------------------------------------------------------------
// Query classifier — determines cost tier (T1/T2/T3) and domain(s)
// ---------------------------------------------------------------------------

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { buildClassifierPrompt } from '@/lib/agents/prompts/classifier.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { MODELS } from '@/lib/config/models';
import type { QueryClassification, CostTier, AgentDomain } from '@/lib/agents/types';

// Schema validado por el modelo vía JSON mode nativo del AI SDK.
// Más confiable que pedir "Respond ONLY with valid JSON" en el prompt.
const classificationSchema = z.object({
  tier: z.enum(['T1', 'T2', 'T3']),
  domains: z.array(z.enum(['tax', 'accounting', 'documents', 'strategy'])),
  intent: z.string(),
  confidence: z.number().min(0).max(1),
});

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
  hasDocument: boolean = false,
): Promise<QueryClassification> {
  // Fast path: obvious greetings / confirmations
  if (isObviousT1(userMessage)) {
    return { tier: 'T1', domains: [], intent: 'greeting_or_confirmation', confidence: 0.99 };
  }

  const recentContext = conversationHistory
    .slice(-4)
    .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
    .join('\n');

  try {
    const result = await withRetry(
      () =>
        generateText({
          model: MODELS.CLASSIFIER,
          messages: [
            { role: 'system', content: buildClassifierPrompt(hasDocument) },
            {
              role: 'user',
              content: `Use case hint: ${useCase || 'none'}
Document attached this turn: ${hasDocument ? 'YES' : 'NO'}

Recent conversation:
${recentContext || '(new conversation)'}

Current user message:
${userMessage}`,
            },
          ],
          temperature: 0,
          maxOutputTokens: 150,
          experimental_output: Output.object({ schema: classificationSchema }),
        }),
      { label: 'classifier', maxAttempts: 3 },
    );

    // `experimental_output` ya viene validado contra el schema Zod.
    // Si el modelo devolvió algo inválido, withRetry lo reintenta y el catch
    // de abajo atrapa el fallo definitivo.
    const parsed = result.experimental_output;

    // T2/T3 deben tener al menos un dominio (safety net por si el modelo
    // devuelve domains=[] para una query no-T1).
    const domains: AgentDomain[] =
      parsed.tier !== 'T1' && parsed.domains.length === 0 ? ['tax'] : parsed.domains;

    return {
      tier: parsed.tier as CostTier,
      domains,
      intent: parsed.intent,
      confidence: parsed.confidence,
    };
  } catch (err) {
    console.warn('[classifier] failed after retries:', err instanceof Error ? err.message : err);
    return { tier: 'T2', domains: ['tax'] as AgentDomain[], intent: 'classifier_error_fallback', confidence: 0.3 };
  }
}
