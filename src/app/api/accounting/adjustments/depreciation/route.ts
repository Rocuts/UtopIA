// ─── POST /api/accounting/adjustments/depreciation ───────────────────────────
//
// Body: { periodId: uuid, entryDate?: ISO-8601, post?: boolean }
//
// Si post=false (default): retorna DepreciationPreview sin tocar la DB.
// Si post=true:
//   1. preview (idempotencia check: si last_depreciated_period_id == periodId → 409)
//   2. createEntry(proposedEntry) con status 'posted'
//   3. updateAfterDepreciation (accumulated + last_depreciated_period_id)
//   Idempotencia: el segundo POST con el mismo periodId devuelve 409.

import { NextResponse } from 'next/server';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  isAutoAdjustmentsEnabled,
  adjustmentsPort,
  updateAfterDepreciation,
  getPeriod,
  ADJ_ERR,
} from '@/lib/accounting/adjustments';
import { AdjustmentsError } from '@/lib/accounting/adjustments/types';
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

    // Idempotencia: si alguna línea ya tiene last_depreciated_period_id == periodId,
    // todas las skipped por 'already_depreciated_this_period' aparecen en skipped.
    // Si TODAS las líneas fueron saltadas (lines vacío), ya lo capturamos arriba.
    // Si hay al menos una línea, creamos el asiento.

    const { entry } = await createEntry({
      ...preview.proposedEntry,
      status: 'posted',
    });

    // Actualizar los activos con el nuevo acumulado y el período procesado.
    await updateAfterDepreciation(
      preview.lines.map((l) => ({
        fixedAssetId: l.fixedAssetId,
        newAccumulatedDepreciation: l.newAccumulatedCop,
        periodId: period.id,
      })),
    );

    return ok(
      {
        ...preview,
        posted: true,
        entryId: entry.id,
        entryNumber: entry.entryNumber,
      },
      201,
    );
  } catch (err) {
    return errorResponse(err);
  }
}
