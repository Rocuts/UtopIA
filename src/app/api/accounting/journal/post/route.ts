// ---------------------------------------------------------------------------
// POST /api/accounting/journal/post
// Body: { entryId: uuid }
// Effect: flip a 'draft' journal entry to 'posted'. Idempotent only insofar
// as a second call on a posted entry returns 409 ENTRY_NOT_DRAFT.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';

import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { postEntry } from '@/lib/accounting/double-entry';
import { postEntryBodySchema } from '@/lib/validation/accounting-schemas';

import { badRequestZod, errorResponse, ok } from '../../_shared';

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
  const parsed = postEntryBodySchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const result = await postEntry({
      entryId: parsed.data.entryId,
      workspaceId: ws.id,
    });
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
