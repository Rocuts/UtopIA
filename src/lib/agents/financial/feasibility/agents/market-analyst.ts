// ---------------------------------------------------------------------------
// Agente 1: Analista de Mercado (Market Research & Sectoral Analysis)
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildMarketAnalystPrompt } from '../prompts/market-analyst.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { ProjectInfo, MarketAnalysisResult, FeasibilityProgressEvent } from '../types';

/**
 * Analyzes market viability: TAM/SAM/SOM, target segment, competitive landscape,
 * demand projections, and regulatory entry barriers for the Colombian market.
 */
export async function runMarketAnalyst(
  projectData: string,
  project: ProjectInfo,
  language: 'es' | 'en',
  instructions?: string,
  onProgress?: (event: FeasibilityProgressEvent) => void,
): Promise<MarketAnalysisResult> {
  const systemPrompt = buildMarketAnalystPrompt(project, language);

  const userContent = [
    'DATOS DEL PROYECTO PARA ANALISIS DE MERCADO:',
    '',
    projectData,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({ type: 'stage_progress', stage: 1, detail: 'Dimensionando mercado y analizando segmento objetivo...' });

  const result = await withRetry(
    () =>
      generateText({
        model: MODELS.FINANCIAL_PIPELINE,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.05,
        maxOutputTokens: 8192,
      }),
    { label: 'market_analyst', maxAttempts: 3 },
  );

  const fullContent = result.text || '';

  const sections = parseSections(fullContent);

  return {
    marketSize: sections['1. DIMENSIONAMIENTO DEL MERCADO'] || sections['1'] || '',
    targetSegment: sections['2. ANALISIS DEL SEGMENTO OBJETIVO'] || sections['2'] || '',
    competitiveLandscape: sections['3. PANORAMA COMPETITIVO'] || sections['3'] || '',
    demandProjections: sections['4. PROYECCIONES DE DEMANDA'] || sections['4'] || '',
    entryBarriers: sections['5. BARRERAS DE ENTRADA Y REQUISITOS REGULATORIOS'] || sections['5'] || '',
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
