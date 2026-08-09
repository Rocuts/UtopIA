import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_SIZE } from '@/lib/validation/schemas';
import { requireAuthSession } from '@/lib/auth/require-session';
import { requireWorkspace } from '@/lib/db/workspace';

// La generacion del token es liviana — no toca el binario del archivo.
// El cliente (`@vercel/blob/client` `upload()`) sube el archivo DIRECTO al
// store; esta ruta solo firma el token y valida la extension.
export const maxDuration = 60;

/**
 * Tipos MIME aceptados por el token de subida directa. Cubre todas las
 * extensiones de ALLOWED_UPLOAD_EXTENSIONS. `application/octet-stream` es el
 * fallback porque varios navegadores no envian MIME para `.csv` / `.md`.
 */
const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/csv',
  'text/plain',
  'text/markdown',
  'application/json',
  'application/xml',
  'text/xml',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/heic',
  'application/octet-stream', // fallback: navegadores sin MIME para .csv/.md
];

/**
 * MIME concretos por extension. La lista global de arriba autoriza CUALQUIER
 * tipo para CUALQUIER extension (un `.png` firmado podia subir un `text/xml`);
 * acotarla por extension recorta esa holgura sin cambiar el flujo del cliente.
 *
 * `application/octet-stream` se mantiene para todo lo que no sea una imagen
 * web clasica: los navegadores lo emiten cuando el SO no tiene el tipo
 * registrado — `.csv` / `.md` siempre, y `.xlsx` / `.doc` en Windows sin
 * Office. Quitarlo de esas extensiones rompe subidas reales. El contenido se
 * revalida igual por magic bytes en POST /api/upload antes de parsearse.
 */
const CONTENT_TYPES_BY_EXT: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.xls': ['application/vnd.ms-excel'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.csv': ['text/csv', 'text/plain'],
  '.txt': ['text/plain'],
  '.md': ['text/markdown', 'text/plain'],
  '.json': ['application/json', 'text/plain'],
  '.xml': ['application/xml', 'text/xml', 'text/plain'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.tiff': ['image/tiff'],
  '.tif': ['image/tiff'],
  '.bmp': ['image/bmp'],
  '.heic': ['image/heic'],
};

/** Imagenes que todo navegador tipa bien: no necesitan el fallback binario. */
const EXTS_WITHOUT_OCTET_STREAM_FALLBACK = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
]);

function allowedContentTypesFor(ext: string): string[] {
  const specific = CONTENT_TYPES_BY_EXT[ext];
  if (!specific) return ALLOWED_CONTENT_TYPES;
  return EXTS_WITHOUT_OCTET_STREAM_FALLBACK.has(ext)
    ? specific
    : [...specific, 'application/octet-stream'];
}

/**
 * POST /api/upload/blob-token
 *
 * Firma un token de subida directa a Vercel Blob via `handleUpload`. El
 * cliente sube el archivo SIN pasar por el body de la Function — esto evita
 * el 413 de plataforma para bodies >4.5MB y habilita archivos hasta 100MB.
 *
 * Requiere `BLOB_READ_WRITE_TOKEN` en el entorno. Sin esa variable
 * `handleUpload` falla y se devuelve un 400 con mensaje claro en espanol.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  const workspace = await requireWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname /*, clientPayload */) => {
        const ext = '.' + (pathname.split('.').pop() ?? '').toLowerCase();
        if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
          throw new Error(`Tipo de archivo no soportado: ${ext}`);
        }
        // El `pathname` lo elige el CLIENTE y `handleUpload` no permite
        // reescribirlo desde este callback: es el unico punto donde se puede
        // acotar. Sin acotarlo, cualquier sesion firma un token que escribe
        // bytes arbitrarios dentro del namespace de OTRO tenant del store
        // compartido (p.ej. `pyme/<uuid-ajeno>/soporte-dian.pdf`), que a ojo
        // humano queda indistinguible de un archivo legitimo de esa empresa.
        // Regla: o el nombre es plano (lo que sube hoy `uploadDocument`, que
        // pasa `file.name`), o va bajo el prefijo del propio workspace.
        const scopedPrefix = `u/${workspace.id}/`;
        const traversal = pathname.startsWith('/') || pathname.split('/').includes('..');
        const foreignPrefix = pathname.includes('/') && !pathname.startsWith(scopedPrefix);
        if (traversal || foreignPrefix) {
          throw new Error('Ruta de destino no autorizada.');
        }
        return {
          allowedContentTypes: allowedContentTypesFor(ext),
          maximumSizeInBytes: MAX_UPLOAD_SIZE,
          addRandomSuffix: true,
          // Deja rastro del dueno del blob en el token: `onUploadCompleted` lo
          // recibe firmado y permite auditar/cobrar por workspace.
          tokenPayload: JSON.stringify({ workspaceId: workspace.id }),
        };
      },
      // No-op: el cliente llama POST /api/upload directamente con el blobUrl
      // para procesar el documento (extraccion + RAG + clasificacion).
      onUploadCompleted: async () => {
        /* intencionalmente vacio */
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Error generando token de subida';
    // Mensaje extra si falta la configuracion del Blob store.
    const hint = !process.env.BLOB_READ_WRITE_TOKEN
      ? ' (falta configurar BLOB_READ_WRITE_TOKEN — provisione un Blob store en Vercel)'
      : '';
    return NextResponse.json({ error: message + hint }, { status: 400 });
  }
}
