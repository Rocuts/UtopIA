import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentWorkspaceId } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme';

// ---------------------------------------------------------------------------
// /api/pyme/uploads/[uploadId]/image — proxy con ownership check.
// ---------------------------------------------------------------------------
// Vercel Blob esta provisionado en modo `public` para MVP (la API privada
// requiere sign-on por request y complica el flujo OCR del extractor). Para
// mitigar el riesgo de URL adivinable:
//
//  1. El endpoint POST /api/pyme/uploads usa `addRandomSuffix: true` al subir,
//     asi la URL final tiene un sufijo aleatorio impredecible.
//  2. Este proxy permite servir la imagen via un path scoped a workspace —
//     el cliente nunca necesita saber la URL Blob real.
//
// Si la URL es `data:`, devolvemos los bytes parseados directo. Si es https
// (Blob), devolvemos un redirect 302. Esto NO es perfectamente privado (Blob
// public sigue siendo accesible si alguien obtiene la URL via header), pero
// reduce la superficie a (a) ingenieria social del enlace o (b) leak de
// referer. Deuda tecnica: migrar a Blob private post-MVP.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ uploadId: string }> };

const NOT_FOUND = new Response('Not Found', { status: 404 });

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { uploadId } = await ctx.params;

    const workspaceId = await getCurrentWorkspaceId();
    if (!workspaceId) return NOT_FOUND;

    const upload = await repo.getUpload(uploadId);
    if (!upload) return NOT_FOUND;

    const book = await repo.getBook(upload.bookId, workspaceId);
    if (!book) return NOT_FOUND;

    // Caso 1: data URL inline (fallback MVP cuando no hay Blob token).
    // Parseamos los bytes y los devolvemos con content-type apropiado.
    if (upload.imageUrl.startsWith('data:')) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(upload.imageUrl);
      if (!match) return NOT_FOUND;
      const [, mime, b64] = match;
      const buf = Buffer.from(b64, 'base64');
      return new Response(new Uint8Array(buf), {
        headers: {
          'content-type': mime,
          'cache-control': 'private, max-age=300',
        },
      });
    }

    // Caso 2: URL https de Blob. Redirect 302. La URL ya tiene sufijo random
    // por el upload, lo que minimiza adivinabilidad. El header `referrer-policy`
    // limita el leak del path al dominio receptor.
    return NextResponse.redirect(upload.imageUrl, {
      status: 302,
      headers: { 'referrer-policy': 'no-referrer' },
    });
  } catch (err) {
    console.error('[pyme/uploads/[uploadId]/image][GET]', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}
