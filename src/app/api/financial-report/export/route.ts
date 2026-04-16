import { NextResponse } from 'next/server';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { orchestrateFinancialReport } from '@/lib/agents/financial/orchestrator';
import { financialReportRequestSchema } from '@/lib/validation/schemas';
import type { FinancialReport } from '@/lib/agents/financial/types';

// ---------------------------------------------------------------------------
// POST /api/financial-report/export
// ---------------------------------------------------------------------------
// Two modes:
//
// 1. FULL PIPELINE: Send rawData + company → preprocess → 3 agents → export
//    Body: { rawData: "...", company: {...}, language: "es" }
//
// 2. EXPORT ONLY: Send an existing FinancialReport → export to Excel
//    Body: { report: {...} }
//
// Returns: .xlsx file download
// ---------------------------------------------------------------------------

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Mode 2: Export existing report
    if (body.report && body.report.consolidatedReport) {
      const report = body.report as FinancialReport;

      // If raw CSV is also provided, preprocess it for precise numbers
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

    // Mode 1: Full pipeline
    const parsed = financialReportRequestSchema.safeParse(body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json({ error: 'Invalid request.', details: errors }, { status: 400 });
    }

    const { rawData, company, language, instructions } = parsed.data;

    // Step 1: Preprocess and validate
    const rows = parseTrialBalanceCSV(rawData);
    const preprocessed = rows.length > 0 ? preprocessTrialBalance(rows) : undefined;

    // Enhance the raw data with validation report for the agents
    const enhancedData = preprocessed
      ? `${preprocessed.validationReport}\n\n---\n\nDATOS LIMPIOS (auxiliares validados):\n${preprocessed.cleanData}`
      : rawData;

    // Build instructions with discrepancy warnings
    let enhancedInstructions = instructions || '';
    if (preprocessed && preprocessed.discrepancies.length > 0) {
      enhancedInstructions += '\n\nADVERTENCIA DEL PREPROCESADOR: Se detectaron discrepancias aritmeticas. USA los totales calculados desde auxiliares, NO los totales reportados. Revisa la seccion de Discrepancias en el informe de validacion.';
    }

    // Step 2: Run the 3-agent financial pipeline
    const report = await orchestrateFinancialReport({
      rawData: enhancedData,
      company,
      language,
      instructions: enhancedInstructions,
    });

    // Step 3: Generate Excel
    const buffer = await generateFinancialExcel({ report, preprocessed });
    return createExcelResponse(buffer, company.name);
  } catch (error) {
    console.error('[financial-report/export] Error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Error generating Excel export.' },
      { status: 500 },
    );
  }
}

function createExcelResponse(buffer: Buffer, companyName: string): Response {
  const safeName = companyName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').slice(0, 30);
  const filename = `Reporte_Financiero_UtopIA_${safeName}_${Date.now()}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    },
  });
}
