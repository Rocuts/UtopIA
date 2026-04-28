import { NextResponse } from 'next/server';
import { taxPlanningRequestSchema } from '@/lib/validation/schemas';
import { orchestrateTaxPlanning } from '@/lib/agents/financial/tax-planning/orchestrator';
import type { TaxPlanningProgressEvent } from '@/lib/agents/financial/tax-planning/types';

// ---------------------------------------------------------------------------
// POST /api/tax-planning
// ---------------------------------------------------------------------------
// Accepts company financial data + metadata, runs the 3-agent sequential
// tax planning pipeline, and returns a consolidated tax optimization report.
//
// Supports SSE streaming via X-Stream: true header for real-time progress.
// ---------------------------------------------------------------------------

export const maxDuration = 300; // 5 minutes — multi-agent pipeline is compute-heavy

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = taxPlanningRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    const { rawData, company, language, instructions, currentRegime, grossRevenue, employeeCount } =
      parsed.data;

    // Auto-fill comparativePeriod when the preprocessor detected >=2 periods in
    // the source file but the caller did not pass an explicit comparative.
    const detectedPeriods = (company as { detectedPeriods?: string[] }).detectedPeriods;
    if (detectedPeriods && detectedPeriods.length >= 2 && !company.comparativePeriod) {
      const inferred = detectedPeriods.find((p) => p !== company.fiscalPeriod);
      if (inferred) {
        (company as { comparativePeriod?: string }).comparativePeriod = inferred;
      }
    }

    // Build enhanced instructions with regime context
    let enhancedInstructions = instructions || '';
    if (currentRegime) {
      enhancedInstructions += `\n\nREGIMEN TRIBUTARIO ACTUAL: ${currentRegime}`;
    }
    if (grossRevenue != null) {
      const fmt =
        '$' +
        grossRevenue.toLocaleString('es-CO', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        });
      enhancedInstructions += `\nINGRESOS BRUTOS ANUALES: ${fmt} COP`;
    }
    if (employeeCount != null) {
      enhancedInstructions += `\nNUMERO DE EMPLEADOS: ${employeeCount}`;
    }

    // Check for streaming request
    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (stream) {
      return handleStreaming(rawData, company, language, enhancedInstructions);
    }

    // Non-streaming: run the full pipeline and return JSON
    const report = await orchestrateTaxPlanning({
      rawData,
      company,
      language,
      instructions: enhancedInstructions,
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error(
      '[tax-planning] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during tax planning report generation.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// SSE streaming handler
// ---------------------------------------------------------------------------

function handleStreaming(
  rawData: string,
  company: Parameters<typeof orchestrateTaxPlanning>[0]['company'],
  language: 'es' | 'en',
  instructions: string | undefined,
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
        const report = await orchestrateTaxPlanning(
          { rawData, company, language, instructions },
          {
            onProgress: (event: TaxPlanningProgressEvent) => {
              send('progress', event);
            },
          },
        );
        send('result', report);
      } catch (error) {
        console.error(
          '[tax-planning] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        send('error', {
          error: 'Error during tax planning report generation.',
          detail: error instanceof Error ? error.message : 'Unknown error',
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
