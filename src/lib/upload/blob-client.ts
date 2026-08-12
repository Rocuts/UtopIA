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
 * Umbral de enrutamiento: 4 MB.
 *
 * El límite duro del body de una Function de Vercel son 4.5 MB, y por encima la
 * plataforma corta con 413 antes de invocar el handler — sin cuerpo JSON, así
 * que el usuario vería un error mudo. Los 0.5 MB restantes son holgura para el
 * sobre multipart (boundaries, headers de parte, el campo `context`) y para el
 * redondeo entre `file.size` y los bytes realmente transmitidos: un archivo de
 * 4.4 MB puede pasarse de 4.5 MB una vez empaquetado. Este umbral es el único
 * que decide el camino, también en el reintento tras un fallo de Blob.
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

  // El reintento SOLO cubre el paso 1 (subir a Blob). Si envolviera también el
  // paso 2, un fallo después de que /api/upload ya procesó el documento —una
  // red que se cae al recibir la respuesta— reenviaría el archivo entero: OCR
  // facturado dos veces y los mismos fragmentos indexados por duplicado en el
  // store vectorial, de modo que toda búsqueda posterior lo recuperaría dos
  // veces. Un fallo del paso 2 debe propagarse tal cual.
  let blobUrl: string;
  try {
    blobUrl = await putOnBlob(file, onProgress);
  } catch (error) {
    // Blob no disponible (típicamente falta BLOB_READ_WRITE_TOKEN y
    // /api/upload/blob-token responde 400). Se reintenta directo sólo si el
    // archivo cabe con la MISMA holgura que usa el enrutado normal: forzar el
    // límite duro cambiaría un mensaje accionable por un 413 mudo de la
    // plataforma, que ni siquiera llega al handler.
    if (file.size <= DIRECT_UPLOAD_MAX_BYTES) {
      return uploadDirect(file, context, onProgress);
    }
    throw new BlobUnavailableError(file, error);
  }

  return processBlob(blobUrl, context, file.name);
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

/**
 * Paso 1 del camino Blob — sube el archivo y devuelve su URL.
 *
 * `multipart: true` parte el archivo, sube las partes en paralelo y reintenta
 * las que fallen — crítico para archivos grandes (hasta 100 MB) en conexiones
 * inestables. Sin él, una subida de 100 MB es un único PUT sin reintentos.
 * Ref: docs Vercel Blob `upload()`.
 */
async function putOnBlob(file: File, onProgress?: (pct: number) => void): Promise<string> {
  const blob = await upload(file.name, file, {
    access: 'public',
    handleUploadUrl: '/api/upload/blob-token',
    multipart: true,
    onUploadProgress: (e) => onProgress?.(Math.round(e.percentage)),
  });
  return blob.url;
}

/** Paso 2 del camino Blob — procesamiento por URL, body JSON en vez de multipart. */
async function processBlob(
  blobUrl: string,
  context: string,
  filename: string,
): Promise<UploadDocumentResult> {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blobUrl, context, filename }),
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
    throw new UploadFailedError(extractErrorMessage(payload), res.status);
  }
  // Un 200 con cuerpo ilegible (buffering de un proxy, página de error servida
  // con 200) dejaría `payload` en null y el llamador reventaría al leer
  // `.preprocessed` de null. Mejor un error de subida que un TypeError.
  if (!payload || typeof payload !== 'object') {
    throw new UploadFailedError(null, res.status);
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
 * Errores de subida con la explicación del servidor SEPARADA del texto que ve
 * el usuario.
 *
 * `/api/upload` propaga mensajes de terceros tal cual —pdf-parse, exceljs,
 * mammoth, y el error del proveedor en la lectura OCR, que puede incluir el
 * endpoint y el motivo de facturación—. Volcarlos en la burbuja del chat
 * expone tripas del despliegue a un usuario final. Así que el motivo crudo
 * viaja en `detail` (para la consola y el soporte) y `message` queda como
 * texto neutro; la UI decide qué enseñar.
 */
export class UploadFailedError extends Error {
  readonly detail: string | null;
  readonly status: number;

  constructor(detail: string | null, status: number) {
    super('No se pudo procesar el documento.');
    this.name = 'UploadFailedError';
    this.detail = detail;
    this.status = status;
  }
}

/**
 * El almacenamiento Blob no está disponible y el archivo no cabe por el camino
 * directo. El usuario necesita saber qué hacer (mandar algo más liviano); el
 * nombre de la variable de entorno que falta es asunto de quien opera el
 * despliegue, así que va en `detail`, no en el mensaje.
 */
export class BlobUnavailableError extends Error {
  readonly detail: string;
  readonly sizeMb: number;

  constructor(file: File, cause: unknown) {
    const sizeMb = file.size / (1024 * 1024);
    super(
      `El archivo pesa ${sizeMb.toFixed(1)} MB y ahora mismo sólo podemos ` +
        'procesar archivos de hasta 4 MB. Vuelve a intentarlo con una versión ' +
        'más liviana — por ejemplo, exporta el balance a CSV o Excel en vez de ' +
        'un PDF escaneado.',
    );
    this.name = 'BlobUnavailableError';
    this.sizeMb = sizeMb;
    this.detail = cause instanceof Error ? cause.message : String(cause);
  }
}
