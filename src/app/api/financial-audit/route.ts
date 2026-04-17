import { NextResponse } from 'next/server';
import { financialAuditRequestSchema } from '@/lib/validation/schemas';
import { orchestrateAudit } from '@/lib/agents/financial/audit/orchestrator';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { AuditProgressEvent } from '@/lib/agents/financial/audit/types';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';

// ---------------------------------------------------------------------------
// POST /api/financial-audit
// ---------------------------------------------------------------------------
// Accepts a FinancialReport (output from /api/financial-report) and runs
// 4 auditors in parallel to validate against Colombian 2026 regulations:
//   1. NIIF Auditor — NIC/NIIF compliance
//   2. Tax Auditor — Estatuto Tributario compliance
//   3. Legal Auditor — Corporate governance / commercial law
//   4. Fiscal Reviewer — ISA/NIA statutory audit opinion
//
// Returns consolidated findings, compliance scores, and formal opinion.
// ---------------------------------------------------------------------------

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = financialAuditRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    const { report, language, auditFocus } = parsed.data;

    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    // Cast the Zod-validated report to the full FinancialReport type.
    // The schema validates the minimal fields needed; downstream code only uses consolidatedReport + company.
    const typedReport = report as unknown as FinancialReport;

    if (stream) {
      return handleStreaming(typedReport, language, auditFocus);
    }

    const auditReport = await orchestrateAudit({
      report: typedReport,
      language,
      auditFocus,
    });

    return NextResponse.json(auditReport);
  } catch (error) {
    console.error(
      '[financial-audit] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during audit.' },
      { status: 500 },
    );
  }
}

function handleStreaming(
  report: FinancialReport,
  language: 'es' | 'en',
  auditFocus: string | undefined,
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
        const auditReport = await orchestrateAudit(
          { report, language, auditFocus },
          {
            onProgress: (event: AuditProgressEvent) => {
              send('progress', event);
            },
          },
        );
        send('result', auditReport);
      } catch (error) {
        console.error(
          '[financial-audit] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        const friendly = toFriendlyError(error, language);
        send('error', {
          error:
            language === 'en' ? 'Error during audit.' : 'Error durante la auditoria.',
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
