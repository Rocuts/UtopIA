// ---------------------------------------------------------------------------
// Agente 1: Analista Contable NIIF (Data & Structuring)
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildNiifAnalystPrompt } from '../prompts/niif-analyst.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { CompanyInfo, NiifAnalysisResult, FinancialProgressEvent } from '../types';

/**
 * Processes raw accounting data and produces the 4 NIIF financial statements.
 */
export async function runNiifAnalyst(
  rawData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions?: string,
  onProgress?: (event: FinancialProgressEvent) => void,
): Promise<NiifAnalysisResult> {
  const systemPrompt = buildNiifAnalystPrompt(company, language);

  const userContent = [
    'DATOS CONTABLES EN BRUTO:',
    '',
    rawData,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({ type: 'stage_progress', stage: 1, detail: 'Clasificando cuentas y mapeando estructura NIIF...' });

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
    { label: 'niif_analyst', maxAttempts: 3 },
  );

  const fullContent = result.text || '';

  // Parse sections from the Markdown output
  const sections = parseSections(fullContent);

  return {
    balanceSheet: sections['1. ESTADO DE SITUACION FINANCIERA'] || sections['1'] || '',
    incomeStatement: sections['2. ESTADO DE RESULTADOS INTEGRAL'] || sections['2'] || '',
    cashFlowStatement: sections['3. ESTADO DE FLUJOS DE EFECTIVO'] || sections['3'] || '',
    equityChangesStatement: sections['4. ESTADO DE CAMBIOS EN EL PATRIMONIO'] || sections['4'] || '',
    technicalNotes: sections['5. NOTAS TECNICAS'] || sections['5'] || '',
    fullContent,
  };
}

/**
 * Parse numbered `## N. TITLE` sections from Markdown content.
 */
function parseSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  // Match ## followed by a number and optional title
  const pattern = /^##\s+(\d+\.?\s*[^\n]*)/gm;
  const matches = [...content.matchAll(pattern)];

  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : content.length;
    sections[key] = content.slice(start, end).trim();
    // Also store by number only for flexible lookup
    const numMatch = key.match(/^(\d+)/);
    if (numMatch) sections[numMatch[1]] = sections[key];
  }

  return sections;
}
