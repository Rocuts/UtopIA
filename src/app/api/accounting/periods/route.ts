// ---------------------------------------------------------------------------
// /api/accounting/periods
//
// GET   ?year=YYYY  → list periods for the workspace (optional year filter)
// POST  body { year, month, startsAt?, endsAt? } → create a new 'open' period
//       Rangos disjuntos (contab-nomina-26, mismas reglas que
//       createPeriodAction): 400 `invalid_period_range` si el período 13 trae
//       fechas distintas del instante canónico de fin de año o si el rango
//       final queda invertido; 409 `period_overlap` si se solapa con otro mes.
//
// Subroutes for state transitions live under periods/close, periods/lock,
// periods/reopen.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { accountingPeriods } from '@/lib/db/schema';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  findOverlappingPeriod,
  isCanonicalYearEndRange,
  YEAR_END_ADJUSTMENTS_MONTH,
} from '@/lib/accounting/periods/ranges';
import { createPeriodBodySchema } from '@/lib/validation/accounting-schemas';
import { requireAuthSession } from '@/lib/auth/require-session';

import {
  badRequestZod,
  computePeriodBoundaries,
  errorResponse,
  ok,
} from '../_shared';

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

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
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

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

    // contab-nomina-26: el período 13 vive sólo en el instante canónico de
    // fin de año y los meses 1–12 no se solapan (periods/ranges.ts).
    if (
      parsed.data.month === YEAR_END_ADJUSTMENTS_MONTH &&
      !isCanonicalYearEndRange(parsed.data.year, startsAt, endsAt)
    ) {
      return NextResponse.json(
        {
          error: 'invalid_period_range',
          message:
            'El periodo 13 (ajustes de cierre) no admite fechas explicitas: vive en el 31 de diciembre 23:59:59.',
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (startsAt.getTime() > endsAt.getTime()) {
      return NextResponse.json(
        { error: 'invalid_period_range', message: 'startsAt debe ser <= endsAt.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const existing = await db
      .select({
        id: accountingPeriods.id,
        year: accountingPeriods.year,
        month: accountingPeriods.month,
        startsAt: accountingPeriods.startsAt,
        endsAt: accountingPeriods.endsAt,
      })
      .from(accountingPeriods)
      .where(eq(accountingPeriods.workspaceId, ws.id));
    const overlap = findOverlappingPeriod(
      { year: parsed.data.year, month: parsed.data.month, startsAt, endsAt },
      existing,
    );
    if (overlap) {
      return NextResponse.json(
        {
          error: 'period_overlap',
          message:
            `El rango se solapa con el periodo ${overlap.year}-${String(overlap.month).padStart(2, '0')} ` +
            'del workspace. Los periodos contables deben ser disjuntos.',
        },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }

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
