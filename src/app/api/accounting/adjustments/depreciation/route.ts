// ─── POST /api/accounting/adjustments/depreciation ───────────────────────────
//
// Body: { periodId: uuid, entryDate?: ISO-8601, post?: boolean }
//
// Si post=false (default): retorna DepreciationPreview sin tocar la DB.
// Si post=true: postDepreciation (adjustments/posting.ts) — asiento posteado
//   y accumulated/last_depreciated_period_id actualizados en la MISMA
//   transacción; idempotente por período (un segundo POST, o el cierre
//   mensual, no duplica: devuelve el asiento existente con alreadyPosted).

import { NextResponse } from 'next/server';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  isAutoAdjustmentsEnabled,
  adjustmentsPort,
  getPeriod,
} from '@/lib/accounting/adjustments';
import { postDepreciation } from '@/lib/accounting/adjustments/posting';
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

    const preview = await adjustmentsPort.previewDepreciation({
      workspaceId: ws.id,
      periodId: period.id,
      entryDate,
    });

    if (!parsed.data.post) {
      return ok(preview);
    }

    // ── Post mode ────────────────────────────────────────────────────────────

    if (!preview.proposedEntry || preview.lines.length === 0) {
      return ok({
        ...preview,
        posted: false,
        message: 'No hay activos a depreciar en este período.',
      });
    }

    const posted = await postDepreciation(preview, period.id);

    return ok(
      {
        ...preview,
        posted: !posted.alreadyPosted,
        alreadyPosted: posted.alreadyPosted,
        entryId: posted.entryId,
        entryNumber: posted.entryNumber,
      },
      posted.alreadyPosted ? 200 : 201,
    );
  } catch (err) {
    return errorResponse(err);
  }
}
