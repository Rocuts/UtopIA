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
import {
  buildQualityV21View,
  getV21DimMeta,
  statusMarker,
  type QualityV21Dimension,
  type QualityV21View,
  type QualityV21SelloType,
} from './v21-mapping';

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

  return toLegacyQualityAssessment(json, input.report.company);
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

function toLegacyQualityAssessment(
  json: QualityReportJson,
  company?: { name: string; nit: string; fiscalPeriod: string },
): QualityAssessment {
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
    fullReport: renderMarkdown(json, company),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Markdown renderer — Spec v2.1 (Parte V) primary, 14-dim appendix as fallback
// ---------------------------------------------------------------------------
// The output is composed in this order:
//   1. Top frame banner (company + NIT + período)
//   2. Resumen ejecutivo (from json.executiveSummary)
//   3. Three block frames (A=ISO 25012, B=ISO/IEC 42001, C=IASB QC) each with
//      4 dimensions in the v2.1 format
//   4. Tabla resumen meta-auditoría (12 rows + global)
//   5. Sello de calidad (one of three variants)
//   6. Acciones correctivas priorizadas (only if any dim < 7/10)
//   7. Conclusión (from json.conclusion)
//   8. Appendix: legacy 14-dim block + raw ISO 25012 / 42001 / IFRS 18 details
//
// The v2.1 visual frame is the PRIMARY contract. The legacy 14-dim appendix
// remains so downstream consumers (PDF Élite, dashboards) that parse the raw
// scores stay backward-compatible.
// ---------------------------------------------------------------------------

const FRAME_TOP = '╔════════════════════════════════════════════════════════════════════════════╗';
const FRAME_MID = '║                                                                            ║';
const FRAME_BOT = '╚════════════════════════════════════════════════════════════════════════════╝';
const BLOCK_TOP = '┌────────────────────────────────────────────────────────────────────────────┐';
const BLOCK_BOT = '└────────────────────────────────────────────────────────────────────────────┘';
const SELLO_TOP = '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓';
const SELLO_BOT = '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛';

function renderMarkdown(
  json: QualityReportJson,
  company?: { name: string; nit: string; fiscalPeriod: string },
): string {
  const view = buildQualityV21View(json);
  const lines: string[] = [];

  // --- Top frame banner -----------------------------------------------------
  lines.push(FRAME_TOP);
  lines.push(centerInFrame('META-AUDITORÍA DE CALIDAD 1+1 — SPEC v2.1 (Parte V)'));
  if (company) {
    lines.push(
      centerInFrame(`Informe: ${company.name} · NIT: ${company.nit} · Período: ${company.fiscalPeriod}`),
    );
  }
  lines.push(FRAME_BOT);
  lines.push('');
  lines.push('**EVALUACIÓN EN 12 DIMENSIONES**');
  lines.push('');
  lines.push(
    'Escala: 0–10 por dimensión. Umbrales: ✅ aprobado (≥8) · ⚠ en revisión (6–7) · ❌ requiere corrección (<6).',
  );
  lines.push('');

  // --- Resumen ejecutivo ----------------------------------------------------
  lines.push('## RESUMEN EJECUTIVO');
  lines.push('');
  lines.push(json.executiveSummary);
  lines.push('');

  // --- Bloques A / B / C ----------------------------------------------------
  for (const blockLetter of ['A', 'B', 'C'] as const) {
    const dimsInBlock = view.dimensions.filter((d) => d.block === blockLetter);
    if (dimsInBlock.length === 0) continue;
    const blockTitle = dimsInBlock[0].blockTitle;

    lines.push(BLOCK_TOP);
    lines.push(`  BLOQUE ${blockLetter} — ${blockTitle}`);
    lines.push(BLOCK_BOT);
    lines.push('');

    for (const dim of dimsInBlock) {
      lines.push(...renderDimensionBlock(dim));
      lines.push('');
    }
  }

  // --- Tabla resumen meta-auditoría -----------------------------------------
  lines.push('## TABLA RESUMEN META-AUDITORÍA');
  lines.push('');
  lines.push('| # | Bloque | Dimensión | Marco | Score | Estado |');
  lines.push('|---|--------|-----------|-------|------:|:------:|');
  for (const dim of view.dimensions) {
    lines.push(
      `| ${dim.num} | ${dim.block} | ${escapeCell(dim.name)} | ${escapeCell(dim.framework)} | ${dim.scoreInt0to10}/10 | ${statusMarker(dim.status)} |`,
    );
  }
  lines.push(
    `| — | — | **SCORE GLOBAL** | Promedio aritmético | **${view.globalScoreInt0to10.toFixed(1)}/10** | ${statusMarker(view.globalStatus)} |`,
  );
  lines.push('');

  // --- Sello de calidad -----------------------------------------------------
  lines.push(...renderSelloBlock(view));
  lines.push('');

  // --- Acciones correctivas priorizadas -------------------------------------
  if (view.correctiveActions.length > 0) {
    lines.push('## ACCIONES CORRECTIVAS PRIORIZADAS');
    lines.push('');
    lines.push('| Dim # | Dimensión | Acción | Impacto estimado |');
    lines.push('|------:|-----------|--------|------------------:|');
    for (const a of view.correctiveActions) {
      lines.push(
        `| ${a.dimNum} | ${escapeCell(a.dimName)} | ${escapeCell(a.action)} | +${a.impactPoints.toFixed(1)} pts |`,
      );
    }
    lines.push('');
  }

  // --- Conclusión ----------------------------------------------------------
  lines.push('## CONCLUSIÓN');
  lines.push('');
  lines.push(json.conclusion);
  lines.push('');

  // --- Appendix: legacy 14-dim + raw blocks ---------------------------------
  lines.push('---');
  lines.push('');
  lines.push('## APÉNDICE — Detalle interno (14 dimensiones D1..D14)');
  lines.push('');
  lines.push(
    '_Las 12 dimensiones del informe ejecutivo arriba se derivan de este detalle interno conforme al mapeo de la Spec v2.1 Parte V._',
  );
  lines.push('');
  for (const d of json.dimensions) {
    lines.push(`### ${d.name} (${d.score}/100) — ${d.framework}`);
    if (d.findings.length > 0) {
      lines.push('**Hallazgos:**');
      for (const f of d.findings) lines.push(`- ${f}`);
    }
    if (d.recommendations.length > 0) {
      lines.push('**Recomendaciones:**');
      for (const r of d.recommendations) lines.push(`- ${r}`);
    }
    lines.push('');
  }
  lines.push('### Calidad de Datos (ISO 25012) — métricas raw');
  lines.push(`- completeness: ${json.dataQuality.completeness}`);
  lines.push(`- accuracy: ${json.dataQuality.accuracy}`);
  lines.push(`- consistency: ${json.dataQuality.consistency}`);
  lines.push(`- timeliness: ${json.dataQuality.timeliness}`);
  lines.push(`- validity: ${json.dataQuality.validity}`);
  lines.push('');
  lines.push('### Gobernanza IA (ISO/IEC 42001) — métricas raw');
  lines.push(`- traceability: ${json.aiGovernance.traceability}`);
  lines.push(`- explainability: ${json.aiGovernance.explainability}`);
  lines.push(`- anti_hallucination: ${json.aiGovernance.antiHallucination}`);
  lines.push(`- human_oversight: ${json.aiGovernance.humanOversight}`);
  lines.push('');
  lines.push('### Preparación NIIF 18');
  lines.push(`- ready: ${json.ifrs18Readiness.ready}`);
  lines.push(`- score: ${json.ifrs18Readiness.score}`);
  if (json.ifrs18Readiness.gaps.length > 0) {
    lines.push('- gaps:');
    for (const g of json.ifrs18Readiness.gaps) lines.push(`  - ${g}`);
  }
  lines.push('');
  if (json.priorityRecommendations.length > 0) {
    lines.push('### Recomendaciones prioritarias (top-5 del meta-auditor)');
    for (const r of json.priorityRecommendations) {
      lines.push(`- [${r.priority.toUpperCase()}] ${r.action} (${r.framework})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Renders a single v2.1 dimension as a 5-line block (DIM header + Definición +
 * Verificación + Puntos detectados + Score & Estado).
 */
function renderDimensionBlock(dim: QualityV21Dimension): string[] {
  const meta = getV21DimMeta(dim.num);
  const def = meta?.definition ?? '';
  const ver = meta?.verification ?? '';
  const out: string[] = [];

  out.push(`### DIM ${dim.num} · ${dim.name}`);
  out.push(`- **Marco:** ${dim.framework}`);
  if (def) out.push(`- **Definición:** ${def}`);
  if (ver) out.push(`- **Verificación:** ${ver}`);

  if (dim.points.length > 0) {
    out.push('- **Puntos detectados:**');
    for (const p of dim.points) {
      out.push(`  - ${p}`);
    }
  } else {
    out.push('- **Puntos detectados:** _(sin observaciones materiales)_');
  }
  out.push(`- **Score:** ${dim.scoreInt0to10}/10 · **Estado:** ${statusMarker(dim.status)}`);

  return out;
}

/**
 * Renders the sello de calidad as a bordered block. One of three variants
 * (certificada / con_observaciones / requiere_correccion) based on the global
 * score.
 */
function renderSelloBlock(view: QualityV21View): string[] {
  const sello = view.sello;
  const out: string[] = [];

  out.push(SELLO_TOP);
  out.push(`  ${selloIcon(sello.type)}  ${sello.title}`);
  out.push(`  Score global: ${sello.score.toFixed(1)}/10`);
  out.push(`  Dimensiones aprobadas: ${sello.approvedCount}/12`);
  out.push(`  ${sello.bottomLine}`);
  out.push(SELLO_BOT);

  return out;
}

function selloIcon(type: QualityV21SelloType): string {
  switch (type) {
    case 'certificada':
      return '✅';
    case 'con_observaciones':
      return '⚠';
    case 'requiere_correccion':
      return '❌';
  }
}

/**
 * Centers text inside the 76-column frame banner. Trims to fit and pads with
 * spaces between the left and right `║` markers.
 */
function centerInFrame(text: string): string {
  const inner = 76; // characters between the two ║
  let t = text;
  if (t.length > inner) t = t.slice(0, inner - 1) + '…';
  const total = inner - t.length;
  const left = Math.floor(total / 2);
  const right = total - left;
  return `║${' '.repeat(left)}${t}${' '.repeat(right)}║`;
}

/** Escape pipe and newline characters so Markdown table cells stay intact. */
function escapeCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

// ---------------------------------------------------------------------------
// Test-only re-export
// ---------------------------------------------------------------------------
//
// `renderMarkdown` is internal; the public surface is `runQualityAudit`. We
// expose this thin alias so the unit tests can assert the exact Markdown
// structure without requiring an LLM call. Do not import this outside of
// tests — production code reads `QualityAssessment.fullReport` instead.
export const __test_renderMarkdown = renderMarkdown;
