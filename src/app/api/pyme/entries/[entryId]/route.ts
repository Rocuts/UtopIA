import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme';
import { patchEntryBodySchema } from '@/lib/validation/pyme-schemas';
import { HttpError } from '../../_lib/ownership';
import type { PymeEntry } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// /api/pyme/entries/[entryId] — recurso individual.
// ---------------------------------------------------------------------------
// PATCH:  edita campos del entry. Verifica que el entry exista Y que su libro
//         pertenezca al workspace activo. Lo opuesto devuelve 404 (no 403).
// DELETE: elimina el entry. Misma verificacion. 204 No Content si OK.
//
// Tenant scoping atomico: usamos `updateEntryScoped` / `deleteEntryScoped` que
// filtran por `bookId IN (libros_del_workspace)` en una sola query. Esto cierra
// la ventana TOCTOU del patron previo (SELECT entry -> SELECT book -> UPDATE
// entry, durante la cual un actor podia mover el entry entre libros). Si la
// query devuelve 0 rows, respondemos 404 — uniforme entre "no existe" y "no es
// tuyo" para no filtrar existencia entre tenants.
// ---------------------------------------------------------------------------

const MAX_JSON_BODY = 64 * 1024;

type RouteContext = { params: Promise<{ entryId: string }> };

interface SerializedEntry extends Omit<PymeEntry, 'amount' | 'confidence'> {
  amount: number;
  confidence: number | null;
}

function serializeEntry(e: PymeEntry): SerializedEntry {
  return {
    ...e,
    amount: Number(e.amount),
    confidence: e.confidence === null ? null : Number(e.confidence),
  };
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const contentLength = req.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_JSON_BODY) {
      return NextResponse.json(
        { ok: false, error: 'payload_too_large' },
        { status: 413 },
      );
    }

    const { entryId } = await ctx.params;
    const ws = await getOrCreateWorkspace();
    const json = await req.json();
    const body = patchEntryBodySchema.parse(json);

    // Convertimos `entryDate` (string ISO) -> Date y `amount` (number) ->
    // string para drizzle numeric. Solo seteamos lo que vino.
    const patch: Parameters<typeof repo.updateEntryScoped>[2] = {};
    if (body.entryDate !== undefined) patch.entryDate = new Date(body.entryDate);
    if (body.description !== undefined) patch.description = body.description;
    if (body.kind !== undefined) patch.kind = body.kind;
    if (body.amount !== undefined) patch.amount = String(body.amount);
    if (body.category !== undefined) patch.category = body.category ?? null;
    if (body.pucHint !== undefined) patch.pucHint = body.pucHint ?? null;
    if (body.status !== undefined) patch.status = body.status;

    const ownedBookIds = await repo.listBookIds(ws.id);
    const updated = await repo.updateEntryScoped(entryId, ownedBookIds, patch);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: 'entry_not_found' },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      entry: serializeEntry(updated),
    });
  } catch (err) {
    return handleError(err, '[pyme/entries/[entryId]][PATCH]');
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const { entryId } = await ctx.params;
    const ws = await getOrCreateWorkspace();

    const ownedBookIds = await repo.listBookIds(ws.id);
    const deleted = await repo.deleteEntryScoped(entryId, ownedBookIds);
    if (!deleted) {
      return NextResponse.json(
        { ok: false, error: 'entry_not_found' },
        { status: 404 },
      );
    }
    // 204 No Content — convencion para deletes exitosos.
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleError(err, '[pyme/entries/[entryId]][DELETE]');
  }
}

function handleError(err: unknown, tag: string) {
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { ok: false, error: 'invalid_input', details: err.flatten() },
      { status: 400 },
    );
  }
  if (err instanceof HttpError) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: err.status },
    );
  }
  console.error(tag, err);
  return NextResponse.json(
    { ok: false, error: err instanceof Error ? err.message : 'internal_error' },
    { status: 500 },
  );
}
