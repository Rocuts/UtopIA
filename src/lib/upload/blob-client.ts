// ---------------------------------------------------------------------------
// Blob upload client helper — shared by every client component that uploads
// documents to UtopIA.
//
// Flujo en 2 pasos (evita el límite de 4.5 MB del body de las funciones Vercel):
//   1. Subida DIRECTA del archivo a Vercel Blob (hasta 100 MB), autorizada por
//      POST /api/upload/blob-token (ruta `handleUpload` de @vercel/blob/client).
//   2. POST /api/upload con body JSON { blobUrl, context, filename } — el
//      servidor descarga el blob por URL y lo procesa (OCR, RAG, preprocesado).
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
 * Sube un archivo a Vercel Blob (directo, sin pasar por el body de la función)
 * y luego pide a /api/upload que lo procese por URL.
 *
 * @param file       Archivo a subir.
 * @param context    Contexto del documento (normalmente `file.name`).
 * @param onProgress Recibe 0..100 durante la subida al Blob store.
 */
export async function uploadDocument(
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

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'No se pudo procesar el documento');
  }
  return data as UploadDocumentResult;
}
