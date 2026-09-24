import { NextResponse } from 'next/server';
import { z } from 'zod';
import { financialExportBlockers } from '@/lib/export/financial-export-validation';
import { Readable } from 'node:stream';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import { revivePreprocessedBalance } from '@/lib/preprocessing/json-safe';
import {
  orchestrateFinancialReport,
  BalanceValidationError,
  buildNiifValidatorOptions,
  fiscalYearOf,
} from '@/lib/agents/financial/orchestrator';
import { NiifReportSchema } from '@/lib/agents/financial/contracts/niif-report';
import { StrategyReportSchema } from '@/lib/agents/financial/contracts/strategy-report';
import { validateNiifReportJson } from '@/lib/agents/financial/validators/niif-json-validator';
import {
  reconcileStrategyAnchors,
  readStrategyQualifications,
} from '@/lib/agents/financial/validators/strategy-anchors';
import { applyAdjustments } from '@/lib/agents/repair/adjustments';
import type { AdjustmentLedger } from '@/lib/agents/repair/types';
import {
  financialReportRequestSchema,
  exportFormatSchema,
} from '@/lib/validation/schemas';
import {
  composeEditorialReport,
  renderEditorialReportToStream,
} from '@/lib/export/pdf-elite-react';
import { aggregatePillars } from '@/lib/pillars/service';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';
import type { OutputOptionsToggle } from '@/lib/export/pdf-elite-react/types';
import { requireAuthSession } from '@/lib/auth/require-session';

// ---------------------------------------------------------------------------
// POST /api/financial-report/export
// ---------------------------------------------------------------------------
// Three modes:
//
// 1. FULL PIPELINE (Excel):    Send rawData + company → preprocess → 3 agents → .xlsx
// 2. EXPORT ONLY (Excel):      Send an existing FinancialReport → .xlsx
// 3. EDITORIAL PDF (pdf-elite): Send rawData + company + format='pdf-elite'
//                               → preprocess → 3 agents → editorial PDF
//
// Selection: body.format ∈ {'excel'|'pdf'|'pdf-elite'} (default 'excel').
// `pdf` is the legacy jsPDF format and is deprecated — prefer `pdf-elite`.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';
// 800 (no 300): los exports full-pipeline ejecutan orchestrateFinancialReport
// completo — con 300s Vercel mataba la function a mitad de run (504 sin
// payload). Mismo techo que /niif /strategy /governance.
export const maxDuration = 800;

// ---------------------------------------------------------------------------
// Una sola fuente por informe (pipeline-flujo-07)
// ---------------------------------------------------------------------------
// Los estados (Balance, P&G, EFE, ECP) salen de `report.niifAnalysis.json`; el
// KPI grid, la cascada, los diales, el anexo del PDF y las pestañas
// deterministas del Excel salen del preprocesado. Hasta ahora ese preprocesado
// se re-derivaba del `rawData` ORIGINAL — sin los ajustes del Doctor de Datos
// que /niif sí aplicó — y nadie comparaba las dos fuentes: un mismo PDF podía
// mostrar dos cifras para el mismo rubro. Ahora:
//   1. El preprocesado de exportación es el que usó /niif: el que envía el
//      cliente (`preprocessed`, ya ajustado) o el re-derivado de `rawData` con
//      el MISMO `adjustmentLedger` aplicado.
//   2. El JSON NIIF se cruza contra las anclas de ese preprocesado con el mismo
//      validador de /niif; si difieren, la exportación se rechaza (422).
// ---------------------------------------------------------------------------

/**
 * Separador con el que /api/upload antepone el informe de validación al texto
 * del balance. TODO(cross-dep ingesta-01): sustituir por el helper compartido
 * `src/lib/preprocessing/raw-data.ts` cuando esté disponible (también debe
 * resolver los bloques `[period=…]` de XLSX, que aquí no se re-parsean).
 */
const VALIDATION_REPORT_SEPARATOR = '\n\n---\n\nDATOS ORIGINALES:\n';

/** El texto del balance sin el informe de validación antepuesto por /upload. */
function stripValidationReportPrefix(rawData: string): string {
  const idx = rawData.indexOf(VALIDATION_REPORT_SEPARATOR);
  return idx >= 0 ? rawData.slice(idx + VALIDATION_REPORT_SEPARATOR.length) : rawData;
}

/** Preprocesa el balance recibido como texto. `undefined` si no es parseable. */
function preprocessRawData(rawData: string, label: string): PreprocessedBalance | undefined {
  const text = stripValidationReportPrefix(rawData);
  // Bloques XLSX `[period=…]`: su parseo depende del periodo forzado por hoja
  // que hace /upload. Re-parsearlos aquí con otra regla produciría un balance
  // distinto del que vio /niif; sin preprocesado, todas las cifras salen del
  // JSON NIIF (una sola fuente).
  if (/^\[period=[^\]]+\]/m.test(text)) return undefined;
  try {
    const rows = parseTrialBalanceCSV(text);
    return rows.length > 0 ? preprocessTrialBalance(rows) : undefined;
  } catch (err) {
    console.warn(`[${label}] preprocess failed:`, err instanceof Error ? err.message : err);
    return undefined;
  }
}

const adjustmentSchema = z.object({
  id: z.string().min(1).max(100),
  accountCode: z.string().min(1).max(10),
  accountName: z.string().min(1).max(200),
  amount: z.number().refine((n) => Number.isFinite(n), 'amount debe ser finito'),
  rationale: z.string().min(1).max(2_000),
  status: z.enum(['proposed', 'applied', 'rejected']),
  proposedAt: z.string().min(1).max(40),
  appliedAt: z.string().min(1).max(40).optional(),
  rejectedAt: z.string().min(1).max(40).optional(),
});
const adjustmentLedgerSchema = z.object({ adjustments: z.array(adjustmentSchema).max(50) }).optional();

type ExportSource =
  | { ok: true; preprocessed: PreprocessedBalance | undefined }
  | { ok: false; response: Response };

/**
 * El preprocesado con el que se componen las superficies deterministas: el
 * mismo balance (ajustado) que usó /niif.
 */
function resolveExportPreprocessed(body: Record<string, unknown>, label: string): ExportSource {
  if (body.preprocessed !== undefined && body.preprocessed !== null) {
    const revived = revivePreprocessedBalance(body.preprocessed);
    if (!revived) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Invalid preprocessed format.' }, { status: 400 }),
      };
    }
    // `context.preprocessed` de /niif ya trae los ajustes del Doctor de Datos.
    return { ok: true, preprocessed: revived };
  }

  const ledger = adjustmentLedgerSchema.safeParse(body.adjustmentLedger);
  if (!ledger.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Invalid adjustmentLedger format.',
          details: ledger.error.issues.map((i) => `adjustmentLedger.${i.path.join('.')}: ${i.message}`),
        },
        { status: 400 },
      ),
    };
  }

  if (typeof body.rawData !== 'string' || body.rawData.length === 0) {
    return { ok: true, preprocessed: undefined };
  }
  const pp = preprocessRawData(body.rawData, label);
  const applied = ((ledger.data as AdjustmentLedger | undefined)?.adjustments ?? []).filter(
    (a) => a.status === 'applied',
  );
  if (!pp || applied.length === 0) return { ok: true, preprocessed: pp };
  // Mismo paso que Stage 0.4 de /niif (`prepareFinancialContext`).
  return { ok: true, preprocessed: applyAdjustments(pp, applied).balance };
}

/**
 * Bloqueantes de coherencia entre fuentes: el JSON NIIF contra las anclas del
 * preprocesado de exportación (mismo validador y mismas anclas que /niif), el
 * periodo del informe contra el del balance, y la Parte II contra sus anclas.
 */
function sourceCoherenceBlockers(
  report: FinancialReport,
  preprocessed: PreprocessedBalance | undefined,
): string[] {
  const out: string[] = [];

  // Veredicto de la Parte II (pipeline-flujo-05) + re-verificación servidor:
  // el flag del cliente no sustituye al cruce aritmético.
  if (readStrategyQualifications(report.strategicAnalysis)?.clean === false) {
    out.push('El análisis estratégico (Parte II) contiene cifras sin respaldo en el balance.');
  }
  const niifParsed = NiifReportSchema.safeParse(report.niifAnalysis?.json);
  const niif = niifParsed.success ? niifParsed.data : null;
  const strategyParsed = StrategyReportSchema.safeParse(report.strategicAnalysis?.json);
  if (strategyParsed.success) {
    const check = reconcileStrategyAnchors(strategyParsed.data, {
      primary: preprocessed?.primary,
      comparative: preprocessed ? (preprocessed.comparative ?? null) : undefined,
      niif,
    });
    out.push(...check.deviations.map((d) => `Parte II — ${d}`));
  }

  if (!preprocessed || !niif) return out;

  const anchored = validateNiifReportJson(niif, buildNiifValidatorOptions(preprocessed));
  out.push(
    ...anchored.errors.map(
      (e) => `Fuentes incoherentes — el informe no coincide con el balance de la exportación: ${e}`,
    ),
  );
  const balanceYear = fiscalYearOf(preprocessed.primary?.period);
  if (balanceYear && niif.company.fiscalPeriod !== balanceYear) {
    out.push(
      `Fuentes incoherentes — el informe es del periodo ${niif.company.fiscalPeriod} y el balance de la exportación de ${balanceYear}.`,
    );
  }
  return out;
}

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    let body;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }

    const formatParse = exportFormatSchema.safeParse(body?.format);
    if (!formatParse.success || formatParse.data === 'pdf') {
      return NextResponse.json({ error: "Unsupported format. Use 'excel' or 'pdf-elite'." }, { status: 400 });
    }
    const format = formatParse.data;

    // -----------------------------------------------------------------------
    // EDITORIAL PDF branch
    // -----------------------------------------------------------------------
    if (format === 'pdf-elite') {
      return await handlePdfElite(body);
    }

    // -----------------------------------------------------------------------
    // Mode 2 (Excel-only): pre-built report passthrough.
    // -----------------------------------------------------------------------
    if (body.report && body.report.consolidatedReport) {
      // Guard de shape mínimo antes del cast: un `report` malformado debe ser
      // 400, no TypeError 500 al leer `report.company.name`.
      if (typeof body.report?.company?.name !== 'string') {
        return NextResponse.json(
          { error: 'Invalid report format: company.name is required.' },
          { status: 400 },
        );
      }
      const report = body.report as FinancialReport;
      const source = resolveExportPreprocessed(body, 'export/excel');
      if (!source.ok) return source.response;
      const { preprocessed } = source;
      const blocked = rejectInvalidExport(report, preprocessed);
      if (blocked) return blocked;
      const buffer = await generateFinancialExcel({ report, preprocessed });
      return createExcelResponse(buffer, report.company.name);
    }

    // -----------------------------------------------------------------------
    // Mode 1 (Excel full pipeline) — original behavior preserved verbatim.
    // -----------------------------------------------------------------------
    const parsed = financialReportRequestSchema.safeParse(body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json({ error: 'Invalid request.', details: errors }, { status: 400 });
    }

    const { rawData, company, language, instructions } = parsed.data;

    const preprocessed = preprocessRawData(rawData, 'export/full');

    const enhancedData = preprocessed
      ? `${preprocessed.validationReport}\n\n---\n\nDATOS LIMPIOS (auxiliares validados):\n${preprocessed.cleanData}`
      : rawData;

    let enhancedInstructions = instructions || '';
    let effectiveCompany = company;
    if (preprocessed) {
      const fmt = (n: number) =>
        (n < 0 ? '-' : '') +
        '$' +
        Math.abs(n).toLocaleString('es-CO', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

      const p = preprocessed.primary;
      const c = preprocessed.comparative;

      const detected = preprocessed.periods.map((s) => s.period);
      if (!effectiveCompany.comparativePeriod && detected.length >= 2) {
        effectiveCompany = {
          ...effectiveCompany,
          comparativePeriod: detected[detected.length - 2],
          detectedPeriods: detected,
        };
      } else if (!effectiveCompany.detectedPeriods) {
        effectiveCompany = { ...effectiveCompany, detectedPeriods: detected };
      }

      enhancedInstructions += `\n\nTOTALES PRE-CALCULADOS (VINCULANTES — precision decimal desde auxiliares).`;
      enhancedInstructions += `\n\n=== Periodo actual (${p.period}) ===\n`;
      enhancedInstructions += `- Total Activos (Clase 1): ${fmt(p.summary.totalAssets)}\n`;
      enhancedInstructions += `- Total Pasivos (Clase 2): ${fmt(p.summary.totalLiabilities)}\n`;
      enhancedInstructions += `- Total Patrimonio (Clase 3): ${fmt(p.summary.totalEquity)}\n`;
      enhancedInstructions += `- Total Ingresos (Clase 4): ${fmt(p.summary.totalRevenue)}\n`;
      enhancedInstructions += `- Total Gastos (Clase 5): ${fmt(p.summary.totalExpenses)}\n`;
      enhancedInstructions += `- Total Costos de Ventas (Clase 6): ${fmt(p.summary.totalCosts)}\n`;
      enhancedInstructions += `- Costos de Produccion (Clase 7): ${fmt(p.summary.totalProduction)}\n`;
      enhancedInstructions += `- Utilidad Neta Calculada: ${fmt(p.summary.netIncome)}\n`;
      enhancedInstructions += `- Ecuacion Patrimonial: ${p.summary.equationBalanced ? 'CUADRA' : 'NO CUADRA'}`;

      if (c) {
        enhancedInstructions += `\n\n=== Periodo comparativo (${c.period}) ===\n`;
        enhancedInstructions += `- Total Activos: ${fmt(c.summary.totalAssets)}\n`;
        enhancedInstructions += `- Total Pasivos: ${fmt(c.summary.totalLiabilities)}\n`;
        enhancedInstructions += `- Total Patrimonio: ${fmt(c.summary.totalEquity)}\n`;
        enhancedInstructions += `- Total Ingresos: ${fmt(c.summary.totalRevenue)}\n`;
        enhancedInstructions += `- Total Gastos: ${fmt(c.summary.totalExpenses)}\n`;
        enhancedInstructions += `- Utilidad Neta: ${fmt(c.summary.netIncome)}`;

        const yoy = (cur: number, base: number): string => {
          if (base === 0) return cur === 0 ? '0,00%' : 'ND';
          const pct = ((cur - base) / Math.abs(base)) * 100;
          return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
        };
        enhancedInstructions += `\n\n=== Variacion YoY (${p.period} vs ${c.period}) ===\n`;
        enhancedInstructions += `- Activos: ${fmt(p.summary.totalAssets - c.summary.totalAssets)} (${yoy(p.summary.totalAssets, c.summary.totalAssets)})\n`;
        enhancedInstructions += `- Pasivos: ${fmt(p.summary.totalLiabilities - c.summary.totalLiabilities)} (${yoy(p.summary.totalLiabilities, c.summary.totalLiabilities)})\n`;
        enhancedInstructions += `- Patrimonio: ${fmt(p.summary.totalEquity - c.summary.totalEquity)} (${yoy(p.summary.totalEquity, c.summary.totalEquity)})\n`;
        enhancedInstructions += `- Ingresos: ${fmt(p.summary.totalRevenue - c.summary.totalRevenue)} (${yoy(p.summary.totalRevenue, c.summary.totalRevenue)})\n`;
        enhancedInstructions += `- Utilidad Neta: ${fmt(p.summary.netIncome - c.summary.netIncome)} (${yoy(p.summary.netIncome, c.summary.netIncome)})`;
        enhancedInstructions += `\n\nREGLA MULTIPERIODO: Tus estados financieros, KPIs y notas DEBEN producir DOS columnas (actual + comparativo) + variacion. Cifras 0 -> $0,00. Cifras inexistentes -> ND. NUNCA omitas el comparativo silenciosamente.`;
      } else {
        enhancedInstructions += `\n\nNOTA: solo hay un periodo en el balance — modo single-period.`;
      }

      enhancedInstructions += `\n\nREGLA: Estos totales son VINCULANTES. Tus estados financieros DEBEN reflejarlos.`;

      const allDiscrepancies = preprocessed.periods.flatMap((s) =>
        (s.discrepancies ?? []).map((d) =>
          typeof d === 'string' ? `[${s.period}] ${d}` : `[${s.period}] ${d.description ?? ''}`,
        ),
      );
      if (allDiscrepancies.length > 0) {
        enhancedInstructions += '\nADVERTENCIA: Discrepancias aritmeticas detectadas. USA totales de auxiliares, NO los reportados.';
      }
    }

    // pipeline-flujo-06: el orquestador recibe el MISMO preprocesado. Sin él
    // re-parseaba `enhancedData` (primera línea "# INFORME DE VALIDACION…" →
    // 0 filas): sin anclas, sin totales vinculantes y sin el gate 422, de modo
    // que un balance descuadrado producía un Excel con estados 100% LLM.
    let report: FinancialReport;
    try {
      report = await orchestrateFinancialReport(
        {
          rawData: enhancedData,
          company: effectiveCompany,
          language,
          instructions: enhancedInstructions,
        },
        { preprocessed },
      );
    } catch (err) {
      if (err instanceof BalanceValidationError) return balanceValidationResponse(err);
      throw err;
    }

    const blocked = rejectInvalidExport(report, preprocessed);
    if (blocked) return blocked;

    const buffer = await generateFinancialExcel({ report, preprocessed });
    return createExcelResponse(buffer, effectiveCompany.name);
  } catch (error) {
    console.error('[financial-report/export] Error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Error generating export.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// pdf-elite branch
// ---------------------------------------------------------------------------
// Runs the same preprocess + 3-agent pipeline as the Excel path. On
// BalanceValidationError, builds a degenerate doc and renders a BLOQUEADO PDF
// (cover + appendix + closing only). On success, optionally aggregates pillars
// and renders the full editorial document.

async function handlePdfElite(body: unknown): Promise<Response> {
  const b = (body ?? {}) as {
    report?: FinancialReport;
    rawData?: string;
    company?: FinancialReport['company'];
    language?: 'es' | 'en';
    instructions?: string;
    // Phase 2 inputs — optional. When PipelineWorkspace finishes Phase 2/3
    // (audit + quality), it forwards the full reports here so the PDF renders
    // AuditFindingsPage + QualityMetaAuditPage. If absent, those pages are
    // omitted by the composer (page-level null guards take care of it).
    auditReport?: AuditReport | null;
    qualityReport?: QualityAssessment | null;
    // Toggle del intake — qué entregables incluir. Omitido o null = todos.
    outputOptions?: OutputOptionsToggle | null;
    // Preprocesado usado por /niif (ya ajustado) o ledger de ajustes para
    // re-derivarlo desde `rawData` — ver `resolveExportPreprocessed`.
    preprocessed?: unknown;
    adjustmentLedger?: unknown;
  };

  // FAST PATH: client already has a completed FinancialReport in state (e.g.
  // PipelineWorkspace just finished the 3-agent run). Skip orchestration; only
  // re-preprocess the trial balance so the editorial template can show full
  // statements + pillar aggregates without paying the 30-60s LLM cost again.
  if (b.report?.consolidatedReport) {
    // Mismo guard de shape que Mode 2: 400 en vez de TypeError 500.
    if (typeof b.report?.company?.name !== 'string') {
      return NextResponse.json(
        { error: 'Invalid report format: company.name is required.' },
        { status: 400 },
      );
    }
    const report = b.report;
    const source = resolveExportPreprocessed(b as Record<string, unknown>, 'pdf-elite/fast');
    if (!source.ok) return source.response;
    const { preprocessed } = source;
    const blocked = rejectInvalidExport(report, preprocessed);
    if (blocked) return blocked;
    const language: 'es' | 'en' = b.language ?? 'es';

    let pillars = null;
    if (preprocessed?.primary) {
      try {
        pillars = aggregatePillars({
          snapshot: preprocessed.primary,
          comparative: preprocessed.comparative ?? null,
        });
      } catch (err) {
        console.warn('[pdf-elite/fast] aggregatePillars failed:', err);
      }
    }

    const doc = composeEditorialReport({
      report,
      preprocessed: preprocessed ?? null,
      pillars,
      language,
      auditReport: b.auditReport ?? null,
      qualityReport: b.qualityReport ?? null,
      outputOptions: b.outputOptions ?? null,
    });
    const stream = await renderEditorialReportToStream(doc);
    return pdfResponse(stream, report.company.name);
  }

  // SLOW PATH: no pre-built report — re-run the full pipeline (used by callers
  // that only have rawData + company, e.g. server-side cron jobs or programmatic
  // exports). Same behavior as before this fast path was added.
  const parsed = financialReportRequestSchema.safeParse(body);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    return NextResponse.json({ error: 'Invalid request.', details: errors }, { status: 400 });
  }
  const { rawData, company, language, instructions } = parsed.data;

  // Preprocess up front so we can reuse the snapshot for both pillars and the
  // BLOQUEADO degenerate path. El orquestador recibe el MISMO preprocesado: una
  // sola fuente para estados, KPI grid y anexo (pipeline-flujo-06/07).
  const preprocessed = preprocessRawData(rawData, 'pdf-elite');

  let report: FinancialReport | null = null;
  let blockerReasons: string[] = [];

  try {
    report = await orchestrateFinancialReport(
      {
        rawData,
        company,
        language,
        instructions,
      },
      { preprocessed },
    );
  } catch (err) {
    if (err instanceof BalanceValidationError) {
      blockerReasons = err.reasons;
    } else {
      throw err;
    }
  }

  if (!report) {
    // BLOCKED branch: build a minimal stub report so composer can produce a
    // doc whose meta.watermark === 'BLOQUEADO'. The renderer is responsible
    // for showing only Cover + Normative Appendix + Closing.
    const stub: FinancialReport = {
      company,
      niifAnalysis: {
        balanceSheet: '',
        incomeStatement: '',
        cashFlowStatement: '',
        equityChangesStatement: '',
        technicalNotes: '',
        fullContent: '',
      },
      strategicAnalysis: {
        kpiDashboard: '',
        breakEvenAnalysis: '',
        projectedCashFlow: '',
        strategicRecommendations: '',
        fullContent: '',
      },
      governance: {
        financialNotes: '',
        shareholderMinutes: '',
        fullContent: '',
      },
      consolidatedReport:
        language === 'en'
          ? '# REPORT BLOCKED — VALIDATION FAILED'
          : '# REPORTE BLOQUEADO — VALIDACION FALLIDA',
      generatedAt: new Date().toISOString(),
    };
    const doc = composeEditorialReport({
      report: stub,
      preprocessed: preprocessed ?? null,
      pillars: null,
      language,
      emittable: { ok: false, blockers: blockerReasons },
    });
    const stream = await renderEditorialReportToStream(doc);
    return pdfResponse(stream, company.name);
  }

  const blocked = rejectInvalidExport(report, preprocessed);
  if (blocked) return blocked;

  // Successful path: optionally aggregate pillars (fail-soft).
  let pillars = null;
  if (preprocessed?.primary) {
    try {
      pillars = aggregatePillars({
        snapshot: preprocessed.primary,
        comparative: preprocessed.comparative ?? null,
      });
    } catch (err) {
      console.warn('[pdf-elite] aggregatePillars failed:', err);
    }
  }

  const doc = composeEditorialReport({
    report,
    preprocessed: preprocessed ?? null,
    pillars,
    language,
  });

  const stream = await renderEditorialReportToStream(doc);
  return pdfResponse(stream, company.name);
}

function rejectInvalidExport(
  report: FinancialReport,
  preprocessed: PreprocessedBalance | undefined,
): Response | null {
  const details = Array.from(
    new Set([...financialExportBlockers(report), ...sourceCoherenceBlockers(report, preprocessed)]),
  );
  return details.length > 0
    ? NextResponse.json({ error: 'Report is not exportable.', details }, { status: 422 })
    : null;
}

function balanceValidationResponse(err: BalanceValidationError): Response {
  return NextResponse.json(
    {
      error: 'El balance de prueba tiene inconsistencias criticas.',
      code: 'BALANCE_VALIDATION_FAILED',
      reasons: err.reasons,
      suggestedAccounts: err.suggestedAccounts,
    },
    { status: 422 },
  );
}

function pdfResponse(stream: Readable, companyName: string): Response {
  const safeName = companyName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').slice(0, 30);
  const filename = `Reporte_Editorial_${safeName}_${Date.now()}.pdf`;
  const web = Readable.toWeb(stream) as unknown as ReadableStream;
  return new Response(web, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

function createExcelResponse(buffer: Buffer, companyName: string): Response {
  const safeName = companyName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').slice(0, 30);
  const filename = `Reporte_Financiero_1mas1_${safeName}_${Date.now()}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  });
}
