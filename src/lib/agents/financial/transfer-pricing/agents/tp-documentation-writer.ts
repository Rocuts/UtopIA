// ---------------------------------------------------------------------------
// Agente 3: Especialista en Documentacion de Precios de Transferencia
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildTPDocumentationPrompt } from '../prompts/tp-documentation.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanly } from '../../utils/finish-reason-check';
import type { CompanyInfo } from '../../types';
import type {
  TPAnalysisResult,
  ComparableAnalysisResult,
  TPDocumentationResult,
  TPProgressEvent,
} from '../types';

/**
 * Takes the TP Analyst + Comparable Analyst outputs and produces:
 * - Executive summary
 * - Local Report (documentacion comprobatoria)
 * - Master File equivalent structure
 * - Conclusions and recommendations
 * - Formato 1125 DIAN filing guide
 */
export async function runTPDocumentationWriter(
  tpAnalysis: TPAnalysisResult,
  comparableAnalysis: ComparableAnalysisResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: TPProgressEvent) => void,
): Promise<TPDocumentationResult> {
  const systemPrompt = buildTPDocumentationPrompt(company, language);

  const userContent = [
    'ANALISIS DEL AGENTE 1 — ANALISTA DE PRECIOS DE TRANSFERENCIA:',
    '',
    tpAnalysis.fullContent,
    '',
    '---',
    '',
    'ANALISIS DEL AGENTE 2 — ESTUDIO DE COMPARABLES Y BENCHMARKING:',
    '',
    comparableAnalysis.fullContent,
  ].join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 3,
    detail: 'Redactando documentacion comprobatoria y guia Formato 1125...',
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
    { label: 'tp_documentation_writer', maxAttempts: 3 },
  );

  assertFinishedCleanly(result, 'tp_documentation_writer');

  const fullContent = result.text || '';

  const sections = parseSections(fullContent);

  return {
    executiveSummary:
      sections['1. RESUMEN EJECUTIVO'] || sections['1'] || '',
    localReport:
      sections['2. INFORME LOCAL (DOCUMENTACION COMPROBATORIA)'] || sections['2'] || '',
    masterFileEquivalent:
      sections['3. MASTER FILE (ARCHIVO MAESTRO)'] || sections['3'] || '',
    conclusions:
      sections['4. CONCLUSIONES Y RECOMENDACIONES'] || sections['4'] || '',
    formato1125Guide:
      sections['5. GUIA DE DILIGENCIAMIENTO — FORMATO 1125 DIAN'] ||
      sections['5'] ||
      findSectionByPrefix(sections, '5.') ||
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
