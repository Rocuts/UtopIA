// ---------------------------------------------------------------------------
// Agente 2: Calculador de Impuesto Diferido (NIC 12)
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildDeferredTaxCalculatorPrompt } from '../prompts/deferred-tax-calculator.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanly } from '../../utils/finish-reason-check';
import type { CompanyInfo } from '../../types';
import type {
  DifferenceIdentifierResult,
  DeferredTaxResult,
  TaxReconciliationProgressEvent,
} from '../types';

/**
 * Takes the identified NIIF-fiscal differences from Agent 1 and calculates
 * deferred tax assets/liabilities, effective tax rate reconciliation,
 * Formato 2516 mapping, and journal entry recommendations.
 */
export async function runDeferredTaxCalculator(
  differenceOutput: DifferenceIdentifierResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: TaxReconciliationProgressEvent) => void,
): Promise<DeferredTaxResult> {
  const systemPrompt = buildDeferredTaxCalculatorPrompt(company, language);

  const userContent = [
    'ANALISIS DE DIFERENCIAS NIIF-FISCAL IDENTIFICADAS POR EL AGENTE 1:',
    '',
    differenceOutput.fullContent,
  ].join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 2,
    detail: 'Calculando impuesto diferido y conciliando tasa efectiva...',
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
    { label: 'deferred_tax_calculator', maxAttempts: 3 },
  );

  assertFinishedCleanly(result, 'deferred_tax_calculator');

  const fullContent = result.text || '';

  const sections = parseSections(fullContent);

  return {
    deferredTaxWorksheet:
      sections['1. HOJA DE CALCULO DE IMPUESTO DIFERIDO'] || sections['1'] || '',
    dtaDtlSchedule: sections['2. CUADRO DTA / DTL'] || sections['2'] || '',
    currentVsDeferredBreakdown:
      sections['3. DESGLOSE GASTO CORRIENTE VS DIFERIDO'] ||
      sections['3'] ||
      findSectionByPrefix(sections, '3.') ||
      '',
    effectiveTaxRateReconciliation:
      sections['4. CONCILIACION DE TASA EFECTIVA'] ||
      sections['4'] ||
      findSectionByPrefix(sections, '4.') ||
      '',
    formato2516Mapping:
      sections['5. MAPEO FORMATO 2516 DIAN'] ||
      sections['5'] ||
      findSectionByPrefix(sections, '5.') ||
      '',
    journalEntries:
      sections['6. ASIENTOS CONTABLES RECOMENDADOS'] ||
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
