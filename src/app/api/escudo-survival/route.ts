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
import { escudoSurvivalRequestSchema } from '@/lib/validation/schemas';
import { orchestrateEscudoSurvival } from '@/lib/agents/financial/escudo-survival/orchestrator';
import type {
  EscudoSurvivalProgressEvent,
  OrchestrateEscudoSurvivalInput,
} from '@/lib/agents/financial/escudo-survival/types';

// 5 minutos — el pipeline corre 5 LLM calls + sintetizador en paralelo.
export const maxDuration = 300;

export async function POST(req: Request) {
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
  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const report = await orchestrateEscudoSurvival(input, {
          onProgress: (event: EscudoSurvivalProgressEvent) => {
            send('progress', event);
          },
        });
        send('result', report);
      } catch (error) {
        console.error(
          '[escudo-survival] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        send('error', {
          error: 'Error during Escudo Survival pipeline execution.',
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
