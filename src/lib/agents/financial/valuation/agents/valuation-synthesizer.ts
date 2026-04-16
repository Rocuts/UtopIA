// ---------------------------------------------------------------------------
// Agente 2: Sintetizador de Valoracion (Valuation Partner)
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { MODELS } from '@/lib/config/models';
import { buildValuationSynthesizerPrompt } from '../prompts/valuation-synthesizer.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { CompanyInfo } from '../../types';
import type { ValuationSynthesisResult, ValuationProgressEvent } from '../types';

/**
 * Synthesizes DCF and market comparables outputs into a consolidated valuation opinion.
 */
export async function runValuationSynthesizer(
  dcfContent: string,
  comparablesContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  purpose?: string,
  onProgress?: (event: ValuationProgressEvent) => void,
): Promise<ValuationSynthesisResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const systemPrompt = buildValuationSynthesizerPrompt(company, language, purpose);

  const userContent = `INFORME DEL MODELADOR DCF:

${dcfContent}

---

INFORME DEL EXPERTO EN MULTIPLOS DE MERCADO:

${comparablesContent}`;

  onProgress?.({
    type: 'agent_progress',
    agent: 'synthesizer',
    detail: 'Ponderando metodologias y construyendo opinion de valor consolidada...',
  });

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: MODELS.FINANCIAL_PIPELINE,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.05,
        max_tokens: 8192,
      }),
    { label: 'valuation_synthesizer', maxAttempts: 3 },
  );

  const fullContent = response.choices[0].message.content || '';
  const sections = parseSections(fullContent);

  return {
    methodologyWeighting: sections['1. PONDERACION DE METODOLOGIAS'] || sections['1'] || '',
    valueRange: sections['2. RANGO DE VALORACION CONSOLIDADO'] || sections['2'] || '',
    keyAssumptions: sections['3. SUPUESTOS CLAVE Y SENSIBILIDADES'] || sections['3'] || '',
    limitations: sections['4. LIMITACIONES Y ADVERTENCIAS'] || sections['4'] || '',
    executiveSummary: sections['5. RESUMEN EJECUTIVO'] || sections['5'] || '',
    fullContent,
  };
}

/**
 * Parse numbered `## N. TITLE` sections from Markdown content.
 */
function parseSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const pattern = /^##\s+(\d+\.?\s*[^\n]*)/gm;
  const matches = [...content.matchAll(pattern)];

  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : content.length;
    sections[key] = content.slice(start, end).trim();
    const numMatch = key.match(/^(\d+)/);
    if (numMatch) sections[numMatch[1]] = sections[key];
  }

  return sections;
}
