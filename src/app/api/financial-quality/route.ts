import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthSession } from '@/lib/auth/require-session';
import { runQualityAudit } from '@/lib/agents/financial/quality/agent';
import { revivePreprocessedBalance } from '@/lib/preprocessing/json-safe';
import {
  requireReportWorkspace,
  loadFinancialVersionRecord,
  loadBoundAuditVersion,
  resolveVersionLineage,
  saveAuditVersion,
  auditResultIsComplete,
  ReportVersionError,
} from '@/lib/db/financial-report-versions';

// ---------------------------------------------------------------------------
// POST /api/financial-quality
// ---------------------------------------------------------------------------
// Meta-audit: evaluates the ENTIRE pipeline output against 2026 best
// practices (IASB, IFRS 18, ISO 25012, ISO 42001, CTCP Colombia).
//
// Input:  { reportVersionId, auditVersionId?, language? }
// Output: QualityAssessment + `qualityVersionId`
//
// The evaluated content comes from the named version, never from the request.
// `auditVersionId` must reference an audit of that same version chain, so the
// meta-audit keeps a record of exactly which audit it read. A partial audit is
// accepted here — the screen shows what the pipeline produced — but the export
// refuses to ship it as a result of record.
//
// POST-MVP: este endpoint deberia migrar a Vercel Workflow DevKit como un
// `step.do("quality-meta-audit", ...)` dentro del workflow durable que tambien
// ejecute Fase 1 y Fase 2. Ver `docs/POST_MVP_WORKFLOW_MIGRATION.md`.
// ---------------------------------------------------------------------------

// 300s = maximo default de Fluid Compute (2026). Igualamos Fases 1 y 2 para
// que la meta-auditoria no sea el eslabon mas debil del pipeline.
export const runtime = 'nodejs';
export const maxDuration = 300;

const requestSchema = z.object({
  reportVersionId: z.string().uuid(),
  auditVersionId: z.string().uuid().nullish(),
  language: z.enum(['es', 'en']).default('es'),
}).strict();

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
        error: 'The meta-audit requires a saved report version. Regenerate historical reports to obtain one.',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      }, { status: 400 });
    }
    const { reportVersionId, auditVersionId, language } = parsed.data;

    const workspace = await requireReportWorkspace();
    const examined = await loadFinancialVersionRecord(workspace, reportVersionId);
    // The meta-audit judges the finished pipeline output, so it needs the
    // consolidated report — not a phase still in progress.
    if (examined.payload.stage !== 'complete' || !examined.payload.report) {
      throw new ReportVersionError(409, 'Report version is incomplete.');
    }

    const boundAudit = auditVersionId
      ? await loadBoundAuditVersion({
        workspace, id: auditVersionId, kind: 'audit', requireComplete: false,
        lineage: await resolveVersionLineage(workspace, reportVersionId),
      })
      : null;

    const preprocessed = examined.payload.preprocessed == null
      ? undefined
      : revivePreprocessedBalance(examined.payload.preprocessed) ?? undefined;

    const quality = await runQualityAudit({
      report: examined.payload.report,
      auditReport: boundAudit?.audit,
      preprocessed,
      language,
    });

    // Its conclusions rest on the audit it read, so a partial audit makes the
    // meta-audit unexportable too. Otherwise the download would have to choose
    // between shipping a meta-audit without its audit and failing outright.
    const qualityComplete = auditResultIsComplete({ kind: 'quality', quality })
      && (boundAudit ? boundAudit.complete : true);
    const qualityVersionId = await saveAuditVersion(workspace, {
      kind: 'quality',
      reportVersionId,
      examinedSha256: examined.sha256,
      examinedStage: examined.payload.stage,
      company: examined.payload.company,
      language,
      auditVersionId: auditVersionId ?? null,
      complete: qualityComplete,
      quality,
    });

    return NextResponse.json({ ...quality, qualityVersionId, qualityComplete });
  } catch (error) {
    if (error instanceof ReportVersionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[financial-quality] Error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Error during quality assessment.' },
      { status: 500 },
    );
  }
}
