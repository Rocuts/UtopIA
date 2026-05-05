// ─── GET /api/cron/monthly-close ─────────────────────────────────────────────
// Cron job: ejecutado el 1ro de cada mes a las 06:00 UTC (01:00 Colombia).
// Schedule configurado en vercel.ts: '0 6 1 * *'
//
// Flujo:
//   1. Verificar auth header de Vercel cron (CRON_SECRET).
//   2. Verificar flag global UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW.
//   3. Iterar workspaces activos.
//   4. Para cada workspace, buscar período del mes anterior con status='open'|'closed'.
//   5. Si no existe run activo, arrancar closeMonthWorkflow.
//
// Esta ruta está en CSRF_ALLOWLIST ('/api/cron/') — no requiere Origin header.
// maxDuration: 300s (configurado en vercel.ts).

import { NextResponse } from 'next/server';
import { start } from 'workflow/api';
import { isMonthlyCloseEnabled } from '@/lib/accounting/closing/types';
import { closeMonthWorkflow } from '@/lib/workflows/monthly-close';
import {
  getActiveWorkspacesWithCloseEnabled,
  getPeriodsEligibleForClose,
  getRunByPeriodId,
  upsertCloseRun,
} from '@/lib/workflows/monthly-close/repository';

export const maxDuration = 300;

export async function GET(req: Request) {
  // 1. Auth: Vercel cron signature
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // 2. Feature flag
  if (!isMonthlyCloseEnabled()) {
    return NextResponse.json(
      { skipped: true, reason: 'UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW no activo' },
      { status: 200 },
    );
  }

  const results: Array<{
    workspaceId: string;
    periodId?: string;
    workflowRunId?: string;
    status: string;
    error?: string;
  }> = [];

  // 3. Iterar workspaces
  const workspaces = await getActiveWorkspacesWithCloseEnabled();

  for (const ws of workspaces) {
    try {
      // 4. Período elegible del mes anterior
      const periods = await getPeriodsEligibleForClose(ws.id);
      if (periods.length === 0) {
        results.push({ workspaceId: ws.id, status: 'no_eligible_period' });
        continue;
      }

      const period = periods[0];

      // 5. Idempotencia: no disparar si ya hay run activo
      const existing = await getRunByPeriodId(period.id);
      if (existing && existing.status !== 'cancelled' && existing.status !== 'completed') {
        results.push({
          workspaceId: ws.id,
          periodId: period.id,
          status: 'already_running',
          workflowRunId: existing.workflowRunId ?? undefined,
        });
        continue;
      }

      // 6. Arrancar workflow
      const input = {
        workspaceId: ws.id,
        periodId: period.id,
        override: false,
        triggeredBy: undefined as string | undefined,
      };

      const run = await start(closeMonthWorkflow, [input]);

      // Registrar el run en DB
      await upsertCloseRun({
        workspaceId: ws.id,
        periodId: period.id,
        status: 'running',
        workflowRunId: run.runId,
      });

      results.push({
        workspaceId: ws.id,
        periodId: period.id,
        workflowRunId: run.runId,
        status: 'started',
      });
    } catch (err) {
      console.error(`[cron/monthly-close] Error en workspace ${ws.id}:`, err);
      results.push({
        workspaceId: ws.id,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processedAt: new Date().toISOString(),
    total: workspaces.length,
    results,
  });
}
