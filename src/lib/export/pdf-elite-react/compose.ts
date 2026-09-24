// compose.ts — translates the 3-agent FinancialReport (+ preprocessed totals,
// + Pillars aggregate, + emittable gate) into the canonical EditorialReport IR
// consumed by EditorialReportDoc (Bucket B).
// ─────────────────────────────────────────────────────────────────────────────
// Internals are deterministic: parsers for GFM tables, heading sections and
// numbered recommendation lists; ratio computation for dial gauges; KPI grid
// synthesis; pillar mapping; norm-citation regex extractor.
//
// Defensive throughout: every reach into `preprocessed` uses optional chaining
// because A3 is mid-flight extending the shape.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AdjustmentRow,
  AreaKey,
  AuditFindingDomain,
  AuditFindingRow,
  AuditFindingSeverity,
  AuditFindingsSpec,
  AuditOpinionKind,
  AuditorScoreCard,
  DialGaugeSpec,
  EditorialReport,
  EmittableGate,
  EmphasisParagraphSpec,
  KpiCell,
  KpiGridSpec,
  NormCitation,
  OutputOptionsToggle,
  ParsedTable,
  ParsedTableRow,
  PillarSatellite,
  PillarsSpec,
  PortraitSpec,
  QualityDimensionBar,
  QualityScoresSpec,
  RecommendationItem,
  ReportMeta,
  SignatureBlockSpec,
  TocEntry,
  WaterfallItem,
} from './types';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';
import type { QualityReportJson } from '@/lib/agents/financial/contracts/quality-report';
import { buildQualityV21View, type QualityV21Context } from '@/lib/agents/financial/quality/v21-mapping';
import { deriveQualityContext, deriveQualityScore } from '@/lib/agents/financial/quality/agent';
import type {
  ControlTotals,
  PreprocessedBalance,
  PeriodSnapshot,
} from '@/lib/preprocessing/trial-balance';
import type { PillarsResult, PillarMetrics, PillarKpi } from '@/lib/pillars/types';
import type { FiscalOpinionDictamen } from '@/lib/agents/financial/fiscal-opinion/types';
import {
  signatoriesFromCompany,
  renderSignatureBlock,
} from '@/lib/agents/financial/fiscal-opinion/signatories';
import {
  formatStatementNote,
  niifJsonToBalanceTable,
  niifJsonToCashFlowTable,
  niifJsonToEquityTable,
  niifJsonToIncomeTable,
  type StatementTableContext,
} from './compose-statements-from-json';
import { formatCopFromPesos } from '@/lib/agents/financial/contracts/money';
import { narrativeDisclaimer, resolvePeriodoTipos } from '../statement-presentation';
import { revenueBreakdown, type RevenueBreakdown } from '../revenue';

// ─── v2.2 — Scrubber de metadatos internos (correcciones #6, #11, #12) ───────
//
// El composer es la última frontera entre LLM-output y client-facing output.
// Cualquier cadena que salga de aquí hacia PDF/HTML pasa por scrubNotes() o
// scrubInternalMetadata(). Los patrones eliminan identificadores de pase,
// nombres de variables internas, cuentas virtuales y cifras en centavos crudos
// que el modelo puede filtrar en notas técnicas o texto de análisis.
// ─────────────────────────────────────────────────────────────────────────────

// Lista de patrones (case-insensitive) que se eliminan o reescriben antes de
// renderizar a PDF/HTML. v2.2 — correcciones #6, #11, #12 (notas internas).
const FORBIDDEN_REGEXES: Array<{ pattern: RegExp; replacement: string }> = [
  // Pase del agente
  { pattern: /\bPass[\s-]?[123]\b/gi, replacement: '' },
  { pattern: /\banchor(?:s)?\s+Pass[-\s]?[123]\b/gi, replacement: '' },
  { pattern: /\bsegún el orquestador\b/gi, replacement: 'según el sistema' },
  { pattern: /\bel orquestador\b/gi, replacement: 'el sistema' },
  { pattern: /\bel preprocesador\b/gi, replacement: 'el preprocesamiento' },
  // Variables internas
  { pattern: /\bnetIncomePrimary\b/g, replacement: 'utilidad neta del período' },
  { pattern: /\btotalEquityPrimary\b/g, replacement: 'total patrimonio' },
  { pattern: /\btotalAssetsPrimary\b/g, replacement: 'total activo' },
  { pattern: /\btotalLiabilitiesPrimary\b/g, replacement: 'total pasivo' },
  { pattern: /\bamountPrimary\b/g, replacement: 'valor del período actual' },
  { pattern: /\bamountComparative\b/g, replacement: 'valor del período comparativo' },
  { pattern: /\bcuratorFlags\b/g, replacement: '' },
  { pattern: /\bequityConvergenceApplied\b/g, replacement: 'ajuste de convergencia patrimonial' },
  { pattern: /\bcashFlowClosureForced\b/g, replacement: 'cierre EFE asistido' },
  { pattern: /\bnegativeAssetReclassified\b/g, replacement: 'reclasificación de activo con saldo contrario' },
  { pattern: /\bpresumedCostWarning\b/g, replacement: 'alerta de costo presunto' },
  { pattern: /\breclassifiedAmountCop\b/g, replacement: 'monto reclasificado' },
  // Cuentas ficticias del curator
  { pattern: /\b2810ZZ\b/g, replacement: 'cuenta de pasivo transitorio' },
  // Movimientos internos
  { pattern: /\b3605-movimiento-periodo\b/g, replacement: 'movimiento de utilidades acumuladas (cuenta 3605)' },
  // Cifras en centavos crudos: 9+ dígitos sin separadores entre comillas o palabras
  { pattern: /\b(\d{9,})\s*centavos\b/gi, replacement: '' },
  { pattern: /"(\d{9,})"/g, replacement: '' },
  // Encabezados internos del preparador
  { pattern: /^\s*NOTAS INTERNAS DEL PREPARADOR.*$/gim, replacement: '' },
  { pattern: /^\s*NO incluir en EEFF firmables.*$/gim, replacement: '' },
  { pattern: /^\s*Advertencia interna de Valoración.*$/gim, replacement: '' },
  { pattern: /^\s*Notas del Preparador\s*$/gim, replacement: '' },
];

function scrubInternalMetadata(note: string): string {
  let out = note;
  for (const { pattern, replacement } of FORBIDDEN_REGEXES) {
    out = out.replace(pattern, replacement);
  }
  // Colapsa espacios múltiples y limpia trailing punctuation que quedó huérfana
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/\s+([,.;:])/g, '$1');
  out = out.replace(/\(\s*\)/g, '');
  return out.trim();
}

// scrubNotes: scrubbing aplicado en cada punto de ingesta de arrays de notas
function scrubNotes(notes: string[] | null | undefined): string[] {
  if (!notes) return [];
  return notes.map(scrubInternalMetadata).filter((n) => n.length > 0);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ComposeInput {
  report: FinancialReport;
  preprocessed?: PreprocessedBalance | null;
  pillars?: PillarsResult | null;
  language: 'es' | 'en';
  emittable?: EmittableGate;
  /**
   * Dictamen del Revisor Fiscal (NIA 700/705/706) — output del Opinion Drafter.
   * Si presente, su `emphasisParagraphs` se mapea al IR para que el PDF
   * editorial los renderice post-opinion (NIA 706 §A1).
   */
  dictamen?: FiscalOpinionDictamen;
  /**
   * Salida del pipeline de Auditoría Especializada (`/api/financial-audit`).
   * Si presente, se renderiza `AuditFindingsPage` con los 4 auditores +
   * findings + opinion. Si undefined la página se omite.
   */
  auditReport?: AuditReport | null;
  /**
   * Salida del meta-auditor de calidad (`/api/financial-quality`).
   * Si presente, se renderiza `QualityMetaAuditPage` con 12 dimensiones +
   * IFRS 18 + ISO 25012 + ISO 42001. Si undefined la página se omite.
   */
  qualityReport?: QualityAssessment | null;
  /**
   * Toggle del intake — qué entregables incluir en el PDF. Si undefined
   * EditorialReportDoc renderiza el set completo (comportamiento histórico).
   * Si presente, cada flag false omite la(s) página(s) correspondiente(s).
   */
  outputOptions?: OutputOptionsToggle | null;
  /**
   * Procedencia de `auditReport` / `qualityReport`. Sólo 'server-persisted'
   * (versión guardada y autorizada en el servidor) permite renderizar el
   * dictamen especializado y el sello de calidad. Sin ella —hoy la ruta los
   * recibe en el cuerpo de la petición— se omiten y el apéndice lo explica
   * (reportes-export-11): un dictamen "favorable" o un grado "A+" enviados por
   * el cliente no pueden salir con la marca del informe.
   */
  assuranceProvenance?: 'server-persisted' | null;
}

const UNVERIFIED_ASSURANCE_NOTE =
  'Las páginas de Auditoría Especializada y Meta-auditoría de Calidad se omitieron: sus ' +
  'resultados llegaron con la solicitud de exportación y no pueden verificarse contra una ' +
  'versión persistida en el servidor.';

/** Aviso en cursiva al inicio de un bloque de narrativa redactada por el LLM. */
function withNarrativeDisclaimer(md: string, language: 'es' | 'en' = 'es'): string {
  return md.trim() ? `*${narrativeDisclaimer(language)}*\n\n${md}` : md;
}

export function composeEditorialReport(input: ComposeInput): EditorialReport {
  const {
    report,
    preprocessed,
    pillars,
    language,
    emittable,
    dictamen,
    auditReport: auditReportInput,
    qualityReport: qualityReportInput,
    outputOptions,
    assuranceProvenance,
  } = input;
  const assuranceVerified = assuranceProvenance === 'server-persisted';
  const auditReport = assuranceVerified ? auditReportInput : null;
  const qualityReport = assuranceVerified ? qualityReportInput : null;
  const assuranceOmitted = !assuranceVerified && !!(auditReportInput || qualityReportInput);

  const meta = buildMeta(report, language, emittable, preprocessed);
  const cover = buildCover(report, language);
  const toc = { entries: buildTocEntries(language, !!pillars) };
  const directorLetter = buildDirectorLetter(report, language);
  const totals = readControlTotals(preprocessed);
  const revenue = revenueBreakdown(
    (preprocessed as { primary?: PeriodSnapshot } | null | undefined)?.primary ?? null,
    report.niifAnalysis?.json ?? null,
  );
  const kpiGrid = buildKpiGrid(totals, pillars ?? null, revenue);
  const waterfall = { items: buildWaterfall(totals, revenue) };
  const dialGauges = { gauges: buildDialGauges(totals) };
  const pillarsSpec = buildPillarsSpec(pillars ?? null);
  const statements = buildStatements(report, preprocessed, language);
  const breakEven = buildBreakEven(report, language);
  const projectedCashFlow = buildProjectedCashFlow(report, language);
  const notes = { blocks: buildNotes(report, language) };
  const recommendations = { items: buildRecommendations(report, language) };
  const shareholderMinutes = buildShareholderMinutes(report, language);
  const appendix = buildAppendix(report, preprocessed, totals, emittable);
  if (assuranceOmitted) {
    appendix.validationWarnings = [...(appendix.validationWarnings ?? []), UNVERIFIED_ASSURANCE_NOTE];
  }
  const signatureBlock = buildSignatureBlock(report);
  const emphasisParagraphs = buildEmphasisParagraphs(dictamen);

  const out: EditorialReport = {
    meta,
    cover,
    toc,
    directorLetter,
    kpiGrid,
    waterfall,
    dialGauges,
    statements,
    notes,
    recommendations,
    appendix,
    signatureBlock,
  };

  if (outputOptions) {
    // Almacenamos el toggle en el IR. EditorialReportDoc lo lee y gatea
    // cada página. No mutamos data (statements/notes/etc. siguen siendo
    // canónicos); solo metadata de render.
    out.outputOptions = outputOptions;
  }

  if (pillarsSpec) {
    out.pillars = pillarsSpec;
  }
  if (breakEven) {
    out.breakEven = breakEven;
  }
  if (projectedCashFlow) {
    out.projectedCashFlow = projectedCashFlow;
  }
  if (shareholderMinutes) {
    out.shareholderMinutes = shareholderMinutes;
  }
  const auditFindings = buildAuditFindings(auditReport ?? null);
  if (auditFindings) {
    out.auditFindings = auditFindings;
  }
  const qualityScores = buildQualityScores(
    qualityReport ?? null,
    qualityReport ? deriveQualityContext({ report, auditReport: auditReport ?? undefined, preprocessed: preprocessed ?? undefined }) : {},
  );
  if (qualityScores) {
    out.qualityScores = qualityScores;
  }
  if (emphasisParagraphs.length > 0) {
    out.emphasisParagraphs = emphasisParagraphs;
  }

  return out;
}

// ─── Audit findings builder ───────────────────────────────────────────────────
// Map AuditReport (4-auditor pipeline) → AuditFindingsSpec for the PDF page.
// We sort findings by severity descending and take the top N so the page fits
// comfortably; the appendix-style full list would need pagination handling
// outside the current scope.

const SEVERITY_ORDER: Record<AuditFindingSeverity, number> = {
  critico: 0,
  alto: 1,
  medio: 2,
  bajo: 3,
  informativo: 4,
};

const MAX_TOP_FINDINGS = 12;

function buildAuditFindings(audit: AuditReport | null): AuditFindingsSpec | undefined {
  if (!audit) return undefined;

  const auditorCards: AuditorScoreCard[] = (audit.auditorResults ?? []).map((r) => ({
    domain: r.domain as AuditFindingDomain,
    auditorName: r.auditorName,
    complianceScore: Math.round(r.complianceScore),
    findingCount: r.findings?.length ?? 0,
    failed: !!r.failed,
  }));

  const sorted = [...(audit.consolidatedFindings ?? [])].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity as AuditFindingSeverity] ?? 9) -
      (SEVERITY_ORDER[b.severity as AuditFindingSeverity] ?? 9),
  );

  const topFindings: AuditFindingRow[] = sorted.slice(0, MAX_TOP_FINDINGS).map((f) => ({
    code: f.code,
    severity: f.severity as AuditFindingSeverity,
    domain: f.domain as AuditFindingDomain,
    title: scrubInternalMetadata(f.title),
    description: scrubInternalMetadata(f.description),
    normReference: f.normReference,
    recommendation: scrubInternalMetadata(f.recommendation),
    impact: scrubInternalMetadata(f.impact),
  }));

  // Defensive: severity counts may be empty if the orchestrator didn't fill them.
  const findingCounts: Record<AuditFindingSeverity, number> = {
    critico: audit.findingCounts?.critico ?? 0,
    alto: audit.findingCounts?.alto ?? 0,
    medio: audit.findingCounts?.medio ?? 0,
    bajo: audit.findingCounts?.bajo ?? 0,
    informativo: audit.findingCounts?.informativo ?? 0,
  };

  // Cobertura (auditoria-calidad-21): con dominios fallidos el overallScore
  // es un promedio PARCIAL; se propaga para rotularlo en la página.
  const cov = audit.coverage;
  const coverage =
    cov && Number.isFinite(cov.completed)
      ? { completed: cov.completed, total: 4 as const, partial: !!cov.partial }
      : undefined;

  return {
    overallScore: roundOrNull(audit.overallScore),
    opinionType: toOpinionKind(audit.opinionType),
    opinionText: scrubInternalMetadata(audit.opinionText ?? ''),
    auditorCards,
    topFindings,
    findingCounts,
    executiveSummary: scrubInternalMetadata(audit.executiveSummary ?? ''),
    ...(coverage ? { coverage } : {}),
  };
}

const OPINION_KINDS: readonly AuditOpinionKind[] = [
  'favorable',
  'con_salvedades',
  'desfavorable',
  'abstension',
  'no_emitida',
];

/**
 * Opinión ausente o desconocida → 'no_emitida' (auditoria-calidad-04). Antes
 * caía a 'abstension': una abstención es una opinión formal que exige
 * evidencia (NIA 705), no el valor por defecto de un dato faltante.
 */
function toOpinionKind(v: unknown): AuditOpinionKind {
  return OPINION_KINDS.includes(v as AuditOpinionKind) ? (v as AuditOpinionKind) : 'no_emitida';
}

function roundOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

// ─── Quality scores builder ───────────────────────────────────────────────────
// Map QualityAssessment (meta-auditor) → QualityScoresSpec.

/**
 * QualityAssessment (legado) → forma del JSON del meta-auditor para recalcular
 * la vista v2.1. Un campo ausente o no finito queda NaN → N/D en la vista
 * (nunca 0); una dimensión sin score numérico se descarta.
 */
function qualityJsonFromAssessment(q: QualityAssessment): QualityReportJson {
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN);
  return {
    overallScore: n(q.overallScore),
    grade: 'F',
    executiveSummary: '',
    dimensions: (q.dimensions ?? [])
      .filter((d) => d && typeof d.name === 'string' && Number.isFinite(d.score))
      .map((d) => ({
        name: d.name,
        score: d.score,
        framework: d.framework ?? '',
        findings: Array.isArray(d.findings) ? d.findings : [],
        recommendations: Array.isArray(d.recommendations) ? d.recommendations : [],
      })),
    dataQuality: {
      completeness: n(q.dataQuality?.completeness),
      accuracy: n(q.dataQuality?.accuracy),
      consistency: n(q.dataQuality?.consistency),
      timeliness: n(q.dataQuality?.timeliness),
      validity: n(q.dataQuality?.validity),
    },
    aiGovernance: {
      traceability: n(q.aiGovernance?.traceability),
      explainability: n(q.aiGovernance?.explainability),
      antiHallucination: n(q.aiGovernance?.antiHallucination),
      humanOversight: n(q.aiGovernance?.humanOversight),
    },
    ifrs18Readiness: { ready: false, score: n(q.ifrs18Readiness?.score), gaps: [] },
    priorityRecommendations: [],
    conclusion: '',
  };
}

function buildQualityScores(
  q: QualityAssessment | null,
  context: QualityV21Context,
): QualityScoresSpec | undefined {
  if (!q) return undefined;

  const dimensions: QualityDimensionBar[] = (q.dimensions ?? []).map((d) => ({
    name: d.name,
    score: Math.round(d.score),
    framework: d.framework,
  }));

  // Veredicto = sello v2.1 recalculado de las dimensiones, y score/grade
  // internos DERIVADOS de él (auditoria-calidad-10): el grade libre del LLM
  // ("A+ · 96" con dimensiones en 50) ya no llega a la PDF, tampoco desde un
  // informe persistido antes de la corrección. Un dato ausente es N/D, no 0
  // ni 'F' (reportes-export-11).
  const view = buildQualityV21View(qualityJsonFromAssessment(q), context);
  const derived = deriveQualityScore(view);
  return {
    overallScore: derived.overallScore,
    grade: derived.grade,
    sello: {
      type: view.sello.type,
      title: view.sello.title,
      score10: view.sello.score,
      approvedCount: view.sello.approvedCount,
      evaluatedCount: view.sello.evaluatedCount,
      bottomLine: view.sello.bottomLine,
    },
    dimensions,
    ifrs18Ready: typeof q.ifrs18Readiness?.ready === 'boolean' ? q.ifrs18Readiness.ready : null,
    ifrs18Score: roundOrNull(q.ifrs18Readiness?.score),
    ifrs18Gaps: scrubNotes(q.ifrs18Readiness?.gaps),
    dataQuality: {
      completeness: roundOrNull(q.dataQuality?.completeness),
      accuracy: roundOrNull(q.dataQuality?.accuracy),
      consistency: roundOrNull(q.dataQuality?.consistency),
      timeliness: roundOrNull(q.dataQuality?.timeliness),
      validity: roundOrNull(q.dataQuality?.validity),
    },
    aiGovernance: {
      traceability: roundOrNull(q.aiGovernance?.traceability),
      explainability: roundOrNull(q.aiGovernance?.explainability),
      antiHallucination: roundOrNull(q.aiGovernance?.antiHallucination),
      humanOversight: roundOrNull(q.aiGovernance?.humanOversight),
    },
    executiveSummary: scrubInternalMetadata(q.executiveSummary ?? ''),
  };
}

// ─── Norm citation regex (binding contract — referenced in tests) ────────────
// Captures NIIF Secc. N | NIIF N | Art. N ET | Decreto N/YYYY | NIC N | NIA N.
const NORM_CITATION_REGEX =
  /\b(NIIF\s+(?:Secc\.\s+)?\d+|NIC\s+\d+|NIA\s+\d+|Art\.\s+\d+\s+ET|Decreto\s+\d+\/\d{4}|Ley\s+\d+\/\d{4})\b/gi;

function extractCitations(text: string | undefined): NormCitation[] {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(NORM_CITATION_REGEX) ?? [];
  const seen = new Set<string>();
  const out: NormCitation[] = [];
  for (const m of matches) {
    const norm = m.replace(/\s+/g, ' ').trim();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({ label: norm });
  }
  return out;
}

// ─── Markdown parsers (inline, no deps) ───────────────────────────────────────

/**
 * Extract the first GFM table from a Markdown block. If no table is found,
 * returns a placeholder ParsedTable with empty rows.
 */
export function parseStatementTable(md: string | undefined): ParsedTable {
  const placeholder: ParsedTable = {
    caption: 'Pendiente',
    headers: [],
    rows: [],
  };
  if (!md || typeof md !== 'string') return placeholder;

  const lines = md.split(/\r?\n/);
  // Find a row that looks like a header `| col | col |` followed by a
  // separator `| --- | --- |`.
  let headerIdx = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i].trim();
    const b = lines[i + 1].trim();
    if (
      a.startsWith('|') &&
      a.endsWith('|') &&
      /^\|[\s:|-]+\|$/.test(b) &&
      b.includes('-')
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return placeholder;

  const headerCells = splitTableRow(lines[headerIdx]);
  const rows: ParsedTableRow[] = [];

  for (let i = headerIdx + 2; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw.startsWith('|') || !raw.endsWith('|')) break;
    const cells = splitTableRow(raw);
    if (cells.length === 0) continue;
    const account = cells[0] ?? '';
    const rest = cells.slice(1);
    const accountUpper = account.toUpperCase();
    let emphasis: 'subtotal' | 'total' | undefined;
    if (
      /\*\*total\*\*/i.test(account) ||
      accountUpper.startsWith('TOTAL') ||
      /^\*\*TOTAL/i.test(account) ||
      /\*\*(UTILIDAD|RESULTADO|GANANCIA|PERDIDA|LOSS|NET\s+INCOME)/i.test(account) ||
      /^(UTILIDAD|RESULTADO\s+DEL\s+EJERCICIO|RESULTADO\s+NETO|GANANCIA\s+NETA)/i.test(accountUpper)
    ) {
      emphasis = 'total';
    } else if (/SUBTOTAL/i.test(account)) {
      emphasis = 'subtotal';
    }
    rows.push({
      account: stripMdEmphasis(account),
      cells: rest.map(stripMdEmphasis),
      ...(emphasis ? { emphasis } : {}),
    });
  }

  // Look backward for a caption: the heading immediately preceding the table.
  let caption: string | undefined;
  for (let j = headerIdx - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (!t) continue;
    const h = t.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      caption = stripMdEmphasis(h[1]);
      break;
    }
    // Bold one-liner caption
    if (/^\*\*.*\*\*$/.test(t)) {
      caption = stripMdEmphasis(t);
      break;
    }
    break;
  }

  return {
    headers: headerCells.map(stripMdEmphasis),
    rows,
    ...(caption ? { caption } : {}),
  };
}

function splitTableRow(line: string): string[] {
  // Trim leading/trailing pipes, then split on pipe.
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

function stripMdEmphasis(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * Splits a markdown block into sections by `## ` (level 2) or `### ` (level 3).
 */
export function parseHeadingSections(
  md: string | undefined,
  level: 2 | 3,
): Array<{ heading: string; body: string }> {
  if (!md || typeof md !== 'string') return [];
  const prefix = level === 2 ? '## ' : '### ';
  const lines = md.split(/\r?\n/);
  const out: Array<{ heading: string; body: string }> = [];
  let current: { heading: string; body: string[] } | null = null;
  for (const line of lines) {
    if (line.startsWith(prefix) && !line.startsWith(prefix + '#')) {
      if (current) {
        out.push({ heading: current.heading, body: current.body.join('\n').trim() });
      }
      current = { heading: stripMdEmphasis(line.slice(prefix.length).trim()), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) {
    out.push({ heading: current.heading, body: current.body.join('\n').trim() });
  }
  return out;
}

/**
 * Extracts entries shaped as `1. **Title**\n body...` or `1. Title\n body...`.
 * Each entry's body is everything until the next `N. ` line at start of line.
 */
export function parseNumberedList(
  md: string | undefined,
): Array<{ title: string; body: string }> {
  if (!md || typeof md !== 'string') return [];
  const out: Array<{ title: string; body: string }> = [];
  // Split by lines starting with `\nN. ` (regex with multiline). We detect
  // entries via a forward sweep.
  const lines = md.split(/\r?\n/);
  let current: { title: string; body: string[] } | null = null;
  const entryRegex = /^(\d+)\.\s+(.+)$/;
  for (const line of lines) {
    const m = line.match(entryRegex);
    if (m) {
      if (current) {
        out.push({ title: current.title, body: current.body.join('\n').trim() });
      }
      current = { title: stripMdEmphasis(m[2]), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) {
    out.push({ title: current.title, body: current.body.join('\n').trim() });
  }
  return out;
}

// ─── Meta / Cover / TOC ───────────────────────────────────────────────────────

function buildMeta(
  report: FinancialReport,
  language: 'es' | 'en',
  emittable: EmittableGate | undefined,
  preprocessed: PreprocessedBalance | null | undefined,
): ReportMeta {
  let watermark: ReportMeta['watermark'] | undefined;
  let watermarkSubtitle: string | undefined;

  // Disparador 3 (NIC 1 par. 38 + NIA 710): comparativos impracticables
  // — el dictamen se emite con borrador hasta que la fuente del periodo N-1
  // este disponible. Tipo defensivo (`unknown`) porque el preprocesador esta
  // siendo extendido en paralelo.
  const comparativosImpracticables =
    !!preprocessed &&
    typeof preprocessed === 'object' &&
    (preprocessed as { comparativos_impracticables?: boolean }).comparativos_impracticables === true;

  // pipeline-flujo-14 (defensa en profundidad): /export responde 422 para un
  // informe sin Partes II/III; si el composer se invoca igual, la portada no
  // puede presentarlo como completo.
  const isEmptyPart = (part: { fullContent?: unknown } | null | undefined) =>
    !part || typeof part.fullContent !== 'string' || part.fullContent.trim().length === 0;
  const missingParts: string[] = [];
  if (isEmptyPart(report.strategicAnalysis)) {
    missingParts.push(language === 'en' ? 'Part II (Strategy)' : 'Parte II (Estrategia)');
  }
  if (isEmptyPart(report.governance)) {
    missingParts.push(language === 'en' ? 'Part III (Governance)' : 'Parte III (Gobierno)');
  }

  if (emittable && emittable.ok === false) {
    watermark = 'BLOQUEADO';
  } else if (missingParts.length > 0) {
    watermark = 'INCOMPLETO';
    watermarkSubtitle =
      (language === 'en' ? 'MISSING: ' : 'FALTA: ') + missingParts.join(' · ');
  } else if (comparativosImpracticables) {
    watermark = 'BORRADOR';
    watermarkSubtitle = language === 'en'
      ? 'COMPARATIVES IMPRACTICABLE'
      : 'COMPARATIVOS IMPRACTICABLES';
  } else if (
    preprocessed &&
    typeof preprocessed === 'object' &&
    (preprocessed as { provisional?: boolean }).provisional === true
  ) {
    watermark = 'BORRADOR';
  } else if (typeof report.consolidatedReport === 'string' &&
    /BORRADOR — VALIDACION PENDIENTE|DRAFT — VALIDATION PENDING/i.test(report.consolidatedReport)) {
    watermark = 'BORRADOR';
  }

  // Identidad desde el JSON validado cuando existe: es la misma fuente de las
  // columnas de los estados. Antes la portada usaba `report.company` y las
  // columnas `json.company`, y el gate no las comparaba (reportes-export-10).
  const jc = report.niifAnalysis?.json?.company;
  return {
    companyName: jc?.name ?? report.company?.name ?? 'N/D',
    nit: jc?.nit ?? report.company?.nit ?? 'N/D',
    entityType: report.company?.entityType ?? jc?.entityType ?? undefined,
    fiscalPeriod: jc?.fiscalPeriod ?? report.company?.fiscalPeriod ?? 'N/D',
    comparativePeriod: jc ? (jc.comparativePeriod ?? undefined) : report.company?.comparativePeriod,
    niifGroup: jc?.niifGroup ?? null,
    generatedAt: report.generatedAt ?? new Date().toISOString(),
    language,
    ...(watermark ? { watermark } : {}),
    ...(watermarkSubtitle ? { watermarkSubtitle } : {}),
  };
}

function buildCover(report: FinancialReport, language: 'es' | 'en') {
  const title =
    language === 'en' ? 'Editorial Financial Report' : 'Informe Financiero Editorial';
  const subtitle = report.niifAnalysis?.json?.company.name ?? report.company?.name ?? '';
  return {
    title,
    subtitle,
    accentArea: 'valor' as AreaKey,
  };
}

function buildTocEntries(language: 'es' | 'en', includePillars: boolean): TocEntry[] {
  const isEs = language === 'es';
  const entries: TocEntry[] = [];
  const push = (label: string, uppercase: boolean) =>
    entries.push({ label, page: 1, uppercase });
  push(isEs ? 'Carta del director' : 'Director letter', false);
  push(isEs ? 'Resumen ejecutivo' : 'Executive summary', false);
  push(isEs ? 'TEMA 1: Indicadores clave' : 'TOPIC 1: Key indicators', true);
  push(isEs ? 'TEMA 2: Cascada de utilidad' : 'TOPIC 2: Profit waterfall', true);
  push(isEs ? 'TEMA 3: Diales de salud' : 'TOPIC 3: Health dials', true);
  if (includePillars) {
    push(isEs ? 'TEMA 4: Pilares' : 'TOPIC 4: Pillars', true);
  }
  push(isEs ? 'TEMA 5: Estados financieros' : 'TOPIC 5: Financial statements', true);
  push(isEs ? 'TEMA 6: Notas' : 'TOPIC 6: Notes', true);
  push(isEs ? 'TEMA 7: Recomendaciones' : 'TOPIC 7: Recommendations', true);
  push(isEs ? 'Apéndice normativo' : 'Normative appendix', false);
  return entries;
}

// ─── Director letter ──────────────────────────────────────────────────────────

function buildDirectorLetter(report: FinancialReport, language: 'es' | 'en') {
  const portrait: PortraitSpec = {
    kind: 'initials',
    initials: 'EU',
    areaAccent: 'valor',
  };
  const raw =
    extractFirstParagraphs(report.governance?.fullContent, 3) ||
    extractFirstParagraphs(report.strategicAnalysis?.fullContent, 3) ||
    extractFirstParagraphs(report.niifAnalysis?.fullContent, 3) ||
    '';
  const pickFromEither = scrubInternalMetadata(raw);
  const citations = extractCitations(pickFromEither);
  return {
    portrait,
    bodyMarkdown: pickFromEither,
    citations,
    signerName: language === 'en' ? '1+1 Team' : 'Equipo 1+1',
    signerRole: language === 'en' ? 'Editorial Director' : 'Director Editorial',
  };
}

function extractFirstParagraphs(md: string | undefined, n: number): string {
  if (!md || typeof md !== 'string') return '';
  // Strip leading headings; take first N non-heading paragraphs.
  const blocks = md
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && !b.startsWith('#') && !b.startsWith('|'));
  return blocks.slice(0, n).join('\n\n');
}

// ─── Control totals helper ────────────────────────────────────────────────────

function readControlTotals(
  pp: PreprocessedBalance | null | undefined,
): ControlTotals | null {
  if (!pp) return null;
  const primary: PeriodSnapshot | undefined = (pp as { primary?: PeriodSnapshot }).primary;
  if (!primary) return null;
  return primary.controlTotals ?? null;
}

// ─── Ratios — fuente única para KPI grid y diales ────────────────────────────
//
// Why: el KPI grid y los diales calculaban los MISMOS indicadores por caminos
// distintos (el grid con fórmulas locales, los diales con los campos
// pre-calculados de Wave 2.F4), de modo que un mismo PDF imprimía dos ROE
// distintos — uno sobre patrimonio de cierre y otro sobre patrimonio promedio —
// y ninguno coincidía con el HTML, que consume `controlTotals` por contrato
// (`html-editor.prompt.ts`: "ROE consistente ... fórmula única de
// controlTotals.roe"). Este resolver es el único punto donde se decide de dónde
// sale cada ratio.
//
// Auditoría 2026-09 (reportes-export-12): `null` y "ausente" NO son lo mismo.
// `controlTotals` declara `null` cuando el denominador es 0/anómalo "para que
// el renderer pinte ND, NUNCA un fallback silencioso"; el resolver anterior
// usaba `??` y convertía ese null en un cálculo local distinto (patrimonio
// promedio 0 → ROE 200 % sobre el patrimonio de cierre). Ahora:
//   - campo `undefined` (balance cacheado pre-F4) → fallback local, rotulado;
//   - campo `null` → N/D.
//
// Convención de escala, la misma que `ControlTotals`:
//   - `*Pct`   → porcentaje 0-100 (ej. 40 = 40 %).
//   - el resto → razón adimensional (ej. 1,5 veces).
interface ResolvedRatios {
  razonCorriente: number | null;
  pruebaAcida: number | null;
  /** Endeudamiento total en PORCENTAJE (0-100), igual que controlTotals. */
  endeudamientoPct: number | null;
  coberturaIntereses: number | null;
  /** Margen neto en PORCENTAJE (0-100). */
  margenNetoPct: number | null;
  /** ROE en PORCENTAJE (0-100). */
  roePct: number | null;
  /** true cuando el ROE está calculado sobre patrimonio de CIERRE (spec v10.1: marca △). */
  roeOnClosingEquity: boolean;
}

/** `undefined` → fallback (legado); `null` → N/D; número finito → tal cual. */
function preferField(
  field: number | null | undefined,
  fallback: () => number | null,
): number | null {
  if (field === undefined) return fallback();
  if (field === null || !Number.isFinite(field)) return null;
  return field;
}

function resolveRatios(totals: ControlTotals): ResolvedRatios {
  const div = (num: number, den: number): number | null =>
    den === 0 || !Number.isFinite(num) || !Number.isFinite(den) ? null : num / den;

  const pctOf = (num: number, den: number): number | null => {
    const r = div(num, den);
    return r === null ? null : r * 100;
  };

  // Margen neto: el denominador es el ingreso NETO de devoluciones (misma base
  // que `controlTotals.margenNeto`), nunca la Σ de la clase 4.
  const ingresosNetos =
    totals.ingresosNetos ??
    (totals.cents ? Number(totals.cents.ingresosNetos) / 100 : undefined);

  const roePct = preferField(totals.roe, () => pctOf(totals.utilidadNeta, totals.patrimonio));
  const roeOnClosingEquity =
    totals.roe === undefined ||
    (typeof totals.patrimonioPromedio === 'number' && totals.patrimonioPromedio === totals.patrimonio);

  return {
    razonCorriente: preferField(totals.razonCorriente, () =>
      div(totals.activoCorriente, totals.pasivoCorriente),
    ),
    pruebaAcida: preferField(totals.pruebaAcida, () =>
      div(totals.activoCorriente - (totals.inventarios14 ?? 0), totals.pasivoCorriente),
    ),
    endeudamientoPct: preferField(totals.endeudamientoTotal, () => pctOf(totals.pasivo, totals.activo)),
    // `coberturaIntereses === null` significa "sin gasto financiero" (no es 0).
    // Sin el campo (balances pre-F4) tampoco hay denominador para calcularlo.
    coberturaIntereses: preferField(totals.coberturaIntereses, () => null),
    margenNetoPct: preferField(totals.margenNeto, () =>
      typeof ingresosNetos === 'number' ? pctOf(totals.utilidadNeta, ingresosNetos) : null,
    ),
    roePct,
    roeOnClosingEquity: roePct !== null && roeOnClosingEquity,
  };
}

// ─── KPI grid ─────────────────────────────────────────────────────────────────

const ND = 'N/D';

function buildKpiGrid(
  totals: ControlTotals | null,
  pillars: PillarsResult | null,
  revenue: RevenueBreakdown,
): KpiGridSpec {
  const kpis: KpiCell[] = [];
  if (totals) {
    const ratios = resolveRatios(totals);

    push(kpis, 'Activo Total', formatCop(totals.activo), 'estructura');
    push(kpis, 'Pasivo Total', formatCop(totals.pasivo), 'estructura');
    push(kpis, 'Patrimonio', formatCop(totals.patrimonio), 'estructura');
    // "Ingresos" = ingresos operacionales netos (41 − 4175), nunca la Σ de la
    // clase 4 con devoluciones y no operacionales (ratios-kpis-04).
    push(
      kpis,
      'Ingresos operacionales netos',
      revenue.operacionalesNetos === null ? ND : formatCop(revenue.operacionalesNetos),
      'resultados',
      revenue.operacionalesNetos === null ? 'Sin detalle PUC de la clase 4 para separar el grupo 41' : undefined,
    );
    push(kpis, 'Gastos + Costos', formatCop(totals.gastos), 'resultados');
    push(kpis, 'Utilidad Neta', formatCop(totals.utilidadNeta), 'resultados');

    // Ratios: un null del preprocesador se imprime N/D (reportes-export-12),
    // nunca se omite en silencio ni se sustituye.
    push(
      kpis,
      'Margen Neto',
      ratios.margenNetoPct === null ? ND : formatPct(ratios.margenNetoPct / 100),
      'rentabilidad',
    );
    push(
      kpis,
      'ROE',
      ratios.roePct === null ? ND : formatPct(ratios.roePct / 100),
      'rentabilidad',
      // El motivo que publicó el preprocesador (p. ej. patrimonio promedio ≤ 0)
      // viaja a la celda; no se recalcula el ROE (ratios-kpis-07).
      ratios.roePct === null
        ? totals.kpiNdMotivos?.roe ?? 'Patrimonio promedio nulo o anómalo'
        : ratios.roeOnClosingEquity
          ? '△ sobre patrimonio de cierre (sin promedio con el comparativo)'
          : undefined,
    );
    push(
      kpis,
      'Razón Corriente',
      ratios.razonCorriente === null ? ND : formatRatio(ratios.razonCorriente),
      'liquidez',
    );
    push(
      kpis,
      'Endeudamiento',
      ratios.endeudamientoPct === null ? ND : formatPct(ratios.endeudamientoPct / 100),
      'liquidez',
    );
  }

  // Pillar-derived cards (pick the headline KPI from each pilar.kpis if present).
  if (pillars) {
    const ebitda = findCardValue(pillars.valor, 'ebitda');
    if (ebitda !== null) push(kpis, 'EBITDA', formatCop(ebitda), 'resultados');
    const autonomia = findCardValue(pillars.escudo, 'autonomia');
    if (autonomia !== null) push(kpis, 'Días Autonomía', `${Math.round(autonomia)} días`, 'liquidez');
    const cagr = findCardValue(pillars.futuro, 'cagr');
    if (cagr !== null) push(kpis, 'Crecimiento Ingresos', formatPct(cagr), 'rentabilidad');
  }

  // Sin recorte silencioso (reportes-export-18): compose emite a lo sumo 13
  // KPIs (10 del balance + 3 de pilares) y la página los agrupa por categoría.
  return { kpis };
}

function push(
  arr: KpiCell[],
  label: string,
  value: string,
  category: KpiCell['category'],
  note?: string,
): void {
  arr.push({ label, value, category, ...(note ? { note } : {}) });
}

function findCardValue(
  pilar: PillarMetrics | undefined,
  key: string,
): number | null {
  if (!pilar) return null;
  const cards =
    (pilar as unknown as Record<string, unknown>).valorCards ??
    (pilar as unknown as Record<string, unknown>).escudoCards ??
    (pilar as unknown as Record<string, unknown>).verdadCards ??
    (pilar as unknown as Record<string, unknown>).futuroCards;
  if (cards && typeof cards === 'object') {
    const card = (cards as Record<string, { value?: number | null }>)[key];
    if (card && typeof card.value === 'number' && Number.isFinite(card.value)) {
      return card.value;
    }
  }
  // Fallback: search the kpis array by key.
  const kpi = pilar.kpis?.find((k: PillarKpi) => k.key === key);
  if (kpi && typeof kpi.value === 'number' && Number.isFinite(kpi.value)) {
    return kpi.value;
  }
  return null;
}

// ─── Waterfall ────────────────────────────────────────────────────────────────

/**
 * Puente Ingresos operacionales netos → (+ Otros ingresos no operacionales) →
 * (Gastos + Costos) → (Impuestos) → Utilidad Neta.
 *
 * Invariante que este builder debe cumplir: la suma acumulada de las barras
 * intermedias tiene que aterrizar EXACTAMENTE en la barra total. El gráfico
 * dibuja la barra `total` desde cero (WaterfallPnL) y por tanto no delata un
 * puente descuadrado: el error se vuelve invisible y el cliente lee un nivel
 * intermedio falso.
 *
 * Auditoría 2026-08: la barra "(Impuestos)" restaba el SALDO del pasivo fiscal
 * (PUC 24); ahora usa el impuesto causado real (`cents.impuestoCausado`, grupo
 * 54) separado de `gastos`, que ya lo incluye.
 *
 * Auditoría 2026-09 (ratios-kpis-04): la barra inicial era `controlTotals
 * .ingresos` (Σ clase 4 = bruto + devoluciones + no operacionales) y el puente
 * no cerraba contra la utilidad neta, que el preprocesador calcula sobre los
 * ingresos NETOS. Ahora arranca en los ingresos operacionales netos (41 − 4175)
 * y los no operacionales (grupo 42) van en su propia barra.
 */
function buildWaterfall(totals: ControlTotals | null, revenue: RevenueBreakdown): WaterfallItem[] {
  if (!totals) return [];
  const items: WaterfallItem[] = [];

  if (revenue.operacionalesNetos !== null && revenue.noOperacionales !== null) {
    items.push({ label: 'Ingresos operacionales netos', amount: revenue.operacionalesNetos, sign: 'pos' });
    if (revenue.noOperacionales !== 0) {
      items.push(
        revenue.noOperacionales > 0
          ? { label: 'Otros ingresos (no operacionales)', amount: revenue.noOperacionales, sign: 'pos' }
          : { label: '(Otros ingresos netos negativos)', amount: revenue.noOperacionales, sign: 'neg' },
      );
    }
  } else if (revenue.netosTotales !== null) {
    // Sin detalle para separar el grupo 41 se rotula lo que es: el total de la
    // clase 4 neto de devoluciones, incluidos los no operacionales.
    items.push({
      label: 'Ingresos netos totales (incl. no operacionales)',
      amount: revenue.netosTotales,
      sign: 'pos',
    });
  } else {
    // Balance legado sin `ingresosNetos`: única cifra disponible, rotulada.
    items.push({ label: 'Ingresos (Σ clase 4)', amount: totals.ingresos, sign: 'pos' });
  }

  // `cents` viaja en centavos (BigInt) — a pesos para la misma unidad que el
  // resto de `controlTotals`.
  const impuestoCausado = totals.cents
    ? Number(totals.cents.impuestoCausado) / 100
    : 0;
  const gastosSinImpuesto = totals.gastos - impuestoCausado;

  if (gastosSinImpuesto !== 0) {
    items.push({
      label: '(Gastos + Costos)',
      amount: -Math.abs(gastosSinImpuesto),
      sign: 'neg',
    });
  }
  if (impuestoCausado !== 0) {
    items.push({
      label: '(Impuestos)',
      amount: -Math.abs(impuestoCausado),
      sign: 'neg',
    });
  }
  items.push({ label: 'Utilidad Neta', amount: totals.utilidadNeta, sign: 'total' });
  return items;
}

// ─── Dial gauges ──────────────────────────────────────────────────────────────

/**
 * Auditoría 2026-09 (reportes-export-05): el dial imprimía el valor RECORTADO a
 * la escala (una razón corriente de 10 salía "5.00"), convertía los ratios null
 * en 0 (zona crítica) y usaba punto decimal y fracción ("0.10") junto a la
 * tarjeta "10,0 %" del mismo PDF. Ahora la aguja se recorta pero la cifra
 * impresa es la real, en es-CO y en la misma unidad que la tarjeta; sin dato →
 * "N/D" sin aguja.
 */
function buildDialGauges(totals: ControlTotals | null): DialGaugeSpec[] {
  if (!totals) return [];

  // Misma resolución de ratios que el KPI grid — un solo camino de cálculo por
  // indicador para que el dial y la tarjeta no puedan contradecirse.
  const ratios = resolveRatios(totals);

  // `endeudamientoTotal` tiene escala definida POR CONTRATO: porcentaje 0-100.
  // El dial trabaja en fracción 0-1 (umbrales 0,3 / 0,5 / 0,7) pero imprime el
  // porcentaje, igual que la tarjeta.
  const endeudamientoFrac =
    ratios.endeudamientoPct === null ? null : ratios.endeudamientoPct / 100;

  const dial = (
    base: Omit<DialGaugeSpec, 'value' | 'displayValue' | 'noData' | 'outOfScale'>,
    real: number | null,
    display: (v: number) => string,
    noDataCaption?: string,
  ): DialGaugeSpec => {
    if (real === null) {
      return {
        ...base,
        value: base.min,
        displayValue: ND,
        noData: true,
        ...(noDataCaption ? { caption: noDataCaption } : {}),
      };
    }
    const needle = clampForGauge(real, base.min, base.max);
    return {
      ...base,
      value: needle,
      displayValue: display(real),
      ...(needle !== real ? { outOfScale: true } : {}),
    };
  };

  return [
    dial(
      { label: 'Razón Corriente', min: 0, max: 5, thresholds: [1.0, 1.5, 2.5], areaAccent: 'escudo' as AreaKey, caption: 'Óptimo ≥ 1,5' },
      ratios.razonCorriente,
      formatRatio,
      'Sin pasivo corriente o dato no disponible',
    ),
    dial(
      { label: 'Prueba Ácida', min: 0, max: 3, thresholds: [0.7, 1.0, 2.0], areaAccent: 'escudo' as AreaKey, caption: 'Óptimo ≥ 1,0' },
      ratios.pruebaAcida,
      formatRatio,
      'Sin pasivo corriente o dato no disponible',
    ),
    dial(
      { label: 'Endeudamiento', min: 0, max: 1, thresholds: [0.3, 0.5, 0.7], areaAccent: 'verdad' as AreaKey, caption: 'Óptimo ≤ 50 %' },
      endeudamientoFrac,
      (v) => formatPct(v),
      'Activo nulo o dato no disponible',
    ),
    dial(
      { label: 'Cobertura Intereses', min: 0, max: 10, thresholds: [1.5, 3.0, 6.0], areaAccent: 'futuro' as AreaKey, caption: 'Óptimo ≥ 3,0' },
      ratios.coberturaIntereses,
      formatRatio,
      // `null` = sin gasto financiero (5305): el indicador no aplica.
      'Sin gasto financiero: no aplica',
    ),
  ];
}

function clampForGauge(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

// ─── Pillars ──────────────────────────────────────────────────────────────────

function buildPillarsSpec(pillars: PillarsResult | null): PillarsSpec | undefined {
  if (!pillars) return undefined;
  const overall = Math.round(pillars.overallScore ?? 0);

  const sat = (
    metrics: PillarMetrics,
    label: string,
    accent: AreaKey,
  ): PillarSatellite => {
    const headline = pickHeadlineKpi(metrics);
    return {
      id: metrics.pillarId as AreaKey,
      label,
      score: Math.round(metrics.healthScore ?? 0),
      topKpi: headline,
      areaAccent: accent,
    };
  };

  return {
    overall,
    satellites: [
      sat(pillars.escudo, 'Escudo', 'escudo'),
      sat(pillars.valor, 'Valor', 'valor'),
      sat(pillars.verdad, 'Verdad', 'verdad'),
      sat(pillars.futuro, 'Futuro', 'futuro'),
    ],
  };
}

function pickHeadlineKpi(metrics: PillarMetrics): string {
  const first = metrics.kpis?.[0];
  if (first) {
    const label = first.labelEs || first.labelEn || first.key;
    const valStr = formatPillarValue(first);
    return valStr ? `${label} ${valStr}` : label;
  }
  return `Score ${Math.round(metrics.healthScore ?? 0)}`;
}

function formatPillarValue(kpi: PillarKpi): string {
  if (kpi.value == null || !Number.isFinite(kpi.value)) return '';
  switch (kpi.unit) {
    case 'cop':
      return formatCop(kpi.value);
    case 'pct':
      return formatPct(kpi.value);
    case 'days':
      return `${Math.round(kpi.value)} días`;
    case 'months':
      return `${Math.round(kpi.value)} meses`;
    case 'ratio':
      return formatRatio(kpi.value);
    case 'count':
      return String(Math.round(kpi.value));
    case 'score':
      return `${Math.round(kpi.value)}/100`;
    default:
      return String(kpi.value);
  }
}

// ─── Statements ───────────────────────────────────────────────────────────────

function buildStatements(
  report: FinancialReport,
  preprocessed: PreprocessedBalance | null | undefined,
  language: 'es' | 'en' = 'es',
) {
  // Fase 3.1 — prefer JSON-strict del NIIF Analyst cuando esté disponible.
  // Parser Markdown queda como fallback para reportes legacy ingestados antes
  // del refactor (e.g. reportes históricos en DB / fixtures viejos).
  const json = report.niifAnalysis?.json;
  if (json) {
    const ctx = statementContext(json.company.fiscalPeriod, json.company.comparativePeriod, preprocessed);
    return {
      balance: labelLlmStatementNotes(niifJsonToBalanceTable(json, ctx), json.balanceSheet?.notes, language),
      income: labelLlmStatementNotes(niifJsonToIncomeTable(json, ctx), json.incomeStatement?.notes, language),
      cashFlow: niifJsonToCashFlowTable(json, ctx),
      equity: labelLlmStatementNotes(niifJsonToEquityTable(json, ctx), json.equityChanges?.notes, language),
    };
  }
  return {
    balance: parseStatementTable(report.niifAnalysis?.balanceSheet),
    income: parseStatementTable(report.niifAnalysis?.incomeStatement),
    cashFlow: parseStatementTable(report.niifAnalysis?.cashFlowStatement),
    equity: parseStatementTable(report.niifAnalysis?.equityChangesStatement),
  };
}

/**
 * Las notas en prosa de cada estado (`balanceSheet/incomeStatement/equityChanges.notes`)
 * las redacta el LLM y sus cifras no se contrastan con las anclas: se imprimían
 * bajo el estado como si fueran parte del estado validado (e2e-niif-10). Si el
 * estado trae alguna nota, la primera línea del pie es el aviso de narrativa no
 * auditada (mismo texto que el resto de la narrativa del PDF y el Excel).
 */
function labelLlmStatementNotes<T extends { footnotes?: string[] }>(
  table: T,
  notes: ReadonlyArray<{ body: string }> | null | undefined,
  language: 'es' | 'en' = 'es',
): T {
  const hasLlmNotes = (notes ?? []).some((n) => typeof n?.body === 'string' && n.body.trim().length > 0);
  if (!hasLlmNotes || !table) return table;
  return { ...table, footnotes: [narrativeDisclaimer(language), ...(table.footnotes ?? [])] };
}

/**
 * Tipo de periodo (año completo / corte parcial) que el preprocesador infirió
 * del archivo, SÓLO cuando el snapshot corresponde al mismo año del JSON. Sin
 * esa coincidencia no se afirma una fecha de corte (reportes-export-14).
 */
function statementContext(
  fiscalPeriod: string,
  comparativePeriod: string | null,
  preprocessed: PreprocessedBalance | null | undefined,
): StatementTableContext {
  const pp = preprocessed as
    | { primary?: Partial<PeriodSnapshot> | null; comparative?: Partial<PeriodSnapshot> | null }
    | null
    | undefined;
  const comparative = pp?.comparative;
  // ingesta-09: comparativo de saldos de apertura, sólo si el snapshot es el
  // del periodo comparativo que declara el JSON (misma regla que el tipo).
  const comparativeSaldosDeApertura =
    !!comparativePeriod &&
    comparative?.saldosDeApertura === true &&
    typeof comparative.period === 'string' &&
    comparative.period.includes(comparativePeriod);
  return {
    ...resolvePeriodoTipos(fiscalPeriod, comparativePeriod, pp?.primary, comparative),
    ...(comparativeSaldosDeApertura ? { comparativeSaldosDeApertura: true } : {}),
  };
}

// ─── Notes ────────────────────────────────────────────────────────────────────

function buildNotes(report: FinancialReport, language: 'es' | 'en' = 'es') {
  const md = report.governance?.financialNotes ?? '';
  const sections = parseHeadingSections(md, 2);
  // Fallback to level 3 if level 2 yielded nothing (defensive).
  const eff = sections.length > 0 ? sections : parseHeadingSections(md, 3);
  const blocks = eff.map((s, i) => {
    const body = scrubInternalMetadata(s.body);
    return {
      heading: scrubInternalMetadata(s.heading),
      // Notas en prosa del LLM: el aviso de narrativa no auditada va al inicio
      // de la sección (reportes-export-11).
      bodyMarkdown: i === 0 ? withNarrativeDisclaimer(body, language) : body,
      citations: extractCitations(body),
    };
  });

  // Notas técnicas estructuradas del JSON NIIF validado (mapeo PUC,
  // reclasificaciones, impracticabilidades). Antes no se exportaban en ningún
  // formato aunque son parte del contrato (reportes-export-11).
  const technical = (report.niifAnalysis?.json?.technicalNotes ?? [])
    .map((n) => scrubInternalMetadata(formatStatementNote(n)))
    .filter((n) => n.length > 0);
  if (technical.length > 0) {
    const body = technical.map((n) => `- ${n}`).join('\n');
    blocks.push({
      heading:
        language === 'en'
          ? 'Technical notes to the financial statements'
          : 'Notas técnicas de los estados financieros',
      // Prosa del Pass-3 del LLM: sus cifras no se anclan (e2e-niif-10).
      bodyMarkdown: withNarrativeDisclaimer(body, language),
      citations: extractCitations(body),
    });
  }
  return blocks;
}

// ─── Break-Even Analysis ──────────────────────────────────────────────────────
// Punto de equilibrio — markdown del Director de Estrategia (FinancialReport.
// strategicAnalysis.breakEvenAnalysis). Retorna undefined si el campo está
// vacío para que la página se omita.

function buildBreakEven(report: FinancialReport, language: 'es' | 'en' = 'es') {
  const raw = (report.strategicAnalysis?.breakEvenAnalysis ?? '').trim();
  if (!raw) return undefined;
  const md = scrubInternalMetadata(raw);
  return { bodyMarkdown: withNarrativeDisclaimer(md, language), citations: extractCitations(md) };
}

// ─── Projected Cash Flow ──────────────────────────────────────────────────────
// Proyección de flujo de caja 12 meses — markdown del Director de Estrategia
// (FinancialReport.strategicAnalysis.projectedCashFlow). Undefined si vacío.

function buildProjectedCashFlow(report: FinancialReport, language: 'es' | 'en' = 'es') {
  const raw = (report.strategicAnalysis?.projectedCashFlow ?? '').trim();
  if (!raw) return undefined;
  const md = scrubInternalMetadata(raw);
  return { bodyMarkdown: withNarrativeDisclaimer(md, language), citations: extractCitations(md) };
}

// ─── Shareholder Minutes ──────────────────────────────────────────────────────
// Acta de asamblea (Art. 187 Ley 222/1995) — markdown del Especialista de
// Gobierno (FinancialReport.governance.shareholderMinutes). Undefined si vacío.

function buildShareholderMinutes(report: FinancialReport, language: 'es' | 'en' = 'es') {
  const raw = (report.governance?.shareholderMinutes ?? '').trim();
  if (!raw) return undefined;
  const md = scrubInternalMetadata(raw);
  return { bodyMarkdown: withNarrativeDisclaimer(md, language), citations: extractCitations(md) };
}

// ─── Recommendations ──────────────────────────────────────────────────────────

const ROTATION: AreaKey[] = ['futuro', 'valor', 'escudo', 'verdad'];

function buildRecommendations(report: FinancialReport, language: 'es' | 'en' = 'es'): RecommendationItem[] {
  const md = report.strategicAnalysis?.strategicRecommendations ?? '';
  const items = parseNumberedList(md);
  return items.map((it, idx) => ({
    title: scrubInternalMetadata(it.title),
    bodyMarkdown:
      idx === 0 ? withNarrativeDisclaimer(scrubInternalMetadata(it.body), language) : scrubInternalMetadata(it.body),
    areaAccent: ROTATION[idx % ROTATION.length],
  }));
}

// ─── Appendix ─────────────────────────────────────────────────────────────────

/**
 * Motivo de descuadre de la ecuación calculado ANTES del curator que el
 * resumen POSTERIOR al curator ya resolvió (normativa-metricas NM-04).
 *
 * `validation.reasons` se escribe al construir el snapshot, antes de R1/R8: con
 * un sobregiro reclasificado al pasivo y el resultado cerrado en el patrimonio,
 * el apéndice imprimía "Activo (1.150.000.000,00) != Pasivo (470.000.000,00) +
 * Patrimonio (…)" al lado de un balance de $1.180.000.000,00 que sí cuadra.
 * Sólo se descartan los motivos de ECUACIÓN, y sólo si los totales de control
 * (la base de las anclas, el balance y el PDF) cuadran al centavo; los motivos
 * de integridad y los bloqueos del curator se conservan siempre.
 */
function isResolvedPreCuratorEquationReason(reason: string, snap: PeriodSnapshot | undefined): boolean {
  if (!snap) return false;
  const persistent = new Set([
    ...(snap.validation?.integrityReasons ?? []),
    ...(snap.validation?.curatorBlockingReasons ?? []),
  ]);
  if (persistent.has(reason)) return false;
  if (
    !/ecuaci[oó]n contable no cuadra|descuadre coincide aproximadamente con la utilidad|Total Patrimonio .* < 1% del Activo/i.test(
      reason,
    )
  ) {
    return false;
  }
  const ct = snap.controlTotals;
  if (!ct) return false;
  const cents = (ct as { cents?: { activo?: bigint; pasivo?: bigint; patrimonio?: bigint } }).cents;
  if (typeof cents?.activo === 'bigint' && typeof cents.pasivo === 'bigint' && typeof cents.patrimonio === 'bigint') {
    return cents.activo === cents.pasivo + cents.patrimonio;
  }
  return Math.round(ct.activo * 100) === Math.round(ct.pasivo * 100) + Math.round(ct.patrimonio * 100);
}

function buildAppendix(
  report: FinancialReport,
  preprocessed: PreprocessedBalance | null | undefined,
  totals: ControlTotals | null,
  emittable: EmittableGate | undefined,
) {
  // adjustmentsTable from a possible governance.adjustmentsLedger field
  // (defensive — the type may not surface it yet).
  const ledger = (report.governance as unknown as {
    adjustmentsLedger?: unknown;
  }).adjustmentsLedger;
  const adjustmentsTable = parseAdjustmentsLedger(ledger);

  // Validation warnings: snapshot.validation.* (defensive optional chain on
  // the in-flight preprocessor shape).
  const validationWarnings: string[] = [];
  if (preprocessed) {
    const primary = (preprocessed as { primary?: PeriodSnapshot }).primary;
    const primaryWarnings = (primary?.validation?.reasons ?? []).filter(
      (w) => !isResolvedPreCuratorEquationReason(String(w), primary),
    );
    for (const w of primaryWarnings) validationWarnings.push(scrubInternalMetadata(String(w)));
    const adjustments = primary?.validation?.adjustments ?? [];
    for (const a of adjustments) validationWarnings.push(scrubInternalMetadata(String(a)));
  }
  if (emittable && !emittable.ok) {
    for (const b of emittable.blockers ?? []) {
      validationWarnings.push(scrubInternalMetadata(String(b)));
    }
  }
  if (Array.isArray(report.emittability?.blockers)) {
    for (const b of report.emittability!.blockers) {
      validationWarnings.push(scrubInternalMetadata(`${b.code}: ${b.message}`));
    }
  }

  const bindingTotalsBlock = totals ? formatBindingTotals(totals) : undefined;

  return {
    ...(adjustmentsTable.length > 0 ? { adjustmentsTable } : {}),
    ...(validationWarnings.length > 0 ? { validationWarnings } : {}),
    ...(bindingTotalsBlock ? { bindingTotalsBlock } : {}),
  };
}

/**
 * Parsea un monto escrito en convención colombiana (`$1.234.567,89`,
 * `(1.234,56)`, `-$1.234`) a pesos.
 *
 * El parser anterior hacía `Number(raw.replace(/[^\d.-]/g, ''))`, que trata el
 * punto de MILES es-CO como punto decimal: `"$1.234.567,89"` quedaba como
 * `"1.234.567.89"` → `NaN` → `0`, y `"$1.234"` quedaba como `1.234` — el valor
 * real dividido por mil. La tabla de ajustes del apéndice imprimía entonces $0
 * (o una milésima) justo donde el cliente debe ver el ajuste NIIF aplicado.
 *
 * Devuelve `null` cuando el texto no contiene un monto interpretable, para que
 * el llamador pueda hacer visible el hueco en vez de fabricar un cero.
 */
export function parseCopAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  // Paréntesis = negativo (convención contable NIIF); se detecta ANTES de
  // limpiar, porque la limpieza elimina los paréntesis.
  const parenthesized = /^\(.*\)$/.test(text);
  const digitsOnly = text.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(digitsOnly)) return null;
  const negative = parenthesized || digitsOnly.trim().startsWith('-');
  // es-CO: '.' separa miles, ',' separa decimales.
  const normalized = digitsOnly.replace(/-/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function parseAdjustmentsLedger(ledger: unknown): AdjustmentRow[] {
  if (!ledger) return [];
  // Accept either an array of rows or a markdown-table string.
  if (Array.isArray(ledger)) {
    const out: AdjustmentRow[] = [];
    for (const r of ledger) {
      if (!r || typeof r !== 'object') continue;
      const row = r as {
        cuenta?: unknown;
        descripcion?: unknown;
        ajuste?: unknown;
        norma?: unknown;
      };
      const cuenta = String(row.cuenta ?? '');
      // El ledger llega sin tipar desde `governance`; el monto puede venir como
      // número o como texto ya formateado en COP.
      const parsed = parseCopAmount(row.ajuste);
      const descripcion = withUnparsedAmountNote(String(row.descripcion ?? ''), parsed, row.ajuste);
      out.push({
        cuenta,
        descripcion,
        ajuste: parsed ?? 0,
        ...(row.norma ? { norma: String(row.norma) } : {}),
      });
    }
    return out;
  }
  if (typeof ledger === 'string') {
    const t = parseStatementTable(ledger);
    const out: AdjustmentRow[] = [];
    for (const row of t.rows) {
      const cuenta = row.account;
      const ajusteRaw = row.cells[1] ?? '';
      const parsed = parseCopAmount(ajusteRaw);
      const descripcion = withUnparsedAmountNote(row.cells[0] ?? '', parsed, ajusteRaw);
      const norma = row.cells[2];
      out.push({
        cuenta,
        descripcion,
        ajuste: parsed ?? 0,
        ...(norma ? { norma } : {}),
      });
    }
    return out;
  }
  return [];
}

/**
 * `AdjustmentRow.ajuste` es `number` por contrato del IR, así que un monto
 * ilegible no puede renderizarse como "N/D" en su propia celda. En vez de
 * dejar un $0 que se lee como "no hubo ajuste", anotamos el texto original en
 * la descripción para que el hueco sea visible y auditable.
 */
function withUnparsedAmountNote(
  descripcion: string,
  parsed: number | null,
  raw: unknown,
): string {
  if (parsed !== null) return descripcion;
  const rawText = typeof raw === 'string' ? raw.trim() : '';
  if (!rawText) return descripcion;
  return `${descripcion} [monto no interpretable: ${rawText}]`.trim();
}

function formatBindingTotals(t: ControlTotals): string {
  const lines: string[] = [];
  lines.push('TOTALES VINCULANTES (controlTotals)');
  lines.push(`  Activo:        ${formatCop(t.activo)}`);
  lines.push(`    Corriente:     ${formatCop(t.activoCorriente)}`);
  lines.push(`    No corriente:  ${formatCop(t.activoNoCorriente)}`);
  lines.push(`  Pasivo:        ${formatCop(t.pasivo)}`);
  lines.push(`    Corriente:     ${formatCop(t.pasivoCorriente)}`);
  lines.push(`    No corriente:  ${formatCop(t.pasivoNoCorriente)}`);
  lines.push(`  Patrimonio:    ${formatCop(t.patrimonio)}`);
  // Σ clase 4 tal cual la balanza (bruto + devoluciones + no operacionales): se
  // rotula como tal para no confundirla con los ingresos operacionales.
  lines.push(`  Σ clase 4:     ${formatCop(t.ingresos)}`);
  if (typeof t.ingresosNetos === 'number') {
    lines.push(`  Ingresos netos (clase 4 − 4175): ${formatCop(t.ingresosNetos)}`);
  }
  lines.push(`  Gastos+Costos: ${formatCop(t.gastos)}`);
  lines.push(`  Utilidad Neta: ${formatCop(t.utilidadNeta)}`);
  return lines.join('\n');
}

// ─── Formatters ───────────────────────────────────────────────────────────────

/**
 * Formatea pesos (float) delegando en el helper canónico `formatCopFromCents`.
 *
 * Why: este archivo tenía su propio formatter con convención `-$1.234,56`
 * mientras los estados financieros del MISMO PDF (vía
 * `compose-statements-from-json.ts` → `formatCopFromCents`) usan la convención
 * NIIF de paréntesis `($1.234,56)`. Dos tipografías para el mismo signo en el
 * mismo entregable, y dos redondeos distintos (`toLocaleString` sobre float vs
 * aritmética exacta en centavos). Se unifica en el helper canónico.
 *
 * `controlTotals` viaja en PESOS (number); el helper trabaja en centavos. La
 * conversión va por el texto decimal (`formatCopFromPesos`), igual que
 * `fmtCopPesos` del Excel: `Math.round(n * 100)` deja de ser un entero seguro
 * por encima de ~$90 billones y, desde niif-contrato-22, `formatCopFromCents`
 * lanza RangeError con él (integración I2).
 */
function formatCop(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'N/D';
  return formatCopFromPesos(n, false);
}

function formatRatio(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'N/D';
  return n.toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPct(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'N/D';
  const pct = n * 100;
  return `${pct.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// ─── Signature block + emphasis paragraphs ───────────────────────────────────

/**
 * Construye el bloque de firma a partir de `company.signatories` (forma
 * canonica nueva) o de los strings legacy `legalRepresentative`/`fiscalAuditor`/
 * `accountant`. Si todos los slots son null → renderSignatureBlock() emite
 * placeholders, y la pagina de cierre renderiza lineas vacias para firma manual.
 */
function buildSignatureBlock(report: FinancialReport): SignatureBlockSpec {
  const signs = signatoriesFromCompany(report.company ?? {});
  return {
    rendered: renderSignatureBlock(signs),
  };
}

/**
 * Mapea los `emphasisParagraphs` y `otherMatterParagraphs` del Dictamen NIA al
 * IR del PDF editorial. NIA 706 §A1 exige encabezado bold "Parrafo de Enfasis"
 * y cierre literal "Nuestra opinion no se modifica respecto a esta cuestion".
 *
 * Regla de presentacion (NIA 706 par. 7-9):
 *  - "Parrafo de Enfasis" se posiciona post-opinion, antes de "Otras
 *    responsabilidades / Cuestiones".
 *  - "Parrafo de Otras Cuestiones" va despues del de enfasis.
 */
function buildEmphasisParagraphs(
  dictamen: FiscalOpinionDictamen | undefined,
): EmphasisParagraphSpec[] {
  if (!dictamen) return [];
  const out: EmphasisParagraphSpec[] = [];

  for (const p of dictamen.emphasisParagraphs ?? []) {
    if (typeof p === 'string' && p.trim().length > 0) {
      out.push({ heading: 'Parrafo de Enfasis', bodyMarkdown: p.trim() });
    }
  }
  for (const p of dictamen.otherMatterParagraphs ?? []) {
    if (typeof p === 'string' && p.trim().length > 0) {
      out.push({ heading: 'Parrafo de Otras Cuestiones', bodyMarkdown: p.trim() });
    }
  }
  return out;
}
