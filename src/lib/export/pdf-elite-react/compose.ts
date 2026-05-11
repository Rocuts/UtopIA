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
  DialGaugeSpec,
  EditorialReport,
  EmittableGate,
  EmphasisParagraphSpec,
  KpiCell,
  KpiGridSpec,
  NormCitation,
  ParsedTable,
  ParsedTableRow,
  PillarSatellite,
  PillarsSpec,
  PortraitSpec,
  RecommendationItem,
  ReportMeta,
  SignatureBlockSpec,
  TocEntry,
  WaterfallItem,
} from './types';
import type { FinancialReport } from '@/lib/agents/financial/types';
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
}

export function composeEditorialReport(input: ComposeInput): EditorialReport {
  const { report, preprocessed, pillars, language, emittable, dictamen } = input;

  const meta = buildMeta(report, language, emittable, preprocessed);
  const cover = buildCover(report, language);
  const toc = { entries: buildTocEntries(language, !!pillars) };
  const directorLetter = buildDirectorLetter(report, language);
  const totals = readControlTotals(preprocessed);
  const kpiGrid = buildKpiGrid(totals, pillars ?? null);
  const waterfall = { items: buildWaterfall(totals) };
  const dialGauges = { gauges: buildDialGauges(totals) };
  const pillarsSpec = buildPillarsSpec(pillars ?? null);
  const statements = buildStatements(report);
  const breakEven = buildBreakEven(report);
  const projectedCashFlow = buildProjectedCashFlow(report);
  const notes = { blocks: buildNotes(report) };
  const recommendations = { items: buildRecommendations(report) };
  const shareholderMinutes = buildShareholderMinutes(report);
  const appendix = buildAppendix(report, preprocessed, totals, emittable);
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
  if (emphasisParagraphs.length > 0) {
    out.emphasisParagraphs = emphasisParagraphs;
  }

  return out;
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

  if (emittable && emittable.ok === false) {
    watermark = 'BLOQUEADO';
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

  return {
    companyName: report.company?.name ?? 'N/D',
    nit: report.company?.nit ?? 'N/D',
    entityType: report.company?.entityType,
    fiscalPeriod: report.company?.fiscalPeriod ?? 'N/D',
    comparativePeriod: report.company?.comparativePeriod,
    generatedAt: report.generatedAt ?? new Date().toISOString(),
    language,
    ...(watermark ? { watermark } : {}),
    ...(watermarkSubtitle ? { watermarkSubtitle } : {}),
  };
}

function buildCover(report: FinancialReport, language: 'es' | 'en') {
  const title =
    language === 'en' ? 'Editorial Financial Report' : 'Informe Financiero Editorial';
  const subtitle = report.company?.name ?? '';
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
  const pickFromEither =
    extractFirstParagraphs(report.governance?.fullContent, 3) ||
    extractFirstParagraphs(report.strategicAnalysis?.fullContent, 3) ||
    extractFirstParagraphs(report.niifAnalysis?.fullContent, 3) ||
    '';
  const citations = extractCitations(pickFromEither);
  return {
    portrait,
    bodyMarkdown: pickFromEither,
    citations,
    signerName: language === 'en' ? 'UtopIA Team' : 'Equipo UtopIA',
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

// ─── KPI grid ─────────────────────────────────────────────────────────────────

function buildKpiGrid(
  totals: ControlTotals | null,
  pillars: PillarsResult | null,
): KpiGridSpec {
  const kpis: KpiCell[] = [];
  if (totals) {
    push(kpis, 'Activo Total', formatCop(totals.activo));
    push(kpis, 'Pasivo Total', formatCop(totals.pasivo));
    push(kpis, 'Patrimonio', formatCop(totals.patrimonio));
    push(kpis, 'Ingresos', formatCop(totals.ingresos));
    push(kpis, 'Gastos + Costos', formatCop(totals.gastos));
    push(kpis, 'Utilidad Neta', formatCop(totals.utilidadNeta));

    // Margin neta = utilidadNeta / ingresos
    if (totals.ingresos !== 0) {
      const margin = totals.utilidadNeta / totals.ingresos;
      push(kpis, 'Margen Neto', formatPct(margin));
    }
    // ROE = utilidadNeta / patrimonio
    if (totals.patrimonio !== 0) {
      const roe = totals.utilidadNeta / totals.patrimonio;
      push(kpis, 'ROE', formatPct(roe));
    }
    // Razon corriente
    if (totals.pasivoCorriente !== 0) {
      push(
        kpis,
        'Razón Corriente',
        formatRatio(totals.activoCorriente / totals.pasivoCorriente),
      );
    }
    // Endeudamiento
    if (totals.activo !== 0) {
      push(kpis, 'Endeudamiento', formatPct(totals.pasivo / totals.activo));
    }
  }

  // Pillar-derived cards (pick the headline KPI from each pilar.kpis if present).
  if (pillars) {
    const ebitda = findCardValue(pillars.valor, 'ebitda');
    if (ebitda !== null) push(kpis, 'EBITDA', formatCop(ebitda));
    const autonomia = findCardValue(pillars.escudo, 'autonomia');
    if (autonomia !== null) push(kpis, 'Días Autonomía', `${Math.round(autonomia)} días`);
    const cagr = findCardValue(pillars.futuro, 'cagr');
    if (cagr !== null) push(kpis, 'Crecimiento Ingresos', formatPct(cagr));
  }

  return { kpis: kpis.slice(0, 12) };
}

function push(arr: KpiCell[], label: string, value: string): void {
  arr.push({ label, value });
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

function buildWaterfall(totals: ControlTotals | null): WaterfallItem[] {
  if (!totals) return [];
  const items: WaterfallItem[] = [];
  items.push({ label: 'Ingresos', amount: totals.ingresos, sign: 'pos' });
  // Split gastos vs costos when individually known is non-trivial here; we use
  // the consolidated `gastos` field (which already includes Class 5+6+7) and
  // approximate costs as 0 if no separate handle exists. We emit a single
  // negative bucket plus impuesto + utilidad for clarity.
  const gastosOp = totals.gastos;
  // Approximate impuesto = impuestos PUC 24 if present, otherwise 0.
  const impuestos =
    typeof totals.impuestosCuenta24 === 'number' ? totals.impuestosCuenta24 : 0;
  if (gastosOp !== 0) {
    items.push({ label: '(Gastos + Costos)', amount: -Math.abs(gastosOp), sign: 'neg' });
  }
  if (impuestos !== 0) {
    items.push({ label: '(Impuestos)', amount: -Math.abs(impuestos), sign: 'neg' });
  }
  items.push({ label: 'Utilidad Neta', amount: totals.utilidadNeta, sign: 'total' });
  return items;
}

// ─── Dial gauges ──────────────────────────────────────────────────────────────

function buildDialGauges(totals: ControlTotals | null): DialGaugeSpec[] {
  if (!totals) return [];

  // Razón Corriente — thresholds [1.0, 1.5, 2.5] (sourced from financial pipeline
  // KPI conventions; standard NIIF PYME ratio bands).
  const razonCorriente =
    totals.pasivoCorriente !== 0 ? totals.activoCorriente / totals.pasivoCorriente : 0;

  // Prueba ácida — inventario approximated as 0 (controlTotals doesn't carry an
  // inventario field). Thresholds [0.7, 1.0, 2.0].
  const inventario = 0;
  const pruebaAcida =
    totals.pasivoCorriente !== 0
      ? (totals.activoCorriente - inventario) / totals.pasivoCorriente
      : 0;

  // Endeudamiento — lower-better. Thresholds [0.3, 0.5, 0.7].
  const endeudamiento = totals.activo !== 0 ? totals.pasivo / totals.activo : 0;

  // Cobertura intereses (approximated): utilidadNeta / 0 or fallback 0 since
  // gastoFinanciero is not directly exposed. We use utilidadNeta as proxy. A
  // future iteration with broken-out interest expense will replace this.
  const coberturaInt = 0;

  return [
    {
      label: 'Razón Corriente',
      value: clampForGauge(razonCorriente, 0, 5),
      min: 0,
      max: 5,
      thresholds: [1.0, 1.5, 2.5],
      areaAccent: 'escudo' as AreaKey,
      caption: 'Óptimo ≥ 1,5',
    },
    {
      label: 'Prueba Ácida',
      value: clampForGauge(pruebaAcida, 0, 3),
      min: 0,
      max: 3,
      thresholds: [0.7, 1.0, 2.0],
      areaAccent: 'escudo' as AreaKey,
      caption: 'Óptimo ≥ 1,0',
    },
    {
      label: 'Endeudamiento',
      value: clampForGauge(endeudamiento, 0, 1),
      min: 0,
      max: 1,
      thresholds: [0.3, 0.5, 0.7],
      areaAccent: 'verdad' as AreaKey,
      caption: 'Óptimo ≤ 0,5',
    },
    {
      label: 'Cobertura Intereses',
      value: clampForGauge(coberturaInt, 0, 10),
      min: 0,
      max: 10,
      thresholds: [1.5, 3.0, 6.0],
      areaAccent: 'futuro' as AreaKey,
      caption: 'Óptimo ≥ 3,0',
    },
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

function buildStatements(report: FinancialReport) {
  return {
    balance: parseStatementTable(report.niifAnalysis?.balanceSheet),
    income: parseStatementTable(report.niifAnalysis?.incomeStatement),
    cashFlow: parseStatementTable(report.niifAnalysis?.cashFlowStatement),
    equity: parseStatementTable(report.niifAnalysis?.equityChangesStatement),
  };
}

// ─── Notes ────────────────────────────────────────────────────────────────────

function buildNotes(report: FinancialReport) {
  const md = report.governance?.financialNotes ?? '';
  const sections = parseHeadingSections(md, 2);
  // Fallback to level 3 if level 2 yielded nothing (defensive).
  const eff = sections.length > 0 ? sections : parseHeadingSections(md, 3);
  return eff.map((s) => ({
    heading: s.heading,
    bodyMarkdown: s.body,
    citations: extractCitations(s.body),
  }));
}

// ─── Break-Even Analysis ──────────────────────────────────────────────────────
// Punto de equilibrio — markdown del Director de Estrategia (FinancialReport.
// strategicAnalysis.breakEvenAnalysis). Retorna undefined si el campo está
// vacío para que la página se omita.

function buildBreakEven(report: FinancialReport) {
  const md = (report.strategicAnalysis?.breakEvenAnalysis ?? '').trim();
  if (!md) return undefined;
  return { bodyMarkdown: md, citations: extractCitations(md) };
}

// ─── Projected Cash Flow ──────────────────────────────────────────────────────
// Proyección de flujo de caja 12 meses — markdown del Director de Estrategia
// (FinancialReport.strategicAnalysis.projectedCashFlow). Undefined si vacío.

function buildProjectedCashFlow(report: FinancialReport) {
  const md = (report.strategicAnalysis?.projectedCashFlow ?? '').trim();
  if (!md) return undefined;
  return { bodyMarkdown: md, citations: extractCitations(md) };
}

// ─── Shareholder Minutes ──────────────────────────────────────────────────────
// Acta de asamblea (Art. 187 Ley 222/1995) — markdown del Especialista de
// Gobierno (FinancialReport.governance.shareholderMinutes). Undefined si vacío.

function buildShareholderMinutes(report: FinancialReport) {
  const md = (report.governance?.shareholderMinutes ?? '').trim();
  if (!md) return undefined;
  return { bodyMarkdown: md, citations: extractCitations(md) };
}

// ─── Recommendations ──────────────────────────────────────────────────────────

const ROTATION: AreaKey[] = ['futuro', 'valor', 'escudo', 'verdad'];

function buildRecommendations(report: FinancialReport): RecommendationItem[] {
  const md = report.strategicAnalysis?.strategicRecommendations ?? '';
  const items = parseNumberedList(md);
  return items.map((it, idx) => ({
    title: it.title,
    bodyMarkdown: it.body,
    areaAccent: ROTATION[idx % ROTATION.length],
  }));
}

// ─── Appendix ─────────────────────────────────────────────────────────────────

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
    const primaryWarnings = primary?.validation?.reasons ?? [];
    for (const w of primaryWarnings) validationWarnings.push(String(w));
    const adjustments = primary?.validation?.adjustments ?? [];
    for (const a of adjustments) validationWarnings.push(String(a));
  }
  if (emittable && !emittable.ok) {
    for (const b of emittable.blockers ?? []) {
      validationWarnings.push(String(b));
    }
  }
  if (Array.isArray(report.emittability?.blockers)) {
    for (const b of report.emittability!.blockers) {
      validationWarnings.push(`${b.code}: ${b.message}`);
    }
  }

  const bindingTotalsBlock = totals ? formatBindingTotals(totals) : undefined;

  return {
    ...(adjustmentsTable.length > 0 ? { adjustmentsTable } : {}),
    ...(validationWarnings.length > 0 ? { validationWarnings } : {}),
    ...(bindingTotalsBlock ? { bindingTotalsBlock } : {}),
  };
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
      const descripcion = String(row.descripcion ?? '');
      const ajuste =
        typeof row.ajuste === 'number' && Number.isFinite(row.ajuste) ? row.ajuste : 0;
      out.push({
        cuenta,
        descripcion,
        ajuste,
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
      const descripcion = row.cells[0] ?? '';
      const ajusteRaw = row.cells[1] ?? '0';
      const ajuste = Number(String(ajusteRaw).replace(/[^\d.-]/g, '')) || 0;
      const norma = row.cells[2];
      out.push({
        cuenta,
        descripcion,
        ajuste,
        ...(norma ? { norma } : {}),
      });
    }
    return out;
  }
  return [];
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
  lines.push(`  Ingresos:      ${formatCop(t.ingresos)}`);
  lines.push(`  Gastos+Costos: ${formatCop(t.gastos)}`);
  lines.push(`  Utilidad Neta: ${formatCop(t.utilidadNeta)}`);
  return lines.join('\n');
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatCop(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'N/D';
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (n < 0 ? '-$' : '$') + formatted;
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
