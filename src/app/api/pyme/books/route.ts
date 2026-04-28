import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme';
import { createBookBodySchema } from '@/lib/validation/pyme-schemas';
import { HttpError } from '../_lib/ownership';

// ---------------------------------------------------------------------------
// /api/pyme/books — coleccion de libros del workspace.
// ---------------------------------------------------------------------------
// POST: crea un libro nuevo.
// GET:  lista todos los libros del workspace activo.
//
// Ambas operaciones son rapidas (1 sola consulta a Postgres). No requieren
// `maxDuration` extendido — usamos el default (60s).
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

// JSON endpoints: 64KB es suficiente para cualquier payload legitimo
// (createBook tiene 2 campos chicos). Rechazamos abuso antes de parsear.
const MAX_JSON_BODY = 64 * 1024;

export async function POST(req: NextRequest) {
  try {
    const contentLength = req.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_JSON_BODY) {
      return NextResponse.json(
        { ok: false, error: 'payload_too_large' },
        { status: 413 },
      );
    }

    const ws = await getOrCreateWorkspace();
    const json = await req.json();
    const body = createBookBodySchema.parse(json);

    const book = await repo.createBook({
      workspaceId: ws.id,
      name: body.name,
      currency: body.currency,
    });

    return NextResponse.json({ ok: true, book }, { status: 201 });
  } catch (err) {
    return handleError(err, '[pyme/books][POST]');
  }
}

export async function GET() {
  try {
    const ws = await getOrCreateWorkspace();
    const books = await repo.listBooks(ws.id);
    return NextResponse.json({ ok: true, books });
  } catch (err) {
    return handleError(err, '[pyme/books][GET]');
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
