// ─── GET /api/accounting/close/status/[runId] ─────────────────────────────────
// Estado de un run de cierre mensual.
// Lee de monthly_close_runs (estado persistido en DB) + getRun (workflow runtime).

import { NextResponse } from 'next/server';
import { getRun } from 'workflow/api';
import { getRunById } from '@/lib/workflows/monthly-close/repository';

interface RouteContext {
  params: Promise<{ runId: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  const { runId } = await context.params;

  if (!runId || typeof runId !== 'string') {
    return NextResponse.json({ error: 'runId requerido' }, { status: 400 });
  }

  // Estado en DB
  const dbRun = await getRunById(runId);
  if (!dbRun) {
    return NextResponse.json({ error: 'Run no encontrado' }, { status: 404 });
  }

  // Estado en Workflow runtime (si hay workflowRunId)
  let workflowStatus: string | null = null;
  if (dbRun.workflowRunId) {
    try {
      const run = getRun(dbRun.workflowRunId);
      workflowStatus = await run.status;
    } catch {
      // Workflow runtime no disponible (dev local sin servidor workflow)
      workflowStatus = null;
    }
  }

  return NextResponse.json({
    id: dbRun.id,
    workspaceId: dbRun.workspaceId,
    periodId: dbRun.periodId,
    workflowRunId: dbRun.workflowRunId,
    status: dbRun.status,
    workflowStatus,
    healthCheckResults: dbRun.healthCheckResults,
    depreciationEntryId: dbRun.depreciationEntryId,
    amortizationEntryId: dbRun.amortizationEntryId,
    provisionEntryIds: dbRun.provisionEntryIds,
    closingEntryId: dbRun.closingEntryId,
    previousPeriodHash: dbRun.previousPeriodHash,
    periodHash: dbRun.periodHash,
    pdfReportUrl: dbRun.pdfReportUrl,
    notifiedAt: dbRun.notifiedAt,
    startedAt: dbRun.startedAt,
    completedAt: dbRun.completedAt,
    errorMessage: dbRun.errorMessage,
  });
}
