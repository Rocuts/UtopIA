// ---------------------------------------------------------------------------
// Auditor Tributario — validates tax compliance against E.T. 2026
// ---------------------------------------------------------------------------

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildTaxAuditorPrompt } from '../prompts/tax-auditor.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import { assertFinishedCleanly } from '../../utils/finish-reason-check';
import type { CompanyInfo } from '../../types';
import type { AuditorResult, AuditFinding, AuditProgressEvent } from '../types';

export async function runTaxAuditor(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: AuditProgressEvent) => void,
): Promise<AuditorResult> {
  onProgress?.({ type: 'auditor_progress', domain: 'tributario', detail: 'Validando cumplimiento tributario contra E.T. 2026...' });

  const result = await withRetry(
    () =>
      generateText({
        model: MODELS.FINANCIAL_PIPELINE,
        messages: [
          { role: 'system', content: buildTaxAuditorPrompt(company, language) },
          { role: 'user', content: `REPORTE FINANCIERO A AUDITAR:\n\n${reportContent}` },
        ],
        temperature: 0.05,
        maxOutputTokens: 6144,
      }),
    { label: 'tax_auditor', maxAttempts: 3 },
  );

  assertFinishedCleanly(result, 'tax_auditor');

  const fullContent = result.text || '';
  const { score, findings, summary } = parseAuditorOutput(fullContent, 'tributario');

  return {
    domain: 'tributario',
    auditorName: 'Auditor Tributario',
    complianceScore: score,
    findings,
    summary,
    fullContent,
    failed: false,
  };
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
