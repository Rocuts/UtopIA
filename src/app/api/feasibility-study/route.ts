import { NextResponse } from 'next/server';
import { requireAuthSession } from '@/lib/auth/require-session';
import { feasibilityStudyRequestSchema } from '@/lib/validation/schemas';
import { orchestrateFeasibilityStudy } from '@/lib/agents/financial/feasibility/orchestrator';
import type { FeasibilityProgressEvent } from '@/lib/agents/financial/feasibility/types';
import { createSafeSse } from '@/lib/api/sse-safe';

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
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

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
  const readableStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sse = createSafeSse(controller);

      try {
        const report = await orchestrateFeasibilityStudy(
          { projectData, project, language, instructions },
          {
            onProgress: (event: FeasibilityProgressEvent) => {
              sse.send('progress', event);
            },
          },
        );
        sse.send('result', report);
      } catch (error) {
        console.error(
          '[feasibility-study] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        sse.send('error', {
          error: 'Error during feasibility study generation.',
          detail: error instanceof Error ? error.message : 'Unknown error',
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
