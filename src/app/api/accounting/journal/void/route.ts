// ---------------------------------------------------------------------------
// POST /api/accounting/journal/void
// Body: { entryId: uuid }
// Effect: physically delete a 'draft' entry. Posted entries are immutable
// — use /journal/reverse instead.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';

import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { voidDraft } from '@/lib/accounting/double-entry';
import { voidDraftBodySchema } from '@/lib/validation/accounting-schemas';

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
  const parsed = voidDraftBodySchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const result = await voidDraft({
      entryId: parsed.data.entryId,
      workspaceId: ws.id,
    });
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
