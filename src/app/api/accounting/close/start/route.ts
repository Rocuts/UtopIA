// ─── POST /api/accounting/close/start ────────────────────────────────────────
// Arranca el workflow de cierre mensual manualmente.
//
// Body: { periodId, override?, overrideReason? }
// Retorna: { runId, workflowRunId, status }
//
// Protegido por CSRF del proxy (requiere Origin = mismo host).
// Rate-limit: se agrega en src/proxy.ts RATE_LIMITS al momento de merge.

import { NextResponse } from 'next/server';
import { start } from 'workflow/api';
import { z } from 'zod';

import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  isMonthlyCloseEnabled,
  CLOSE_ERR,
  ClosingError,
} from '@/lib/accounting/closing/types';
import { closeMonthWorkflow } from '@/lib/workflows/monthly-close';
import { getRunByPeriodId, upsertCloseRun } from '@/lib/workflows/monthly-close/repository';

const StartCloseSchema = z.object({
  periodId: z.string().uuid('periodId debe ser un UUID válido'),
  override: z.boolean().optional().default(false),
  overrideReason: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  if (!isMonthlyCloseEnabled()) {
    return NextResponse.json(
      { error: 'Workflow de cierre mensual no habilitado. Activar UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW=true.' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const parsed = StartCloseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { periodId, override, overrideReason } = parsed.data;

  // Obtener workspace del usuario (cookie httpOnly — sin args en esta versión)
  const workspace = await getOrCreateWorkspace();
  const workspaceId = workspace.id;

  // Idempotencia: si ya hay un run activo para este período, retornarlo
  const existingRun = await getRunByPeriodId(periodId);
  if (existingRun && existingRun.status !== 'cancelled' && existingRun.status !== 'completed') {
    return NextResponse.json(
      {
        runId: existingRun.id,
        workflowRunId: existingRun.workflowRunId,
        status: existingRun.status,
        message: 'Ya existe un run activo para este período.',
      },
      { status: 200 },
    );
  }

  // Arrancar el workflow
  const input = {
    workspaceId,
    periodId,
    override,
    overrideReason,
    triggeredBy: undefined as string | undefined,
  };

  const run = await start(closeMonthWorkflow, [input]);

  // Persistir el workflowRunId en la fila del run. Race con el step
  // `persist-run` del workflow (que puede INSERT-ar primero sin runId)
  // queda resuelto porque `upsertCloseRun` UPDATEa con todos los campos
  // recibidos cuando encuentra fila existente.
  const dbRow = await upsertCloseRun({
    workspaceId,
    periodId,
    status: 'running',
    workflowRunId: run.runId,
  });

  // Retornamos el UUID de la fila como `runId` (para que el cliente pueda
  // polear /status/[runId] de forma determinista, sin depender del campo
  // workflow_run_id que el workflow puede sobreescribir o ignorar entre
  // replays). El workflowRunId queda disponible aparte para correlacionar
  // con el dashboard `npx workflow web`.
  return NextResponse.json(
    {
      runId: dbRow.id,
      workflowRunId: run.runId,
      status: 'started',
      message: 'Workflow de cierre mensual iniciado.',
    },
    { status: 202 },
  );
}
