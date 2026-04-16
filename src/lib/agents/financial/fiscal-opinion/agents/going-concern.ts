// ---------------------------------------------------------------------------
// Evaluador de Empresa en Marcha (NIA 570)
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { buildGoingConcernPrompt } from '../prompts/going-concern.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { CompanyInfo } from '../../types';
import type {
  GoingConcernResult,
  GoingConcernConclusion,
  GoingConcernIndicator,
  FiscalOpinionProgressEvent,
} from '../types';

export async function runGoingConcernEvaluator(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: FiscalOpinionProgressEvent) => void,
): Promise<GoingConcernResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  onProgress?.({
    type: 'evaluator_progress',
    domain: 'empresa_en_marcha',
    detail: 'Evaluando hipotesis de empresa en marcha (NIA 570)...',
  });

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: buildGoingConcernPrompt(company, language) },
          { role: 'user', content: `ESTADOS FINANCIEROS E INFORMACION A EVALUAR:\n\n${reportContent}` },
        ],
        temperature: 0.05,
        max_tokens: 8192,
      }),
    { label: 'going_concern_evaluator', maxAttempts: 3 },
  );

  const fullContent = response.choices[0].message.content || '';

  return {
    assessment: parseAssessment(fullContent),
    conclusion: parseConclusion(fullContent),
    indicators: parseIndicators(fullContent),
    recommendedDisclosures: parseDisclosures(fullContent),
    analysis: parseAnalysis(fullContent),
    fullContent,
  };
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseAssessment(content: string): GoingConcernResult['assessment'] {
  const match = content.match(/##\s*EVALUACION\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (match) {
    const text = match[1].trim().toLowerCase();
    if (text.includes('doubt') || text.includes('duda')) return 'doubt';
    if (text.includes('caution') || text.includes('precaucion') || text.includes('caucion')) return 'caution';
    if (text.includes('pass') || text.includes('pasa') || text.includes('adecuad')) return 'pass';
  }
  return 'caution';
}

function parseConclusion(content: string): GoingConcernConclusion {
  const match = content.match(/##\s*CONCLUSION\s+NIA\s+570\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (match) {
    const text = match[1].trim().toLowerCase();
    if (text.includes('base_inadecuada') || text.includes('inadecuada')) return 'base_inadecuada';
    if (text.includes('incertidumbre_material') || text.includes('incertidumbre')) return 'incertidumbre_material';
    if (text.includes('sin_incertidumbre') || text.includes('sin incertidumbre')) return 'sin_incertidumbre';
  }
  return 'sin_incertidumbre';
}

function parseIndicators(content: string): GoingConcernIndicator[] {
  const match = content.match(/##\s*INDICADORES\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (!match) return [];

  const jsonClean = match[1]
    .trim()
    .replace(/^```json?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(jsonClean);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((ind: Record<string, unknown>) => ({
      category: validateCategory(ind.category as string),
      description: (ind.description as string) || '',
      severity: validateIndicatorSeverity(ind.severity as string),
      normReference: (ind.normReference as string) || '',
    }));
  } catch {
    return [];
  }
}

function parseDisclosures(content: string): string[] {
  const match = content.match(/##\s*REVELACIONES\s+RECOMENDADAS\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (!match) return [];

  return match[1]
    .trim()
    .split('\n')
    .filter((line) => line.trim().startsWith('-'))
    .map((line) => line.trim().replace(/^-\s*/, ''));
}

function parseAnalysis(content: string): string {
  const match = content.match(/##\s*ANALISIS\s+DETALLADO\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  return match ? match[1].trim() : '';
}

function validateCategory(c: string): GoingConcernIndicator['category'] {
  const valid = ['financiero', 'operacional', 'regulatorio'];
  return valid.includes(c) ? c as GoingConcernIndicator['category'] : 'financiero';
}

function validateIndicatorSeverity(s: string): GoingConcernIndicator['severity'] {
  const valid = ['alto', 'medio', 'bajo'];
  return valid.includes(s) ? s as GoingConcernIndicator['severity'] : 'medio';
}
