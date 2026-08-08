// ---------------------------------------------------------------------------
// Regresion — RAG: umbral de relevancia + query sin CTE materializada
// ---------------------------------------------------------------------------
//
// Hallazgos cubiertos:
//   - rag-sin-umbral-no-results-muerto: el canal vectorial devolvia SIEMPRE los
//     30 chunks mas cercanos (sin filtro de distancia), asi que NO_RESULTS era
//     inalcanzable con corpus no vacio y el especialista redactaba sobre
//     contexto irrelevante presentado como "Fuente:".
//   - cte-materializada-anula-indice-hnsw: la CTE `base` referenciada 3 veces
//     se materializaba y el ORDER BY por distancia corria sobre un resultset
//     intermedio sin indices.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({ getDb: vi.fn() }));
vi.mock('../init', () => ({ initRagSchema: vi.fn().mockResolvedValue(undefined) }));
vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>();
  return { ...actual, embedMany: vi.fn(), rerank: vi.fn() };
});
vi.mock('@ai-sdk/openai', () => ({
  openai: { embedding: vi.fn(() => 'mock-embedding-model') },
}));
vi.mock('@ai-sdk/cohere', () => ({
  cohere: { reranking: vi.fn(() => 'mock-rerank-model') },
}));
vi.mock('@/lib/config/models', () => ({
  MODEL_IDS: { EMBEDDINGS: 'text-embedding-3-small' },
}));

import { embedMany, rerank } from 'ai';
import { getDb } from '@/lib/db/client';
import { searchDocuments } from '../vectorstore';

const mockEmbedMany = vi.mocked(embedMany);
const mockRerank = vi.mocked(rerank);
const mockGetDb = vi.mocked(getDb);

/**
 * Reconstruye el texto SQL de un objeto `SQL` de Drizzle recorriendo sus
 * `queryChunks` (los parametros bindeados se emiten como `?<valor>?`).
 */
function sqlText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node !== 'object') return `?${String(node)}?`;
  const anyNode = node as { queryChunks?: unknown[]; value?: unknown[] };
  if (Array.isArray(anyNode.queryChunks)) return anyNode.queryChunks.map(sqlText).join('');
  if (Array.isArray(anyNode.value)) return anyNode.value.join('');
  return '';
}

function mockEmbedding() {
  mockEmbedMany.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] } as never);
}

function makeChunkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chunk-1',
    source: 'et-colombia.md',
    doc_type: 'ley',
    entity: 'dian',
    year: 2026,
    content: 'Art. 240 E.T. — tarifa del impuesto sobre la renta.',
    contextual_prefix: null,
    metadata: {},
    rrf_score: 0.85,
    cosine_sim: 0.51,
    ...overrides,
  };
}

describe('RAG — gate de relevancia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COHERE_API_KEY;
  });

  afterEach(() => {
    delete process.env.COHERE_API_KEY;
  });

  it('el canal vectorial filtra por distancia coseno (NO_RESULTS deja de ser inalcanzable)', async () => {
    mockEmbedding();
    const execute = vi.fn().mockResolvedValue([]);
    mockGetDb.mockReturnValue({ execute } as never);

    await searchDocuments('cuantas patas tiene un gato');

    const text = sqlText(execute.mock.calls[0]?.[0]);
    // El subselect ordenado se filtra POR FUERA (patron pgvector) con el umbral.
    expect(text).toMatch(/WHERE v\.dist <= \?0\.7\?/);
  });

  it('no usa una CTE compartida: cada canal lee directo de rag_chunks (indice HNSW vivo)', async () => {
    mockEmbedding();
    const execute = vi.fn().mockResolvedValue([]);
    mockGetDb.mockReturnValue({ execute } as never);

    await searchDocuments('tarifa renta 2026');

    const text = sqlText(execute.mock.calls[0]?.[0]);
    expect(text).not.toContain('WITH base AS');
    expect(text).not.toMatch(/FROM base\b/);
    // vector_hits + lex_hits + JOIN final = 3 lecturas directas de la tabla.
    expect(text.match(/FROM rag_chunks/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain('JOIN rag_chunks c ON c.id = fused.id');
  });

  it('devuelve NO_RESULTS cuando el reranker descarta todos los candidatos', async () => {
    process.env.COHERE_API_KEY = 'test-key';
    mockEmbedding();
    const rows = [makeChunkRow({ cosine_sim: 0.31 }), makeChunkRow({ id: 'chunk-2', cosine_sim: 0.30 })];
    mockGetDb.mockReturnValue({ execute: vi.fn().mockResolvedValue(rows) } as never);
    // Scores por debajo del piso (0.05): el corpus no responde la consulta.
    mockRerank.mockResolvedValue({
      ranking: [
        { originalIndex: 0, score: 0.004, document: 'x' },
        { originalIndex: 1, score: 0.001, document: 'y' },
      ],
    } as never);

    const result = await searchDocuments('regimen aduanero de importacion temporal de aeronaves');

    expect(result).toContain('NO_RESULTS');
    expect(result).not.toContain('Resultado 1');
  });

  it('conserva los chunks que el reranker sí puntua por encima del piso', async () => {
    process.env.COHERE_API_KEY = 'test-key';
    mockEmbedding();
    const rows = [makeChunkRow(), makeChunkRow({ id: 'chunk-2', content: 'ruido irrelevante' })];
    mockGetDb.mockReturnValue({ execute: vi.fn().mockResolvedValue(rows) } as never);
    mockRerank.mockResolvedValue({
      ranking: [
        { originalIndex: 0, score: 0.92, document: 'x' },
        { originalIndex: 1, score: 0.002, document: 'y' },
      ],
    } as never);

    const result = await searchDocuments('tarifa del impuesto sobre la renta');

    expect(result).toContain('Resultado 1');
    expect(result).toContain('Art. 240 E.T.');
    expect(result).not.toContain('ruido irrelevante');
  });
});
