import { NextResponse, type NextRequest } from 'next/server';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { assertBookOwned, HttpError } from '../../_lib/ownership';

// ---------------------------------------------------------------------------
// /api/pyme/books/[bookId] — recurso individual.
// ---------------------------------------------------------------------------
// GET: devuelve el libro si pertenece al workspace activo, 404 si no.
//
// TODO: PATCH (renombrar, cambiar currency) y DELETE en una iteracion futura.
//   Por ahora el MVP solo permite crear y listar; la UI no expone edicion.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

// Next.js 16 — params es Promise.
type RouteContext = { params: Promise<{ bookId: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { bookId } = await ctx.params;
    const ws = await getOrCreateWorkspace();
    const book = await assertBookOwned(bookId, ws.id);
    return NextResponse.json({ ok: true, book });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.status },
      );
    }
    console.error('[pyme/books/[bookId]][GET]', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'internal_error',
      },
      { status: 500 },
    );
  }
}
