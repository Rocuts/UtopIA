// ─── GET /api/accounting/close/status/[runId] ─────────────────────────────────
// Estado de un run de cierre mensual.
// Lee de monthly_close_runs (estado persistido en DB) + getRun (workflow runtime).

import { NextResponse } from 'next/server';
import { getRun } from 'workflow/api';
import { getRunById } from '@/lib/workflows/monthly-close/repository';
import { requireAuthSession } from '@/lib/auth/require-session';
import { requireWorkspace } from '@/lib/db/workspace';

interface RouteContext {
  params: Promise<{ runId: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  const { runId } = await context.params;

  if (!runId || typeof runId !== 'string') {
    return NextResponse.json({ error: 'runId requerido' }, { status: 400 });
  }

  // ---------------------------------------------------------------------------
  // Frontera de tenant. `requireAuthSession` sólo dice que HAY sesión; no dice
  // de quién es el `runId`. Sin este control la ruta era un IDOR: cualquier
  // usuario autenticado podía enumerar runIds y leer el estado del cierre
  // mensual de otra empresa — incluidos los ids de los asientos contables y,
  // en la propia respuesta, el `workspaceId` ajeno, que es la llave para
  // pivotar a los demás recursos de ese tenant.
  // Auditoría 2026-08 — `idor-close-status-runid`.
  // ---------------------------------------------------------------------------
  const workspace = await requireWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace no resuelto' }, { status: 401 });
  }

  // Estado en DB
  const dbRun = await getRunById(runId);

  // Un run de otro workspace se responde EXACTAMENTE igual que uno inexistente:
  // distinguirlos convertiría este endpoint en un oráculo de existencia de
  // runIds ajenos.
  if (!dbRun || dbRun.workspaceId !== workspace.id) {
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
