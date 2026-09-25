// ─── POST /api/accounting/adjustments/provisions ─────────────────────────────
//
// Body: { periodId: uuid, entryDate?: ISO-8601, post?: boolean }
//
// Si post=false: retorna ProvisionsPreview (N proposed entries, uno por tipo).
// Si post=true: postProvisions (adjustments/posting.ts) — 1 asiento por
//   provision_type, idempotente por período; errores por tipo en `errors`.

import { NextResponse } from 'next/server';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  isAutoAdjustmentsEnabled,
  adjustmentsPort,
  getPeriod,
} from '@/lib/accounting/adjustments';
import { postProvisions } from '@/lib/accounting/adjustments/posting';
import {
  errorResponse,
  ok,
  disabled503,
  badRequestZod,
  runBodySchema,
} from '../_shared';
import { requireAuthSession } from '@/lib/auth/require-session';

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  if (!isAutoAdjustmentsEnabled()) return disabled503();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = runBodySchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const period = await getPeriod(ws.id, parsed.data.periodId);
    const entryDate = parsed.data.entryDate
      ? new Date(parsed.data.entryDate)
      : new Date(period.endsAt);

    const preview = await adjustmentsPort.previewProvisions({
      workspaceId: ws.id,
      periodId: period.id,
      entryDate,
    });

    if (!parsed.data.post) return ok(preview);

    if (preview.proposedEntries.length === 0) {
      return ok({
        ...preview,
        posted: false,
        postedEntryIds: [],
        message: 'No hay provisiones que generar en este período.',
      });
    }

    // Un asiento por provision_type, idempotente por período y tipo; las
    // fallas se reportan (antes una falla a mitad dejaba el resto sin postear
    // y sin detalle).
    const posted = await postProvisions(preview);

    return ok(
      {
        ...preview,
        posted: posted.postedEntryIds.length > 0,
        postedEntryIds: posted.postedEntryIds,
        alreadyPosted: posted.alreadyPosted,
        errors: posted.errors,
      },
      posted.errors.length > 0 ? 207 : posted.postedEntryIds.length > 0 ? 201 : 200,
    );
  } catch (err) {
    return errorResponse(err);
  }
}
