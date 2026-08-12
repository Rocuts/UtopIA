// ---------------------------------------------------------------------------
// Regresión — enrutamiento de uploadDocument().
//
// El wizard "Informe NIIF Elite" murió en producción porque TODA subida pasaba
// por Vercel Blob y el store no estaba provisionado: /api/upload/blob-token
// respondía 400 y la pipeline nunca arrancaba, incluso para un balance de
// prueba de 23 líneas. Estos tests fijan el contrato que lo evita:
//   - archivo pequeño  → POST multipart directo, sin tocar Blob;
//   - archivo grande   → flujo Blob de 2 pasos (multipart + progreso);
//   - Blob caído       → reintento directo si el archivo cabe en el body de la
//                        Function; si no cabe, error accionable que conserva la
//                        explicación del servidor.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Vitest hoistea vi.mock() al tope del módulo compilado.
const uploadMock = vi.fn();
vi.mock('@vercel/blob/client', () => ({
  upload: (...args: unknown[]) => uploadMock(...args),
}));

import { DIRECT_UPLOAD_MAX_BYTES, uploadDocument } from '../blob-client';

/** File con `size` falseado — evita reservar megabytes reales en el test. */
function fileOfSize(bytes: number, name = 'balance.csv'): File {
  const file = new File(['x'], name, { type: 'text/csv' });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

const SERVER_RESULT = {
  success: true,
  filename: 'balance.csv',
  chunks: 3,
  extractedText: 'texto',
  detectedCaseType: null,
  isTrialBalance: true,
  preprocessed: null,
  detectedPeriods: ['2025'],
  message: 'ok',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  uploadMock.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse(SERVER_RESULT));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadDocument — archivo pequeño (camino directo)', () => {
  it('hace POST multipart a /api/upload y NO toca Vercel Blob', async () => {
    const file = fileOfSize(23 * 1024);

    const result = await uploadDocument(file, 'balance.csv');

    expect(uploadMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/upload');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);

    const form = init?.body as FormData;
    expect(form.get('file')).toBe(file);
    expect(form.get('context')).toBe('balance.csv');

    // El navegador debe poner el boundary: no fijamos Content-Type a mano.
    expect(init?.headers).toBeUndefined();

    expect(result).toEqual(SERVER_RESULT);
  });

  it('reporta progreso hasta 100 para que la UI del wizard avance', async () => {
    const onProgress = vi.fn();

    await uploadDocument(fileOfSize(1024), 'balance.csv', onProgress);

    const reported = onProgress.mock.calls.map(([pct]) => pct);
    expect(reported[0]).toBe(0);
    expect(reported.at(-1)).toBe(100);
  });

  it('propaga el error del servidor cuando /api/upload responde !ok', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unsupported file type.' }, 400));

    await expect(uploadDocument(fileOfSize(1024), 'x.csv')).rejects.toThrow(
      'Unsupported file type.',
    );
  });
});

describe('uploadDocument — archivo grande (camino Blob)', () => {
  const bigFile = () => fileOfSize(30 * 1024 * 1024, 'auxiliares.pdf');

  it('sube a Blob con multipart y luego procesa por URL en JSON', async () => {
    uploadMock.mockResolvedValue({ url: 'https://x.blob.vercel-storage.com/auxiliares.pdf' });
    const onProgress = vi.fn();

    const result = await uploadDocument(bigFile(), 'auxiliares.pdf', onProgress);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [name, , options] = uploadMock.mock.calls[0] as [
      string,
      File,
      { multipart?: boolean; handleUploadUrl?: string; onUploadProgress?: (e: { percentage: number }) => void },
    ];
    expect(name).toBe('auxiliares.pdf');
    expect(options.multipart).toBe(true);
    expect(options.handleUploadUrl).toBe('/api/upload/blob-token');

    options.onUploadProgress?.({ percentage: 42.4 });
    expect(onProgress).toHaveBeenCalledWith(42);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/upload');
    expect(init?.body).toBe(
      JSON.stringify({
        blobUrl: 'https://x.blob.vercel-storage.com/auxiliares.pdf',
        context: 'auxiliares.pdf',
        filename: 'auxiliares.pdf',
      }),
    );
    expect(result).toEqual(SERVER_RESULT);
  });

  it('no enruta por Blob justo en el umbral', async () => {
    await uploadDocument(fileOfSize(DIRECT_UPLOAD_MAX_BYTES), 'limite.csv');
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe('uploadDocument — Blob no disponible', () => {
  const BLOB_ERROR =
    'Vercel Blob: No token found (falta configurar BLOB_READ_WRITE_TOKEN — provisione un Blob store en Vercel)';

  it('reintenta por el camino directo si el archivo aún cabe en el body', async () => {
    uploadMock.mockRejectedValue(new Error(BLOB_ERROR));
    // 4.2 MB: por encima del umbral con holgura, por debajo del límite duro
    // de 4.5 MB de la Function.
    const file = fileOfSize(Math.floor(4.2 * 1024 * 1024), 'balance.xlsx');

    const result = await uploadDocument(file, 'balance.xlsx');

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
    expect(result).toEqual(SERVER_RESULT);
  });

  it('lanza un error accionable que conserva la explicación del servidor', async () => {
    uploadMock.mockRejectedValue(new Error(BLOB_ERROR));

    const promise = uploadDocument(fileOfSize(30 * 1024 * 1024, 'auxiliares.pdf'), 'ctx');

    await expect(promise).rejects.toThrow(/auxiliares\.pdf/);
    await expect(promise).rejects.toThrow(/Blob store en Vercel/);
    await expect(promise).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/);
    // No se intenta el POST directo: garantizaría un 413 de plataforma.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
