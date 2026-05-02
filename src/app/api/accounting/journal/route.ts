// ---------------------------------------------------------------------------
// /api/accounting/journal
//
// POST   → create a journal entry (status: 'draft' | 'posted')
// GET    → fetch entry by ?id=<uuid>, OR list entries when ?id is absent
//
// Tenant scoping: cookie-driven via getOrCreateWorkspace() (same model as
// every other anonymous-tenant endpoint in this codebase). Every accounting
// query is scoped by `workspace_id`.
//
// Subroute handlers for posting, reversing and voiding live in
// `journal/post/`, `journal/reverse/`, `journal/void/`.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';

import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  createEntry,
  getEntryWithLines,
  listEntries,
} from '@/lib/accounting/double-entry';
import {
  createEntryBodySchema,
  listEntriesQuerySchema,
} from '@/lib/validation/accounting-schemas';

import { badRequestZod, errorResponse, ok } from '../_shared';

export const runtime = 'nodejs';
// Mutating endpoints must never be cached.
export const dynamic = 'force-dynamic';

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

  const parsed = createEntryBodySchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const result = await createEntry({
      workspaceId: ws.id,
      periodId: parsed.data.periodId,
      entryDate: new Date(parsed.data.entryDate),
      description: parsed.data.description,
      sourceType: parsed.data.sourceType,
      sourceId: parsed.data.sourceId ?? null,
      sourceRef: parsed.data.sourceRef ?? null,
      status: parsed.data.status,
      metadata: parsed.data.metadata ?? null,
      lines: parsed.data.lines.map((l) => ({
        accountId: l.accountId,
        thirdPartyId: l.thirdPartyId ?? null,
        costCenterId: l.costCenterId ?? null,
        debit: l.debit,
        credit: l.credit,
        currency: l.currency,
        exchangeRate: l.exchangeRate,
        description: l.description ?? null,
        dimensions: l.dimensions ?? null,
      })),
    });
    return ok(result, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  try {
    const ws = await getOrCreateWorkspace();

    if (id) {
      // Single fetch
      const result = await getEntryWithLines(id, ws.id);
      return ok(result);
    }

    // List mode
    const parsed = listEntriesQuerySchema.safeParse({
      periodId: url.searchParams.get('periodId') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      offset: url.searchParams.get('offset') ?? undefined,
    });
    if (!parsed.success) return badRequestZod(parsed.error);

    const result = await listEntries({
      workspaceId: ws.id,
      periodId: parsed.data.periodId,
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
