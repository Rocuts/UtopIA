// ---------------------------------------------------------------------------
// POST /api/sentinel/check
// Body: { periodId?: string, recipient?: string, dryRun?: boolean }
// Effect: dispara `runSentinelCheck` (workflow durable Vercel WDK).
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { accountingPeriods } from '@/lib/db/schema';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { runSentinelCheck } from '@/lib/workflows/sentinel/orchestrator';
import {
  findComparativePeriod,
  getCachedPreprocessedBalance,
  getLatestOpenPeriod,
} from '@/lib/cache/preprocessed-balance';

export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { periodId?: string; recipient?: string; dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // body opcional
  }

  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();

    // Resolver periodo target: explícito o último abierto del workspace.
    let targetPeriod = null;
    if (body.periodId) {
      const rows = await db
        .select()
        .from(accountingPeriods)
        .where(eq(accountingPeriods.id, body.periodId))
        .limit(1);
      targetPeriod = rows[0] ?? null;
    } else {
      targetPeriod = await getLatestOpenPeriod(ws.id);
    }

    // Cargar preprocessed (con curator inyectado) si hay periodo.
    let preprocessed = null;
    if (targetPeriod) {
      const comparative = await findComparativePeriod(ws.id, targetPeriod);
      const result = await getCachedPreprocessedBalance(
        ws.id,
        targetPeriod.id,
        comparative?.id,
      );
      preprocessed = result.balance;
    }

    const report = await runSentinelCheck(
      {
        workspaceId: ws.id,
        periodId: targetPeriod?.id ?? null,
        recipient: body.recipient,
        dryRun: body.dryRun ?? false,
      },
      preprocessed,
    );

    return NextResponse.json(
      { ok: true, report },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sentinel_check_failed';
    console.warn('[api/sentinel/check] error:', msg);
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
