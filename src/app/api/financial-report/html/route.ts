// ---------------------------------------------------------------------------
// POST /api/financial-report/html (Wave 4.F7)
// ---------------------------------------------------------------------------
//
// Stage 4 del pipeline financiero — cap-stone visual. Corre el Editor Jefe HTML
// que compone el documento HTML 12-slide auto-contenido siguiendo
// `docs/spec/financial-report-v8.1.md`.
//
// Patrón idéntico a `/api/financial-report/niif/route.ts` (Wave 3.F1):
//
//   - SSE streaming opt-in via header `X-Stream: true` o query `?stream=1`.
//   - Modo no-streaming devuelve `{ html, metadata, checklistFailures }`.
//   - `maxDuration = 800` para acomodar HTML 32K tokens en gpt-5.5
//     (~30-60s end-to-end).
//
// SSE events:
//   - `event: progress`     FinancialProgressEvent
//   - `event: html_phase`   payload completo HtmlEditorOutput
//   - `event: done`         { stage: 'html' }
//   - `event: error`        { error, code, detail }
//
// Wave 4.F8 cableará el frontend (intake toggle `outputOptions.htmlReport` +
// 4ª sub-fase post-Quality) para invocar este endpoint cuando el usuario
// pida el HTML elite.
//
// Refs:
//   - src/app/api/financial-report/niif/route.ts (patrón a replicar)
//   - docs/spec/financial-report-v8.1.md
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { HtmlEditorInputSchema } from '@/lib/agents/financial/contracts/html-editor';
import { runHtmlEditor } from '@/lib/agents/financial/agents/html-editor';
import type { FinancialProgressEvent } from '@/lib/agents/financial/types';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';

export const runtime = 'nodejs';
export const maxDuration = 800;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = HtmlEditorInputSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      );
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    // El header X-Stream o el query param ?stream=1 activan SSE. Espejado de
    // los otros endpoints financieros (niif/strategy/governance) para
    // consistencia con el cliente.
    const wantsStream =
      req.headers.get('x-stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (!wantsStream) {
      // Non-streaming: ejecuta y devuelve el output completo en una sola
      // respuesta JSON. Útil para invocaciones server-to-server o tests.
      const result = await runHtmlEditor(parsed.data);
      return NextResponse.json(result);
    }

    // Streaming SSE — emite progress events durante la generación y el
    // payload final como `event: html_phase`.
    const encoder = new TextEncoder();
    const language = parsed.data.language;

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };

        try {
          const onProgress = (event: FinancialProgressEvent) => {
            if (event.type === 'warning') {
              send('warning', { warnings: event.warnings });
              return;
            }
            send('progress', event);
          };

          const result = await runHtmlEditor(parsed.data, onProgress, req.signal);

          send('html_phase', result);
          send('done', { stage: 'html' });
        } catch (err) {
          console.error(
            '[financial-report/html] Pipeline error:',
            err instanceof Error ? err.message : err,
          );
          const friendly = toFriendlyError(err, language);
          send('error', {
            error:
              language === 'en'
                ? 'Error during HTML editor phase.'
                : 'Error durante la fase del Editor Jefe HTML.',
            detail: friendly.message,
            code: friendly.code,
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        // x-accel-buffering: no — pista a proxies (nginx, Vercel edge) para
        // no buffer-ar el stream y dejar que los eventos lleguen en tiempo
        // real al cliente.
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error(
      '[financial-report/html] API error:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      {
        error: 'Internal server error during HTML editor phase.',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
