// ---------------------------------------------------------------------------
// POST /api/accounting/journal/reverse
// Body: { originalEntryId: uuid, reason: string, entryDate?: ISO string }
// Effect:
//   1. Locks the original (must be 'posted', not already reversed).
//   2. Creates a new posted entry with `sourceType='reversal'` and inverted
//      debit/credit on each line; metadata records the reason and origin.
//   3. Marks original.status='reversed' and original.reversedByEntryId=new.id.
// Both happen in a single serializable transaction.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';

import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { reverseEntry } from '@/lib/accounting/double-entry';
import { reverseEntryBodySchema } from '@/lib/validation/accounting-schemas';

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
  const parsed = reverseEntryBodySchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const result = await reverseEntry({
      originalEntryId: parsed.data.originalEntryId,
      workspaceId: ws.id,
      reason: parsed.data.reason,
      entryDate: parsed.data.entryDate
        ? new Date(parsed.data.entryDate)
        : undefined,
    });
    return ok(result, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
