import { NextResponse, type NextRequest } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme';
import { processUpload } from '@/lib/agents/pyme/orchestrator';
import { assertBookOwned, HttpError } from '../_lib/ownership';

// ---------------------------------------------------------------------------
// /api/pyme/uploads — POST: ingesta una foto de cuaderno y dispara OCR async.
// ---------------------------------------------------------------------------
// Flujo:
//  1. valida workspace + bookId + archivo (MIME, tamano).
//  2. persiste imagen en Vercel Blob si BLOB_READ_WRITE_TOKEN esta presente,
//     o como data URL inline en `image_url` si no (fallback MVP).
//  3. crea row `pyme_uploads` con ocrStatus='pending'.
//  4. dispara `processUpload(uploadId)` via `waitUntil` — corre fuera del
//     ciclo request/response (Vercel Fluid Compute lo mantiene vivo).
//  5. responde inmediato con uploadId + imageUrl. El cliente hace polling
//     a /api/pyme/uploads/[uploadId] hasta ocrStatus='done'.
//
// `maxDuration = 300` por si el filesystem-write a Blob tarda en frio o el
// archivo HEIC requiere transformacion lenta. La parte LLM corre en el
// `waitUntil` y NO bloquea el response.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
// Body cap para FormData: imagen (4MB) + overhead de boundaries y otros campos.
// 5MB cubre el escenario y rechaza payloads claramente abusivos antes de
// pagar el costo de leer el FormData.
const MAX_BODY_SIZE = 5 * 1024 * 1024;
// Limite por libro y ventana corta (spec §4.11). Cap de costo OCR.
const UPLOAD_RATE_WINDOW_MS = 60_000;
const UPLOAD_RATE_LIMIT = 5;
const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

// Magic-byte signatures por MIME. Defensa contra archivos con extension/MIME
// falsificado (un .exe renombrado a .jpg pasa el check de file.type pero falla
// aqui). Para contenedores ISO BMFF (HEIC/HEIF) los bytes 4-7 contienen
// 'ftyp' como marca generica del formato. WebP usa 'RIFF' al inicio (offset 0)
// y 'WEBP' en bytes 8-11; verificamos solo RIFF para mantener el check simple.
const MAGIC_SIGNATURES: Record<string, { offset: number; bytes: number[] }[]> = {
  'image/jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }],
  'image/webp': [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }],
  'image/heic': [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
  'image/heif': [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
};

function validMagicBytes(buf: Buffer, mime: string): boolean {
  const sigs = MAGIC_SIGNATURES[mime];
  if (!sigs || sigs.length === 0) return false;
  return sigs.some((sig) =>
    sig.bytes.every((b, i) => buf[sig.offset + i] === b),
  );
}

export async function POST(req: NextRequest) {
  try {
    // Body size guard ANTES de leer el FormData. content-length es informativo
    // pero la mayoria de clientes legitimos lo envian; rechazamos abuso temprano
    // sin pagar el costo de buffering.
    const contentLength = req.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_BODY_SIZE) {
      return NextResponse.json(
        { ok: false, error: 'payload_too_large' },
        { status: 413 },
      );
    }

    const ws = await getOrCreateWorkspace();
    const form = await req.formData();
    const bookId = form.get('bookId');
    const file = form.get('file');

    if (typeof bookId !== 'string' || !bookId) {
      return NextResponse.json(
        { ok: false, error: 'missing_book_id' },
        { status: 400 },
      );
    }
    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: 'missing_file' },
        { status: 400 },
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { ok: false, error: 'empty_file' },
        { status: 400 },
      );
    }
    if (file.size > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { ok: false, error: 'file_too_large' },
        { status: 413 },
      );
    }
    if (!ALLOWED_MIMES.has(file.type)) {
      return NextResponse.json(
        { ok: false, error: 'unsupported_mime' },
        { status: 415 },
      );
    }

    // Verifica ownership del libro antes de gastar bytes en Blob.
    await assertBookOwned(bookId, ws.id);

    // Rate limit: maximo 5 fotos por minuto por libro. Cap de costo OCR
    // (~$0.015/foto). Lo aplicamos despues del ownership-check para que
    // un caller foraneo no pueda enumerar libros via 429s.
    const recentCount = await repo.countRecentUploads(
      bookId,
      UPLOAD_RATE_WINDOW_MS,
    );
    if (recentCount >= UPLOAD_RATE_LIMIT) {
      return NextResponse.json(
        {
          ok: false,
          error: 'too_many_uploads',
          message: 'Maximo 5 fotos por minuto por libro. Intenta de nuevo en un momento.',
        },
        { status: 429 },
      );
    }

    // Lee el archivo una sola vez. Lo reusamos para magic-byte validation y
    // (si aplica) data URL fallback. En la rama de Blob, el File se reusa
    // directo — el doble read no aplica porque Blob recibe el File completo.
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!validMagicBytes(buffer, file.type)) {
      return NextResponse.json(
        { ok: false, error: 'invalid_file_signature' },
        { status: 415 },
      );
    }

    // Persistencia de imagen — Blob preferido, data URL fallback.
    let imageUrl: string;
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import('@vercel/blob');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      // `addRandomSuffix: true` es CRITICO: Blob esta en modo `public` para
      // MVP (la API privada requiere sign-on por request) y un nombre
      // determinista permite enumerar fotos de otros libros si un caller
      // adivina UUIDs. El sufijo random hace la URL no-adivinable. Deuda
      // tecnica documentada en docs/PYME_MODULE_TODO.md: migrar a Blob
      // privado o servir todo via /api/pyme/uploads/[id]/image.
      const key = `pyme/${ws.id}/${crypto.randomUUID()}-${safeName}`;
      const blob = await put(key, buffer, {
        access: 'public',
        addRandomSuffix: true,
        contentType: file.type,
      });
      imageUrl = blob.url;
    } else {
      imageUrl = `data:${file.type};base64,${buffer.toString('base64')}`;
    }

    const upload = await repo.createUpload({
      bookId,
      imageUrl,
      mimeType: file.type,
      pageCount: 1,
      ocrStatus: 'pending',
    });

    // Dispara OCR fuera del ciclo request/response. Cualquier error se loguea
    // — el row de pyme_uploads queda en `failed` (responsabilidad del
    // orchestrator setear el status correcto en su propio catch).
    waitUntil(
      processUpload(upload.id).catch((err) => {
        console.error('[pyme] processUpload failed:', err);
      }),
    );

    return NextResponse.json(
      {
        ok: true,
        uploadId: upload.id,
        imageUrl,
        status: 'pending',
      },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.status },
      );
    }
    console.error('[pyme/uploads][POST]', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'internal_error',
      },
      { status: 500 },
    );
  }
}
