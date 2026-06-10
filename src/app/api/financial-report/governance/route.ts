import { NextResponse } from 'next/server';
import { governancePhaseRequestSchema } from '@/lib/validation/schemas';
import { runGovernancePhase } from '@/lib/agents/financial/orchestrator';
import type {
  FinancialProgressEvent,
  NiifAnalysisResult,
  StrategicAnalysisResult,
} from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { revivePreprocessedBalance } from '@/lib/preprocessing/json-safe';
import { createSafeSse } from '@/lib/api/sse-safe';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';

// ---------------------------------------------------------------------------
// POST /api/financial-report/governance (Wave 3.F1)
// ---------------------------------------------------------------------------
// Stage 3 del pipeline financiero — corre el Especialista en Gobierno
// Corporativo. Stateless: consume el output de /niif + /strategy y devuelve
// el GovernanceResult.
//
// SSE events:
//   - `event: progress` FinancialProgressEvent
//   - `event: governance_phase` payload = { governance: GovernanceResult }
//   - `event: done`
//   - `event: error`    { error, detail, code }
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';
export const maxDuration = 800;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = governancePhaseRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    const {
      niifResult,
      strategyResult,
      bindingTotals,
      preprocessed,
      company,
      language,
      instructions,
    } = parsed.data;

    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    const typedNiif = niifResult as unknown as NiifAnalysisResult;
    const typedStrategy = strategyResult as unknown as StrategicAnalysisResult;
    // `preprocessed` viene del round-trip JSON de /niif: se valida
    // estructuralmente y se reviven los BigInt (cents).
    let typedPp: PreprocessedBalance | undefined;
    if (preprocessed !== undefined && preprocessed !== null) {
      const revived = revivePreprocessedBalance(preprocessed);
      if (!revived) {
        return NextResponse.json(
          { error: 'Invalid preprocessed format.' },
          { status: 400 },
        );
      }
      typedPp = revived;
    }

    if (stream) {
      return handleStreaming({
        niifResult: typedNiif,
        strategyResult: typedStrategy,
        bindingTotals,
        preprocessed: typedPp,
        company,
        language,
        instructions,
      });
    }

    const governance = await runGovernancePhase({
      niifResult: typedNiif,
      strategyResult: typedStrategy,
      bindingTotals,
      preprocessed: typedPp,
      company,
      language,
      instructions,
    });

    return NextResponse.json({ governance });
  } catch (error) {
    console.error(
      '[financial-report/governance] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during Governance phase.' },
      { status: 500 },
    );
  }
}

function handleStreaming(args: {
  niifResult: NiifAnalysisResult;
  strategyResult: StrategicAnalysisResult;
  bindingTotals: string;
  preprocessed: PreprocessedBalance | undefined;
  company: Parameters<typeof runGovernancePhase>[0]['company'];
  language: 'es' | 'en';
  instructions: string | undefined;
}) {
  const {
    niifResult,
    strategyResult,
    bindingTotals,
    preprocessed,
    company,
    language,
    instructions,
  } = args;

  const readableStream = new ReadableStream({
    async start(controller) {
      const sse = createSafeSse(controller);
      const send = sse.send;

      try {
        const governance = await runGovernancePhase(
          {
            niifResult,
            strategyResult,
            bindingTotals,
            preprocessed,
            company,
            language,
            instructions,
          },
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

        send('governance_phase', { governance });
        send('done', { stage: 'governance' });
      } catch (error) {
        console.error(
          '[financial-report/governance] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        const friendly = toFriendlyError(error, language);
        send('error', {
          error:
            language === 'en'
              ? 'Error during Governance phase.'
              : 'Error durante la fase de Gobierno Corporativo.',
          detail: friendly.message,
          code: friendly.code,
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
