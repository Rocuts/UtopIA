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
import {
  QualityReportSchema,
  type QualityGradeJson,
  type QualityReportJson,
} from '../contracts/quality-report';
import type { FinancialReport } from '../types';
import type { AuditReport } from '../audit/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { QualityAssessment, QualityDimension } from './types';
import { deriveReportIntegrity, describeIntegrity } from '../audit/integrity';
import {
  buildQualityV21View,
  getV21DimMeta,
  statusMarker,
  type QualityV21Context,
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
/**
 * Contexto determinista de la meta-auditoría: integridad aritmética del
 * informe (preprocesador + banderas de reconciliación + sello de salvedades)
 * y disponibilidad de comparativo. Sin preprocesador el comparativo se infiere
 * sólo de `company.comparativePeriod`; si no consta queda desconocido (null).
 */
export function deriveQualityContext(input: Pick<QualityAuditInput, 'report' | 'auditReport' | 'preprocessed'>): QualityV21Context {
  const integrity = deriveReportIntegrity(
    input.report,
    input.preprocessed,
    input.auditReport?.integrity ?? null,
  );
  let comparativeAvailable: boolean | null = null;
  if (input.preprocessed) {
    comparativeAvailable =
      input.preprocessed.comparative !== null &&
      input.preprocessed.comparative !== undefined &&
      input.preprocessed.comparativos_impracticables !== true;
  } else if (input.report.company?.comparativePeriod) {
    comparativeAvailable = true;
  }
  return { integrity, comparativeAvailable };
}

export async function runQualityAudit(input: QualityAuditInput): Promise<QualityAssessment> {
  const systemPrompt = buildQualityAuditorPrompt(input.report.company, input.language);
  const context = deriveQualityContext(input);
  const userContent = buildUserContent(input, context);

  const { json } = await callFinancialAgent({
    agentName: 'quality-meta-auditor',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: QualityReportSchema,
    system: systemPrompt,
    userContent,
    ...MODELS_CONFIG.qualityMetaAuditor,
  });

  return toLegacyQualityAssessment(json, input.report.company, context);
}

// ---------------------------------------------------------------------------
// User content composer — concatena reporte + auditoria + preprocesador
// ---------------------------------------------------------------------------

function buildUserContent(input: QualityAuditInput, context: QualityV21Context): string {
  const sections: string[] = [];

  sections.push('=== REPORTE FINANCIERO CONSOLIDADO (3 Agentes) ===');
  sections.push(input.report.consolidatedReport);

  if (input.auditReport) {
    sections.push('\n=== INFORME DE AUDITORIA (4 Auditores) ===');
    sections.push(input.auditReport.consolidatedReport);
    const cov = input.auditReport.coverage;
    sections.push(
      `\nScore de Auditoria: ${input.auditReport.overallScore}/100${cov?.partial ? ` (PARCIAL: ${cov.completed}/${cov.total} dominios)` : ''}`,
    );
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
  } else {
    sections.push(
      '\n=== PREPROCESADOR NO SUMINISTRADO ===\n' +
        'El servidor no recibio el balance preprocesado: el numero de periodos y la ecuacion patrimonial NO estan verificados. ' +
        'D14 (multiperiodo) no es evaluable salvo que el reporte muestre explicitamente dos periodos.',
    );
  }

  sections.push(`\n=== INTEGRIDAD ARITMETICA DETERMINISTA ===\n${describeIntegrity(context.integrity ?? { status: 'no_verificada', motivos: [] })}`);
  if (context.comparativeAvailable === false) {
    sections.push('Sin periodo comparativo utilizable: NO emitas D14 (no evaluable).');
  }

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Score y grade deterministas (auditoria-calidad-10)
// ---------------------------------------------------------------------------

/**
 * Cortes documentados del grade interno (QualityAssessment.grade):
 * A+ ≥ 95 · A ≥ 90 · B ≥ 80 · C ≥ 70 · D ≥ 60 · F < 60.
 */
export function gradeFromScore(score: number): QualityGradeJson {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * overallScore y grade calculados en código, no tomados del LLM
 * (auditoria-calidad-10). El LLM emitía ambos libremente —el esquema acepta
 * `{overallScore: 40, grade: 'A+'}` y "ponderando las 14 dimensiones" no
 * declara pesos—, así que la insignia de la UI y la PDF podían decir "A+ · 96"
 * mientras el sello v2.1 del mismo informe decía "requiere corrección".
 *
 *   overallScore = score global v2.1 (promedio de las dimensiones evaluadas,
 *                  0-10, un decimal) × 10  →  escala 0-100;
 *   grade        = cortes de `gradeFromScore`.
 *
 * Con los mismos cortes del sello (8,0 / 6,0) el grade ≥ B coincide con
 * "certificada" y el F con "requiere corrección". Si el sello está bloqueado
 * (integridad rota o Exactitud < 6), el score se topa en 59 → F
 * (auditoria-calidad-03). Sin ninguna dimensión evaluable no hay score:
 * `null` (N/D), nunca 0.
 */
export function deriveQualityScore(
  view: QualityV21View,
): { overallScore: number | null; grade: QualityGradeJson | null; capped: boolean } {
  if (view.globalScore10 === null) return { overallScore: null, grade: null, capped: false };
  const base = Math.round(view.globalScore10 * 10);
  const blocked = view.sello.type === 'requiere_correccion' && view.selloBlockers.length > 0;
  const overallScore = blocked ? Math.min(base, 59) : base;
  return { overallScore, grade: gradeFromScore(overallScore), capped: overallScore !== base };
}

/**
 * La insignia del workspace/PDF usa el score y el grade del LLM. Si el sello
 * v2.1 determinista es "requiere corrección" (integridad rota o Exactitud
 * bloqueante), el score se topa en 59 y el grade se recalcula: el LLM no
 * puede certificar lo que la aritmética determinista rechaza
 * (auditoria-calidad-03).
 */
export function capLlmScore(
  overallScore: number,
  grade: string,
  view: QualityV21View,
): { overallScore: number; grade: string; capped: boolean } {
  if (view.sello.type !== 'requiere_correccion' || view.selloBlockers.length === 0) {
    return { overallScore, grade, capped: false };
  }
  const cappedScore = Math.min(overallScore, 59);
  const cappedGrade = gradeFromScore(cappedScore);
  return {
    overallScore: cappedScore,
    grade: cappedGrade,
    capped: cappedScore !== overallScore || cappedGrade !== grade,
  };
}

// ---------------------------------------------------------------------------
// Adapter local: JSON strict -> QualityAssessment legacy
// ---------------------------------------------------------------------------

export function toLegacyQualityAssessment(
  json: QualityReportJson,
  company?: { name: string; nit: string; fiscalPeriod: string },
  context: QualityV21Context = {},
): QualityAssessment {
  const view = buildQualityV21View(json, context);
  const derived = deriveQualityScore(view);
  // Sin dimensiones evaluables (inalcanzable con un JSON que pasó Zod: las
  // métricas ISO 25012/42001 son obligatorias) el contrato legado exige un
  // número: se conserva el del LLM topado como no certificable.
  const cap =
    derived.overallScore !== null && derived.grade !== null
      ? { overallScore: derived.overallScore, grade: derived.grade, capped: derived.capped }
      : capLlmScore(Math.min(json.overallScore, 59), 'F', view);
  const dimensions: QualityDimension[] = json.dimensions.map((d) => ({
    name: d.name,
    score: d.score,
    framework: d.framework,
    findings: d.findings,
    recommendations: d.recommendations,
  }));

  return {
    overallScore: cap.overallScore,
    grade: cap.grade,
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
    executiveSummary: cap.capped
      ? `[Score topado por el sello determinista: ${view.selloBlockers.join(' ')}] ${json.executiveSummary}`
      : json.executiveSummary,
    fullReport: renderMarkdown(json, company, context),
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
  context: QualityV21Context = {},
): string {
  const view = buildQualityV21View(json, context);
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
    'Escala: 0–10 por dimensión (un decimal). Umbrales: ✅ aprobado (≥8,0) · ⚠ en revisión (6,0–7,9) · ❌ requiere corrección (<6,0) · — N/D sin fuente (excluida del promedio).',
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
      `| ${dim.num} | ${dim.block} | ${escapeCell(dim.name)} | ${escapeCell(dim.framework)} | ${fmtDimScore(dim.score10)} | ${statusMarker(dim.status)} |`,
    );
  }
  lines.push(
    `| — | — | **SCORE GLOBAL** | Promedio de dimensiones evaluadas | **${fmtDimScore(view.globalScore10)}** | ${statusMarker(view.globalStatus)} |`,
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
  out.push(`- **Score:** ${fmtDimScore(dim.score10)} · **Estado:** ${statusMarker(dim.status)}`);

  return out;
}

function fmtDimScore(score10: number | null): string {
  return score10 === null ? 'N/D' : `${score10.toFixed(1)}/10`;
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
  out.push(`  Score global: ${fmtDimScore(sello.score)}`);
  out.push(`  Dimensiones aprobadas: ${sello.approvedCount}/12 (evaluadas: ${sello.evaluatedCount}/12)`);
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
    case 'no_evaluable':
      return '—';
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
