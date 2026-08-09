import { NextResponse } from 'next/server';
import { requireAuthSession } from '@/lib/auth/require-session';
import { transferPricingRequestSchema } from '@/lib/validation/schemas';
import { orchestrateTransferPricing } from '@/lib/agents/financial/transfer-pricing/orchestrator';
import type { TPProgressEvent } from '@/lib/agents/financial/transfer-pricing/types';
import { createSafeSse } from '@/lib/api/sse-safe';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';

// ---------------------------------------------------------------------------
// POST /api/transfer-pricing
// ---------------------------------------------------------------------------
// Accepts intercompany transaction data + company metadata, runs the 3-agent
// sequential pipeline, and returns a consolidated transfer pricing study.
//
// Supports SSE streaming via X-Stream: true header for real-time progress.
// ---------------------------------------------------------------------------

export const maxDuration = 300; // 5 minutes — multi-agent pipeline is compute-heavy

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const parsed = transferPricingRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    const { rawData, company, relatedParties, controlledTransactions, language, instructions } =
      parsed.data;

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
      return handleStreaming(rawData, company, relatedParties, controlledTransactions, language, instructions);
    }

    // Non-streaming: run the full pipeline and return JSON
    const report = await orchestrateTransferPricing({
      rawData,
      company,
      relatedParties,
      controlledTransactions,
      language,
      instructions,
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error(
      '[transfer-pricing] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during transfer pricing analysis.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// SSE streaming handler
// ---------------------------------------------------------------------------

function handleStreaming(
  rawData: string,
  company: Parameters<typeof orchestrateTransferPricing>[0]['company'],
  relatedParties: Parameters<typeof orchestrateTransferPricing>[0]['relatedParties'],
  controlledTransactions: Parameters<typeof orchestrateTransferPricing>[0]['controlledTransactions'],
  language: 'es' | 'en',
  instructions: string | undefined,
) {
  const readableStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sse = createSafeSse(controller);

      try {
        const report = await orchestrateTransferPricing(
          { rawData, company, relatedParties, controlledTransactions, language, instructions },
          {
            onProgress: (event: TPProgressEvent) => {
              sse.send('progress', event);
            },
          },
        );
        sse.send('result', report);
      } catch (error) {
        console.error(
          '[transfer-pricing] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        sse.send('error', {
          error: 'Error during transfer pricing analysis.',
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
