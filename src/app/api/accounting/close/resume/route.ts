// ─── POST /api/accounting/close/resume ───────────────────────────────────────
// Reanuda un workflow pausado en el health-check hook.
//
// Body: { token, payload: CloseHookResumePayload }
// El token es determinístico: closeApprovalHookToken(periodId).
//
// Esta ruta está en /api/cron/* NO — está en /api/accounting/close/resume,
// que sí pasa por CSRF. El frontend (o el revisor fiscal) la llama con Origin.

import { NextResponse } from 'next/server';
import { resumeHook } from 'workflow/api';
import { z } from 'zod';
import { closeApprovalHookToken } from '@/lib/accounting/closing/types';

const ResumeSchema = z.object({
  token: z.string().min(1),
  payload: z.object({
    approved: z.boolean(),
    reason: z.string().optional(),
    approvedBy: z.string().min(1, 'approvedBy requerido'),
  }),
});

export async function POST(req: Request) {
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

  const { token, payload } = parsed.data;

  try {
    const result = await resumeHook(token, payload);
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      approved: payload.approved,
    });
  } catch (err) {
    // Hook no encontrado = token inválido o workflow ya completado
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
