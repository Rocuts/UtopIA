// ---------------------------------------------------------------------------
// Agente 3: Especialista en Gobierno Corporativo (Legal & Compliance)
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { buildGovernancePrompt } from '../prompts/governance-specialist.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
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
 */
export async function runGovernanceSpecialist(
  niifOutput: NiifAnalysisResult,
  strategyOutput: StrategicAnalysisResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: FinancialProgressEvent) => void,
): Promise<GovernanceResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const systemPrompt = buildGovernancePrompt(company, language);

  const userContent = [
    '=== ESTADOS FINANCIEROS NIIF (Agente 1) ===',
    '',
    niifOutput.fullContent,
    '',
    '=== ANALISIS ESTRATEGICO (Agente 2) ===',
    '',
    strategyOutput.fullContent,
  ].join('\n');

  onProgress?.({ type: 'stage_progress', stage: 3, detail: 'Redactando notas contables y acta de asamblea...' });

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 8192,
      }),
    { label: 'governance_specialist', maxAttempts: 3 },
  );

  const fullContent = response.choices[0].message.content || '';

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
