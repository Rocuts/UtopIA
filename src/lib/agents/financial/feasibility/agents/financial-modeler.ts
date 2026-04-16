// ---------------------------------------------------------------------------
// Agente 2: Modelador Financiero (Project Evaluation & Projections)
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { buildFinancialModelerPrompt } from '../prompts/financial-modeler.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { ProjectInfo, MarketAnalysisResult, FinancialModelResult, FeasibilityProgressEvent } from '../types';

/**
 * Takes market analysis from Agent 1 and builds a complete financial model:
 * pro-forma statements, WACC, NPV, IRR, sensitivity analysis, breakeven.
 */
export async function runFinancialModeler(
  marketOutput: MarketAnalysisResult,
  project: ProjectInfo,
  language: 'es' | 'en',
  onProgress?: (event: FeasibilityProgressEvent) => void,
): Promise<FinancialModelResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const systemPrompt = buildFinancialModelerPrompt(project, language);

  const userContent = [
    'ANALISIS DE MERCADO GENERADO POR EL ANALISTA DE MERCADO:',
    '',
    marketOutput.fullContent,
  ].join('\n');

  onProgress?.({ type: 'stage_progress', stage: 2, detail: 'Construyendo estados pro-forma y calculando WACC...' });

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
    { label: 'financial_modeler', maxAttempts: 3 },
  );

  const fullContent = response.choices[0].message.content || '';

  const sections = parseSections(fullContent);

  return {
    proFormaStatements: sections['1. ESTADOS FINANCIEROS PRO-FORMA'] || sections['1'] || '',
    capitalStructure: sections['2. ESTRUCTURA DE CAPITAL Y WACC'] || sections['2'] || '',
    projectEvaluation: sections['3. EVALUACION DEL PROYECTO'] || sections['3'] || '',
    sensitivityAnalysis: sections['4. ANALISIS DE SENSIBILIDAD Y ESCENARIOS'] || sections['4'] || '',
    breakEvenAnalysis: sections['5. PUNTO DE EQUILIBRIO'] || sections['5'] || '',
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
