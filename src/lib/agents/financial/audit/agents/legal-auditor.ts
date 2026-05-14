// ---------------------------------------------------------------------------
// Auditor Legal/Societario — outcome-first GPT-5.4 (Fase 2.B) + Wave 7.B1
// ---------------------------------------------------------------------------
// Llama a `callFinancialAgent` con `LegalAuditReportSchema` y adapta el JSON
// validado al struct legacy `AuditorResult`.
//
// Wave 7.B1: renderMarkdown emite el formato visual ASCII-boxed del Spec v2.1
// "Dictamen 3 — Auditor Legal" cuando los nuevos campos estructurados estan
// presentes. Si los campos son null (fallback), produce el render legacy.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../../agents/runtime';
import { buildLegalAuditorPrompt } from '../prompts/legal-auditor.prompt';
import {
  LegalAuditReportSchema,
  type LegalAuditReportJson,
  type AuditFindingJson,
  type SocietaryObligationJson,
  type SocietaryObligationStatusJson,
  type LegalAuditOpinionTypeJson,
  type LegalRequiredActionJson,
  type RiesgoLegalJson,
} from '../../contracts/audit-report';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
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

  return toLegacyAuditorResult(json, company, defaultPeriod);
}

// ---------------------------------------------------------------------------
// Adapter local: JSON strict -> AuditorResult legacy
// ---------------------------------------------------------------------------

function toLegacyAuditorResult(
  json: LegalAuditReportJson,
  company: CompanyInfo,
  defaultPeriod: string | undefined,
): AuditorResult {
  const findings: AuditFinding[] = json.findings.map((f) => mapFinding(f, defaultPeriod));
  return {
    domain: 'legal',
    auditorName: 'Auditor Legal/Societario',
    complianceScore: json.complianceScore,
    findings,
    summary: json.executiveSummary,
    fullContent: renderMarkdown(json, findings, company),
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

// ---------------------------------------------------------------------------
// renderMarkdown — Spec v2.1 Dictamen 3 (ASCII boxed)
// ---------------------------------------------------------------------------
// Si los campos estructurados estan presentes (societaryObligations,
// patrimonyDistribution, auditOpinion, requiredActions), renderiza el formato
// visual del Spec v2.1. Caso contrario, fallback al render legacy.
// ---------------------------------------------------------------------------

const ASCII_FRAME = '═══════════════════════════════════════════════════════════════════';

const STATUS_BADGE: Record<SocietaryObligationStatusJson, string> = {
  cumplido: '[✅ CUMPLIDO]',
  parcial: '[⚠ PARCIAL]',
  incumplido: '[❌ INCUMPLIDO]',
  no_aplica: '[— N/D]',
};

const OPINION_LABEL: Record<LegalAuditOpinionTypeJson, string> = {
  sin_observaciones: 'SIN OBSERVACIONES',
  con_observaciones_subsanables: 'CON OBSERVACIONES SUBSANABLES',
  con_hallazgos_inmediatos: 'CON HALLAZGOS QUE EXIGEN ACCION INMEDIATA',
};

/**
 * Renderiza el dictamen legal a Markdown ASCII-boxed (Spec v2.1 Dictamen 3).
 * Exportado para testeo de snapshot. Cuando los campos v2.1 son null,
 * produce el render legacy compatible con el orchestrator existente.
 */
export function renderLegalAuditorMarkdown(
  json: LegalAuditReportJson,
  findings: AuditFinding[],
  company: CompanyInfo,
): string {
  return renderMarkdown(json, findings, company);
}

function renderMarkdown(
  json: LegalAuditReportJson,
  findings: AuditFinding[],
  company: CompanyInfo,
): string {
  const hasV21Structure =
    json.societaryObligations !== null ||
    json.patrimonyDistribution !== null ||
    json.capitalizacionAnalysis !== null ||
    json.riesgosLegales !== null ||
    json.auditOpinion !== null ||
    json.requiredActions !== null;

  const lines: string[] = [];

  if (hasV21Structure) {
    lines.push(ASCII_FRAME);
    lines.push('  DICTAMEN 3 — AUDITOR LEGAL Y SOCIETARIO');
    lines.push(`  ${company.name}  ·  NIT ${company.nit}  ·  Periodo ${company.fiscalPeriod}`);
    lines.push(ASCII_FRAME);
    lines.push('');
    lines.push(`**Score de cumplimiento legal:** ${json.complianceScore}/100`);
    lines.push('');
    lines.push('## 1. RESUMEN EJECUTIVO');
    lines.push('');
    lines.push(json.executiveSummary);
    lines.push('');

    if (json.societaryObligations && json.societaryObligations.length > 0) {
      lines.push('## 2. CHECKLIST DE OBLIGACIONES SOCIETARIAS');
      lines.push('');
      for (let i = 0; i < json.societaryObligations.length; i++) {
        const o: SocietaryObligationJson = json.societaryObligations[i];
        const idx = String(i + 1).padStart(2, '0');
        const badge = STATUS_BADGE[o.status];
        lines.push(`- ${idx}. ${badge} **${o.obligation}** — ${o.reference}`);
        if (o.comment) {
          lines.push(`     ${o.comment}`);
        }
      }
      lines.push('');
    }

    if (json.patrimonyDistribution) {
      const p = json.patrimonyDistribution;
      lines.push('## 3. DISTRIBUCION DEL PATRIMONIO');
      lines.push('');
      lines.push(ASCII_FRAME);
      lines.push(`  Utilidad neta del ejercicio    : ${fmtMoneyOrND(p.utilidadNetaCop)}`);
      lines.push(`  Reserva legal obligatoria      : ${p.reservaLegalObligatoria ? 'SI (Art. 452 C.Co.)' : 'NO'}`);
      lines.push(`  Monto reserva 10%              : ${fmtMoneyOrND(p.montoReserva10pctCop)}`);
      lines.push(`  Utilidad disponible            : ${fmtMoneyOrND(p.utilidadDisponibleCop)}`);
      lines.push(`  Tipo de dividendo posible      : ${p.tipoDividendoPosible ?? 'N/D'}`);
      lines.push(ASCII_FRAME);
      lines.push('');
      lines.push(`**Impuesto a dividendos:** ${p.impuestoDividendosComment}`);
      lines.push('');
    }

    if (json.capitalizacionAnalysis) {
      const c = json.capitalizacionAnalysis;
      lines.push('## 4. ANALISIS DE CAPITALIZACION');
      lines.push('');
      lines.push(`- **Propuesta:** ${c.proposed ? 'SI' : 'NO'}`);
      lines.push(`- **Base legal:** ${c.baseLegal}`);
      lines.push(`- **Documento requerido:** ${c.documentoRequerido}`);
      lines.push(`- **Beneficio fiscal:** ${c.beneficioFiscal}`);
      if (c.procedimiento.length > 0) {
        lines.push('- **Procedimiento:**');
        for (let i = 0; i < c.procedimiento.length; i++) {
          lines.push(`  ${i + 1}. ${c.procedimiento[i]}`);
        }
      }
      lines.push('');
    }

    if (json.riesgosLegales && json.riesgosLegales.length > 0) {
      lines.push('## 5. RIESGOS LEGALES IDENTIFICADOS');
      lines.push('');
      for (const r of json.riesgosLegales) {
        const r2: RiesgoLegalJson = r;
        const probLabel = r2.probabilidad.toUpperCase();
        lines.push(`- [${probLabel}] **${r2.descripcion}**`);
        lines.push(`    Norma: ${r2.normaAplicable}`);
        lines.push(`    Consecuencia: ${r2.consecuenciaPotencial}`);
      }
      lines.push('');
    }

    lines.push('## 6. HALLAZGOS DETALLADOS');
    if (findings.length === 0) {
      lines.push('');
      lines.push('*No se encontraron hallazgos legales.*');
    } else {
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
    }
    lines.push('');

    if (json.auditOpinion) {
      lines.push('## 7. OPINION DEL AUDITOR LEGAL');
      lines.push('');
      lines.push(ASCII_FRAME);
      lines.push(`  ${OPINION_LABEL[json.auditOpinion.type]}`);
      lines.push(ASCII_FRAME);
      lines.push('');
      lines.push(json.auditOpinion.text);
      lines.push('');
    }

    if (json.requiredActions && json.requiredActions.length > 0) {
      lines.push('## 8. ACCIONES REQUERIDAS');
      lines.push('');
      for (const a of json.requiredActions) {
        const a2: LegalRequiredActionJson = a;
        const prioLabel = a2.priority.toUpperCase();
        lines.push(`- [PRIORIDAD ${prioLabel}] ${a2.action}`);
        lines.push(`    Norma: ${a2.reference}`);
        if (a2.plazo) lines.push(`    Plazo: ${a2.plazo}`);
      }
      lines.push('');
    }

    lines.push('## 9. CONCLUSION');
    lines.push('');
    lines.push(json.conclusion);
    lines.push('');
    lines.push(ASCII_FRAME);
    return lines.join('\n');
  }

  // ---- Fallback legacy (cuando los nuevos campos vienen en null) ----
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

// ---------------------------------------------------------------------------
// Helpers de render
// ---------------------------------------------------------------------------

function fmtMoneyOrND(value: string | null): string {
  if (value === null) return 'N/D';
  try {
    return formatCopFromCents(parseMoneyCop(value), true);
  } catch {
    return 'N/D';
  }
}
