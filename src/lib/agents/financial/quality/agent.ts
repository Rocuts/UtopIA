// ---------------------------------------------------------------------------
// Meta-Auditor de Calidad y Best Practices 2026
// ---------------------------------------------------------------------------
// Evaluates the ENTIRE pipeline output (report + audit + preprocessed data)
// against international and Colombian 2026 standards:
//   - IASB Conceptual Framework (qualitative characteristics)
//   - IFRS 18 readiness (effective 2027)
//   - ISO/IEC 25012 (data quality dimensions)
//   - ISO/IEC 42001 (AI governance)
//   - Colombian CTCP + Decreto 2420/2496
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { MODELS } from '@/lib/config/models';
import { buildQualityAuditorPrompt } from './prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { FinancialReport } from '../types';
import type { AuditReport } from '../audit/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { QualityAssessment, QualityDimension } from './types';

export interface QualityAuditInput {
  report: FinancialReport;
  auditReport?: AuditReport;
  preprocessed?: PreprocessedBalance;
  language: 'es' | 'en';
}

/**
 * Run the meta-quality audit on the full pipeline output.
 */
export async function runQualityAudit(input: QualityAuditInput): Promise<QualityAssessment> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const systemPrompt = buildQualityAuditorPrompt(input.report.company, input.language);

  // Build comprehensive context for the auditor
  const sections: string[] = [];

  sections.push('=== REPORTE FINANCIERO CONSOLIDADO (3 Agentes) ===');
  sections.push(input.report.consolidatedReport);

  if (input.auditReport) {
    sections.push('\n=== INFORME DE AUDITORIA (4 Auditores) ===');
    sections.push(input.auditReport.consolidatedReport);
    sections.push(`\nScore de Auditoria: ${input.auditReport.overallScore}/100`);
    sections.push(`Opinion: ${input.auditReport.opinionType}`);
    sections.push(`Hallazgos: ${input.auditReport.consolidatedFindings.length} total`);
  }

  if (input.preprocessed) {
    sections.push('\n=== INFORME DE VALIDACION ARITMETICA (Preprocesador) ===');
    sections.push(input.preprocessed.validationReport);
    sections.push(`\nCuentas auxiliares procesadas: ${input.preprocessed.auxiliaryCount}`);
    sections.push(`Discrepancias detectadas: ${input.preprocessed.discrepancies.length}`);
    sections.push(`Ecuacion patrimonial: ${input.preprocessed.summary.equationBalanced ? 'CUADRA' : 'NO CUADRA'}`);
  }

  const userContent = sections.join('\n');

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: MODELS.FINANCIAL_PIPELINE,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.05,
        max_tokens: 8192,
      }),
    { label: 'quality_auditor', maxAttempts: 3 },
  );

  const fullReport = response.choices[0].message.content || '';
  return parseQualityAssessment(fullReport);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseQualityAssessment(content: string): QualityAssessment {
  // Score
  const scoreMatch = content.match(/##\s*SCORE GLOBAL\s*\n+(\d+)/i);
  const overallScore = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10))) : 50;

  // Grade
  const gradeMatch = content.match(/##\s*GRADE\s*\n+([A-F][+]?)/i);
  const grade = gradeMatch ? gradeMatch[1] : deriveGrade(overallScore);

  // Executive summary
  const summaryMatch = content.match(/##\s*RESUMEN EJECUTIVO\s*\n+([\s\S]*?)(?=\n##\s)/i);
  const executiveSummary = summaryMatch ? summaryMatch[1].trim() : '';

  // Dimensions
  const dimensions = parseDimensions(content);

  // Data quality (ISO 25012)
  const dataQuality = parseDataQuality(content);

  // AI governance (ISO 42001)
  const aiGovernance = parseAIGovernance(content);

  // IFRS 18
  const ifrs18Readiness = parseIFRS18(content);

  return {
    overallScore,
    grade,
    dimensions,
    ifrs18Readiness,
    dataQuality,
    aiGovernance,
    executiveSummary,
    fullReport: content,
    generatedAt: new Date().toISOString(),
  };
}

function deriveGrade(score: number): string {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function parseDimensions(content: string): QualityDimension[] {
  const dimMatch = content.match(/##\s*DIMENSIONES DE CALIDAD\s*\n+([\s\S]*?)(?=\n##\s)/i);
  if (!dimMatch) return [];

  const jsonBlock = dimMatch[1].trim().replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(jsonBlock);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((d: Record<string, unknown>) => ({
      name: (d.name as string) || '',
      score: typeof d.score === 'number' ? d.score : 50,
      framework: (d.framework as string) || '',
      findings: Array.isArray(d.findings) ? d.findings as string[] : [],
      recommendations: Array.isArray(d.recommendations) ? d.recommendations as string[] : [],
    }));
  } catch {
    return [];
  }
}

function parseDataQuality(content: string): QualityAssessment['dataQuality'] {
  const section = content.match(/##\s*CALIDAD DE DATOS[^#]*\n([\s\S]*?)(?=\n##\s)/i);
  const defaults = { completeness: 50, accuracy: 50, consistency: 50, timeliness: 50, validity: 50 };
  if (!section) return defaults;

  const text = section[1];
  const extract = (key: string) => {
    const m = text.match(new RegExp(`${key}\\s*:\\s*(\\d+)`, 'i'));
    return m ? Math.min(100, parseInt(m[1], 10)) : 50;
  };

  return {
    completeness: extract('completeness|completitud'),
    accuracy: extract('accuracy|exactitud'),
    consistency: extract('consistency|consistencia'),
    timeliness: extract('timeliness|actualidad'),
    validity: extract('validity|validez'),
  };
}

function parseAIGovernance(content: string): QualityAssessment['aiGovernance'] {
  const section = content.match(/##\s*GOBERNANZA IA[^#]*\n([\s\S]*?)(?=\n##\s)/i);
  const defaults = { traceability: 50, explainability: 50, antiHallucination: 50, humanOversight: 50 };
  if (!section) return defaults;

  const text = section[1];
  const extract = (key: string) => {
    const m = text.match(new RegExp(`${key}\\s*:\\s*(\\d+)`, 'i'));
    return m ? Math.min(100, parseInt(m[1], 10)) : 50;
  };

  return {
    traceability: extract('traceability|trazabilidad'),
    explainability: extract('explainability|explicabilidad'),
    antiHallucination: extract('anti.?hallucination|anti.?alucinacion'),
    humanOversight: extract('human.?oversight|supervision.?humana'),
  };
}

function parseIFRS18(content: string): QualityAssessment['ifrs18Readiness'] {
  const section = content.match(/##\s*PREPARACION IFRS 18[^#]*\n([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (!section) return { ready: false, score: 0, gaps: [] };

  const text = section[1];
  const readyMatch = text.match(/ready\s*:\s*(true|false)/i);
  const scoreMatch = text.match(/score\s*:\s*(\d+)/i);
  const gapsMatch = text.match(/gaps\s*:\s*\[([\s\S]*?)\]/i);

  let gaps: string[] = [];
  if (gapsMatch) {
    gaps = gapsMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[-*"',\s]+/, '').replace(/["',\s]+$/, '').trim())
      .filter((l) => l.length > 0);
  }

  return {
    ready: readyMatch ? readyMatch[1].toLowerCase() === 'true' : false,
    score: scoreMatch ? parseInt(scoreMatch[1], 10) : 0,
    gaps,
  };
}
