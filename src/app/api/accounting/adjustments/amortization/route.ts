// ─── POST /api/accounting/adjustments/amortization ───────────────────────────
//
// Body: { periodId: uuid, entryDate?: ISO-8601, post?: boolean }
//
// Si post=false (default): retorna AmortizationPreview sin tocar la DB.
// Si post=true: postAmortization (adjustments/posting.ts) — asiento y
//   amortized_amount/last_amortized_period_id en la MISMA transacción;
//   idempotente por período.

import { NextResponse } from 'next/server';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  isAutoAdjustmentsEnabled,
  adjustmentsPort,
  getPeriod,
} from '@/lib/accounting/adjustments';
import { postAmortization } from '@/lib/accounting/adjustments/posting';
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

    const preview = await adjustmentsPort.previewAmortization({
      workspaceId: ws.id,
      periodId: period.id,
      entryDate,
    });

    if (!parsed.data.post) return ok(preview);

    if (!preview.proposedEntry || preview.lines.length === 0) {
      return ok({
        ...preview,
        posted: false,
        message: 'No hay diferidos a amortizar en este período.',
      });
    }

    const posted = await postAmortization(preview, period.id);

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
