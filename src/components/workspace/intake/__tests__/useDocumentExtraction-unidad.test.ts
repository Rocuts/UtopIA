// ---------------------------------------------------------------------------
// P4-a (revisión): la confirmación de unidad reenvía el ÚLTIMO archivo a
// /api/upload. Si mientras llega la respuesta el usuario sube otro archivo, la
// respuesta tardía del anterior no puede reemplazar la lectura vigente: el
// intake enviaría a /niif el balance del archivo viejo con el nombre del nuevo.
//
// El entorno de pruebas es `node` (sin DOM): el hook se ejercita con un
// `react` mínimo (estado en memoria, callbacks y refs directos).
// ---------------------------------------------------------------------------
import { beforeEach, describe, expect, it, vi } from 'vitest';

const holder: { state: unknown } = { state: undefined };

vi.mock('react', () => ({
  useState: <T,>(init: T) => {
    holder.state = init;
    const set = (u: T | ((prev: T) => T)) => {
      holder.state = typeof u === 'function' ? (u as (prev: T) => T)(holder.state as T) : u;
    };
    return [init, set];
  },
  useCallback: <F,>(fn: F) => fn,
  useRef: <T,>(v: T) => ({ current: v }),
}));

const uploadDocument = vi.fn();
vi.mock('@/lib/upload/blob-client', () => ({
  uploadDocument: (...args: unknown[]) => uploadDocument(...args),
}));
vi.mock('@/lib/upload/preprocessed-handoff', () => ({ rememberUploadedPreprocessed: () => {} }));

import { useDocumentExtraction, type ExtractionState } from '../useDocumentExtraction';

function respuesta(rawData: string, confirmed: 'miles' | null) {
  return {
    success: true,
    filename: 'x.csv',
    chunks: 0,
    extractedText: rawData,
    rawData,
    isTrialBalance: true,
    preprocessed: null,
    detectedPeriods: [],
    unit: { declared: 'miles', declaredText: 'Saldo (miles)', confirmed, requiresConfirmation: confirmed === null },
    message: 'ok',
  };
}

describe('useDocumentExtraction — confirmación de unidad', () => {
  beforeEach(() => {
    uploadDocument.mockReset();
  });

  it('una confirmación que llega después de subir otro archivo no reemplaza la lectura vigente', async () => {
    const hook = useDocumentExtraction();
    const archivoA = new File(['a'], 'a.csv');
    const archivoB = new File(['b'], 'b.csv');

    uploadDocument.mockResolvedValueOnce(respuesta('codigo,nombre,saldo (miles)\nA', null));
    await hook.uploadAndExtract(archivoA);

    // Confirmación de A en vuelo…
    let resolverA!: (v: unknown) => void;
    uploadDocument.mockReturnValueOnce(new Promise((r) => (resolverA = r)));
    const confirmando = hook.confirmUnit('miles');

    // …el usuario sube B y su lectura termina primero.
    uploadDocument.mockResolvedValueOnce(respuesta('codigo,nombre,saldo (miles)\nB', null));
    await hook.uploadAndExtract(archivoB);

    resolverA(respuesta('[unidad-confirmada=miles]\ncodigo,nombre,saldo (miles)\nA', 'miles'));
    await confirmando;

    const state = holder.state as ExtractionState;
    expect(state.fileName).toBe('b.csv');
    expect(state.extracted?.rawText).toBe('codigo,nombre,saldo (miles)\nB');
    expect(state.extracted?.unit?.requiresConfirmation).toBe(true);
    expect(state.unitConfirmation.status).toBe('idle');
  });

  it('la confirmación del archivo vigente sí reemplaza la lectura con la unidad confirmada', async () => {
    const hook = useDocumentExtraction();
    uploadDocument.mockResolvedValueOnce(respuesta('codigo,nombre,saldo (miles)\nA', null));
    await hook.uploadAndExtract(new File(['a'], 'a.csv'));
    uploadDocument.mockResolvedValueOnce(respuesta('[unidad-confirmada=miles]\ncodigo,nombre,saldo (miles)\nA', 'miles'));
    await hook.confirmUnit('miles');
    const state = holder.state as ExtractionState;
    expect(state.extracted?.rawText.split('\n')[0]).toBe('[unidad-confirmada=miles]');
    expect(state.extracted?.unit?.confirmed).toBe('miles');
  });
});
