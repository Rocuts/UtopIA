// ---------------------------------------------------------------------------
// Agente 2: Director de Estrategia Financiera (KPIs & Projections)
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildStrategyDirectorPrompt } from '../prompts/strategy-director.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanlyOrThrow } from '../utils/finish-reason-check';
import type {
  CompanyInfo,
  NiifAnalysisResult,
  StrategicAnalysisResult,
  FinancialProgressEvent,
} from '../types';

/**
 * Takes the NIIF financial statements from Agent 1 and produces
 * KPIs, break-even analysis, cash flow projections, and strategic recommendations.
 *
 * @param niifOutput    Output del Agente 1.
 * @param company       Metadata de la empresa.
 * @param language      es | en
 * @param instructions  Instrucciones adicionales del usuario (propagacion A2).
 * @param bindingTotals Bloque Markdown con totales vinculantes. Se antepone
 *                      al contexto para que el Agente 2 NO divague sobre cifras.
 */
export async function runStrategyDirector(
  niifOutput: NiifAnalysisResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions: string | undefined,
  bindingTotals: string,
  onProgress?: (event: FinancialProgressEvent) => void,
): Promise<StrategicAnalysisResult> {
  const systemPrompt = buildStrategyDirectorPrompt(company, language);

  const userContent = [
    bindingTotals,
    '',
    'ANALISIS NIIF DEL AGENTE 1:',
    niifOutput.fullContent,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({ type: 'stage_progress', stage: 2, detail: 'Calculando KPIs y punto de equilibrio...' });

  const result = await withRetry(
    () =>
      generateText({
        model: MODELS.FINANCIAL_PIPELINE,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        // 16384: KPIs + proyecciones + recomendaciones + break-even caben;
        // 6144 era muy justo y cortaba el flujo proyectado.
        maxOutputTokens: 16384,
        seed: 42,
      }),
    { label: 'strategy_director', maxAttempts: 3 },
  );

  assertFinishedCleanlyOrThrow(result, 'Strategy Director');

  const fullContent = result.text || '';

  const sections = parseSections(fullContent);

  return {
    kpiDashboard: sections['1. DASHBOARD EJECUTIVO DE KPIs'] || sections['1'] || '',
    breakEvenAnalysis: sections['2. ANALISIS DE PUNTO DE EQUILIBRIO'] || sections['2'] || '',
    projectedCashFlow: sections['3'] || findSectionByPrefix(sections, '3.') || '',
    strategicRecommendations: sections['4. RECOMENDACIONES ESTRATEGICAS'] || sections['4'] || '',
    fullContent,
  };
}

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
