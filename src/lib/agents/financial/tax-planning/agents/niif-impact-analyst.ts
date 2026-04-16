// ---------------------------------------------------------------------------
// Agente 2: Analista de Impacto NIIF (Tax Restructuring Effects)
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { MODELS } from '@/lib/config/models';
import { buildNiifImpactPrompt } from '../prompts/niif-impact.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { CompanyInfo } from '../../types';
import type {
  TaxOptimizerResult,
  NiifImpactResult,
  TaxPlanningProgressEvent,
} from '../types';

/**
 * Takes the Tax Optimizer output and evaluates NIIF implications of each
 * proposed strategy — deferred tax, disclosure requirements, and statement effects.
 */
export async function runNiifImpactAnalyst(
  taxOptimizerOutput: TaxOptimizerResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: TaxPlanningProgressEvent) => void,
): Promise<NiifImpactResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const systemPrompt = buildNiifImpactPrompt(company, language);

  const userContent = [
    '=== ANALISIS DEL OPTIMIZADOR TRIBUTARIO (Agente 1) ===',
    '',
    taxOptimizerOutput.fullContent,
  ].join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 2,
    detail: 'Evaluando impacto NIIF de cada estrategia tributaria...',
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
    { label: 'niif_impact_analyst', maxAttempts: 3 },
  );

  const fullContent = response.choices[0].message.content || '';

  const sections = parseSections(fullContent);

  return {
    impactAssessment:
      sections['1. EVALUACION DE IMPACTO NIIF POR ESTRATEGIA'] || sections['1'] || '',
    deferredTaxImplications:
      sections['2. IMPLICACIONES DE IMPUESTO DIFERIDO (NIC 12)'] || sections['2'] || '',
    disclosureRequirements:
      sections['3. REQUISITOS DE REVELACION Y PRESENTACION'] || sections['3'] || '',
    financialStatementEffects:
      sections['4. EFECTOS EN ESTADOS FINANCIEROS'] || sections['4'] || '',
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
