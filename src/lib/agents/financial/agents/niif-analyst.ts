// ---------------------------------------------------------------------------
// Agente 1: Analista Contable NIIF (Data & Structuring)
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildNiifAnalystPrompt } from '../prompts/niif-analyst.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanlyOrThrow } from '../utils/finish-reason-check';
import type { CompanyInfo, NiifAnalysisResult, FinancialProgressEvent } from '../types';

/**
 * Processes raw accounting data and produces the 4 NIIF financial statements.
 *
 * @param rawData       Texto CSV/markdown del balance pre-procesado.
 * @param company       Metadata de la empresa.
 * @param language      es | en
 * @param instructions  Instrucciones adicionales del usuario (propaga A2 a los 3 agentes).
 * @param bindingTotals Bloque Markdown con totales vinculantes (pre-calculados). Se
 *                      antepone al userContent para que el modelo lo vea SIEMPRE.
 */
export async function runNiifAnalyst(
  rawData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions: string | undefined,
  bindingTotals: string,
  onProgress?: (event: FinancialProgressEvent) => void,
): Promise<NiifAnalysisResult> {
  const systemPrompt = buildNiifAnalystPrompt(company, language);

  // El bindingTotals se antepone al raw data para que el Agente 1 lo lea
  // ANTES de ver los auxiliares. Esto evita que el modelo re-sume y divaga.
  const userContent = [
    bindingTotals,
    '',
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
        // 16384: un reporte NIIF completo (4 estados + notas tecnicas) supera
        // los 8k tokens con frecuencia y se trunca. El modelo soporta 16k.
        maxOutputTokens: 16384,
        // seed fija -> salidas deterministicas (AI SDK v6 soporta seed a nivel raiz;
        // si el provider lo ignora, el efecto es nulo pero no rompe).
        seed: 42,
      }),
    { label: 'niif_analyst', maxAttempts: 3 },
  );

  // Si el modelo cortó por 'length' / 'content-filter' / 'error', lanzamos
  // un error claro para que el caller (orchestrator -> SSE -> UI) lo vea.
  assertFinishedCleanlyOrThrow(result, 'NIIF Analyst');

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
