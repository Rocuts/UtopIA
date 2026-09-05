import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { financialExportBlockers } from '@/lib/export/financial-export-validation';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { composeEditorialReport, renderEditorialReportToStream } from '@/lib/export/pdf-elite-react';
import { aggregatePillars } from '@/lib/pillars/service';
import { revivePreprocessedBalance } from '@/lib/preprocessing/json-safe';
import { requireAuthSession } from '@/lib/auth/require-session';
import {
  requireReportWorkspace, loadFinancialVersion, loadBoundAuditVersion, resolveVersionLineage,
  ReportVersionError,
} from '@/lib/db/financial-report-versions';

export const runtime = 'nodejs';
export const maxDuration = 800;

// Export never generates a new report or accepts financial content from a client.
// Audits are named by reference, like the report itself: the server proves each
// one examined this version chain before it becomes part of the download.
const requestSchema = z.object({
  reportVersionId: z.string().uuid(),
  format: z.enum(['excel', 'pdf-elite']).default('excel'),
  auditVersionId: z.string().uuid().nullish(),
  qualityVersionId: z.string().uuid().nullish(),
}).strict();

export async function POST(req: Request): Promise<Response> {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;
  try {
    let body: unknown;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({
      error: 'Export requires reportVersionId, format and optional saved audit references. Regenerate historical reports to obtain a server version.',
    }, { status: 400 });
    const workspace = await requireReportWorkspace();
    const version = await loadFinancialVersion(workspace, parsed.data.reportVersionId);
    if (version.stage !== 'complete' || !version.report) {
      throw new ReportVersionError(409, 'Report version is incomplete.');
    }
    if ((version.provisional as { active?: boolean } | undefined)?.active) {
      throw new ReportVersionError(422, 'A provisional report cannot be exported as a completed financial report.');
    }
    const report = version.report;
    const details = financialExportBlockers(report);
    if (details.length) return NextResponse.json({ error: 'Report is not exportable.', details }, { status: 422 });
    const { auditVersionId, qualityVersionId } = parsed.data;
    let auditReport = null as Awaited<ReturnType<typeof loadBoundAuditVersion>>['audit'] | null;
    let qualityReport = null as Awaited<ReturnType<typeof loadBoundAuditVersion>>['quality'] | null;
    let auditExaminedStage: Awaited<ReturnType<typeof loadBoundAuditVersion>>['examinedStage'] | null = null;
    if (auditVersionId || qualityVersionId) {
      const lineage = await resolveVersionLineage(workspace, parsed.data.reportVersionId);
      if (auditVersionId) {
        const bound = await loadBoundAuditVersion({
          workspace, id: auditVersionId, kind: 'audit', lineage,
        });
        auditReport = bound.audit ?? null;
        // The audit runs while strategy and governance are still generating, so
        // the document states which phase the auditors actually read.
        auditExaminedStage = bound.examinedStage;
      }
      if (qualityVersionId) {
        const quality = await loadBoundAuditVersion({
          workspace, id: qualityVersionId, kind: 'quality', lineage,
        });
        // The meta-audit's conclusions rest on the audit it read. Shipping it
        // next to a different audit misrepresents both; shipping it next to any
        // audit when it read none suggests a review that never happened.
        if ((quality.auditVersionId ?? null) !== (auditVersionId ?? null)) {
          throw new ReportVersionError(409, 'The meta-audit examined a different audit result.');
        }
        qualityReport = quality.quality ?? null;
      }
    }
    const preprocessed = version.preprocessed === null ? undefined : revivePreprocessedBalance(version.preprocessed);
    if (version.preprocessed !== null && !preprocessed) throw new ReportVersionError(409, 'Stored source context is invalid.');
    const safeName = report.company.name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').slice(0, 30);
    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
      'X-Report-Version-Id': parsed.data.reportVersionId,
    };
    if (auditReport) headers['X-Audit-Version-Id'] = auditVersionId!;
    if (qualityReport) headers['X-Quality-Version-Id'] = qualityVersionId!;
    if (parsed.data.format === 'excel') {
      const buffer = await generateFinancialExcel({
        report, preprocessed: preprocessed ?? undefined, auditReport, qualityReport,
        auditExaminedStage,
      });
      return new Response(new Uint8Array(buffer), { headers: {
        ...headers,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Reporte_${safeName}_${parsed.data.reportVersionId}.xlsx"`,
        'Content-Length': String(buffer.length),
      } });
    }
    const pillars = preprocessed?.primary ? aggregatePillars({
      snapshot: preprocessed.primary, comparative: preprocessed.comparative ?? null,
    }) : null;
    const doc = composeEditorialReport({ report, preprocessed: preprocessed ?? null,
      pillars, language: version.language, outputOptions: version.outputOptions,
      auditReport, qualityReport, auditExaminedStage });
    const stream = await renderEditorialReportToStream(doc);
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { headers: {
      ...headers, 'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Reporte_${safeName}_${parsed.data.reportVersionId}.pdf"`,
    } });
  } catch (error) {
    if (error instanceof ReportVersionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[financial-report/export] Export failed');
    return NextResponse.json({ error: 'Report storage or export is unavailable. Retry using the same version.' }, { status: 503 });
  }
}
