// ---------------------------------------------------------------------------
// POST /api/accounting/periods/reopen
// Body: { periodId: uuid }
// Effect: closed → open. Refuses 'locked' (terminal) and 'open' (no-op).
// Clears `closedAt` so the audit trail records the most recent closure only;
// `lockedAt` is never reached on a reopened period.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { accountingPeriods } from '@/lib/db/schema';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { periodActionBodySchema } from '@/lib/validation/accounting-schemas';

import { badRequestZod, errorResponse, ok } from '../../_shared';

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const parsed = periodActionBodySchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();

    const result = await db.transaction(
      async (tx) => {
        const rows = await tx
          .select()
          .from(accountingPeriods)
          .where(
            and(
              eq(accountingPeriods.id, parsed.data.periodId),
              eq(accountingPeriods.workspaceId, ws.id),
            ),
          )
          .for('update');
        const period = rows[0];
        if (!period) return { kind: 'not_found' as const };
        if (period.status === 'locked') {
          return { kind: 'locked' as const, period };
        }
        if (period.status === 'open') {
          return { kind: 'already_open' as const, period };
        }
        const [updated] = await tx
          .update(accountingPeriods)
          .set({ status: 'open', closedAt: null })
          .where(eq(accountingPeriods.id, period.id))
          .returning();
        return { kind: 'reopened' as const, period: updated };
      },
      { isolationLevel: 'serializable' },
    );

    if (result.kind === 'not_found') {
      return NextResponse.json(
        { error: 'period_not_found' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (result.kind === 'locked') {
      return NextResponse.json(
        { error: 'period_locked_cannot_reopen', period: result.period },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (result.kind === 'already_open') {
      return ok({ period: result.period, alreadyOpen: true });
    }
    return ok({ period: result.period });
  } catch (err) {
    return errorResponse(err);
  }
}
