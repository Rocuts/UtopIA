import { NextResponse } from 'next/server';
import { financialReportRequestSchema } from '@/lib/validation/schemas';
import { orchestrateFinancialReport } from '@/lib/agents/financial/orchestrator';
import type { FinancialProgressEvent } from '@/lib/agents/financial/types';

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

    // Check for streaming request
    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (stream) {
      return handleStreaming(rawData, company, language, instructions);
    }

    // Non-streaming: run the full pipeline and return JSON
    const report = await orchestrateFinancialReport({
      rawData,
      company,
      language,
      instructions,
    });

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
          },
        );
        send('result', report);
      } catch (error) {
        console.error(
          '[financial-report] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        send('error', {
          error: 'Error during financial report generation.',
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
