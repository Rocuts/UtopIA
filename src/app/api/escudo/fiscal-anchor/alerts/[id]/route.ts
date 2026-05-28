import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentWorkspaceId } from '@/lib/db/workspace';
import { getDb } from '@/lib/db/client';
import {
  findAlertById,
  resolveAlert,
  snoozeAlert,
} from '@/lib/workflows/sentinel/repository';
import { alertRowToView } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/alert-mapping';

// ---------------------------------------------------------------------------
// PATCH /api/escudo/fiscal-anchor/alerts/[id] — ciclo de vida de la alerta
// ---------------------------------------------------------------------------
// action: 'resolve' | 'snooze'. Reutiliza resolveAlert / snoozeAlert del
// repositorio Sentinel. Verifica que la alerta pertenezca al workspace de la
// cookie antes de mutar. Contrato §4.3.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

const patchBodySchema = z.object({
  action: z.enum(['resolve', 'snooze']),
  days: z.number().int().min(1).max(365).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_input',
        details: parsed.error.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`,
        ),
      },
      { status: 400 },
    );
  }

  const db = getDb();

  // Ownership: la alerta debe pertenecer al workspace de la cookie.
  const existing = await findAlertById(db, id);
  if (!existing || existing.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const updated =
    parsed.data.action === 'resolve'
      ? await resolveAlert(db, id)
      : await snoozeAlert(db, id, parsed.data.days ?? 7);

  if (!updated) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, alert: alertRowToView(updated) });
}
