// ─── /api/accounting/adjustments/fixed-assets/[id] ───────────────────────────
// GET    → fetch one fixed_asset
// PATCH  → partial update
// DELETE → soft-delete (sets active=false, disposedAt=now)

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
  fixedAssetUpdateSchema,
} from '../../_shared';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  if (!isAutoAdjustmentsEnabled()) return disabled503();
  try {
    const { id } = await ctx.params;
    const ws = await getOrCreateWorkspace();
    const db = getDb();
    const rows = await db
      .select()
      .from(fixedAssets)
      .where(and(eq(fixedAssets.id, id), eq(fixedAssets.workspaceId, ws.id)))
      .limit(1);
    if (!rows[0])
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return ok(rows[0]);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  if (!isAutoAdjustmentsEnabled()) return disabled503();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = fixedAssetUpdateSchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const { id } = await ctx.params;
    const ws = await getOrCreateWorkspace();
    const db = getDb();

    const set: Record<string, unknown> = { updatedAt: new Date() };
    const d = parsed.data;
    if (d.code !== undefined) set.code = d.code;
    if (d.name !== undefined) set.name = d.name;
    if (d.category !== undefined) set.category = d.category;
    if (d.assetAccountId !== undefined) set.assetAccountId = d.assetAccountId;
    if (d.depreciationAccountId !== undefined) set.depreciationAccountId = d.depreciationAccountId;
    if (d.expenseAccountId !== undefined) set.expenseAccountId = d.expenseAccountId;
    if (d.acquisitionDate !== undefined) set.acquisitionDate = new Date(d.acquisitionDate);
    if (d.acquisitionCost !== undefined) set.acquisitionCost = d.acquisitionCost;
    if (d.salvageValue !== undefined) set.salvageValue = d.salvageValue;
    if (d.usefulLifeMonths !== undefined) set.usefulLifeMonths = d.usefulLifeMonths;
    if (d.depreciationMethod !== undefined) set.depreciationMethod = d.depreciationMethod;
    if (d.notes !== undefined) set.notes = d.notes;
    if (d.active !== undefined) set.active = d.active;
    if (d.disposedAt !== undefined) set.disposedAt = d.disposedAt ? new Date(d.disposedAt) : null;

    const [updated] = await db
      .update(fixedAssets)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(set as any)
      .where(and(eq(fixedAssets.id, id), eq(fixedAssets.workspaceId, ws.id)))
      .returning();

    if (!updated)
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return ok(updated);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  if (!isAutoAdjustmentsEnabled()) return disabled503();
  try {
    const { id } = await ctx.params;
    const ws = await getOrCreateWorkspace();
    const db = getDb();
    const [updated] = await db
      .update(fixedAssets)
      .set({ active: false, disposedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(fixedAssets.id, id), eq(fixedAssets.workspaceId, ws.id)))
      .returning();
    if (!updated)
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return ok({ ok: true, id: updated.id });
  } catch (err) {
    return errorResponse(err);
  }
}
