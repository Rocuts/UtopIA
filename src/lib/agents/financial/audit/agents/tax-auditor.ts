// ---------------------------------------------------------------------------
// Auditor Tributario — outcome-first GPT-5.4 (Fase 2.B)
// ---------------------------------------------------------------------------
// Llama a `callFinancialAgent` con `TaxAuditReportSchema` y adapta el JSON
// validado al struct legacy `AuditorResult`. Mantiene el `impactCop` en el
// Markdown legacy concatenando "Exposicion COP: $X.XXX" al campo impact si
// el modelo lo cuantifico — los renderers downstream (PDF Elite/Excel) ya
// saben leer ese formato.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../../agents/runtime';
import { buildTaxAuditorPrompt } from '../prompts/tax-auditor.prompt';
import {
  TaxAuditReportSchema,
  type TaxAuditReportJson,
  type AuditFindingJson,
} from '../../contracts/audit-report';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import type { CompanyInfo } from '../../types';
import type { AuditorResult, AuditFinding, AuditProgressEvent } from '../types';

/** Format MoneyCop (string en centavos) -> "$X.XXX,XX" estilo COP. */
function fmtMoneyCop(value: string): string {
  return formatCopFromCents(parseMoneyCop(value), /* absolute */ true);
}

export async function runTaxAuditor(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: AuditProgressEvent) => void,
  defaultPeriod?: string,
): Promise<AuditorResult> {
  onProgress?.({
    type: 'auditor_progress',
    domain: 'tributario',
    detail: 'Validando cumplimiento tributario contra E.T. 2026...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'tax-auditor',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: TaxAuditReportSchema,
    system: buildTaxAuditorPrompt(company, language),
    userContent: `REPORTE FINANCIERO A AUDITAR:\n\n${reportContent}`,
    ...MODELS_CONFIG.taxAuditor,
  });

  return toLegacyAuditorResult(json, defaultPeriod);
}

// ---------------------------------------------------------------------------
// Adapter local: JSON strict -> AuditorResult legacy
// ---------------------------------------------------------------------------

function toLegacyAuditorResult(
  json: TaxAuditReportJson,
  defaultPeriod: string | undefined,
): AuditorResult {
  const findings: AuditFinding[] = json.findings.map((f) => mapFinding(f, defaultPeriod));
  return {
    domain: 'tributario',
    auditorName: 'Auditor Tributario',
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
  // El AuditFinding legacy no tiene impactCop. Concatenamos la exposicion al
  // campo `impact` cuando el LLM la cuantifique — el renderer PDF Elite ya
  // sabe extraerla del impact text.
  const baseImpact = f.impact;
  const cop = f.impactCop;
  const exposureLine =
    cop !== null
      ? ` (Exposicion estimada: ${fmtMoneyCop(cop)})`
      : '';

  return {
    code: f.code,
    severity: f.severity,
    domain: 'tributario',
    title: f.title,
    description: f.description,
    normReference: f.normReference,
    recommendation: f.recommendation,
    impact: `${baseImpact}${exposureLine}`,
    period: f.period ?? defaultPeriod,
  };
}

function renderMarkdown(json: TaxAuditReportJson, findings: AuditFinding[]): string {
  const lines: string[] = [];
  lines.push(`## SCORE\n${json.complianceScore}`);
  lines.push('');
  lines.push(`## RESUMEN EJECUTIVO\n${json.executiveSummary}`);
  if (json.totalFiscalExposureCop !== null) {
    lines.push('');
    lines.push(
      `**Exposicion fiscal total estimada:** ${fmtMoneyCop(json.totalFiscalExposureCop)}`,
    );
  }
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
