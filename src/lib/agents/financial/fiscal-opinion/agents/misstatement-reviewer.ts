// ---------------------------------------------------------------------------
// Revisor de Incorrecciones Materiales (NIA 315/320/330/450)
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { buildMisstatementReviewerPrompt } from '../prompts/misstatement-reviewer.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { CompanyInfo } from '../../types';
import type {
  MisstatementResult,
  MaterialityCalculation,
  IdentifiedMisstatement,
  MisstatementType,
  FiscalOpinionProgressEvent,
} from '../types';

export async function runMisstatementReviewer(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: FiscalOpinionProgressEvent) => void,
): Promise<MisstatementResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  onProgress?.({
    type: 'evaluator_progress',
    domain: 'incorrecciones',
    detail: 'Calculando materialidad y evaluando incorrecciones (NIA 320/450)...',
  });

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: buildMisstatementReviewerPrompt(company, language) },
          { role: 'user', content: `ESTADOS FINANCIEROS E INFORMACION A EVALUAR:\n\n${reportContent}` },
        ],
        temperature: 0.05,
        max_tokens: 8192,
      }),
    { label: 'misstatement_reviewer', maxAttempts: 3 },
  );

  const fullContent = response.choices[0].message.content || '';

  const materiality = parseMateriality(fullContent);
  const misstatements = parseMisstatements(fullContent);
  const totalUncorrected = misstatements
    .filter((m) => !m.corrected)
    .reduce((sum, m) => sum + m.amount, 0);
  const { materialInAggregate, assessment } = parseAggregateEffect(fullContent, totalUncorrected, materiality.materialityThreshold);

  return {
    materiality,
    misstatements,
    totalUncorrected,
    materialInAggregate,
    assessment,
    analysis: parseAnalysis(fullContent),
    fullContent,
  };
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseMateriality(content: string): MaterialityCalculation {
  const match = content.match(/##\s*MATERIALIDAD\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (!match) {
    return {
      benchmark: 'No determinado',
      baseAmount: 0,
      materialityThreshold: 0,
      performanceMateriality: 0,
      trivialThreshold: 0,
    };
  }

  const jsonClean = match[1]
    .trim()
    .replace(/^```json?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(jsonClean) as Record<string, unknown>;
    return {
      benchmark: (parsed.benchmark as string) || 'No determinado',
      baseAmount: Number(parsed.baseAmount) || 0,
      materialityThreshold: Number(parsed.materialityThreshold) || 0,
      performanceMateriality: Number(parsed.performanceMateriality) || 0,
      trivialThreshold: Number(parsed.trivialThreshold) || 0,
    };
  } catch {
    return {
      benchmark: 'No determinado (error de parseo)',
      baseAmount: 0,
      materialityThreshold: 0,
      performanceMateriality: 0,
      trivialThreshold: 0,
    };
  }
}

function parseMisstatements(content: string): IdentifiedMisstatement[] {
  const match = content.match(/##\s*INCORRECCIONES\s+IDENTIFICADAS\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (!match) return [];

  const jsonClean = match[1]
    .trim()
    .replace(/^```json?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(jsonClean);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((m: Record<string, unknown>) => ({
      code: (m.code as string) || 'MIS-000',
      type: validateMisstatementType(m.type as string),
      description: (m.description as string) || '',
      amount: Number(m.amount) || 0,
      corrected: Boolean(m.corrected),
      affectedArea: (m.affectedArea as string) || '',
      normReference: (m.normReference as string) || '',
    }));
  } catch {
    // Try to extract individual JSON objects
    const objectRegex = /\{[^{}]*\}/g;
    const matches = jsonClean.match(objectRegex);
    if (!matches) return [];

    const results: IdentifiedMisstatement[] = [];
    for (const obj of matches) {
      try {
        const m = JSON.parse(obj) as Record<string, unknown>;
        results.push({
          code: (m.code as string) || 'MIS-000',
          type: validateMisstatementType(m.type as string),
          description: (m.description as string) || '',
          amount: Number(m.amount) || 0,
          corrected: Boolean(m.corrected),
          affectedArea: (m.affectedArea as string) || '',
          normReference: (m.normReference as string) || '',
        });
      } catch { /* skip malformed */ }
    }
    return results;
  }
}

function parseAggregateEffect(
  content: string,
  totalUncorrected: number,
  materialityThreshold: number,
): { materialInAggregate: boolean; assessment: MisstatementResult['assessment'] } {
  const match = content.match(/##\s*EVALUACION\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (match) {
    const text = match[1].trim().toLowerCase();
    if (text.includes('pervasive') || text.includes('generalizado')) {
      return { materialInAggregate: true, assessment: 'pervasive' };
    }
    if (text.includes('material')) {
      return { materialInAggregate: true, assessment: 'material' };
    }
    if (text.includes('immaterial') || text.includes('inmaterial')) {
      return { materialInAggregate: false, assessment: 'immaterial' };
    }
  }

  // Fallback: compare total uncorrected against materiality
  if (materialityThreshold > 0 && totalUncorrected > materialityThreshold) {
    return { materialInAggregate: true, assessment: 'material' };
  }
  return { materialInAggregate: false, assessment: 'immaterial' };
}

function parseAnalysis(content: string): string {
  const match = content.match(/##\s*ANALISIS\s+DETALLADO\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  return match ? match[1].trim() : '';
}

function validateMisstatementType(t: string): MisstatementType {
  const valid = ['factual', 'judgmental', 'projected'];
  return valid.includes(t) ? t as MisstatementType : 'factual';
}
