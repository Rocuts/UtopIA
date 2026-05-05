// ─── /api/accounting/adjustments/provisions-config ───────────────────────────
// GET  → list provisions_config for workspace
// POST → create provisions_config entry

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { getDb } from '@/lib/db/client';
import { provisionsConfig } from '@/lib/db/schema';
import { isAutoAdjustmentsEnabled } from '@/lib/accounting/adjustments';
import {
  errorResponse,
  ok,
  disabled503,
  badRequestZod,
  provisionsConfigCreateSchema,
} from '../_shared';

export async function GET() {
  if (!isAutoAdjustmentsEnabled()) return disabled503();
  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();
    const rows = await db
      .select()
      .from(provisionsConfig)
      .where(eq(provisionsConfig.workspaceId, ws.id))
      .orderBy(provisionsConfig.provisionType);
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

  const parsed = provisionsConfigCreateSchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();
    const [row] = await db
      .insert(provisionsConfig)
      .values({
        workspaceId: ws.id,
        provisionType: parsed.data.provisionType,
        rate: parsed.data.rate,
        baseAccountCodes: parsed.data.baseAccountCodes,
        expenseAccountId: parsed.data.expenseAccountId,
        liabilityAccountId: parsed.data.liabilityAccountId,
        cadence: parsed.data.cadence,
        active: parsed.data.active,
      })
      .returning();
    return ok(row, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
