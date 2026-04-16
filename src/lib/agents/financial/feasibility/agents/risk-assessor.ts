// ---------------------------------------------------------------------------
// Agente 3: Evaluador de Riesgos (Risk Assessment & Go/No-Go)
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { buildRiskAssessorPrompt } from '../prompts/risk-assessor.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type {
  ProjectInfo,
  MarketAnalysisResult,
  FinancialModelResult,
  RiskAssessmentResult,
  FeasibilityProgressEvent,
} from '../types';

/**
 * Takes outputs from Agent 1 (Market) and Agent 2 (Financial) to produce
 * a comprehensive risk assessment with go/no-go recommendation.
 */
export async function runRiskAssessor(
  marketOutput: MarketAnalysisResult,
  financialOutput: FinancialModelResult,
  project: ProjectInfo,
  language: 'es' | 'en',
  onProgress?: (event: FeasibilityProgressEvent) => void,
): Promise<RiskAssessmentResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const systemPrompt = buildRiskAssessorPrompt(project, language);

  const userContent = [
    '=== ANALISIS DE MERCADO (Agente 1) ===',
    '',
    marketOutput.fullContent,
    '',
    '=== MODELO FINANCIERO (Agente 2) ===',
    '',
    financialOutput.fullContent,
  ].join('\n');

  onProgress?.({ type: 'stage_progress', stage: 3, detail: 'Evaluando riesgos y construyendo matriz probabilidad-impacto...' });

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
    { label: 'risk_assessor', maxAttempts: 3 },
  );

  const fullContent = response.choices[0].message.content || '';

  const sections = parseSections(fullContent);

  return {
    riskMatrix: sections['1. MATRIZ DE RIESGOS'] || sections['1'] || '',
    riskAdjustedNpv: sections['2. VPN AJUSTADO POR RIESGO'] || sections['2'] || '',
    mitigationStrategies: sections['3. ESTRATEGIAS DE MITIGACION'] || sections['3'] || '',
    insuranceRecommendations: sections['4. RECOMENDACIONES DE SEGUROS Y COBERTURAS'] || sections['4'] || '',
    goNoGoRecommendation: sections['5. RECOMENDACION GO / NO-GO'] || sections['5'] || '',
    executiveSummary: sections['6. RESUMEN EJECUTIVO'] || sections['6'] || '',
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
