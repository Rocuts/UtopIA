import { NextResponse } from 'next/server';
import { fiscalAuditOpinionRequestSchema } from '@/lib/validation/schemas';
import { orchestrateFiscalOpinion } from '@/lib/agents/financial/fiscal-opinion/orchestrator';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { FiscalOpinionProgressEvent } from '@/lib/agents/financial/fiscal-opinion/types';

// ---------------------------------------------------------------------------
// POST /api/fiscal-audit-opinion
// ---------------------------------------------------------------------------
// Accepts a FinancialReport (and optionally an AuditReport) and produces a
// formal Dictamen del Revisor Fiscal through a hybrid 4-agent pipeline:
//
//   [Going Concern Evaluator]   ──┐
//   [Misstatement Reviewer]     ──┼──→ [Opinion Drafter]
//   [Compliance Checker]        ──┘
//
// 3 evaluators run in PARALLEL, then the Opinion Drafter runs sequentially
// with all three outputs to produce the formal dictamen.
//
// Supports SSE streaming via X-Stream: true header for real-time progress.
// ---------------------------------------------------------------------------

export const maxDuration = 300; // 5 minutes

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = fiscalAuditOpinionRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    const { report, auditReport, language, instructions } = parsed.data;

    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    // Cast the Zod-validated objects to the full types.
    // The schema validates the minimal fields needed; downstream code uses consolidatedReport + company.
    const typedReport = report as unknown as FinancialReport;
    const typedAuditReport = auditReport as unknown as AuditReport | undefined;

    if (stream) {
      return handleStreaming(typedReport, typedAuditReport, language, instructions);
    }

    const fiscalOpinion = await orchestrateFiscalOpinion({
      report: typedReport,
      auditReport: typedAuditReport,
      language,
      instructions,
    });

    return NextResponse.json(fiscalOpinion);
  } catch (error) {
    console.error(
      '[fiscal-audit-opinion] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during fiscal opinion generation.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// SSE streaming handler
// ---------------------------------------------------------------------------

function handleStreaming(
  report: FinancialReport,
  auditReport: AuditReport | undefined,
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
        const fiscalOpinion = await orchestrateFiscalOpinion(
          { report, auditReport, language, instructions },
          {
            onProgress: (event: FiscalOpinionProgressEvent) => {
              send('progress', event);
            },
          },
        );
        send('result', fiscalOpinion);
      } catch (error) {
        console.error(
          '[fiscal-audit-opinion] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        send('error', {
          error: 'Error during fiscal opinion generation.',
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
