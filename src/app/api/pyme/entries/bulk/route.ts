import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme';
import { bulkConfirmBodySchema } from '@/lib/validation/pyme-schemas';
import { assertBookOwned, HttpError } from '../../_lib/ownership';
import { requireAuthSession } from '@/lib/auth/require-session';

// ---------------------------------------------------------------------------
// PATCH /api/pyme/entries/bulk — confirma todos los drafts de un libro.
// ---------------------------------------------------------------------------
// Recibe { bookId } y actualiza todos los entries con status='draft' a
// status='confirmed' en una sola query atómica. Devuelve { ok, confirmed }.
// Útil para el flujo "revisar y aprobar todo" de la UI PYME.
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const ws = await getOrCreateWorkspace();
    const json = await req.json();
    const body = bulkConfirmBodySchema.parse(json);

    await assertBookOwned(body.bookId, ws.id);

    const confirmed = await repo.bulkConfirmEntries(body.bookId, body.uploadId);

    return NextResponse.json({ ok: true, confirmed });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: 'invalid_input', details: err.flatten() },
        { status: 400 },
      );
    }
    if (err instanceof HttpError) {
      return NextResponse.json(
        { ok: false, error: (err as HttpError).message },
        { status: (err as HttpError).status },
      );
    }
    console.error('[pyme/entries/bulk][PATCH]', err);
    return NextResponse.json(
      { ok: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}
