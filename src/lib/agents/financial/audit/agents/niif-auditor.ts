// ---------------------------------------------------------------------------
// Auditor NIIF/Contable — outcome-first GPT-5.4 (Fase 2.B)
// ---------------------------------------------------------------------------
// Llama a `callFinancialAgent` con `NiifAuditReportSchema` y adapta el JSON
// validado al struct legacy `AuditorResult` que consume el orchestrator
// (`audit/orchestrator.ts`). El adapter local sintetiza el `fullContent`
// Markdown que el orchestrator inyecta en el reporte consolidado.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../../agents/runtime';
import { buildNiifAuditorPrompt } from '../prompts/niif-auditor.prompt';
import {
  NiifAuditReportSchema,
  type NiifAuditReportJson,
  type AuditFindingJson,
} from '../../contracts/audit-report';
import type { CompanyInfo } from '../../types';
import type { AuditorResult, AuditFinding, AuditProgressEvent } from '../types';

export async function runNiifAuditor(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: AuditProgressEvent) => void,
  defaultPeriod?: string,
): Promise<AuditorResult> {
  onProgress?.({
    type: 'auditor_progress',
    domain: 'niif',
    detail: 'Validando estados financieros contra NIC/NIIF...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'niif-auditor',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: NiifAuditReportSchema,
    system: buildNiifAuditorPrompt(company, language),
    userContent: `REPORTE FINANCIERO A AUDITAR:\n\n${reportContent}`,
    ...MODELS_CONFIG.niifAuditor,
  });

  return toLegacyAuditorResult(json, defaultPeriod);
}

// ---------------------------------------------------------------------------
// Adapter local: JSON strict -> AuditorResult legacy
// ---------------------------------------------------------------------------

function toLegacyAuditorResult(
  json: NiifAuditReportJson,
  defaultPeriod: string | undefined,
): AuditorResult {
  const findings: AuditFinding[] = json.findings.map((f) => mapFinding(f, defaultPeriod));
  return {
    domain: 'niif',
    auditorName: 'Auditor NIIF/Contable',
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
    domain: 'niif',
    title: f.title,
    description: f.description,
    normReference: f.normReference,
    recommendation: f.recommendation,
    impact: f.impact,
    period: f.period ?? defaultPeriod,
  };
}

function renderMarkdown(json: NiifAuditReportJson, findings: AuditFinding[]): string {
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
