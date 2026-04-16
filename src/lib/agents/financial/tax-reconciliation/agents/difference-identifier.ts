// ---------------------------------------------------------------------------
// Agente 1: Identificador de Diferencias NIIF-Fiscal
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { MODELS } from '@/lib/config/models';
import { buildDifferenceIdentifierPrompt } from '../prompts/difference-identifier.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { CompanyInfo } from '../../types';
import type { DifferenceIdentifierResult, TaxReconciliationProgressEvent } from '../types';

/**
 * Processes raw accounting data and identifies all NIIF-to-fiscal differences,
 * classifying them as permanent or temporary (deductible/taxable).
 */
export async function runDifferenceIdentifier(
  rawData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions?: string,
  onProgress?: (event: TaxReconciliationProgressEvent) => void,
): Promise<DifferenceIdentifierResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const systemPrompt = buildDifferenceIdentifierPrompt(company, language);

  const userContent = [
    'DATOS CONTABLES PARA CONCILIACION FISCAL:',
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
    detail: 'Identificando diferencias entre bases contables NIIF y bases fiscales ET...',
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
    { label: 'difference_identifier', maxAttempts: 3 },
  );

  const fullContent = response.choices[0].message.content || '';

  // Parse sections from the Markdown output
  const sections = parseSections(fullContent);

  return {
    revenueDifferences: sections['1. DIFERENCIAS EN INGRESOS'] || sections['1'] || '',
    costDeductionDifferences: sections['2. DIFERENCIAS EN COSTOS Y DEDUCCIONES'] || sections['2'] || '',
    assetDifferences: sections['3. DIFERENCIAS EN ACTIVOS'] || sections['3'] || '',
    liabilityDifferences: sections['4. DIFERENCIAS EN PASIVOS'] || sections['4'] || '',
    equityDifferences: sections['5. DIFERENCIAS EN PATRIMONIO'] || sections['5'] || '',
    bridgeSchedule:
      sections['6. CEDULA PUENTE — PATRIMONIO NIIF A PATRIMONIO FISCAL'] ||
      sections['6'] ||
      findSectionByPrefix(sections, '6.') ||
      '',
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

function findSectionByPrefix(sections: Record<string, string>, prefix: string): string {
  const key = Object.keys(sections).find((k) => k.startsWith(prefix));
  return key ? sections[key] : '';
}
