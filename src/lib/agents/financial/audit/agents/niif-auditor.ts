// ---------------------------------------------------------------------------
// Auditor NIIF/Contable — validates financial statements against NIC/NIIF
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { buildNiifAuditorPrompt } from '../prompts/niif-auditor.prompt';
import { withRetry } from '@/lib/agents/utils/retry';
import type { CompanyInfo } from '../../types';
import type { AuditorResult, AuditFinding, AuditProgressEvent } from '../types';

export async function runNiifAuditor(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: AuditProgressEvent) => void,
): Promise<AuditorResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  onProgress?.({ type: 'auditor_progress', domain: 'niif', detail: 'Validando estados financieros contra NIC/NIIF...' });

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: buildNiifAuditorPrompt(company, language) },
          { role: 'user', content: `REPORTE FINANCIERO A AUDITAR:\n\n${reportContent}` },
        ],
        temperature: 0.05,
        max_tokens: 6144,
      }),
    { label: 'niif_auditor', maxAttempts: 3 },
  );

  const fullContent = response.choices[0].message.content || '';
  const { score, findings, summary } = parseAuditorOutput(fullContent, 'niif');

  return {
    domain: 'niif',
    auditorName: 'Auditor NIIF/Contable',
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
  // Extract score
  const scoreMatch = content.match(/##\s*SCORE\s*\n+(\d+)/i);
  const score = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10))) : 50;

  // Extract findings JSON array
  let findings: AuditFinding[] = [];
  const findingsMatch = content.match(/##\s*HALLAZGOS\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (findingsMatch) {
    const jsonBlock = findingsMatch[1].trim();
    // Try to extract JSON array (may be wrapped in code fences)
    const jsonClean = jsonBlock.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
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
      // If JSON parsing fails, try to extract individual objects
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
          } catch { /* skip malformed */ }
        }
      }
    }
  }

  // Extract summary
  const summaryMatch = content.match(/##\s*RESUMEN EJECUTIVO\s*\n+([\s\S]*?)(?=\n##\s)/i);
  const summary = summaryMatch ? summaryMatch[1].trim() : '';

  return { score, findings, summary };
}

function validateSeverity(s: string): AuditFinding['severity'] {
  const valid = ['critico', 'alto', 'medio', 'bajo', 'informativo'];
  return valid.includes(s) ? s as AuditFinding['severity'] : 'medio';
}
