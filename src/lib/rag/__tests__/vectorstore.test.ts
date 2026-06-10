import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — antes de todos los imports de módulos reales.
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/client', () => ({ getDb: vi.fn() }));
vi.mock('../init', () => ({ initRagSchema: vi.fn().mockResolvedValue(undefined) }));
vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>();
  return { ...actual, embedMany: vi.fn(), rerank: vi.fn() };
});
vi.mock('@ai-sdk/openai', () => ({
  openai: { embedding: vi.fn(() => 'mock-embedding-model') },
}));
vi.mock('@/lib/config/models', () => ({
  MODEL_IDS: { EMBEDDINGS: 'text-embedding-3-small' },
}));

// ---------------------------------------------------------------------------
// Imports reales
// ---------------------------------------------------------------------------

import { embedMany } from 'ai';
import { getDb } from '@/lib/db/client';
import {
  searchDocuments,
  addDocumentsToStore,
  getBackendStatus,
  getStoragePath,
  invalidateVectorStore,
} from '../vectorstore';

const mockEmbedMany = vi.mocked(embedMany);
const mockGetDb = vi.mocked(getDb);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Chunk row mínimo para las pruebas */
function makeChunkRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'chunk-1',
    source: 'et-colombia.md',
    doc_type: 'ley',
    entity: 'dian',
    year: 2026,
    content: 'Art. 240 ET — tarifa del impuesto sobre la renta.',
    contextual_prefix: null,
    metadata: {},
    rrf_score: 0.85,
    ...overrides,
  };
}

/** Configura el mock de getDb().execute para devolver `rows` */
function mockDbReturning(rows: ReturnType<typeof makeChunkRow>[]) {
  const mockExecute = vi.fn().mockResolvedValue(rows);
  mockGetDb.mockReturnValue({ execute: mockExecute } as unknown as ReturnType<typeof getDb>);
  return mockExecute;
}

/** Configura embedMany para devolver un único vector de prueba */
function mockEmbedding() {
  mockEmbedMany.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getStoragePath', () => {
  it('devuelve una ruta bajo /tmp cuando process.env.VERCEL está definido', () => {
    process.env.VERCEL = '1';
    const result = getStoragePath('uploads');
    // path.join normaliza separadores según el OS; comprobamos semántica, no separadores
    expect(result).toContain('tmp');
    expect(result).toContain('uploads');
    delete process.env.VERCEL;
  });

  it('devuelve src/data/<subdir> cuando NO estamos en Vercel', () => {
    delete process.env.VERCEL;
    const result = getStoragePath('uploads');
    expect(result).toContain('src');
    expect(result).toContain('data');
    expect(result).toContain('uploads');
  });
});

describe('invalidateVectorStore', () => {
  it('es un no-op y no lanza excepción', () => {
    expect(() => invalidateVectorStore()).not.toThrow();
  });
});

describe('searchDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('devuelve NO_RESULTS cuando la base de datos está vacía', async () => {
    mockEmbedding();
    mockDbReturning([]);

    const result = await searchDocuments('Art. 240 ET');

    expect(result).toContain('NO_RESULTS');
    expect(result).toContain('pgvector');
    expect(getBackendStatus()).toBe('pgvector_empty');
  });

  it('devuelve los resultados formateados cuando hay chunks', async () => {
    mockEmbedding();
    mockDbReturning([makeChunkRow()]);

    const result = await searchDocuments('tarifa renta');

    expect(result).toContain('Resultado 1');
    expect(result).toContain('et-colombia.md');
    expect(result).toContain('Art. 240 ET');
    expect(getBackendStatus()).toBe('pgvector');
  });

  it('incluye el tipo de documento y año en el resultado formateado', async () => {
    mockEmbedding();
    mockDbReturning([makeChunkRow({ doc_type: 'decreto', year: 2025, entity: 'dian' })]);

    const result = await searchDocuments('consulta');

    expect(result).toContain('Tipo: decreto');
    expect(result).toContain('Año: 2025');
    expect(result).toContain('DIAN');
  });

  it('incluye contextual_prefix cuando está definido', async () => {
    mockEmbedding();
    mockDbReturning([makeChunkRow({ contextual_prefix: 'Capítulo IV — Retenciones' })]);

    const result = await searchDocuments('retenciones');

    expect(result).toContain('Capítulo IV — Retenciones');
  });

  it('devuelve error fallback cuando la DB falla', async () => {
    mockEmbedMany.mockResolvedValue({ embeddings: [[0.1]] } as never);
    mockGetDb.mockImplementation(() => {
      throw new Error('connection refused');
    });

    const result = await searchDocuments('consulta que falla');

    expect(result).toContain('NO_RESULTS');
    expect(result).toContain('Error');
    expect(getBackendStatus()).toBe('error');
  });

  it('clampea k a 20 cuando se pasa un valor mayor', async () => {
    mockEmbedding();
    // Devolver 5 chunks — se deben devolver todos (k=20 ≥ 5)
    const rows = Array.from({ length: 5 }, (_, i) => makeChunkRow({ id: `chunk-${i}` }));
    mockDbReturning(rows);

    const result = await searchDocuments('query', 999);

    // Todos los 5 chunks deberían aparecer
    expect(result).toContain('Resultado 1');
  });

  it('clampea k a 1 cuando se pasa 0 o negativo', async () => {
    mockEmbedding();
    mockDbReturning([makeChunkRow()]);

    // No debe lanzar aunque k=0
    await expect(searchDocuments('query', 0)).resolves.toBeTruthy();
  });
});

describe('addDocumentsToStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('devuelve 0 cuando texts es un array vacío', async () => {
    const result = await addDocumentsToStore([], {});
    expect(result).toBe(0);
  });

  it('devuelve el número de chunks insertados', async () => {
    // Un texto largo que se dividirá en varios chunks
    const longText = 'Lorem ipsum '.repeat(200); // ~2400 chars → al menos 2 chunks con chunk_size=1000
    mockEmbedMany.mockResolvedValue({
      embeddings: Array.from({ length: 3 }, () => [0.1, 0.2]),
    } as never);
    const mockExecute = vi.fn().mockResolvedValue([]);
    mockGetDb.mockReturnValue({ execute: mockExecute } as unknown as ReturnType<typeof getDb>);

    const count = await addDocumentsToStore([longText], { source: 'test.pdf' });

    expect(count).toBeGreaterThan(0);
    expect(mockExecute).toHaveBeenCalled();
  });

  it('devuelve 0 cuando la inserción en DB falla', async () => {
    mockEmbedMany.mockResolvedValue({
      embeddings: [[0.1, 0.2]],
    } as never);
    mockGetDb.mockImplementation(() => {
      throw new Error('insert failed');
    });

    const count = await addDocumentsToStore(['Texto de prueba'], { source: 'test.pdf' });

    expect(count).toBe(0);
  });

  it('usa doc_type = "user_upload" cuando no se pasa docType en metadata', async () => {
    const text = 'contenido de prueba '.repeat(30);
    mockEmbedMany.mockResolvedValue({ embeddings: [[0.1]] } as never);
    const mockExecute = vi.fn().mockResolvedValue([]);
    mockGetDb.mockReturnValue({ execute: mockExecute } as unknown as ReturnType<typeof getDb>);

    await addDocumentsToStore([text], { source: 'doc.pdf' });

    // El SQL generado debe contener 'user_upload'
    const callArg = mockExecute.mock.calls[0]?.[0];
    const sqlStr = JSON.stringify(callArg);
    expect(sqlStr).toContain('user_upload');
  });
});
