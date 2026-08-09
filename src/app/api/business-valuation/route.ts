import { NextResponse } from 'next/server';
import { requireAuthSession } from '@/lib/auth/require-session';
import { businessValuationRequestSchema } from '@/lib/validation/schemas';
import { orchestrateValuation } from '@/lib/agents/financial/valuation/orchestrator';
import type { ValuationProgressEvent } from '@/lib/agents/financial/valuation/types';
import { createSafeSse } from '@/lib/api/sse-safe';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';

// ---------------------------------------------------------------------------
// POST /api/business-valuation
// ---------------------------------------------------------------------------
// Accepts financial data + company metadata, runs the 3-agent hybrid pipeline
// (DCF + Comparables in parallel, then Synthesizer), and returns a consolidated
// business valuation report.
//
// Supports SSE streaming via X-Stream: true header for real-time progress.
// ---------------------------------------------------------------------------

export const maxDuration = 300; // 5 minutes — valuation agents are compute-heavy

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const parsed = businessValuationRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    const { financialData, company, language, instructions, purpose } = parsed.data;

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
      return handleStreaming(financialData, company, language, instructions, purpose);
    }

    // Non-streaming: run the full pipeline and return JSON
    const report = await orchestrateValuation({
      financialData,
      company,
      language,
      instructions,
      purpose,
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error(
      '[business-valuation] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during business valuation.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// SSE streaming handler
// ---------------------------------------------------------------------------

function handleStreaming(
  financialData: string,
  company: Parameters<typeof orchestrateValuation>[0]['company'],
  language: 'es' | 'en',
  instructions: string | undefined,
  purpose: string | undefined,
) {
  const readableStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sse = createSafeSse(controller);

      try {
        const report = await orchestrateValuation(
          { financialData, company, language, instructions, purpose },
          {
            onProgress: (event: ValuationProgressEvent) => {
              sse.send('progress', event);
            },
          },
        );
        sse.send('result', report);
      } catch (error) {
        console.error(
          '[business-valuation] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        sse.send('error', {
          error: 'Error during business valuation.',
          detail: toFriendlyError(error).message,
        });
      } finally {
        sse.close();
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
