// ---------------------------------------------------------------------------
// Auditor de Revisoria Fiscal — statutory auditor / ISA perspective
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildFiscalReviewerPrompt } from '../prompts/fiscal-reviewer.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { CompanyInfo } from '../../types';
import type { AuditorResult, AuditFinding, AuditOpinionType, AuditProgressEvent } from '../types';

export async function runFiscalReviewer(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: AuditProgressEvent) => void,
): Promise<AuditorResult & { opinionType: AuditOpinionType; dictamen: string }> {
  onProgress?.({ type: 'auditor_progress', domain: 'revisoria', detail: 'Evaluando razonabilidad y materialidad (NIA/ISA)...' });

  const result = await withRetry(
    () =>
      generateText({
        model: MODELS.FINANCIAL_PIPELINE,
        messages: [
          { role: 'system', content: buildFiscalReviewerPrompt(company, language) },
          { role: 'user', content: `REPORTE FINANCIERO COMPLETO A AUDITAR:\n\n${reportContent}` },
        ],
        temperature: 0.05,
        maxOutputTokens: 8192,
      }),
    { label: 'fiscal_reviewer', maxAttempts: 3 },
  );

  const fullContent = result.text || '';
  const { score, findings, summary } = parseAuditorOutput(fullContent, 'revisoria');
  const opinionType = parseOpinionType(fullContent);
  const dictamen = parseDictamen(fullContent);

  return {
    domain: 'revisoria',
    auditorName: 'Auditor de Revisoria Fiscal',
    complianceScore: score,
    findings,
    summary,
    fullContent,
    failed: false,
    opinionType,
    dictamen,
  };
}

function parseOpinionType(content: string): AuditOpinionType {
  const match = content.match(/##\s*TIPO DE OPINION\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (match) {
    const text = match[1].trim().toLowerCase();
    if (text.includes('favorable') && !text.includes('desfavorable') && !text.includes('salvedad')) return 'favorable';
    if (text.includes('salvedad')) return 'con_salvedades';
    if (text.includes('desfavorable') || text.includes('adversa')) return 'desfavorable';
    if (text.includes('abstension') || text.includes('abstencion')) return 'abstension';
  }
  return 'con_salvedades'; // conservative default
}

function parseDictamen(content: string): string {
  const match = content.match(/##\s*DICTAMEN\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  return match ? match[1].trim() : '';
}

function parseAuditorOutput(
  content: string,
  domain: 'niif' | 'tributario' | 'legal' | 'revisoria',
): { score: number; findings: AuditFinding[]; summary: string } {
  const scoreMatch = content.match(/##\s*SCORE\s*\n+(\d+)/i);
  const score = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10))) : 50;

  let findings: AuditFinding[] = [];
  const findingsMatch = content.match(/##\s*HALLAZGOS\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (findingsMatch) {
    const jsonClean = findingsMatch[1].trim().replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    try {
      const parsed = JSON.parse(jsonClean);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      findings = arr.map((f: Record<string, unknown>) => ({
        code: (f.code as string) || `${domain.toUpperCase()}-000`,
        severity: validateSeverity(f.severity as string),
        domain,
        title: (f.title as string) || '',
        description: (f.description as string) || '',
        normReference: (f.normReference as string) || '',
        recommendation: (f.recommendation as string) || '',
        impact: (f.impact as string) || '',
      }));
    } catch {
      const objectRegex = /\{[^{}]*\}/g;
      const matches = jsonClean.match(objectRegex);
      if (matches) {
        for (const m of matches) {
          try {
            const f = JSON.parse(m) as Record<string, unknown>;
            findings.push({
              code: (f.code as string) || `${domain.toUpperCase()}-000`,
              severity: validateSeverity(f.severity as string),
              domain,
              title: (f.title as string) || '',
              description: (f.description as string) || '',
              normReference: (f.normReference as string) || '',
              recommendation: (f.recommendation as string) || '',
              impact: (f.impact as string) || '',
            });
          } catch { /* skip */ }
        }
      }
    }
  }

  const summaryMatch = content.match(/##\s*RESUMEN EJECUTIVO\s*\n+([\s\S]*?)(?=\n##\s)/i);
  const summary = summaryMatch ? summaryMatch[1].trim() : '';

  return { score, findings, summary };
}

function validateSeverity(s: string): AuditFinding['severity'] {
  const valid = ['critico', 'alto', 'medio', 'bajo', 'informativo'];
  return valid.includes(s) ? s as AuditFinding['severity'] : 'medio';
}
