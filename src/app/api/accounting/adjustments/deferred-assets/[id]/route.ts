// ─── /api/accounting/adjustments/deferred-assets/[id] ────────────────────────
// GET    → fetch one deferred_asset
// PATCH  → partial update
// DELETE → soft-delete (active=false)

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { getDb } from '@/lib/db/client';
import { deferredAssets } from '@/lib/db/schema';
import { isAutoAdjustmentsEnabled } from '@/lib/accounting/adjustments';
import {
  errorResponse,
  ok,
  disabled503,
  badRequestZod,
  deferredAssetUpdateSchema,
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
      .from(deferredAssets)
      .where(and(eq(deferredAssets.id, id), eq(deferredAssets.workspaceId, ws.id)))
      .limit(1);
    if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 });
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

  const parsed = deferredAssetUpdateSchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const { id } = await ctx.params;
    const ws = await getOrCreateWorkspace();
    const db = getDb();

    const set: Record<string, unknown> = { updatedAt: new Date() };
    const d = parsed.data;
    if (d.description !== undefined) set.description = d.description;
    if (d.category !== undefined) set.category = d.category;
    if (d.assetAccountId !== undefined) set.assetAccountId = d.assetAccountId;
    if (d.expenseAccountId !== undefined) set.expenseAccountId = d.expenseAccountId;
    if (d.totalAmount !== undefined) set.totalAmount = d.totalAmount;
    if (d.amortizationStart !== undefined) set.amortizationStart = new Date(d.amortizationStart);
    if (d.amortizationEnd !== undefined) set.amortizationEnd = new Date(d.amortizationEnd);
    if (d.active !== undefined) set.active = d.active;

    const [updated] = await db
      .update(deferredAssets)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(set as any)
      .where(and(eq(deferredAssets.id, id), eq(deferredAssets.workspaceId, ws.id)))
      .returning();

    if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 });
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
      .update(deferredAssets)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(deferredAssets.id, id), eq(deferredAssets.workspaceId, ws.id)))
      .returning();
    if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return ok({ ok: true, id: updated.id });
  } catch (err) {
    return errorResponse(err);
  }
}
