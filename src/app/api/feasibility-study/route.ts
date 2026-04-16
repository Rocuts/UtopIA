import { NextResponse } from 'next/server';
import { feasibilityStudyRequestSchema } from '@/lib/validation/schemas';
import { orchestrateFeasibilityStudy } from '@/lib/agents/financial/feasibility/orchestrator';
import type { FeasibilityProgressEvent } from '@/lib/agents/financial/feasibility/types';

// ---------------------------------------------------------------------------
// POST /api/feasibility-study
// ---------------------------------------------------------------------------
// Accepts project data + metadata, runs the 3-agent sequential pipeline
// (Market Analyst → Financial Modeler → Risk Assessor), and returns a
// consolidated feasibility study.
//
// Supports SSE streaming via X-Stream: true header for real-time progress.
// ---------------------------------------------------------------------------

export const maxDuration = 300; // 5 minutes — 3-agent sequential pipeline

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = feasibilityStudyRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    const { projectData, project, language, instructions } = parsed.data;

    // Check for streaming request
    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (stream) {
      return handleStreaming(projectData, project, language, instructions);
    }

    // Non-streaming: run the full pipeline and return JSON
    const report = await orchestrateFeasibilityStudy({
      projectData,
      project,
      language,
      instructions,
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error(
      '[feasibility-study] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during feasibility study generation.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// SSE streaming handler
// ---------------------------------------------------------------------------

function handleStreaming(
  projectData: string,
  project: Parameters<typeof orchestrateFeasibilityStudy>[0]['project'],
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
        const report = await orchestrateFeasibilityStudy(
          { projectData, project, language, instructions },
          {
            onProgress: (event: FeasibilityProgressEvent) => {
              send('progress', event);
            },
          },
        );
        send('result', report);
      } catch (error) {
        console.error(
          '[feasibility-study] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        send('error', {
          error: 'Error during feasibility study generation.',
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
