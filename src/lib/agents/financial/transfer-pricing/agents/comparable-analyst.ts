// ---------------------------------------------------------------------------
// Agente 2: Analista de Comparables y Benchmarking
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildComparableAnalystPrompt } from '../prompts/comparable-analyst.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanly } from '../../utils/finish-reason-check';
import type { CompanyInfo } from '../../types';
import type { TPAnalysisResult, ComparableAnalysisResult, TPProgressEvent } from '../types';

/**
 * Takes the TP Analyst output and produces:
 * - Comparable search strategy
 * - Comparability criteria analysis
 * - Selected comparables with justification
 * - Interquartile range calculation
 * - Adjustments applied
 * - Arm's length conclusion
 */
export async function runComparableAnalyst(
  tpAnalysis: TPAnalysisResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: TPProgressEvent) => void,
): Promise<ComparableAnalysisResult> {
  const systemPrompt = buildComparableAnalystPrompt(company, language);

  const userContent = [
    'ANALISIS DE PRECIOS DE TRANSFERENCIA DEL AGENTE ANALISTA:',
    '',
    tpAnalysis.fullContent,
  ].join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 2,
    detail: 'Buscando comparables y calculando rango intercuartil...',
  });

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
    { label: 'comparable_analyst', maxAttempts: 3 },
  );

  assertFinishedCleanly(result, 'comparable_analyst');

  const fullContent = result.text || '';

  const sections = parseSections(fullContent);

  return {
    searchStrategy:
      sections['1. ESTRATEGIA DE BUSQUEDA DE COMPARABLES'] || sections['1'] || '',
    comparabilityCriteria:
      sections['2. CRITERIOS DE COMPARABILIDAD'] || sections['2'] || '',
    selectedComparables:
      sections['3. COMPARABLES SELECCIONADOS'] || sections['3'] || '',
    interquartileRange:
      sections['4. RANGO INTERCUARTIL Y MEDIANA'] || sections['4'] || '',
    adjustmentsApplied:
      sections['5. AJUSTES DE COMPARABILIDAD'] || sections['5'] || '',
    armLengthConclusion:
      sections['6. CONCLUSION SOBRE PLENA COMPETENCIA'] || sections['6'] || '',
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
