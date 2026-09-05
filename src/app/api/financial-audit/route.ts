import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthSession } from '@/lib/auth/require-session';
import { orchestrateAudit } from '@/lib/agents/financial/audit/orchestrator';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { AuditProgressEvent, AuditReport } from '@/lib/agents/financial/audit/types';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';
import { createSafeSse } from '@/lib/api/sse-safe';
import { revivePreprocessedBalance } from '@/lib/preprocessing/json-safe';
import {
  requireReportWorkspace,
  loadFinancialVersionRecord,
  saveAuditVersion,
  auditResultIsComplete,
  ReportVersionError,
  type FinancialVersion,
} from '@/lib/db/financial-report-versions';

// ---------------------------------------------------------------------------
// POST /api/financial-audit
// ---------------------------------------------------------------------------
// Runs the 4 auditors in parallel over an authorized, persisted financial
// version and stores the result before reporting success:
//   1. NIIF Auditor — NIC/NIIF compliance
//   2. Tax Auditor — Estatuto Tributario compliance
//   3. Legal Auditor — Corporate governance / commercial law
//   4. Fiscal Reviewer — ISA/NIA statutory audit opinion
//
// The audited content is never taken from the request. The caller names a
// version with `reportVersionId`; the server loads it, checks that it belongs
// to the workspace company, audits it, and returns `auditVersionId` — the
// reference the export uses. Reports that only exist in a browser have no
// version and must be regenerated.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';
export const maxDuration = 300;

// Audit never accepts financial content from a client.
const requestSchema = z.object({
  reportVersionId: z.string().uuid(),
  language: z.enum(['es', 'en']).default('es'),
  auditFocus: z.string().max(2_000).optional(),
}).strict();

/**
 * Content the auditors examine, rebuilt from the stored version. The pipeline
 * audits in parallel with the strategy and governance phases, so a NIIF-stage
 * version has no strategy or governance text yet; those stay empty instead of
 * being invented, and the stored `examinedStage` records which one was read.
 */
function buildAuditSubject(stored: FinancialVersion): FinancialReport {
  if (stored.stage === 'complete' && stored.report) return stored.report;
  return {
    company: stored.company,
    niifAnalysis: stored.niifResult,
    strategicAnalysis: stored.strategyResult ?? {
      kpiDashboard: '', breakEvenAnalysis: '', projectedCashFlow: '',
      strategicRecommendations: '', fullContent: '',
    },
    governance: { financialNotes: '', shareholderMinutes: '', fullContent: '' },
    consolidatedReport: stored.niifResult.fullContent,
    generatedAt: new Date().toISOString(),
    fiscalSnapshot: stored.fiscalSnapshot,
    ancora: stored.ancora,
  };
}

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    let body: unknown;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Audit requires a saved report version. Regenerate historical reports to obtain one.',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      }, { status: 400 });
    }
    const { reportVersionId, language, auditFocus } = parsed.data;

    const workspace = await requireReportWorkspace();
    const examined = await loadFinancialVersionRecord(workspace, reportVersionId);
    const subject = buildAuditSubject(examined.payload);
    // The stored source context reaches the auditors: control totals and the
    // inter-period tables were unavailable while the report travelled through
    // the browser.
    const preprocessed = examined.payload.preprocessed == null
      ? undefined
      : revivePreprocessedBalance(examined.payload.preprocessed) ?? undefined;

    // The caller is told whether the stored result is exportable, so it never
    // names an audit the download would refuse.
    const persist = async (audit: AuditReport) => {
      const auditComplete = auditResultIsComplete({ kind: 'audit', audit });
      const auditVersionId = await saveAuditVersion(workspace, {
        kind: 'audit',
        reportVersionId,
        examinedSha256: examined.sha256,
        examinedStage: examined.payload.stage,
        company: examined.payload.company,
        language,
        auditVersionId: null,
        complete: auditComplete,
        audit,
      });
      return { auditVersionId, auditComplete, examinedStage: examined.payload.stage };
    };

    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (stream) {
      return handleStreaming({ subject, preprocessed, language, auditFocus, persist });
    }

    const auditReport = await orchestrateAudit({ report: subject, language, auditFocus }, { preprocessed });
    return NextResponse.json({ ...auditReport, ...await persist(auditReport) });
  } catch (error) {
    if (error instanceof ReportVersionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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

function handleStreaming(args: {
  subject: FinancialReport;
  preprocessed: ReturnType<typeof revivePreprocessedBalance> | undefined;
  language: 'es' | 'en';
  auditFocus: string | undefined;
  persist: (audit: AuditReport) => Promise<{
    auditVersionId: string; auditComplete: boolean; examinedStage: FinancialVersion['stage'];
  }>;
}) {
  const { subject, preprocessed, language, auditFocus, persist } = args;
  const readableStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // createSafeSse: serializa BigInt y absorbe enqueue/close sobre un
      // controller cancelado (cliente desconectado bajo Fluid Compute).
      const sse = createSafeSse(controller);

      try {
        const auditReport = await orchestrateAudit(
          { report: subject, language, auditFocus },
          {
            preprocessed: preprocessed ?? undefined,
            onProgress: (event: AuditProgressEvent) => {
              sse.send('progress', event);
            },
          },
        );
        // The result is announced only after it is stored: a client that sees
        // `result` holds a reference the export can resolve.
        sse.send('result', { ...auditReport, ...await persist(auditReport) });
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
