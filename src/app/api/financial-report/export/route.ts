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

    // Build binding constraints from pre-computed totals
    let enhancedInstructions = instructions || '';
    if (preprocessed) {
      const s = preprocessed.summary;
      const fmt = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      enhancedInstructions += `\n\nTOTALES PRE-CALCULADOS (VINCULANTES — precision decimal desde auxiliares):
- Total Activos (Clase 1): ${fmt(s.totalAssets)}
- Total Pasivos (Clase 2): ${fmt(s.totalLiabilities)}
- Total Patrimonio (Clase 3): ${fmt(s.totalEquity)}
- Total Ingresos (Clase 4): ${fmt(s.totalRevenue)}
- Total Gastos (Clase 5): ${fmt(s.totalExpenses)}
- Total Costos de Ventas (Clase 6): ${fmt(s.totalCosts)}
- Costos de Produccion (Clase 7): ${fmt(s.totalProduction)}
- Utilidad Neta Calculada: ${fmt(s.netIncome)}
- Ecuacion Patrimonial: ${s.equationBalanced ? 'CUADRA' : 'NO CUADRA'}
REGLA: Estos totales son VINCULANTES. Tus estados financieros DEBEN reflejarlos.`;
      if (preprocessed.discrepancies.length > 0) {
        enhancedInstructions += '\nADVERTENCIA: Discrepancias aritmeticas detectadas. USA totales de auxiliares, NO los reportados.';
      }
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
  const filename = `Reporte_Financiero_1mas1_${safeName}_${Date.now()}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    },
  });
}
