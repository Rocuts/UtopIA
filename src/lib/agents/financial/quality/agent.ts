// ---------------------------------------------------------------------------
// Meta-Auditor de Calidad y Best Practices 2026 — outcome-first GPT-5.4
// ---------------------------------------------------------------------------
// Evalua el pipeline completo (3 agentes + 4 auditores) contra:
//   - IASB Conceptual Framework
//   - IFRS 18 readiness (efectiva 2027)
//   - ISO/IEC 25012 (data quality)
//   - ISO/IEC 42001 (AI governance)
//   - CTCP + Decreto 2420/2496
//
// Llama a `callFinancialAgent` con `QualityReportSchema` y adapta el JSON
// validado al struct legacy `QualityAssessment` que consumen el endpoint
// `/api/financial-quality` y el renderer PDF Elite.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../agents/runtime';
import { buildQualityAuditorPrompt } from './prompt';
import { QualityReportSchema, type QualityReportJson } from '../contracts/quality-report';
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
  const systemPrompt = buildQualityAuditorPrompt(input.report.company, input.language);
  const userContent = buildUserContent(input);

  const { json } = await callFinancialAgent({
    agentName: 'quality-meta-auditor',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: QualityReportSchema,
    system: systemPrompt,
    userContent,
    ...MODELS_CONFIG.qualityMetaAuditor,
  });

  return toLegacyQualityAssessment(json);
}

// ---------------------------------------------------------------------------
// User content composer — concatena reporte + auditoria + preprocesador
// ---------------------------------------------------------------------------

function buildUserContent(input: QualityAuditInput): string {
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
    const periods = input.preprocessed.periods;
    const totalDiscrepancies = periods.reduce((acc, p) => acc + p.discrepancies.length, 0);
    const allBalanced = periods.every((p) => p.summary.equationBalanced);
    const failingPeriods = periods.filter((p) => !p.summary.equationBalanced).map((p) => p.period);

    sections.push('\n=== INFORME DE VALIDACION ARITMETICA (Preprocesador) ===');
    sections.push(input.preprocessed.validationReport);
    sections.push(`\nCuentas auxiliares procesadas: ${input.preprocessed.auxiliaryCount}`);
    sections.push(`Periodos detectados: ${periods.length} (${periods.map((p) => p.period).join(', ')})`);
    sections.push(`Periodo primario: ${input.preprocessed.primary.period}`);

    if (input.preprocessed.comparative) {
      sections.push(`Periodo comparativo: ${input.preprocessed.comparative.period}`);
    } else if (periods.length === 1) {
      sections.push('Sin periodo comparativo disponible');
    }

    sections.push(`Discrepancias totales (todos los periodos): ${totalDiscrepancies}`);
    sections.push(
      `Ecuacion patrimonial: ${allBalanced ? 'CUADRA en todos los periodos' : `NO CUADRA en ${failingPeriods.join(', ')}`}`,
    );

    if (periods.length > 1) {
      sections.push(
        `\n[META-AUDITORIA] Hay ${periods.length} periodos disponibles. ` +
          `EVALUA si el reporte presenta los datos comparativos correctamente. ` +
          `Si solo cubre el periodo primario (${input.preprocessed.primary.period}) ` +
          `e ignora el comparativo (${input.preprocessed.comparative?.period ?? 'N/A'}), ` +
          `ese es un HALLAZGO CRITICO de calidad multiperiodo (D14).`,
      );
    }
  }

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Adapter local: JSON strict -> QualityAssessment legacy
// ---------------------------------------------------------------------------

function toLegacyQualityAssessment(json: QualityReportJson): QualityAssessment {
  const dimensions: QualityDimension[] = json.dimensions.map((d) => ({
    name: d.name,
    score: d.score,
    framework: d.framework,
    findings: d.findings,
    recommendations: d.recommendations,
  }));

  return {
    overallScore: json.overallScore,
    grade: json.grade,
    dimensions,
    ifrs18Readiness: {
      ready: json.ifrs18Readiness.ready,
      score: json.ifrs18Readiness.score,
      gaps: json.ifrs18Readiness.gaps,
    },
    dataQuality: {
      completeness: json.dataQuality.completeness,
      accuracy: json.dataQuality.accuracy,
      consistency: json.dataQuality.consistency,
      timeliness: json.dataQuality.timeliness,
      validity: json.dataQuality.validity,
    },
    aiGovernance: {
      traceability: json.aiGovernance.traceability,
      explainability: json.aiGovernance.explainability,
      antiHallucination: json.aiGovernance.antiHallucination,
      humanOversight: json.aiGovernance.humanOversight,
    },
    executiveSummary: json.executiveSummary,
    fullReport: renderMarkdown(json),
    generatedAt: new Date().toISOString(),
  };
}

function renderMarkdown(json: QualityReportJson): string {
  const lines: string[] = [];
  lines.push(`## SCORE GLOBAL\n${json.overallScore}`);
  lines.push('');
  lines.push(`## GRADE\n${json.grade}`);
  lines.push('');
  lines.push(`## RESUMEN EJECUTIVO\n${json.executiveSummary}`);
  lines.push('');
  lines.push('## DIMENSIONES DE CALIDAD');
  for (const d of json.dimensions) {
    lines.push('');
    lines.push(`### ${d.name} (${d.score}/100) — ${d.framework}`);
    if (d.findings.length > 0) {
      lines.push('**Hallazgos:**');
      for (const f of d.findings) lines.push(`- ${f}`);
    }
    if (d.recommendations.length > 0) {
      lines.push('**Recomendaciones:**');
      for (const r of d.recommendations) lines.push(`- ${r}`);
    }
  }
  lines.push('');
  lines.push('## CALIDAD DE DATOS (ISO 25012)');
  lines.push(`completeness: ${json.dataQuality.completeness}`);
  lines.push(`accuracy: ${json.dataQuality.accuracy}`);
  lines.push(`consistency: ${json.dataQuality.consistency}`);
  lines.push(`timeliness: ${json.dataQuality.timeliness}`);
  lines.push(`validity: ${json.dataQuality.validity}`);
  lines.push('');
  lines.push('## GOBERNANZA IA (ISO 42001)');
  lines.push(`traceability: ${json.aiGovernance.traceability}`);
  lines.push(`explainability: ${json.aiGovernance.explainability}`);
  lines.push(`anti_hallucination: ${json.aiGovernance.antiHallucination}`);
  lines.push(`human_oversight: ${json.aiGovernance.humanOversight}`);
  lines.push('');
  lines.push('## PREPARACION IFRS 18');
  lines.push(`ready: ${json.ifrs18Readiness.ready}`);
  lines.push(`score: ${json.ifrs18Readiness.score}`);
  if (json.ifrs18Readiness.gaps.length > 0) {
    lines.push('gaps:');
    for (const g of json.ifrs18Readiness.gaps) lines.push(`- ${g}`);
  }
  lines.push('');
  lines.push('## RECOMENDACIONES PRIORITARIAS');
  for (const r of json.priorityRecommendations) {
    lines.push(`- [${r.priority.toUpperCase()}] ${r.action} (${r.framework})`);
  }
  lines.push('');
  lines.push(`## CONCLUSION\n${json.conclusion}`);
  return lines.join('\n');
}
