// ---------------------------------------------------------------------------
// Auditor de Revisoria Fiscal — outcome-first GPT-5.4 (Fase 2.B)
// ---------------------------------------------------------------------------
// Llama a `callFinancialAgent` con `FiscalReviewReportSchema` y adapta al
// struct legacy. Mantiene el override `enforceOpinionCoherence` (no-blanqueo)
// que ya existia en la version anterior — es una salvaguarda determinista que
// debe sobrevivir al refactor.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../../agents/runtime';
import { buildFiscalReviewerPrompt } from '../prompts/fiscal-reviewer.prompt';
import {
  FiscalReviewReportSchema,
  type FiscalReviewReportJson,
  type AuditFindingJson,
} from '../../contracts/audit-report';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import type { CompanyInfo } from '../../types';
import type {
  AuditorResult,
  AuditFinding,
  AuditOpinionType,
  AuditProgressEvent,
} from '../types';

export async function runFiscalReviewer(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: AuditProgressEvent) => void,
  defaultPeriod?: string,
): Promise<AuditorResult & { opinionType: AuditOpinionType; dictamen: string }> {
  onProgress?.({
    type: 'auditor_progress',
    domain: 'revisoria',
    detail: 'Evaluando razonabilidad y materialidad (NIA/ISA)...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'fiscal-reviewer',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: FiscalReviewReportSchema,
    system: buildFiscalReviewerPrompt(company, language),
    userContent: `REPORTE FINANCIERO COMPLETO A AUDITAR:\n\n${reportContent}`,
    ...MODELS_CONFIG.fiscalReviewer,
  });

  return toLegacyAuditorResult(json, defaultPeriod);
}

// ---------------------------------------------------------------------------
// Adapter local: JSON strict -> AuditorResult legacy + opinionType + dictamen
// ---------------------------------------------------------------------------

function toLegacyAuditorResult(
  json: FiscalReviewReportJson,
  defaultPeriod: string | undefined,
): AuditorResult & { opinionType: AuditOpinionType; dictamen: string } {
  const findings: AuditFinding[] = json.findings.map((f) => mapFinding(f, defaultPeriod));

  // Why: salvaguarda determinista — el LLM puede emitir findings criticos y
  // concluir con opinion favorable (blanqueo). Forzamos coherencia minima.
  const opinionType = enforceOpinionCoherence(json.opinionType, findings);

  return {
    domain: 'revisoria',
    auditorName: 'Auditor de Revisoria Fiscal',
    complianceScore: json.complianceScore,
    findings,
    summary: json.executiveSummary,
    fullContent: renderMarkdown(json, findings, opinionType),
    failed: false,
    opinionType,
    dictamen: json.dictamen,
  };
}

/**
 * Override post-parse: garantiza que la opinion del Revisor Fiscal sea
 * COHERENTE con los hallazgos que el mismo emitio. Reglas (NIA 705 §7-§10):
 *  - 1+ findings "critico" → DESFAVORABLE como minimo.
 *  - 1+ findings "alto" → CON SALVEDADES como minimo.
 *  - Resto → respeta la opinion del LLM.
 */
function enforceOpinionCoherence(
  raw: AuditOpinionType,
  findings: AuditFinding[],
): AuditOpinionType {
  const hasCritico = findings.some((f) => f.severity === 'critico');
  const hasAlto = findings.some((f) => f.severity === 'alto');

  if (hasCritico) {
    if (raw === 'favorable' || raw === 'con_salvedades') return 'desfavorable';
    return raw;
  }
  if (hasAlto) {
    if (raw === 'favorable') return 'con_salvedades';
    return raw;
  }
  return raw;
}

function mapFinding(
  f: AuditFindingJson,
  defaultPeriod: string | undefined,
): AuditFinding {
  return {
    code: f.code,
    severity: f.severity,
    domain: 'revisoria',
    title: f.title,
    description: f.description,
    normReference: f.normReference,
    recommendation: f.recommendation,
    impact: f.impact,
    period: f.period ?? defaultPeriod,
  };
}

function renderMarkdown(
  json: FiscalReviewReportJson,
  findings: AuditFinding[],
  opinionType: AuditOpinionType,
): string {
  const lines: string[] = [];
  lines.push(`## SCORE\n${json.complianceScore}`);
  lines.push('');
  lines.push(`## RESUMEN EJECUTIVO\n${json.executiveSummary}`);
  lines.push('');
  lines.push('## MATERIALIDAD');
  lines.push(`- **Benchmark:** ${json.materiality.benchmarkLabel}`);
  lines.push(`- **Materialidad:** ${formatCopFromCents(parseMoneyCop(json.materiality.materialityAmountCop), true)}`);
  lines.push(`- **Materialidad de ejecucion:** ${formatCopFromCents(parseMoneyCop(json.materiality.performanceMateriality), true)}`);
  lines.push(`- **Comentario:** ${json.materiality.comment}`);
  lines.push('');
  lines.push('## EMPRESA EN FUNCIONAMIENTO');
  lines.push(
    `- **Incertidumbre material:** ${json.goingConcern.hasMaterialUncertainty ? 'SI' : 'NO'}`,
  );
  if (json.goingConcern.indicatorsFound.length > 0) {
    lines.push('- **Indicadores observados:**');
    for (const ind of json.goingConcern.indicatorsFound) lines.push(`  - ${ind}`);
  }
  lines.push(`- **Conclusion:** ${json.goingConcern.conclusion}`);
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
  lines.push(`## TIPO DE OPINION\n${opinionType}`);
  lines.push('');
  lines.push(`## DICTAMEN\n${json.dictamen}`);
  return lines.join('\n');
}
