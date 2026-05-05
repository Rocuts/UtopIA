// ─── POST /api/accounting/adjustments/amortization ───────────────────────────
//
// Body: { periodId: uuid, entryDate?: ISO-8601, post?: boolean }
//
// Si post=false (default): retorna AmortizationPreview sin tocar la DB.
// Si post=true: crea y postea el asiento, actualiza amortized_amount.

import { NextResponse } from 'next/server';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  isAutoAdjustmentsEnabled,
  adjustmentsPort,
  updateAfterAmortization,
  getPeriod,
} from '@/lib/accounting/adjustments';
import { createEntry } from '@/lib/accounting/double-entry';
import {
  errorResponse,
  ok,
  disabled503,
  badRequestZod,
  runBodySchema,
} from '../_shared';

export async function POST(req: Request) {
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

    const { entry } = await createEntry({
      ...preview.proposedEntry,
      status: 'posted',
    });

    await updateAfterAmortization(
      preview.lines.map((l) => ({
        deferredAssetId: l.deferredAssetId,
        newAmortizedAmount: l.newAmortizedCop,
        periodId: period.id,
      })),
    );

    return ok(
      { ...preview, posted: true, entryId: entry.id, entryNumber: entry.entryNumber },
      201,
    );
  } catch (err) {
    return errorResponse(err);
  }
}
