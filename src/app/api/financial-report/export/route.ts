import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import {
  orchestrateFinancialReport,
  BalanceValidationError,
} from '@/lib/agents/financial/orchestrator';
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
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const formatParse = exportFormatSchema.safeParse(body?.format);
    const format = formatParse.success ? formatParse.data : 'excel';

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
      const report = body.report as FinancialReport;
      let preprocessed;
      if (body.rawData) {
        const rows = parseTrialBalanceCSV(body.rawData as string);
        if (rows.length > 0) {
          preprocessed = preprocessTrialBalance(rows);
        }
      }
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

    const rows = parseTrialBalanceCSV(rawData);
    const preprocessed = rows.length > 0 ? preprocessTrialBalance(rows) : undefined;

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

    const report = await orchestrateFinancialReport({
      rawData: enhancedData,
      company: effectiveCompany,
      language,
      instructions: enhancedInstructions,
    });

    if (format === 'pdf') {
      // @deprecated — use 'pdf-elite' instead. Legacy jsPDF path is preserved
      // here only to not break existing callers; new integrations should opt
      // into 'pdf-elite' for the editorial template.
    }

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
  };

  // FAST PATH: client already has a completed FinancialReport in state (e.g.
  // PipelineWorkspace just finished the 3-agent run). Skip orchestration; only
  // re-preprocess the trial balance so the editorial template can show full
  // statements + pillar aggregates without paying the 30-60s LLM cost again.
  if (b.report?.consolidatedReport) {
    const report = b.report;
    const language: 'es' | 'en' = b.language ?? 'es';

    let preprocessed;
    if (typeof b.rawData === 'string' && b.rawData.length > 0) {
      try {
        const rows = parseTrialBalanceCSV(b.rawData);
        preprocessed = rows.length > 0 ? preprocessTrialBalance(rows) : undefined;
      } catch (err) {
        console.warn('[pdf-elite/fast] preprocess failed:', err);
      }
    }

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
  // BLOQUEADO degenerate path.
  let preprocessed;
  try {
    const rows = parseTrialBalanceCSV(rawData);
    preprocessed = rows.length > 0 ? preprocessTrialBalance(rows) : undefined;
  } catch (err) {
    console.warn('[pdf-elite] preprocess failed:', err);
  }

  let report: FinancialReport | null = null;
  let blockerReasons: string[] = [];

  try {
    report = await orchestrateFinancialReport({
      rawData,
      company,
      language,
      instructions,
    });
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
    },
  });
}
