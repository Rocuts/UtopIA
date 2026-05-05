// ─── POST /api/accounting/adjustments/provisions ─────────────────────────────
//
// Body: { periodId: uuid, entryDate?: ISO-8601, post?: boolean }
//
// Si post=false: retorna ProvisionsPreview (N proposed entries, uno por tipo).
// Si post=true: crea y postea cada entry individualmente (1 entry por provision_type).

import { NextResponse } from 'next/server';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  isAutoAdjustmentsEnabled,
  adjustmentsPort,
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

    // Post each proposed entry sequentially (each is independent, 1 per provision_type).
    const postedEntryIds: string[] = [];
    for (const proposed of preview.proposedEntries) {
      const { entry } = await createEntry({ ...proposed, status: 'posted' });
      postedEntryIds.push(entry.id);
    }

    return ok(
      { ...preview, posted: true, postedEntryIds },
      201,
    );
  } catch (err) {
    return errorResponse(err);
  }
}
