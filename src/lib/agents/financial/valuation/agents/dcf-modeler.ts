// ---------------------------------------------------------------------------
// Agente 1a: Modelador de Flujo de Caja Descontado (DCF)
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { MODELS } from '@/lib/config/models';
import { buildDcfModelerPrompt } from '../prompts/dcf-modeler.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { CompanyInfo } from '../../types';
import type { DcfModelResult, ValuationProgressEvent } from '../types';

/**
 * Builds a DCF model from the financial data and returns enterprise/equity value.
 */
export async function runDcfModeler(
  financialData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  purpose?: string,
  instructions?: string,
  onProgress?: (event: ValuationProgressEvent) => void,
): Promise<DcfModelResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const systemPrompt = buildDcfModelerPrompt(company, language, purpose);

  const userContent = [
    'DATOS FINANCIEROS PARA VALORACION DCF:',
    '',
    financialData,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({
    type: 'agent_progress',
    agent: 'dcf',
    detail: 'Construyendo proyecciones de flujo de caja libre y calculando WACC...',
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
    { label: 'dcf_modeler', maxAttempts: 3 },
  );

  const fullContent = response.choices[0].message.content || '';
  const sections = parseSections(fullContent);

  return {
    cashFlowProjections: sections['1. PROYECCION DE FLUJOS DE CAJA LIBRE'] || sections['1'] || '',
    waccCalculation: sections['2. CALCULO DEL WACC'] || sections['2'] || '',
    terminalValue: sections['3. VALOR TERMINAL'] || sections['3'] || '',
    valuationSummary: sections['4. VALORACION DCF'] || sections['4'] || '',
    sensitivityAnalysis: sections['5. ANALISIS DE SENSIBILIDAD'] || sections['5'] || '',
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
