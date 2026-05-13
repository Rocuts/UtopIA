import { NextResponse } from 'next/server';
import { strategyPhaseRequestSchema } from '@/lib/validation/schemas';
import { runStrategyPhase } from '@/lib/agents/financial/orchestrator';
import type {
  FinancialProgressEvent,
  NiifAnalysisResult,
} from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';

// ---------------------------------------------------------------------------
// POST /api/financial-report/strategy (Wave 3.F1)
// ---------------------------------------------------------------------------
// Stage 2 del pipeline financiero — corre el Director de Estrategia.
// Stateless: consume el output de /niif (niifResult + bindingTotals +
// preprocessed) y devuelve el StrategicAnalysisResult.
//
// SSE events:
//   - `event: progress` FinancialProgressEvent (stage_start, stage_progress,
//                                               stage_complete)
//   - `event: strategy_phase` payload = { strategy: StrategicAnalysisResult }
//   - `event: done`
//   - `event: error`    { error, detail, code }
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';
export const maxDuration = 800;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = strategyPhaseRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    const { niifResult, bindingTotals, preprocessed, company, language, instructions } =
      parsed.data;

    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    // Cast a tipos full: el schema valida solo lo critico (fullContent), el
    // resto del shape se preserva pasando el body. Misma estrategia que
    // /api/financial-audit/route.ts.
    const typedNiif = niifResult as unknown as NiifAnalysisResult;
    const typedPp = preprocessed as PreprocessedBalance | undefined;

    if (stream) {
      return handleStreaming({
        niifResult: typedNiif,
        bindingTotals,
        preprocessed: typedPp,
        company,
        language,
        instructions,
      });
    }

    const strategy = await runStrategyPhase({
      niifResult: typedNiif,
      bindingTotals,
      preprocessed: typedPp,
      company,
      language,
      instructions,
    });

    return NextResponse.json({ strategy });
  } catch (error) {
    console.error(
      '[financial-report/strategy] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during Strategy phase.' },
      { status: 500 },
    );
  }
}

function handleStreaming(args: {
  niifResult: NiifAnalysisResult;
  bindingTotals: string;
  preprocessed: PreprocessedBalance | undefined;
  company: Parameters<typeof runStrategyPhase>[0]['company'];
  language: 'es' | 'en';
  instructions: string | undefined;
}) {
  const { niifResult, bindingTotals, preprocessed, company, language, instructions } = args;
  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const strategy = await runStrategyPhase(
          { niifResult, bindingTotals, preprocessed, company, language, instructions },
          {
            onProgress: (event: FinancialProgressEvent) => {
              if (event.type === 'warning') {
                send('warning', { warnings: event.warnings });
                return;
              }
              send('progress', event);
            },
          },
        );

        send('strategy_phase', { strategy });
        send('done', { stage: 'strategy' });
      } catch (error) {
        console.error(
          '[financial-report/strategy] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        const friendly = toFriendlyError(error, language);
        send('error', {
          error:
            language === 'en'
              ? 'Error during Strategy phase.'
              : 'Error durante la fase de Estrategia.',
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
