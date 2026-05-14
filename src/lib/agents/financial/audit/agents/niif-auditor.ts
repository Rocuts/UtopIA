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

// ---------------------------------------------------------------------------
// Renderer v2.1 — Dictamen NIIF formato ASCII boxed
// ---------------------------------------------------------------------------
// Cuando el agente entrega los campos v2.1 (`niifSectionChecks`, `summaryStats`,
// `auditOpinion`, `requiredActions`) se renderiza el dictamen formal con marco
// ASCII y secciones numeradas. Cuando alguno es null, el bloque cae al render
// legacy (findings sueltos) — preservando backward compat.
// ---------------------------------------------------------------------------

const ASCII_FRAME = '═══════════════════════════════════════════════════════════════════';

function statusIcon(status: 'conforme' | 'observacion' | 'incumplimiento'): string {
  switch (status) {
    case 'conforme':
      return '✅';
    case 'observacion':
      return '⚠';
    case 'incumplimiento':
      return '❌';
  }
}

function opinionLabel(type: 'sin_salvedades' | 'con_salvedades' | 'adversa' | 'abstension'): string {
  switch (type) {
    case 'sin_salvedades':
      return 'OPINION SIN SALVEDADES (favorable)';
    case 'con_salvedades':
      return 'OPINION CON SALVEDADES';
    case 'adversa':
      return 'OPINION ADVERSA';
    case 'abstension':
      return 'ABSTENCION DE OPINION';
  }
}

function horizonLabel(h: 'inmediato' | 'corto_plazo' | 'mediano_plazo'): string {
  switch (h) {
    case 'inmediato':
      return 'INMEDIATO';
    case 'corto_plazo':
      return 'CORTO PLAZO';
    case 'mediano_plazo':
      return 'MEDIANO PLAZO';
  }
}

export function renderNiifDictamenMarkdown(
  json: NiifAuditReportJson,
  findings: AuditFinding[],
): string {
  return renderMarkdown(json, findings);
}

function renderMarkdown(json: NiifAuditReportJson, findings: AuditFinding[]): string {
  const hasV21 =
    json.niifSectionChecks !== null &&
    json.summaryStats !== null &&
    json.auditOpinion !== null &&
    json.requiredActions !== null;

  if (!hasV21) {
    return renderLegacyMarkdown(json, findings);
  }

  const lines: string[] = [];
  lines.push(ASCII_FRAME);
  lines.push('DICTAMEN 1 — AUDITOR NIIF');
  lines.push(ASCII_FRAME);
  lines.push('');
  lines.push(`Score de cumplimiento NIIF: ${json.complianceScore}/100`);
  lines.push('');
  lines.push('## 1. ALCANCE');
  lines.push('');
  lines.push(json.executiveSummary);
  lines.push('');

  // 2. HALLAZGOS POR SECCION NIIF
  lines.push('## 2. HALLAZGOS POR SECCION NIIF');
  lines.push('');
  if (findings.length === 0) {
    lines.push('Sin hallazgos materiales registrados.');
    lines.push('');
  } else {
    for (const f of findings) {
      lines.push(`### ${f.code}: ${f.title}`);
      lines.push(`- **Severidad:** ${f.severity.toUpperCase()}`);
      lines.push(`- **Norma:** ${f.normReference}`);
      lines.push(`- **Descripcion:** ${f.description}`);
      lines.push(`- **Recomendacion:** ${f.recommendation}`);
      lines.push(`- **Impacto:** ${f.impact}`);
      if (f.period) lines.push(`- **Periodo:** ${f.period}`);
      lines.push('');
    }
  }

  // 3. LISTA MINIMA DE VERIFICACION (13 secciones NIIF for SMEs)
  lines.push('## 3. LISTA MINIMA DE VERIFICACION');
  lines.push('');
  const checks = json.niifSectionChecks!;
  for (const check of checks) {
    lines.push(
      `- ${statusIcon(check.status)} **${check.section} — ${check.sectionTitle}** [${check.reference}]`,
    );
    lines.push(`  - Hallazgo: ${check.finding}`);
    lines.push(`  - Accion: ${check.action}`);
  }
  lines.push('');

  // 4. RESUMEN ESTADISTICO
  const stats = json.summaryStats!;
  lines.push('## 4. RESUMEN ESTADISTICO');
  lines.push('');
  lines.push(`- ✅ Conformes: ${stats.conformes}`);
  lines.push(`- ⚠ Observaciones: ${stats.observaciones}`);
  lines.push(`- ❌ Incumplimientos: ${stats.incumplimientos}`);
  lines.push('');

  // 5. OPINION FORMAL
  const op = json.auditOpinion!;
  lines.push('## 5. OPINION FORMAL');
  lines.push('');
  lines.push(`**${opinionLabel(op.type)}**`);
  lines.push('');
  lines.push(op.text);
  lines.push('');

  // 6. ACCIONES REQUERIDAS
  const actions = json.requiredActions!;
  lines.push('## 6. ACCIONES REQUERIDAS');
  lines.push('');
  if (actions.length === 0) {
    lines.push('□ Ninguna accion adicional requerida.');
  } else {
    for (const a of actions) {
      lines.push(`- □ **[${horizonLabel(a.horizon)}]** ${a.action}`);
      lines.push(`  - Referencia: ${a.reference}`);
    }
  }
  lines.push('');

  // 7. CONCLUSION
  lines.push('## 7. CONCLUSION');
  lines.push('');
  lines.push(json.conclusion);
  lines.push('');
  lines.push(ASCII_FRAME);
  lines.push('FIN DEL DICTAMEN 1');
  lines.push(ASCII_FRAME);

  return lines.join('\n');
}

function renderLegacyMarkdown(json: NiifAuditReportJson, findings: AuditFinding[]): string {
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
