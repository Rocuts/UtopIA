import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_SIZE } from '@/lib/validation/schemas';

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
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_SIZE,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({}),
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
