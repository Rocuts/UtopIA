import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentWorkspaceId } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme';

// ---------------------------------------------------------------------------
// /api/pyme/uploads/[uploadId] — GET status del OCR.
// ---------------------------------------------------------------------------
// El cliente hace polling cada ~2s a este endpoint hasta que `ocrStatus`
// pase a `done` o `failed`. Cuando llega a `done`, el cliente lee
// /api/pyme/entries?bookId=...&status=draft para mostrar la review tabla.
//
// Tenant scoping: `repo.getUpload` no filtra por workspaceId (no expone esa
// firma — un upload solo tiene FK a `pyme_books`). Para evitar leak de
// existencia entre workspaces hacemos el cruce manualmente: leemos el
// upload, leemos su libro con `getBook(bookId, ws.id)`, y si ese libro no
// pertenece al workspace activo devolvemos 404 (NUNCA 403, asi un caller
// foraneo no aprende que el uploadId existe en otro tenant).
//
// `getCurrentWorkspaceId` lee la cookie sin crear workspace nuevo — si no
// hay cookie, no hay ownership posible -> 404.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

// Si un upload lleva mas de 5 minutos en `processing` (max maxDuration=300s
// del route POST), asumimos que el waitUntil murio antes de actualizar el
// estado. Reportamos `failed` al cliente para que pueda reintentar sin tocar
// la DB (otra escritura aqui podria pisar un waitUntil tardio que finalmente
// completa). Si eventualmente el waitUntil acaba, su update gana y el
// siguiente poll mostrara el estado real.
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

type RouteContext = { params: Promise<{ uploadId: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { uploadId } = await ctx.params;

    const workspaceId = await getCurrentWorkspaceId();
    if (!workspaceId) {
      return NextResponse.json(
        { ok: false, error: 'upload_not_found' },
        { status: 404 },
      );
    }

    const upload = await repo.getUpload(uploadId);
    if (!upload) {
      return NextResponse.json(
        { ok: false, error: 'upload_not_found' },
        { status: 404 },
      );
    }

    // Verifica que el libro al que pertenezca el upload este en este workspace.
    const book = await repo.getBook(upload.bookId, workspaceId);
    if (!book) {
      return NextResponse.json(
        { ok: false, error: 'upload_not_found' },
        { status: 404 },
      );
    }

    // Detecta uploads "stuck" en processing por mas del threshold y los reporta
    // como failed AL CLIENTE (no escribe a DB para evitar race con un waitUntil
    // que finalmente completa).
    const isStuck =
      upload.ocrStatus === 'processing' &&
      Date.now() - upload.createdAt.getTime() > STUCK_THRESHOLD_MS;

    const ocrStatus = isStuck ? 'failed' : upload.ocrStatus;
    const errorMessage = isStuck
      ? 'processing_timeout'
      : upload.errorMessage;

    // No devolvemos `imageUrl` si es data URL inline — el cliente ya tiene la
    // preview local desde el momento del upload, no necesita re-recibir 4MB
    // base64 en cada poll. Para Blob (https) sí la devolvemos por compatibilidad
    // con la UI legacy; ademas hay un proxy en /api/pyme/uploads/[id]/image
    // para servirla con ownership-check si hace falta.
    const safeImageUrl = upload.imageUrl.startsWith('data:')
      ? null
      : upload.imageUrl;

    return NextResponse.json({
      ok: true,
      upload: {
        id: upload.id,
        bookId: upload.bookId,
        ocrStatus,
        errorMessage,
        imageUrl: safeImageUrl,
        mimeType: upload.mimeType,
        pageCount: upload.pageCount,
        createdAt: upload.createdAt,
      },
    });
  } catch (err) {
    console.error('[pyme/uploads/[uploadId]][GET]', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'internal_error',
      },
      { status: 500 },
    );
  }
}
