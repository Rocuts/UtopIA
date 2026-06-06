import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme';
import { assertBookOwned, HttpError } from '../../_lib/ownership';

// ---------------------------------------------------------------------------
// /api/pyme/books/[bookId] — recurso individual.
// ---------------------------------------------------------------------------
// GET:    devuelve el libro si pertenece al workspace activo, 404 si no.
// PATCH:  renombra el libro y/o cambia la moneda.
// DELETE: elimina el libro y todos sus entries (FK ON DELETE CASCADE).
// ---------------------------------------------------------------------------

type RouteContext = { params: Promise<{ bookId: string }> };

function handleError(err: unknown, tag: string): NextResponse {
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { ok: false, error: 'validation_error', details: err.issues },
      { status: 400 },
    );
  }
  if (err instanceof HttpError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  }
  console.error(tag, err);
  return NextResponse.json(
    { ok: false, error: err instanceof Error ? err.message : 'internal_error' },
    { status: 500 },
  );
}

const patchBookSchema = z.object({
  name:     z.string().min(1).max(120).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
}).refine((d) => d.name !== undefined || d.currency !== undefined, {
  message: 'At least one field (name or currency) must be provided',
});

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { bookId } = await ctx.params;
    const ws = await getOrCreateWorkspace();
    const book = await assertBookOwned(bookId, ws.id);
    return NextResponse.json({ ok: true, book });
  } catch (err) {
    return handleError(err, '[pyme/books/[bookId]][GET]');
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { bookId } = await ctx.params;
    const ws = await getOrCreateWorkspace();
    // Verify ownership first so unknown books return 404, not silent no-op.
    await assertBookOwned(bookId, ws.id);

    const json = await req.json();
    const body = patchBookSchema.parse(json);
    const updated = await repo.updateBook(bookId, ws.id, body);
    if (!updated) {
      return NextResponse.json({ ok: false, error: 'book_not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, book: updated });
  } catch (err) {
    return handleError(err, '[pyme/books/[bookId]][PATCH]');
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const { bookId } = await ctx.params;
    const ws = await getOrCreateWorkspace();
    const deleted = await repo.deleteBook(bookId, ws.id);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: 'book_not_found' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleError(err, '[pyme/books/[bookId]][DELETE]');
  }
}
