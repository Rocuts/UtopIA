// ---------------------------------------------------------------------------
// POST /api/escudo/fiscal — Capa 4 (Agente Fiscal)
// ---------------------------------------------------------------------------
//
// Endpoint del Agente Fiscal de El Escudo. Orquesta los módulos CCV / Risk /
// Conciliación / Planeación / Defensa DIAN / Devoluciones / Supervivencia +
// sintetizador en un único reporte.
//
// SSE events (X-Stream: true o ?stream=1):
//   - event: progress          FiscalAgentProgressEvent
//   - event: module_complete   { stage, data: <module result> }
//   - event: report            FiscalAgentReport
//   - event: done              { partial }
//   - event: error             { error, detail }
//
// `maxDuration` 800s para acomodar el modo `full` (7 módulos + synth en
// paralelo + secuencial — el cuello de botella es Promise.all sobre los 7).
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  orchestrateFiscalAgent,
  type FiscalAgentProgressEvent,
} from '@/lib/agents/financial/escudo-survival/fiscal-agent';
import { fiscalAgentRequestSchema } from '@/lib/validation/schemas';
import { logActivity } from '@/lib/db/activity-log';

export const runtime = 'nodejs';
export const maxDuration = 800;

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json()) as unknown;
    const parsed = fiscalAgentRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    const {
      rawData,
      company,
      language,
      mode,
      instructions,
      dianRequirementText,
      dianRequirementKind,
    } = parsed.data;

    const wantsStream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (wantsStream) {
      return handleStreaming({
        rawData,
        company,
        language,
        mode,
        instructions,
        dianRequirementText,
        dianRequirementKind,
        startedAt,
      });
    }

    const report = await orchestrateFiscalAgent({
      rawData,
      company,
      language,
      mode,
      instructions,
      dianRequirementText,
      dianRequirementKind,
    });

    void logActivity({
      category: 'financial',
      action: 'escudo.fiscal.completed',
      level: 'info',
      message: `Agente Fiscal — modo ${mode} completado`,
      durationMs: Date.now() - startedAt,
      resourceType: 'escudo_fiscal',
      metadata: {
        language,
        mode,
        partial: report.metadata.partial,
        modulesRun: report.metadata.modulesRun.join(','),
        modulesFailed: report.metadata.modulesFailed.join(','),
      },
    });

    return NextResponse.json({ report });
  } catch (error) {
    console.error(
      '[escudo/fiscal] API error:',
      error instanceof Error ? error.message : error,
    );
    void logActivity({
      category: 'financial',
      action: 'escudo.fiscal.failed',
      level: 'error',
      message: `Error en Agente Fiscal: ${error instanceof Error ? error.message : 'desconocido'}`,
      durationMs: Date.now() - startedAt,
      resourceType: 'escudo_fiscal',
    });
    return NextResponse.json(
      { error: 'Internal server error during fiscal agent execution.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// SSE streaming
// ---------------------------------------------------------------------------

function handleStreaming(args: {
  rawData: string;
  company: z.infer<typeof fiscalAgentRequestSchema>['company'];
  language: 'es' | 'en';
  mode: z.infer<typeof fiscalAgentRequestSchema>['mode'];
  instructions: string | undefined;
  dianRequirementText: string | undefined;
  dianRequirementKind:
    | 'requerimiento_ordinario'
    | 'emplazamiento_corregir'
    | 'emplazamiento_no_declarar'
    | 'pliego_cargos'
    | 'liquidacion_oficial_revision'
    | 'desconocido'
    | undefined;
  startedAt: number;
}) {
  const {
    rawData,
    company,
    language,
    mode,
    instructions,
    dianRequirementText,
    dianRequirementKind,
    startedAt,
  } = args;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const report = await orchestrateFiscalAgent(
          {
            rawData,
            company,
            language,
            mode,
            instructions,
            dianRequirementText,
            dianRequirementKind,
          },
          {
            onProgress: (event: FiscalAgentProgressEvent) => {
              send('progress', event);
            },
          },
        );

        send('report', { report });
        send('done', { partial: report.metadata.partial });

        void logActivity({
          category: 'financial',
          action: 'escudo.fiscal.completed',
          level: 'info',
          message: `Agente Fiscal — modo ${mode} completado (stream)`,
          durationMs: Date.now() - startedAt,
          resourceType: 'escudo_fiscal',
          metadata: {
            language,
            mode,
            partial: report.metadata.partial,
            modulesRun: report.metadata.modulesRun.join(','),
            modulesFailed: report.metadata.modulesFailed.join(','),
          },
        });
      } catch (error) {
        console.error(
          '[escudo/fiscal] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        send('error', {
          error:
            language === 'en'
              ? 'Fiscal agent execution failed.'
              : 'La ejecución del Agente Fiscal falló.',
          detail: error instanceof Error ? error.message : 'unknown',
        });
        void logActivity({
          category: 'financial',
          action: 'escudo.fiscal.failed',
          level: 'error',
          message: `Error en Agente Fiscal stream: ${error instanceof Error ? error.message : 'unknown'}`,
          durationMs: Date.now() - startedAt,
          resourceType: 'escudo_fiscal',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
