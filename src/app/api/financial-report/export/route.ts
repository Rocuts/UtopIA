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

    // Build binding constraints from pre-computed totals — multiperiodo:
    // imprimimos cifras del periodo actual (primary) y, si existe comparativo,
    // tambien las del periodo anterior + variacion YoY.
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

    // Step 2: Run the 3-agent financial pipeline
    const report = await orchestrateFinancialReport({
      rawData: enhancedData,
      company: effectiveCompany,
      language,
      instructions: enhancedInstructions,
    });

    // Step 3: Generate Excel
    const buffer = await generateFinancialExcel({ report, preprocessed });
    return createExcelResponse(buffer, effectiveCompany.name);
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
