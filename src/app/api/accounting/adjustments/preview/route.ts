// ─── POST /api/accounting/adjustments/preview ─────────────────────────────────
//
// Devuelve los tres previews (depreciation, amortization, provisions) juntos,
// sin postear nada. Idempotente — no modifica la DB.
//
// Body: { periodId: uuid, entryDate?: ISO-8601 }
// Response: { depreciation: DepreciationPreview, amortization: AmortizationPreview,
//             provisions: ProvisionsPreview }

import { NextResponse } from 'next/server';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { adjustmentsPort, isAutoAdjustmentsEnabled } from '@/lib/accounting/adjustments';
import { errorResponse, ok, disabled503, badRequestZod, previewBodySchema } from '../_shared';
import { getPeriod } from '@/lib/accounting/adjustments';

export async function POST(req: Request) {
  if (!isAutoAdjustmentsEnabled()) return disabled503();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = previewBodySchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();

    // If no entryDate provided, use the last second of the period as default.
    let entryDate: Date;
    if (parsed.data.entryDate) {
      entryDate = new Date(parsed.data.entryDate);
    } else {
      const period = await getPeriod(ws.id, parsed.data.periodId);
      entryDate = new Date(period.endsAt);
    }

    const input = {
      workspaceId: ws.id,
      periodId: parsed.data.periodId,
      entryDate,
    };

    const [depreciation, amortization, provisions] = await Promise.all([
      adjustmentsPort.previewDepreciation(input),
      adjustmentsPort.previewAmortization(input),
      adjustmentsPort.previewProvisions(input),
    ]);

    return ok({ depreciation, amortization, provisions });
  } catch (err) {
    return errorResponse(err);
  }
}
