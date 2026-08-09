// ─── POST /api/accounting/close/resume ───────────────────────────────────────
// Reanuda un workflow pausado en el health-check hook.
//
// Body: { periodId, payload: { approved, reason?, claimedBy? } }
// El token del hook NO viaja por la red: se deriva en el servidor con
// closeApprovalHookToken(periodId) una vez comprobado que el período es de
// este workspace.
//
// Esta ruta está en /api/cron/* NO — está en /api/accounting/close/resume,
// que sí pasa por CSRF. El frontend (o el revisor fiscal) la llama con Origin.

import { NextResponse } from 'next/server';
import { resumeHook } from 'workflow/api';
import { z } from 'zod';
import {
  closeApprovalHookToken,
  isMonthlyCloseEnabled,
  type CloseHookResumePayload,
} from '@/lib/accounting/closing/types';
import { requireAuthSession } from '@/lib/auth/require-session';
import { requireWorkspace } from '@/lib/db/workspace';
import { getPeriodById } from '@/lib/workflows/monthly-close/repository';

// ---------------------------------------------------------------------------
// El body ya no acepta el `token` del hook: lo acepta era el agujero. El token
// es determinístico (`close-approval:<periodId>`, sin HMAC ni sal) y vive en el
// namespace GLOBAL del Workflow DevKit, así que quien conociera el periodId de
// otra empresa podía aprobar o cancelar su cierre mensual. Ahora sólo entra el
// periodId — que sí se puede cruzar contra el workspace del llamante — y el
// token lo deriva el servidor.
// Auditoría 2026-08 — `bfla-close-resume-no-authz`.
// ---------------------------------------------------------------------------
const ResumeSchema = z.object({
  periodId: z.string().uuid('periodId debe ser un UUID válido'),
  payload: z.object({
    approved: z.boolean(),
    reason: z.string().max(1000).optional(),
    // Nombre que DECLARA quien llama. No es la firma del revisor fiscal: se
    // conserva sólo como dato declarado dentro de `reason` (ver abajo).
    claimedBy: z.string().max(200).optional(),
  }),
});

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  // Paridad con /close/start: si el workflow está apagado, esta ruta tampoco
  // debe ofrecer superficie.
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

  const parsed = ResumeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { periodId, payload } = parsed.data;

  // ---------------------------------------------------------------------------
  // Frontera de tenant. `requireAuthSession` sólo dice que HAY sesión; no dice
  // de quién es el período. Sin este cruce, aprobar (approved:true) saltaba el
  // health-check bloqueante de otra empresa y le generaba ajustes y asiento de
  // cierre con wasOverridden=true, y rechazar (approved:false) le cancelaba el
  // cierre del mes.
  // ---------------------------------------------------------------------------
  const workspace = await requireWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace no resuelto' }, { status: 401 });
  }

  const period = await getPeriodById(workspace.id, periodId);
  if (!period) {
    // Un período ajeno se responde igual que uno inexistente: distinguirlos
    // haría de esta ruta un oráculo de existencia de periodIds de otros
    // tenants.
    return NextResponse.json({ error: 'period_not_found' }, { status: 404 });
  }

  // ---------------------------------------------------------------------------
  // La firma del cierre la pone el servidor, no el cliente. Antes `approvedBy`
  // era un string libre del body que viajaba tal cual a la traza del run: se
  // podía firmar la aprobación de un cierre con el nombre de un revisor fiscal
  // inventado — falsificación de la atribución, con la exposición del Art. 647
  // E.T. que eso implica. Ahora sale de los datos del tenant y lo declarado por
  // el cliente queda etiquetado como tal dentro de `reason`.
  // ---------------------------------------------------------------------------
  const approvedBy =
    workspace.revisorFiscalNombre?.trim() ||
    workspace.contadorPublicoNombre?.trim() ||
    `Responsable del workspace ${workspace.id}`;

  const trace: string[] = [];
  const declaredReason = payload.reason?.trim();
  const claimedBy = payload.claimedBy?.trim();
  if (declaredReason) trace.push(declaredReason);
  if (claimedBy) trace.push(`declarado por el solicitante como: ${claimedBy}`);

  const hookPayload: CloseHookResumePayload = {
    approved: payload.approved,
    reason: trace.length > 0 ? trace.join(' — ') : undefined,
    approvedBy,
  };

  try {
    const result = await resumeHook(closeApprovalHookToken(periodId), hookPayload);
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      approved: payload.approved,
    });
  } catch (err) {
    // Hook no encontrado = período sin cierre pausado o workflow ya completado
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('not found') || message.toLowerCase().includes('hook')) {
      return NextResponse.json(
        { error: 'Token de aprobación no encontrado o ya expirado.' },
        { status: 404 },
      );
    }
    console.error('[close/resume] Error al resumir hook:', err);
    return NextResponse.json({ error: 'Error interno al resumir el workflow.' }, { status: 500 });
  }
}
