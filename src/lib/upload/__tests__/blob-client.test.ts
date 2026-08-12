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

import {
  BlobUnavailableError,
  DIRECT_UPLOAD_MAX_BYTES,
  UploadFailedError,
  uploadDocument,
} from '../blob-client';

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

  it('guarda el motivo del servidor en `detail`, no en el mensaje visible', async () => {
    // El mensaje de /api/upload puede venir de una librería de terceros o del
    // proveedor de OCR (endpoint, motivo de facturación). Se conserva para la
    // consola y el soporte, pero no se expone como texto de cara al usuario.
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unsupported file type.' }, 400));

    const err = await uploadDocument(fileOfSize(1024), 'x.csv').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UploadFailedError);
    const failed = err as UploadFailedError;
    expect(failed.detail).toBe('Unsupported file type.');
    expect(failed.status).toBe(400);
    expect(failed.message).not.toContain('Unsupported file type.');
  });

  it('no resuelve a null cuando un 200 trae un cuerpo ilegible', async () => {
    // Un proxy que trunca la respuesta, o una página de error servida con 200:
    // devolver null haría reventar al llamador al leer `.preprocessed`.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    } as unknown as Response);

    await expect(uploadDocument(fileOfSize(1024), 'x.csv')).rejects.toBeInstanceOf(
      UploadFailedError,
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

  it('NO reintenta directo un archivo por encima del umbral con holgura', async () => {
    uploadMock.mockRejectedValue(new Error(BLOB_ERROR));
    // 4.2 MB: cabe en el límite duro de 4.5 MB, pero no en el umbral con
    // holgura. Empaquetado en multipart puede pasarse, y entonces la plataforma
    // responde 413 sin cuerpo JSON: el usuario vería un error mudo en vez del
    // mensaje accionable.
    const file = fileOfSize(Math.floor(4.2 * 1024 * 1024), 'balance.xlsx');

    await expect(uploadDocument(file, 'balance.xlsx')).rejects.toBeInstanceOf(
      BlobUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un fallo del PASO 2 no reenvía el archivo: no se procesa dos veces', async () => {
    // Si el reintento cubriera también el procesado, una respuesta perdida tras
    // un OCR ya ejecutado volvería a subir el archivo: segundo OCR facturado y
    // fragmentos duplicados en el índice.
    uploadMock.mockResolvedValue({ url: 'https://x.blob.vercel-storage.com/a.pdf' });
    fetchMock.mockRejectedValue(new Error('network gone'));

    await expect(
      uploadDocument(fileOfSize(30 * 1024 * 1024, 'a.pdf'), 'ctx'),
    ).rejects.toThrow('network gone');

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lanza un error legible sin filtrar la configuración del despliegue', async () => {
    uploadMock.mockRejectedValue(new Error(BLOB_ERROR));

    const err = await uploadDocument(
      fileOfSize(30 * 1024 * 1024, 'auxiliares.pdf'),
      'ctx',
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BlobUnavailableError);
    const blobErr = err as BlobUnavailableError;
    expect(blobErr.message).toMatch(/hasta 4 MB/);
    expect(blobErr.message).not.toMatch(/BLOB_READ_WRITE_TOKEN/);
    // El detalle sigue disponible para la consola y el soporte.
    expect(blobErr.detail).toMatch(/BLOB_READ_WRITE_TOKEN/);
    // No se intenta el POST directo: garantizaría un 413 de plataforma.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
