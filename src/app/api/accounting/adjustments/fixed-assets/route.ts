// ─── /api/accounting/adjustments/fixed-assets ────────────────────────────────
// GET  → list fixed_assets for workspace
// POST → create fixed_asset

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { getDb } from '@/lib/db/client';
import { fixedAssets } from '@/lib/db/schema';
import { isAutoAdjustmentsEnabled } from '@/lib/accounting/adjustments';
import {
  errorResponse,
  ok,
  disabled503,
  badRequestZod,
  fixedAssetCreateSchema,
} from '../_shared';

export async function GET() {
  if (!isAutoAdjustmentsEnabled()) return disabled503();
  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();
    const rows = await db
      .select()
      .from(fixedAssets)
      .where(eq(fixedAssets.workspaceId, ws.id))
      .orderBy(fixedAssets.code);
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

  const parsed = fixedAssetCreateSchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();
    const [row] = await db
      .insert(fixedAssets)
      .values({
        workspaceId: ws.id,
        code: parsed.data.code,
        name: parsed.data.name,
        category: parsed.data.category,
        assetAccountId: parsed.data.assetAccountId,
        depreciationAccountId: parsed.data.depreciationAccountId,
        expenseAccountId: parsed.data.expenseAccountId,
        acquisitionDate: new Date(parsed.data.acquisitionDate),
        acquisitionCost: parsed.data.acquisitionCost,
        salvageValue: parsed.data.salvageValue,
        usefulLifeMonths: parsed.data.usefulLifeMonths,
        depreciationMethod: parsed.data.depreciationMethod,
        notes: parsed.data.notes ?? null,
      })
      .returning();
    return ok(row, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
