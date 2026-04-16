// ---------------------------------------------------------------------------
// Agente 1b: Experto en Valoracion por Multiplos de Mercado
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { buildMarketComparablesPrompt } from '../prompts/market-comparables.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { CompanyInfo } from '../../types';
import type { MarketComparablesResult, ValuationProgressEvent } from '../types';

/**
 * Performs a relative valuation using market comparables and multiples.
 */
export async function runMarketComparables(
  financialData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  purpose?: string,
  instructions?: string,
  onProgress?: (event: ValuationProgressEvent) => void,
): Promise<MarketComparablesResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const systemPrompt = buildMarketComparablesPrompt(company, language, purpose);

  const userContent = [
    'DATOS FINANCIEROS PARA VALORACION POR MULTIPLOS:',
    '',
    financialData,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({
    type: 'agent_progress',
    agent: 'comparables',
    detail: 'Seleccionando comparables y calculando multiplos de mercado...',
  });

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.05,
        max_tokens: 8192,
      }),
    { label: 'market_comparables', maxAttempts: 3 },
  );

  const fullContent = response.choices[0].message.content || '';
  const sections = parseSections(fullContent);

  return {
    comparableSelection: sections['1. SELECCION DE COMPARABLES'] || sections['1'] || '',
    multiplesAnalysis: sections['2. ANALISIS DE MULTIPLOS'] || sections['2'] || '',
    impliedValuation: sections['3. VALORACION IMPLICITA'] || sections['3'] || '',
    colombianAdjustments: sections['4. AJUSTES COLOMBIANOS'] || sections['4'] || '',
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
