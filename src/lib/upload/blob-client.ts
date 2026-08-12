// ---------------------------------------------------------------------------
// Blob upload client helper — shared by every client component that uploads
// documents to UtopIA.
//
// Hay DOS caminos, elegidos por tamaño del archivo:
//
//   A. Archivos pequeños (<= DIRECT_UPLOAD_MAX_BYTES) → POST multipart/form-data
//      directo a /api/upload. Cabe en el body de la Function, así que no hace
//      falta Blob: un solo round-trip y CERO dependencia de infraestructura
//      externa. Esto es lo que salva el wizard NIIF: un balance de prueba real
//      pesa pocos KB, y hacerlo pasar por Blob significaba que si el store no
//      está provisionado (sin BLOB_READ_WRITE_TOKEN) la subida moría en el
//      paso 1 con un 400 y la pipeline completa nunca arrancaba.
//
//   B. Archivos grandes (> DIRECT_UPLOAD_MAX_BYTES) → flujo Blob en 2 pasos,
//      porque el body de una Function de Vercel está limitado a 4.5 MB y un
//      POST directo devolvería 413 de plataforma (ni siquiera llega al handler):
//        1. Subida DIRECTA del archivo a Vercel Blob (hasta 100 MB), autorizada
//           por POST /api/upload/blob-token (`handleUpload` de @vercel/blob/client).
//        2. POST /api/upload con body JSON { blobUrl, context, filename } — el
//           servidor descarga el blob por URL y lo procesa (OCR, RAG, preprocesado).
//
// Ambos caminos devuelven exactamente el mismo `UploadDocumentResult` (el
// servidor responde con `processDocument()` serializado en los dos branches),
// de modo que los callers no distinguen cuál se usó.
//
// Este módulo es .ts puro; NO lleva 'use client' pero SOLO debe importarse
// desde componentes cliente (usa `upload` de @vercel/blob/client).
// ---------------------------------------------------------------------------

import { upload } from '@vercel/blob/client';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

export interface UploadDocumentResult {
  success: boolean;
  filename: string;
  chunks: number;
  extractedText: string;
  validationReport?: string;
  detectedCaseType: string | null;
  isTrialBalance: boolean;
  preprocessed: PreprocessedBalance | null;
  detectedPeriods: string[];
  message: string;
}

/**
 * Límite duro documentado del body de una Function de Vercel: 4.5 MB. Por
 * encima, la plataforma corta la request con 413 antes de invocar el handler.
 */
const VERCEL_FUNCTION_BODY_LIMIT_BYTES = Math.floor(4.5 * 1024 * 1024);

/**
 * Umbral de enrutamiento: 4 MB. Deja ~0.5 MB de holgura sobre el límite duro
 * para el overhead del sobre multipart (boundaries, headers de parte, el campo
 * `context`) y para el redondeo entre `file.size` y los bytes realmente
 * transmitidos. Un archivo de exactamente 4.4 MB podría pasarse de 4.5 MB una
 * vez empaquetado; con 4 MB eso no ocurre.
 */
export const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Sube un archivo y pide a /api/upload que lo procese.
 *
 * Pequeño → POST multipart directo. Grande → Vercel Blob + procesado por URL.
 *
 * @param file       Archivo a subir.
 * @param context    Contexto del documento (normalmente `file.name`).
 * @param onProgress Recibe 0..100 durante la subida.
 */
export async function uploadDocument(
  file: File,
  context: string,
  onProgress?: (pct: number) => void,
): Promise<UploadDocumentResult> {
  if (file.size <= DIRECT_UPLOAD_MAX_BYTES) {
    return uploadDirect(file, context, onProgress);
  }

  try {
    return await uploadViaBlob(file, context, onProgress);
  } catch (error) {
    // Blob no está disponible (típicamente falta BLOB_READ_WRITE_TOKEN y
    // /api/upload/blob-token responde 400). Si el archivo aún cabe en el body
    // de la Function reintentamos por el camino directo: aquí ya renunciamos a
    // la holgura del umbral porque la alternativa es un fallo seguro — un 413
    // improbable es mejor que no intentarlo.
    if (file.size <= VERCEL_FUNCTION_BODY_LIMIT_BYTES) {
      return uploadDirect(file, context, onProgress);
    }
    throw new Error(blobUnavailableMessage(file, error));
  }
}

/**
 * Camino directo — multipart/form-data con los campos `file` y `context`, tal
 * como los lee el branch legado de /api/upload (`formData.get('file')`).
 *
 * No fijamos Content-Type a mano: el navegador debe añadir el `boundary` del
 * multipart. Si lo escribiéramos nosotros, el servidor no podría parsear el body.
 */
async function uploadDirect(
  file: File,
  context: string,
  onProgress?: (pct: number) => void,
): Promise<UploadDocumentResult> {
  onProgress?.(0);

  const form = new FormData();
  form.append('file', file);
  form.append('context', context);

  // No hay eventos de progreso reales con fetch(): el archivo es pequeño y la
  // subida es un único round-trip, así que reportamos hitos para que la UI del
  // wizard no se quede congelada en 0.
  onProgress?.(50);

  const res = await fetch('/api/upload', { method: 'POST', body: form });
  const result = await readUploadResponse(res);

  onProgress?.(100);
  return result;
}

/** Camino Blob en 2 pasos — para archivos que no caben en el body. */
async function uploadViaBlob(
  file: File,
  context: string,
  onProgress?: (pct: number) => void,
): Promise<UploadDocumentResult> {
  // 1. Subida directa a Blob — el token lo emite /api/upload/blob-token.
  //    `multipart: true` parte el archivo, sube las partes en paralelo y
  //    reintenta las que fallen — crítico para archivos grandes (hasta 100 MB)
  //    en conexiones inestables. Sin él, una subida de 100 MB es un único
  //    PUT sin reintentos. Ref: docs Vercel Blob `upload()`.
  const blob = await upload(file.name, file, {
    access: 'public',
    handleUploadUrl: '/api/upload/blob-token',
    multipart: true,
    onUploadProgress: (e) => onProgress?.(Math.round(e.percentage)),
  });

  // 2. Procesamiento por URL — body JSON, no multipart.
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blobUrl: blob.url, context, filename: file.name }),
  });

  return readUploadResponse(res);
}

/**
 * Lee la respuesta de /api/upload. Tolera cuerpos no-JSON (un 413 de plataforma
 * devuelve HTML, y `res.json()` lanzaría un SyntaxError opaco para el usuario).
 */
async function readUploadResponse(res: Response): Promise<UploadDocumentResult> {
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new Error(
      extractErrorMessage(payload) ??
        `No se pudo procesar el documento (HTTP ${res.status}).`,
    );
  }
  return payload as UploadDocumentResult;
}

function extractErrorMessage(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error: unknown }).error;
    if (typeof error === 'string' && error.trim()) return error.trim();
  }
  return null;
}

/**
 * Mensaje accionable para un usuario no técnico cuando Blob falla y el archivo
 * es demasiado grande para el camino directo. Conserva la explicación del
 * servidor al final: es la que le dice al administrador qué provisionar.
 */
function blobUnavailableMessage(file: File, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const sizeMb = (file.size / (1024 * 1024)).toFixed(1).replace('.', ',');
  return (
    `No pudimos subir «${file.name}» (${sizeMb} MB). Los archivos de más de 4 MB ` +
    'necesitan un almacenamiento Blob que hoy no está disponible. Vuelve a ' +
    'intentarlo con un archivo más liviano (por ejemplo, exporta el balance a ' +
    'CSV o Excel en vez de PDF escaneado) o pide a tu administrador que ' +
    `provisione un Blob store en Vercel. Detalle técnico: ${detail}`
  );
}
