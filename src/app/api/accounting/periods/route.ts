// ---------------------------------------------------------------------------
// /api/accounting/periods
//
// GET   ?year=YYYY  → list periods for the workspace (optional year filter)
// POST  body { year, month, startsAt?, endsAt? } → create a new 'open' period
//
// Subroutes for state transitions live under periods/close, periods/lock,
// periods/reopen.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { accountingPeriods } from '@/lib/db/schema';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { createPeriodBodySchema } from '@/lib/validation/accounting-schemas';

import {
  badRequestZod,
  computePeriodBoundaries,
  errorResponse,
  ok,
} from '../_shared';

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const yearStr = url.searchParams.get('year');
    const year = yearStr ? Number(yearStr) : null;
    if (yearStr && (!Number.isFinite(year) || (year as number) < 2000 || (year as number) > 2099)) {
      return NextResponse.json(
        { error: 'invalid_year' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const ws = await getOrCreateWorkspace();
    const db = getDb();

    const conditions = [eq(accountingPeriods.workspaceId, ws.id)];
    if (year) conditions.push(eq(accountingPeriods.year, year));

    const rows = await db
      .select()
      .from(accountingPeriods)
      .where(and(...conditions))
      .orderBy(accountingPeriods.year, accountingPeriods.month);

    return ok({ periods: rows });
  } catch (err) {
    return errorResponse(err);
  }
}

// ─── POST ──────────────────────────────────────────────────────────────────

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
  const parsed = createPeriodBodySchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();

    const explicitStart = parsed.data.startsAt
      ? new Date(parsed.data.startsAt)
      : null;
    const explicitEnd = parsed.data.endsAt
      ? new Date(parsed.data.endsAt)
      : null;
    const computed = computePeriodBoundaries(parsed.data.year, parsed.data.month);

    const startsAt = explicitStart ?? computed.startsAt;
    const endsAt = explicitEnd ?? computed.endsAt;

    const [created] = await db
      .insert(accountingPeriods)
      .values({
        workspaceId: ws.id,
        year: parsed.data.year,
        month: parsed.data.month,
        startsAt,
        endsAt,
        status: 'open',
      })
      .returning();

    return ok({ period: created }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
