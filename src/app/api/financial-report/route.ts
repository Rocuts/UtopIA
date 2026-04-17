import { NextResponse } from 'next/server';
import { financialReportRequestSchema } from '@/lib/validation/schemas';
import { orchestrateFinancialReport } from '@/lib/agents/financial/orchestrator';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import type { FinancialProgressEvent } from '@/lib/agents/financial/types';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';

// ---------------------------------------------------------------------------
// POST /api/financial-report
// ---------------------------------------------------------------------------
// Accepts raw accounting data + company metadata, runs the 3-agent sequential
// pipeline, and returns a consolidated NIIF financial report.
//
// Supports SSE streaming via X-Stream: true header for real-time progress.
// ---------------------------------------------------------------------------

export const maxDuration = 300; // 5 minutes — financial analysis is compute-heavy

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = financialReportRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    const { rawData, company, language, instructions } = parsed.data;

    // Si el cliente nos paso un PreprocessedBalance completo (desde /api/upload),
    // lo reusamos. Asi evitamos re-parsear el CSV y garantizamos que los totales
    // vinculantes que vio el usuario en el upload son exactamente los que
    // alimentan al orchestrator. Fallback: re-preprocesamos on-the-fly.
    const bodyPreprocessed = (body as { preprocessed?: PreprocessedBalance | null }).preprocessed;
    let preprocessed: PreprocessedBalance | undefined;
    if (bodyPreprocessed && typeof bodyPreprocessed === 'object') {
      preprocessed = bodyPreprocessed;
    } else {
      const rows = parseTrialBalanceCSV(rawData);
      preprocessed = rows.length > 0 ? preprocessTrialBalance(rows) : undefined;
    }

    // Enhance data with validation report and clean auxiliary data
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

    // Check for streaming request
    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (stream) {
      return handleStreaming(enhancedData, company, language, enhancedInstructions, preprocessed);
    }

    // Non-streaming: run the full pipeline and return JSON
    const report = await orchestrateFinancialReport(
      {
        rawData: enhancedData,
        company,
        language,
        instructions: enhancedInstructions,
      },
      { preprocessed },
    );

    return NextResponse.json(report);
  } catch (error) {
    console.error(
      '[financial-report] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during financial report generation.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// SSE streaming handler
// ---------------------------------------------------------------------------

function handleStreaming(
  rawData: string,
  company: Parameters<typeof orchestrateFinancialReport>[0]['company'],
  language: 'es' | 'en',
  instructions: string | undefined,
  preprocessed: PreprocessedBalance | undefined,
) {
  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const report = await orchestrateFinancialReport(
          { rawData, company, language, instructions },
          {
            onProgress: (event: FinancialProgressEvent) => {
              send('progress', event);
            },
            preprocessed,
          },
        );
        send('result', report);
      } catch (error) {
        console.error(
          '[financial-report] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        // Traduce errores conocidos del Gateway (billing, quota, model, auth)
        // al idioma del usuario y agrega un `code` para que la UI pueda
        // diferenciar "el LLM rebote" de "tu cuenta no tiene tarjeta".
        const friendly = toFriendlyError(error, language);
        send('error', {
          error:
            language === 'en'
              ? 'Error during financial report generation.'
              : 'Error durante la generacion del reporte financiero.',
          detail: friendly.message,
          code: friendly.code,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
