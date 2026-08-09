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
import {
  getPeriodById,
  getRunByPeriodId,
  upsertCloseRun,
} from '@/lib/workflows/monthly-close/repository';
import { requireAuthSession } from '@/lib/auth/require-session';

const StartCloseSchema = z.object({
  periodId: z.string().uuid('periodId debe ser un UUID válido'),
  override: z.boolean().optional().default(false),
  overrideReason: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

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

  // ---------------------------------------------------------------------------
  // Frontera de tenant. El `periodId` llega del body y hasta aquí nadie había
  // comprobado que fuera de ESTE workspace. Con el período de otra empresa la
  // ruta hacía dos cosas graves: (a) el early-return de idempotencia devolvía
  // su `runId` y su `workflowRunId` — justo las llaves para reanudar su hook de
  // aprobación desde /close/resume; y (b) si no tenía run, insertaba en
  // monthly_close_runs una fila con NUESTRO workspaceId y SU periodId. Como
  // `mcr_period_uniq` es un índice único GLOBAL por period_id, esa fila
  // envenenada no puede coexistir con la legítima: a partir de ahí tanto esta
  // ruta como el cron /api/cron/monthly-close encuentran el run ajeno y
  // responden "ya existe un run activo" — el cierre contable de esa empresa
  // queda bloqueado de forma persistente y no hay ruta de borrado expuesta.
  // Auditoría 2026-08 — `bola-close-start-periodid`.
  // ---------------------------------------------------------------------------
  const period = await getPeriodById(workspaceId, periodId);
  if (!period) {
    return NextResponse.json(
      { error: 'Período no encontrado', code: CLOSE_ERR.PERIOD_NOT_FOUND },
      { status: 404 },
    );
  }

  // Idempotencia: si ya hay un run activo para este período, retornarlo
  const existingRun = await getRunByPeriodId(periodId);

  // `getRunByPeriodId` busca por period_id sin filtrar workspace. Con el
  // chequeo de arriba el período ya es nuestro, así que un run de otro
  // workspace sobre él sólo puede ser residuo del envenenamiento anterior:
  // respondemos 409 sin devolver sus identificadores, porque esa fuga es
  // exactamente el primer escalón del ataque.
  if (existingRun && existingRun.workspaceId !== workspaceId) {
    return NextResponse.json(
      {
        error: 'El período tiene un run de cierre inconsistente. Contactar soporte.',
        code: CLOSE_ERR.CONCURRENT_RUN,
      },
      { status: 409 },
    );
  }

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
