// ---------------------------------------------------------------------------
// Agente 3: Especialista en Gobierno Corporativo (Legal & Compliance)
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildGovernancePrompt } from '../prompts/governance-specialist.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanlyOrThrow } from '../utils/finish-reason-check';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type {
  CompanyInfo,
  NiifAnalysisResult,
  StrategicAnalysisResult,
  GovernanceResult,
  FinancialProgressEvent,
} from '../types';

/**
 * Takes the outputs from Agent 1 (NIIF) and Agent 2 (Strategy) to produce
 * Notes to Financial Statements and Shareholder Assembly Minutes.
 *
 * @param niifOutput      Output del Agente 1.
 * @param strategyOutput  Output del Agente 2.
 * @param company         Metadata de la empresa.
 * @param language        es | en
 * @param instructions    Instrucciones adicionales del usuario (propagacion A2).
 * @param bindingTotals   Totales vinculantes pre-calculados — se antepone al
 *                        contexto para que las Notas citen cifras correctas.
 * @param preprocessed    PreprocessedBalance completo. Activa modo comparativo
 *                        en notas y acta cuando hay >=2 periodos.
 */
export async function runGovernanceSpecialist(
  niifOutput: NiifAnalysisResult,
  strategyOutput: StrategicAnalysisResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions: string | undefined,
  bindingTotals: string,
  preprocessed: PreprocessedBalance | undefined,
  onProgress?: (event: FinancialProgressEvent) => void,
): Promise<GovernanceResult> {
  const systemPrompt = buildGovernancePrompt(company, language, preprocessed);

  const userContent = [
    bindingTotals,
    '',
    '=== ESTADOS FINANCIEROS NIIF (Agente 1) ===',
    '',
    niifOutput.fullContent,
    '',
    '=== ANALISIS ESTRATEGICO (Agente 2) ===',
    '',
    strategyOutput.fullContent,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({ type: 'stage_progress', stage: 3, detail: 'Redactando notas contables y acta de asamblea...' });

  const result = await withRetry(
    () =>
      generateText({
        model: MODELS.FINANCIAL_PIPELINE,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        // 16384: notas NIIF completas + acta de asamblea requieren margen amplio.
        maxOutputTokens: 16384,
        seed: 42,
      }),
    { label: 'governance_specialist', maxAttempts: 3 },
  );

  assertFinishedCleanlyOrThrow(result, 'Governance Specialist');

  const fullContent = result.text || '';

  const sections = parseSections(fullContent);

  return {
    financialNotes: sections['1. NOTAS A LOS ESTADOS FINANCIEROS'] || sections['1'] || '',
    shareholderMinutes: sections['2'] || findSectionByPrefix(sections, '2.') || '',
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
