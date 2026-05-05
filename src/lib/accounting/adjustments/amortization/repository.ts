// ─── WS4 — Deferred assets repository ───────────────────────────────────────

import 'server-only';

import { and, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { accountingPeriods, deferredAssets } from '@/lib/db/schema';
import type { AccountingPeriodRow, DeferredAssetRow } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// listActiveDeferredAssets
// ---------------------------------------------------------------------------

export async function listActiveDeferredAssets(
  workspaceId: string,
): Promise<
  Array<
    DeferredAssetRow & {
      lastAmortizedPeriod: { year: number; month: number } | null;
    }
  >
> {
  const db = getDb();

  const assets = await db
    .select()
    .from(deferredAssets)
    .where(
      and(
        eq(deferredAssets.workspaceId, workspaceId),
        eq(deferredAssets.active, true),
      ),
    );

  if (assets.length === 0) return [];

  const periodIds = [
    ...new Set(
      assets
        .map((a) => a.lastAmortizedPeriodId)
        .filter((id): id is string => id !== null && id !== undefined),
    ),
  ];

  let periodsMap = new Map<string, AccountingPeriodRow>();
  if (periodIds.length > 0) {
    const periods = await db
      .select()
      .from(accountingPeriods)
      .where(eq(accountingPeriods.workspaceId, workspaceId));
    periodsMap = new Map(
      periods.filter((p) => periodIds.includes(p.id)).map((p) => [p.id, p]),
    );
  }

  return assets.map((a) => {
    const period = a.lastAmortizedPeriodId
      ? periodsMap.get(a.lastAmortizedPeriodId)
      : undefined;
    return {
      ...a,
      lastAmortizedPeriod: period
        ? { year: period.year, month: period.month }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// updateAfterAmortization
// ---------------------------------------------------------------------------

export async function updateAfterAmortization(
  updates: Array<{
    deferredAssetId: string;
    newAmortizedAmount: string;
    periodId: string;
  }>,
): Promise<void> {
  if (updates.length === 0) return;
  const db = getDb();

  await Promise.all(
    updates.map((u) =>
      db
        .update(deferredAssets)
        .set({
          amortizedAmount: u.newAmortizedAmount,
          lastAmortizedPeriodId: u.periodId,
          updatedAt: new Date(),
        })
        .where(eq(deferredAssets.id, u.deferredAssetId)),
    ),
  );
}
