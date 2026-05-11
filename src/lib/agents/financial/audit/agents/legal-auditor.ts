// ---------------------------------------------------------------------------
// Auditor Legal/Societario — outcome-first GPT-5.4 (Fase 2.B)
// ---------------------------------------------------------------------------
// Llama a `callFinancialAgent` con `LegalAuditReportSchema` y adapta el JSON
// validado al struct legacy `AuditorResult`.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../../agents/runtime';
import { buildLegalAuditorPrompt } from '../prompts/legal-auditor.prompt';
import {
  LegalAuditReportSchema,
  type LegalAuditReportJson,
  type AuditFindingJson,
} from '../../contracts/audit-report';
import type { CompanyInfo } from '../../types';
import type { AuditorResult, AuditFinding, AuditProgressEvent } from '../types';

export async function runLegalAuditor(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: AuditProgressEvent) => void,
  defaultPeriod?: string,
): Promise<AuditorResult> {
  onProgress?.({
    type: 'auditor_progress',
    domain: 'legal',
    detail: 'Validando documentos de gobierno corporativo...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'legal-auditor',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: LegalAuditReportSchema,
    system: buildLegalAuditorPrompt(company, language),
    userContent: `REPORTE FINANCIERO A AUDITAR:\n\n${reportContent}`,
    ...MODELS_CONFIG.legalAuditor,
  });

  return toLegacyAuditorResult(json, defaultPeriod);
}

// ---------------------------------------------------------------------------
// Adapter local: JSON strict -> AuditorResult legacy
// ---------------------------------------------------------------------------

function toLegacyAuditorResult(
  json: LegalAuditReportJson,
  defaultPeriod: string | undefined,
): AuditorResult {
  const findings: AuditFinding[] = json.findings.map((f) => mapFinding(f, defaultPeriod));
  return {
    domain: 'legal',
    auditorName: 'Auditor Legal/Societario',
    complianceScore: json.complianceScore,
    findings,
    summary: json.executiveSummary,
    fullContent: renderMarkdown(json, findings),
    failed: false,
  };
}

function mapFinding(
  f: AuditFindingJson,
  defaultPeriod: string | undefined,
): AuditFinding {
  return {
    code: f.code,
    severity: f.severity,
    domain: 'legal',
    title: f.title,
    description: f.description,
    normReference: f.normReference,
    recommendation: f.recommendation,
    impact: f.impact,
    period: f.period ?? defaultPeriod,
  };
}

function renderMarkdown(json: LegalAuditReportJson, findings: AuditFinding[]): string {
  const lines: string[] = [];
  lines.push(`## SCORE\n${json.complianceScore}`);
  lines.push('');
  lines.push(`## RESUMEN EJECUTIVO\n${json.executiveSummary}`);
  lines.push('');
  lines.push('## HALLAZGOS');
  for (const f of findings) {
    lines.push('');
    lines.push(`### ${f.code}: ${f.title}`);
    lines.push(`- **Severidad:** ${f.severity.toUpperCase()}`);
    lines.push(`- **Norma:** ${f.normReference}`);
    lines.push(`- **Descripcion:** ${f.description}`);
    lines.push(`- **Recomendacion:** ${f.recommendation}`);
    lines.push(`- **Impacto:** ${f.impact}`);
    if (f.period) lines.push(`- **Periodo:** ${f.period}`);
  }
  lines.push('');
  lines.push(`## CONCLUSION\n${json.conclusion}`);
  return lines.join('\n');
}
