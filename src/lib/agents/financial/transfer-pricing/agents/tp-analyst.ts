// ---------------------------------------------------------------------------
// Agente 1: Analista de Precios de Transferencia
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildTPAnalystPrompt } from '../prompts/tp-analyst.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { CompanyInfo } from '../../types';
import type { TPAnalysisResult, TPProgressEvent } from '../types';

/**
 * Processes raw intercompany transaction data and produces:
 * - Obligation assessment (umbrales Art. 260-1 ET)
 * - Transaction characterization
 * - Functional analysis (FAR)
 * - Method selection with justification
 * - Preliminary pricing analysis
 */
export async function runTPAnalyst(
  rawData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions?: string,
  onProgress?: (event: TPProgressEvent) => void,
): Promise<TPAnalysisResult> {
  const systemPrompt = buildTPAnalystPrompt(company, language);

  const userContent = [
    'DATOS DE TRANSACCIONES INTERCOMPANIA:',
    '',
    rawData,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 1,
    detail: 'Evaluando obligatoriedad y caracterizando transacciones controladas...',
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
    { label: 'tp_analyst', maxAttempts: 3 },
  );

  const fullContent = result.text || '';

  const sections = parseSections(fullContent);

  return {
    obligationAssessment:
      sections['1. EVALUACION DE OBLIGATORIEDAD'] || sections['1'] || '',
    transactionCharacterization:
      sections['2. CARACTERIZACION DE TRANSACCIONES CONTROLADAS'] || sections['2'] || '',
    functionalAnalysis:
      sections['3. ANALISIS FUNCIONAL (FAR)'] || sections['3'] || '',
    methodSelection:
      sections['4. SELECCION DEL METODO DE PRECIOS DE TRANSFERENCIA'] || sections['4'] || '',
    preliminaryPricingAnalysis:
      sections['5. ANALISIS PRELIMINAR DE PRECIOS'] || sections['5'] || '',
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
