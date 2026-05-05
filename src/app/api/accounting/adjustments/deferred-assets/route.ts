// ─── /api/accounting/adjustments/deferred-assets ─────────────────────────────
// GET  → list deferred_assets for workspace
// POST → create deferred_asset

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { getDb } from '@/lib/db/client';
import { deferredAssets } from '@/lib/db/schema';
import { isAutoAdjustmentsEnabled } from '@/lib/accounting/adjustments';
import {
  errorResponse,
  ok,
  disabled503,
  badRequestZod,
  deferredAssetCreateSchema,
} from '../_shared';

export async function GET() {
  if (!isAutoAdjustmentsEnabled()) return disabled503();
  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();
    const rows = await db
      .select()
      .from(deferredAssets)
      .where(eq(deferredAssets.workspaceId, ws.id))
      .orderBy(deferredAssets.amortizationStart);
    return ok(rows);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  if (!isAutoAdjustmentsEnabled()) return disabled503();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = deferredAssetCreateSchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();
    const [row] = await db
      .insert(deferredAssets)
      .values({
        workspaceId: ws.id,
        description: parsed.data.description,
        category: parsed.data.category,
        assetAccountId: parsed.data.assetAccountId,
        expenseAccountId: parsed.data.expenseAccountId,
        totalAmount: parsed.data.totalAmount,
        amortizationStart: new Date(parsed.data.amortizationStart),
        amortizationEnd: new Date(parsed.data.amortizationEnd),
      })
      .returning();
    return ok(row, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
