// ---------------------------------------------------------------------------
// Verificador de Cumplimiento Estatutario (Art. 207 C.Co.)
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildComplianceCheckerPrompt } from '../prompts/compliance-checker.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanly } from '../../utils/finish-reason-check';
import type { CompanyInfo } from '../../types';
import type {
  ComplianceResult,
  StatutoryFunction,
  ComplianceItem,
  ComplianceStatus,
  FiscalOpinionProgressEvent,
} from '../types';

export async function runComplianceChecker(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: FiscalOpinionProgressEvent) => void,
): Promise<ComplianceResult> {
  onProgress?.({
    type: 'evaluator_progress',
    domain: 'cumplimiento',
    detail: 'Verificando cumplimiento estatutario (Art. 207 C.Co.)...',
  });

  const result = await withRetry(
    () =>
      generateText({
        model: MODELS.FINANCIAL_PIPELINE,
        messages: [
          { role: 'system', content: buildComplianceCheckerPrompt(company, language) },
          { role: 'user', content: `ESTADOS FINANCIEROS E INFORMACION A EVALUAR:\n\n${reportContent}` },
        ],
        temperature: 0.05,
        maxOutputTokens: 8192,
      }),
    { label: 'compliance_checker', maxAttempts: 3 },
  );

  assertFinishedCleanly(result, 'compliance_checker');

  const fullContent = result.text || '';

  const statutoryFunctions = parseStatutoryFunctions(fullContent);
  const regulatoryItems = parseRegulatoryItems(fullContent);
  const nonComplianceItems = parseNonComplianceItems(fullContent);
  const complianceScore = parseScore(fullContent);
  const independenceAssessment = parseIndependence(fullContent);
  const analysis = parseAnalysis(fullContent);

  return {
    statutoryFunctions,
    regulatoryItems,
    independenceAssessment,
    nonComplianceItems,
    complianceScore,
    analysis,
    fullContent,
  };
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseStatutoryFunctions(content: string): StatutoryFunction[] {
  const match = content.match(/##\s*MATRIZ\s+ESTATUTARIA\s*\(ART\.\s*207\s*C\.Co\.\)\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (!match) return [];

  const jsonClean = match[1]
    .trim()
    .replace(/^```json?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(jsonClean);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((f: Record<string, unknown>) => ({
      number: Number(f.number) || 0,
      description: (f.description as string) || '',
      status: validateComplianceStatus(f.status as string),
      observations: (f.observations as string) || '',
    }));
  } catch {
    return [];
  }
}

function parseRegulatoryItems(content: string): ComplianceItem[] {
  const match = content.match(/##\s*CUMPLIMIENTO\s+REGULATORIO\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (!match) return [];

  const jsonClean = match[1]
    .trim()
    .replace(/^```json?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(jsonClean);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((item: Record<string, unknown>) => ({
      code: (item.code as string) || 'COMP-000',
      area: (item.area as string) || '',
      requirement: (item.requirement as string) || '',
      status: validateComplianceStatus(item.status as string),
      normReference: (item.normReference as string) || '',
      observation: (item.observation as string) || '',
    }));
  } catch {
    return [];
  }
}

function parseNonComplianceItems(content: string): ComplianceItem[] {
  const match = content.match(/##\s*INCUMPLIMIENTOS\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (!match) return [];

  const jsonClean = match[1]
    .trim()
    .replace(/^```json?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(jsonClean);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((item: Record<string, unknown>) => ({
      code: (item.code as string) || 'INC-000',
      area: (item.area as string) || '',
      requirement: (item.requirement as string) || '',
      status: validateComplianceStatus(item.status as string),
      normReference: (item.normReference as string) || '',
      observation: (item.observation as string) || '',
    }));
  } catch {
    return [];
  }
}

function parseScore(content: string): number {
  const match = content.match(/##\s*SCORE\s*\n+(\d+)/i);
  return match ? Math.min(100, Math.max(0, parseInt(match[1], 10))) : 50;
}

function parseIndependence(content: string): string {
  const match = content.match(/##\s*INDEPENDENCIA\s*\n+([\s\S]*?)(?=\n##\s)/i);
  return match ? match[1].trim() : '';
}

function parseAnalysis(content: string): string {
  const match = content.match(/##\s*ANALISIS\s+DETALLADO\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  return match ? match[1].trim() : '';
}

function validateComplianceStatus(s: string): ComplianceStatus {
  const valid = ['cumple', 'cumple_parcial', 'no_cumple', 'no_evaluado'];
  return valid.includes(s) ? s as ComplianceStatus : 'no_evaluado';
}
