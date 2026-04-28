import { NextResponse } from 'next/server';
import { taxReconciliationRequestSchema } from '@/lib/validation/schemas';
import { orchestrateTaxReconciliation } from '@/lib/agents/financial/tax-reconciliation/orchestrator';
import type { TaxReconciliationProgressEvent } from '@/lib/agents/financial/tax-reconciliation/types';

// ---------------------------------------------------------------------------
// POST /api/tax-reconciliation
// ---------------------------------------------------------------------------
// Accepts raw accounting data + company metadata, runs the 2-agent sequential
// pipeline (Difference Identifier → Deferred Tax Calculator), and returns a
// consolidated Conciliacion Fiscal report mapped to Formato 2516 DIAN.
//
// Supports SSE streaming via X-Stream: true header for real-time progress.
// ---------------------------------------------------------------------------

export const maxDuration = 300; // 5 minutes — tax reconciliation is compute-heavy

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = taxReconciliationRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    const { rawData, company, language, instructions } = parsed.data;

    // Auto-fill comparativePeriod when the preprocessor detected >=2 periods.
    const detectedPeriods = (company as { detectedPeriods?: string[] }).detectedPeriods;
    if (detectedPeriods && detectedPeriods.length >= 2 && !company.comparativePeriod) {
      const inferred = detectedPeriods.find((p) => p !== company.fiscalPeriod);
      if (inferred) {
        (company as { comparativePeriod?: string }).comparativePeriod = inferred;
      }
    }

    // Check for streaming request
    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (stream) {
      return handleStreaming(rawData, company, language, instructions);
    }

    // Non-streaming: run the full pipeline and return JSON
    const report = await orchestrateTaxReconciliation({
      rawData,
      company,
      language,
      instructions,
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error(
      '[tax-reconciliation] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during tax reconciliation.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// SSE streaming handler
// ---------------------------------------------------------------------------

function handleStreaming(
  rawData: string,
  company: Parameters<typeof orchestrateTaxReconciliation>[0]['company'],
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
        const report = await orchestrateTaxReconciliation(
          { rawData, company, language, instructions },
          {
            onProgress: (event: TaxReconciliationProgressEvent) => {
              send('progress', event);
            },
          },
        );
        send('result', report);
      } catch (error) {
        console.error(
          '[tax-reconciliation] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        send('error', {
          error: 'Error during tax reconciliation.',
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
