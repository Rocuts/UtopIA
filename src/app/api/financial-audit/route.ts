import { NextResponse } from 'next/server';
import { requireAuthSession } from '@/lib/auth/require-session';
import { financialAuditRequestSchema } from '@/lib/validation/schemas';
import { orchestrateAudit } from '@/lib/agents/financial/audit/orchestrator';
import { deriveReportIntegrity } from '@/lib/agents/financial/audit/integrity';
import { resolveClientPreprocessed } from '@/lib/reports/client-preprocessed';
import { resolveAuditedReport } from '@/lib/reports/audited-report';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { AuditIntegrity, AuditProgressEvent } from '@/lib/agents/financial/audit/types';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';
import { createSafeSse } from '@/lib/api/sse-safe';

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
//
// Integridad (auditoria-calidad-03 / -07): el cuerpo puede traer
// `preprocessed` (round-trip JSON de /niif, revivido y validado aquí) y el
// informe completo con sus banderas de reconciliación / emitibilidad. Esas
// señales se leen ANTES de que el esquema de validación las descarte y sólo
// pueden degradar la opinión (nunca producir una favorable).
// ---------------------------------------------------------------------------

export const maxDuration = 300;

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

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

    const { language, auditFocus } = parsed.data;

    const rawBody = body as { preprocessed?: unknown; report?: unknown; adjustmentLedger?: unknown };
    // Cross-dep P1: el preprocesado de /niif se re-deriva desde sus filas con
    // el ledger confirmado de la petición; alterado → 422 antes de auditar.
    const client = resolveClientPreprocessed(rawBody.preprocessed, rawBody.adjustmentLedger);
    if (!client.ok) return client.response;
    const preprocessed: PreprocessedBalance | undefined = client.preprocessed;
    // I5-1: los auditores leen el consolidado que produce el servidor desde el
    // JSON de las Partes I–III (con sus veredictos y el preprocesado
    // re-derivado), no el Markdown recibido; las banderas de integridad salen
    // de ese mismo informe (sólo endurecen las del cliente).
    const audited = resolveAuditedReport(
      { ...(rawBody.report as object), company: parsed.data.report.company },
      client,
      language,
    );
    if (!audited.ok) return audited.response;
    const typedReport: FinancialReport = audited.report;
    const integrity = deriveReportIntegrity(typedReport, preprocessed);

    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (stream) {
      return handleStreaming(typedReport, language, auditFocus, preprocessed, integrity);
    }

    const auditReport = await orchestrateAudit(
      {
        report: typedReport,
        language,
        auditFocus,
      },
      { preprocessed, integrity },
    );

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
  preprocessed: PreprocessedBalance | undefined,
  integrity: AuditIntegrity,
) {
  const readableStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // createSafeSse: serializa BigInt y absorbe enqueue/close sobre un
      // controller cancelado (cliente desconectado bajo Fluid Compute).
      const sse = createSafeSse(controller);

      try {
        const auditReport = await orchestrateAudit(
          { report, language, auditFocus },
          {
            onProgress: (event: AuditProgressEvent) => {
              sse.send('progress', event);
            },
            preprocessed,
            integrity,
          },
        );
        sse.send('result', auditReport);
      } catch (error) {
        console.error(
          '[financial-audit] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        const friendly = toFriendlyError(error, language);
        sse.send('error', {
          error:
            language === 'en' ? 'Error during audit.' : 'Error durante la auditoria.',
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
