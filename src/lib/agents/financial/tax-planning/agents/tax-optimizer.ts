// ---------------------------------------------------------------------------
// Agente 1: Optimizador Tributario (Tax Planning Strategist)
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildTaxOptimizerPrompt } from '../prompts/tax-optimizer.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanly } from '../../utils/finish-reason-check';
import type { CompanyInfo } from '../../types';
import type { TaxOptimizerResult, TaxPlanningProgressEvent } from '../types';

/**
 * Analyzes the company's current tax structure and proposes optimization
 * strategies with projected savings in COP.
 */
export async function runTaxOptimizer(
  rawData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions?: string,
  onProgress?: (event: TaxPlanningProgressEvent) => void,
): Promise<TaxOptimizerResult> {
  const systemPrompt = buildTaxOptimizerPrompt(company, language);

  const userContent = [
    'DATOS FINANCIEROS Y TRIBUTARIOS DE LA EMPRESA:',
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
    detail: 'Analizando estructura tributaria actual y evaluando regimenes...',
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
    { label: 'tax_optimizer', maxAttempts: 3 },
  );

  assertFinishedCleanly(result, 'tax_optimizer');

  const fullContent = result.text || '';

  // Parse sections from the Markdown output
  const sections = parseSections(fullContent);

  return {
    currentStructureAnalysis:
      sections['1. DIAGNOSTICO DE ESTRUCTURA TRIBUTARIA ACTUAL'] || sections['1'] || '',
    optimizationStrategies:
      sections['2. ESTRATEGIAS DE OPTIMIZACION TRIBUTARIA'] || sections['2'] || '',
    projectedSavings:
      sections['3. PROYECCION DE AHORROS'] || sections['3'] || '',
    implementationRoadmap:
      sections['4. HOJA DE RUTA DE IMPLEMENTACION'] || sections['4'] || '',
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
