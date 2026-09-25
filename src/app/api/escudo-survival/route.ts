// ---------------------------------------------------------------------------
// POST /api/escudo-survival
// ---------------------------------------------------------------------------
// Modo Supervivencia Elite — recibe rawData (CSV/Excel/PDF como texto) +
// company info, ejecuta el pipeline de 5 agentes en paralelo + sintetizador,
// y retorna el `EscudoSurvivalReport` (5 cards + sintesis).
//
// SSE streaming si el header `X-Stream: true` o querystring `stream=1` esta
// presente. En otro caso, JSON normal con el reporte completo.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { requireAuthSession } from '@/lib/auth/require-session';
import { escudoSurvivalRequestSchema } from '@/lib/validation/schemas';
import { orchestrateEscudoSurvival } from '@/lib/agents/financial/escudo-survival/orchestrator';
import type {
  EscudoSurvivalProgressEvent,
  OrchestrateEscudoSurvivalInput,
} from '@/lib/agents/financial/escudo-survival/types';
import { createSafeSse } from '@/lib/api/sse-safe';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';
import {
  EscudoBalanceBloqueadoError,
  escudoBalanceBloqueadoPayload,
} from '@/lib/agents/financial/escudo-survival/lib/balance-ingesta';

// 5 minutos — el pipeline corre 5 LLM calls + sintetizador en paralelo.
export const maxDuration = 300;

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  let language: 'es' | 'en' = 'es';
  try {
    const body = await req.json();
    const parsed = escudoSurvivalRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      );
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    language = parsed.data.language;
    const orchestratorInput: OrchestrateEscudoSurvivalInput = {
      rawData: parsed.data.rawData,
      company: parsed.data.company,
      language: parsed.data.language,
      instructions: parsed.data.instructions,
    };

    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (stream) {
      return handleStreaming(orchestratorInput);
    }

    const report = await orchestrateEscudoSurvival(orchestratorInput);
    return NextResponse.json(report);
  } catch (error) {
    // Balance que no sirve de base para cifras fiscales: 422 con los motivos,
    // mismo contrato que /niif (I4-escudo 1). No es un error del servidor.
    if (error instanceof EscudoBalanceBloqueadoError) {
      return NextResponse.json(escudoBalanceBloqueadoPayload(error, language), { status: 422 });
    }
    console.error(
      '[escudo-survival] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during Escudo Survival pipeline.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// SSE streaming handler
// ---------------------------------------------------------------------------

function handleStreaming(input: OrchestrateEscudoSurvivalInput) {
  const readableStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sse = createSafeSse(controller);

      try {
        const report = await orchestrateEscudoSurvival(input, {
          onProgress: (event: EscudoSurvivalProgressEvent) => {
            sse.send('progress', event);
          },
        });
        sse.send('result', report);
      } catch (error) {
        const language = input.language ?? 'es';
        if (error instanceof EscudoBalanceBloqueadoError) {
          // Mismo contrato que el 422 de /niif por SSE: code + reasons.
          sse.send('error', escudoBalanceBloqueadoPayload(error, language));
          return;
        }
        console.error(
          '[escudo-survival] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        const friendly = toFriendlyError(error, language);
        sse.send('error', {
          error:
            language === 'en'
              ? 'Error during Escudo Survival pipeline execution.'
              : 'Error durante la ejecución del Modo Supervivencia.',
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
