import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme';
import {
  createEntryBodySchema,
  listEntriesQuerySchema,
} from '@/lib/validation/pyme-schemas';
import { assertBookOwned, HttpError } from '../_lib/ownership';
import type { PymeEntry } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// /api/pyme/entries — listado y creacion manual.
// ---------------------------------------------------------------------------
// GET:  query params (bookId, status, kind, fromDate, toDate, limit, offset).
//       Verifica ownership del libro antes de listar.
// POST: crea una entry manual (para correcciones cuando el usuario tipea
//       directamente sin pasar por OCR).
//
// `numeric` columns en Postgres llegan como strings desde drizzle-orm/neon-http.
// Las convertimos a number antes de devolver al cliente para que la UI pueda
// formatearlas con `.toLocaleString` sin coercion silenciosa.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

// JSON endpoints: 64KB es ampliamente suficiente para crear un entry manual.
const MAX_JSON_BODY = 64 * 1024;

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

export async function GET(req: NextRequest) {
  try {
    const ws = await getOrCreateWorkspace();
    const url = new URL(req.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const query = listEntriesQuerySchema.parse(params);

    await assertBookOwned(query.bookId, ws.id);

    const entries = await repo.listEntries({
      bookId: query.bookId,
      status: query.status,
      kind: query.kind,
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
      limit: query.limit,
      offset: query.offset,
    });

    return NextResponse.json({
      ok: true,
      entries: entries.map(serializeEntry),
    });
  } catch (err) {
    return handleError(err, '[pyme/entries][GET]');
  }
}

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
    const body = createEntryBodySchema.parse(json);

    await assertBookOwned(body.bookId, ws.id);

    const [created] = await repo.insertEntries([
      {
        bookId: body.bookId,
        // `entryDate` es ISO date `YYYY-MM-DD`. `new Date(s)` lo trata como
        // UTC midnight, suficiente para agregaciones por mes (drizzle escribe
        // `timestamptz`). El usuario nunca elige hora.
        entryDate: new Date(body.entryDate),
        description: body.description,
        kind: body.kind,
        // `numeric` en drizzle-orm acepta string; convertimos para
        // preservar precision decimal exacta. JS number -> string vuelve
        // ronda a la representacion canonica de toString.
        amount: String(body.amount),
        category: body.category ?? null,
        pucHint: body.pucHint ?? null,
        status: body.status,
      },
    ]);

    return NextResponse.json(
      { ok: true, entry: serializeEntry(created) },
      { status: 201 },
    );
  } catch (err) {
    return handleError(err, '[pyme/entries][POST]');
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
