// ---------------------------------------------------------------------------
// RAG vector store — Neon pgvector + hybrid search + AI SDK rerank.
// ---------------------------------------------------------------------------
//
// Reemplazo del HNSWLib local que en Vercel se degradaba a MemoryVectorStore
// vacio (el index 285 MB excede los 250 MB del bundle de Functions). Ahora
// los chunks viven en Neon Postgres con la extension `vector` (pgvector 0.8)
// y un GENERATED tsvector('spanish'), habilitando hybrid retrieval BM25 +
// coseno fusionados con Reciprocal Rank Fusion (k = 60).
//
// Multi-tenant: la misma tabla `rag_chunks` aloja el corpus global
// (`workspace_id IS NULL`) y los docs subidos por cada workspace
// (`workspace_id = $uuid`). Una query de tenant siempre busca en
//   global  ∪  docs propios
// para que la normativa colombiana siga estando disponible aunque el tenant
// no haya subido nada.
//
// Reranking: si `COHERE_API_KEY` esta seteado, ejecutamos `cohere/rerank-v3.5`
// (multilingue, ideal para DIAN) sobre el top 30 RRF y devolvemos el top K
// final. Si no, usamos el ranking RRF directo. Esto evita acoplar el deploy
// a Cohere y permite al usuario activarlo cuando quiera.
//
// Embeddings: `text-embedding-3-small` (1536 dim) via `embedMany` de AI SDK.
// Antes lo hacia `@langchain/openai` con su propio cliente — ahora un solo
// provider chain (`@ai-sdk/openai`) sirve embeddings + chat + OCR.
//
// API publica preservada (compat con `src/lib/agents/tools/registry.ts`,
// `src/app/api/rag/route.ts` y el upload route):
//   - `searchDocuments(query, k?, filter?)`: string formateado para LLM.
//   - `addDocumentsToStore(texts, metadata)`: chunks insertados.
//   - `invalidateVectorStore()`: no-op (Postgres siempre consistente; queda
//     como hook en caso de cache local futuro).
//   - `getStoragePath(subdir)`: helper para uploads al disco efimero
//     (usado por `/api/upload` para guardar copia del PDF, NO el vector index).
// ---------------------------------------------------------------------------

import path from 'path';
import { sql, type SQL } from 'drizzle-orm';
import { embedMany, rerank } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getDb } from '@/lib/db/client';
import { MODEL_IDS } from '@/lib/config/models';
import { initRagSchema } from './init';

// ---------------------------------------------------------------------------
// Filesystem helper (kept for upload route — vector_store is gone)
// ---------------------------------------------------------------------------

/**
 * Ruta de almacenamiento efimero. En Vercel Functions solo /tmp es escribible;
 * en local devolvemos `src/data/<subdir>` para reusar copias entre runs.
 *
 * Solo se usa para guardar copias de archivos subidos por el usuario; el
 * vector store ya no toca disco.
 */
export function getStoragePath(subdir: string): string {
  if (process.env.VERCEL) {
    return path.join('/tmp', subdir);
  }
  return path.join(process.cwd(), 'src', 'data', subdir);
}

// ---------------------------------------------------------------------------
// Singleton config
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = openai.embedding(MODEL_IDS.EMBEDDINGS);
const RRF_K = 60;
// Top-N por canal antes de fusionar. Mayor = mas recall, mas tokens al rerank.
const PER_CHANNEL_LIMIT = 30;
// Top-N que devuelve el rerank (o el fallback RRF directo).
const DEFAULT_K = 8;

let backendStatus: 'pgvector' | 'pgvector_empty' | 'uninitialized' | 'error' =
  'uninitialized';

/** Estado actual del backend para endpoints de salud / observabilidad. */
export function getBackendStatus(): typeof backendStatus {
  return backendStatus;
}

// ---------------------------------------------------------------------------
// Search filter type
// ---------------------------------------------------------------------------

export interface SearchFilters {
  /** Si se pasa, busca en `workspaceId IS NULL` ∪ `workspaceId = workspaceId`. */
  workspaceId?: string;
  docType?: string;
  entity?: string;
  /** En el modelo previo `year` era string; ahora es number en DB. Aceptamos ambos. */
  year?: number | string;
  /** Backwards-compat: el viejo filtro `type: 'user_upload'` ahora mapea a `docType`. */
  type?: string;
}

// ---------------------------------------------------------------------------
// Embedding helper
// ---------------------------------------------------------------------------

async function embedSingle(text: string): Promise<number[]> {
  const { embeddings } = await embedMany({
    model: EMBEDDING_MODEL,
    values: [text],
  });
  return embeddings[0];
}

// ---------------------------------------------------------------------------
// Hybrid retrieval (BM25 + cosine + RRF)
// ---------------------------------------------------------------------------

interface ChunkRow extends Record<string, unknown> {
  id: string;
  source: string;
  doc_type: string | null;
  entity: string | null;
  year: number | null;
  content: string;
  contextual_prefix: string | null;
  metadata: Record<string, unknown> | null;
  rrf_score: number;
}

/**
 * Ejecuta RRF en SQL: combina ranking por similaridad coseno (HNSW) con
 * ranking por ts_rank (BM25 lexico). RRF k = 60 es el default canonico
 * (Cormack et al. 2009).
 *
 * SQL crudo: Drizzle aun no expone `ts_rank` ni operadores `<=>` de pgvector
 * de forma typesafe. La query es safe-by-construction (parameters bindeados
 * a embeddings y filtros validados aguas arriba).
 */
async function hybridSearch(
  query: string,
  embedding: number[],
  filters: SearchFilters | undefined,
): Promise<ChunkRow[]> {
  const db = getDb();

  // pgvector acepta el embedding como literal `[v1,v2,...]`.
  const embLiteral = `[${embedding.join(',')}]`;

  // Filtro por workspace: si filters.workspaceId existe, traemos
  // global + ese tenant; si no, solo global.
  const tenantClause: SQL = filters?.workspaceId
    ? sql`(workspace_id IS NULL OR workspace_id = ${filters.workspaceId}::uuid)`
    : sql`workspace_id IS NULL`;

  // Backwards-compat: `filter.type === 'user_upload'` mapea al docType viejo.
  const docTypeFilter = filters?.docType ?? filters?.type;
  const docTypeClause: SQL = docTypeFilter
    ? sql`AND doc_type = ${docTypeFilter}`
    : sql``;

  const entityClause: SQL = filters?.entity
    ? sql`AND entity = ${filters.entity}`
    : sql``;

  const yearFilter =
    filters?.year !== undefined ? Number(filters.year) : undefined;
  const yearClause: SQL =
    yearFilter !== undefined && Number.isFinite(yearFilter)
      ? sql`AND year = ${yearFilter}`
      : sql``;

  // RRF query:
  //   - vector_hits: top PER_CHANNEL_LIMIT por similaridad coseno.
  //   - lex_hits  : top PER_CHANNEL_LIMIT por ts_rank('spanish', plainto_tsquery).
  //   - fusion    : RRF score = sum(1 / (k + rank_i)) sobre cada canal donde aparece.
  const rows = await db.execute<ChunkRow>(sql`
    WITH base AS (
      SELECT id, source, doc_type, entity, year, content, contextual_prefix, metadata, embedding, tsv
      FROM rag_chunks
      WHERE ${tenantClause}
      ${docTypeClause}
      ${entityClause}
      ${yearClause}
    ),
    vector_hits AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> ${embLiteral}::vector ASC) AS rnk
      FROM base
      ORDER BY embedding <=> ${embLiteral}::vector ASC
      LIMIT ${PER_CHANNEL_LIMIT}
    ),
    lex_hits AS (
      SELECT id, ROW_NUMBER() OVER (
        ORDER BY ts_rank(tsv, plainto_tsquery('spanish', ${query})) DESC
      ) AS rnk
      FROM base
      WHERE tsv @@ plainto_tsquery('spanish', ${query})
      ORDER BY ts_rank(tsv, plainto_tsquery('spanish', ${query})) DESC
      LIMIT ${PER_CHANNEL_LIMIT}
    ),
    fused AS (
      SELECT id, SUM(score) AS rrf_score
      FROM (
        SELECT id, 1.0 / (${RRF_K} + rnk) AS score FROM vector_hits
        UNION ALL
        SELECT id, 1.0 / (${RRF_K} + rnk) AS score FROM lex_hits
      ) s
      GROUP BY id
    )
    SELECT
      base.id,
      base.source,
      base.doc_type,
      base.entity,
      base.year,
      base.content,
      base.contextual_prefix,
      base.metadata,
      fused.rrf_score
    FROM fused
    JOIN base ON base.id = fused.id
    ORDER BY fused.rrf_score DESC
    LIMIT ${PER_CHANNEL_LIMIT}
  `);

  // `db.execute` puede devolver `{ rows }` o el array directo dependiendo del
  // driver. Normalizamos.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (rows as any).rows ?? (rows as any);
  return Array.isArray(data) ? (data as ChunkRow[]) : [];
}

// ---------------------------------------------------------------------------
// Optional rerank with Cohere (AI SDK native)
// ---------------------------------------------------------------------------

async function maybeRerank(
  query: string,
  rows: ChunkRow[],
  topN: number,
): Promise<ChunkRow[]> {
  if (rows.length <= topN) return rows;
  if (!process.env.COHERE_API_KEY) return rows.slice(0, topN);

  try {
    // Lazy import: si el package no esta instalado, caemos a RRF directo sin romper el build.
    const { cohere } = await import('@ai-sdk/cohere');
    const documents = rows.map((r) =>
      [r.contextual_prefix, r.content].filter(Boolean).join('\n\n'),
    );
    const { ranking } = await rerank({
      model: cohere.reranking('rerank-v3.5'),
      documents,
      query,
      topN,
    });
    return ranking.map((r) => rows[r.originalIndex]);
  } catch (err) {
    console.warn(
      '[vectorstore] Rerank fallback ⇒ RRF only:',
      err instanceof Error ? err.message : err,
    );
    return rows.slice(0, topN);
  }
}

// ---------------------------------------------------------------------------
// Public API: searchDocuments
// ---------------------------------------------------------------------------

/**
 * Hybrid search sobre `rag_chunks`. Devuelve un string formateado listo
 * para alimentar a un LLM. Compatible con la firma vieja:
 *   - `searchDocuments(query)`           ⇒ k = 8, sin filtros, solo global.
 *   - `searchDocuments(query, k)`        ⇒ k custom.
 *   - `searchDocuments(query, k, filter)` con la forma legacy `{ docType?, entity?, year?, type? }`.
 *
 * Si quieres restringir por workspace, pasa `filter.workspaceId`.
 */
export async function searchDocuments(
  query: string,
  k: number = DEFAULT_K,
  filter?: SearchFilters,
): Promise<string> {
  const safeQuery = query.slice(0, 2000);
  const safeK = Math.max(1, Math.min(k, 20));

  try {
    await initRagSchema();
    const embedding = await embedSingle(safeQuery);
    const rrfHits = await hybridSearch(safeQuery, embedding, filter);

    if (rrfHits.length === 0) {
      backendStatus = 'pgvector_empty';
      return [
        'NO_RESULTS: No se encontraron coincidencias en el RAG (Neon pgvector).',
        'ACCION OBLIGATORIA: invoca la tool "search_web" con una query enfocada en normativa colombiana',
        '(ej: "Art. 240 ET Ley 2277/2022 site:dian.gov.co") para obtener fuentes oficiales. NO inventes citas.',
      ].join(' ');
    }

    backendStatus = 'pgvector';
    const top = await maybeRerank(safeQuery, rrfHits, safeK);

    return top
      .map((row, i) => {
        const docType = row.doc_type ? ` | Tipo: ${row.doc_type}` : '';
        const year = row.year ? ` | Año: ${row.year}` : '';
        const entity = row.entity ? ` | Entidad: ${row.entity.toUpperCase()}` : '';
        const prefix = row.contextual_prefix
          ? `[${row.contextual_prefix}]\n\n`
          : '';
        return `[Resultado ${i + 1} — Fuente: ${row.source}${docType}${year}${entity}]\n${prefix}${row.content}`;
      })
      .join('\n\n---\n\n');
  } catch (err) {
    backendStatus = 'error';
    console.warn(
      '[vectorstore] searchDocuments failed:',
      err instanceof Error ? err.message : err,
    );
    return `NO_RESULTS: Error al consultar el RAG (${
      err instanceof Error ? err.message : 'unknown'
    }). ACCION: usa "search_web" con fuentes oficiales (.gov.co, ctcp.gov.co).`;
  }
}

// ---------------------------------------------------------------------------
// Public API: addDocumentsToStore (upload route)
// ---------------------------------------------------------------------------

/**
 * Splits texts en chunks ~1000 chars con solapamiento ~250 (mismo perfil
 * que el ingest principal), embed con `text-embedding-3-small`, e inserta
 * en `rag_chunks` con metadata correcta. Para uploads de usuario fijamos
 * `doc_type = 'user_upload'`.
 *
 * Si `metadata.workspaceId` se pasa, el chunk queda scoped a ese tenant.
 * Si NO, queda como global (corpus oficial). El upload route deberia
 * pasar workspaceId desde la cookie `utopia_workspace_id`.
 *
 * Devuelve la cantidad de chunks insertados (0 si vectorizacion fallo).
 */
export async function addDocumentsToStore(
  texts: string[],
  metadata: Record<string, string>,
): Promise<number> {
  try {
    await initRagSchema();
    const fullText = texts.join('\n\n');
    const chunks = chunkText(fullText, 1000, 250);
    if (chunks.length === 0) return 0;

    const contextualPrefix = metadata.context
      ? `Documento Contable/Tributario: ${metadata.context} — Archivo: ${metadata.source ?? 'sin nombre'}`
      : `Archivo: ${metadata.source ?? 'sin nombre'}`;

    const { embeddings } = await embedMany({
      model: EMBEDDING_MODEL,
      values: chunks,
      maxParallelCalls: 5,
    });

    const db = getDb();
    const workspaceId = metadata.workspaceId || null;
    const docType = metadata.docType || 'user_upload';

    // Bulk insert. INSERT ... VALUES (...), (...), ... — `db.execute(sql)`
    // permite construir multi-row con sql.join.
    const values = chunks.map((chunk, i) => {
      const embLit = `[${embeddings[i].join(',')}]`;
      const mergedMeta = JSON.stringify({
        ...metadata,
        type: docType,
        uploadedAt: new Date().toISOString(),
      });
      return sql`(
        ${workspaceId ? sql`${workspaceId}::uuid` : sql`NULL`},
        ${metadata.source ?? 'unknown'},
        ${docType},
        ${metadata.entity ?? null},
        ${metadata.year ? Number(metadata.year) : null},
        ${chunk},
        ${contextualPrefix},
        ${embLit}::vector,
        ${mergedMeta}::jsonb
      )`;
    });

    await db.execute(sql`
      INSERT INTO rag_chunks (
        workspace_id, source, doc_type, entity, year, content, contextual_prefix, embedding, metadata
      ) VALUES ${sql.join(values, sql`, `)}
    `);

    return chunks.length;
  } catch (err) {
    console.warn(
      '[vectorstore] addDocumentsToStore failed:',
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Public API: invalidateVectorStore (no-op — Postgres es siempre consistente)
// ---------------------------------------------------------------------------

/**
 * Hook de invalidacion. Con HNSWLib local habia que recargar el snapshot;
 * con pgvector la consistencia es transactional, asi que es no-op. Lo
 * exportamos para no romper consumidores existentes.
 */
export function invalidateVectorStore(): void {
  // intentionally empty
}

// ---------------------------------------------------------------------------
// Public API: getStoreStats
// ---------------------------------------------------------------------------

export async function getStoreStats(): Promise<{
  totalDocs: number;
  backend: string;
  byType: Record<string, number>;
  byEntity: Record<string, number>;
}> {
  try {
    await initRagSchema();
    const db = getDb();
    const result = await db.execute<{
      total: string;
      doc_type: string | null;
      entity: string | null;
      cnt: string;
    }>(sql`
      SELECT
        COUNT(*) OVER () AS total,
        doc_type,
        entity,
        COUNT(*) AS cnt
      FROM rag_chunks
      GROUP BY doc_type, entity
    `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = ((result as any).rows ?? (result as any)) as Array<{
      total: string;
      doc_type: string | null;
      entity: string | null;
      cnt: string;
    }>;
    const byType: Record<string, number> = {};
    const byEntity: Record<string, number> = {};
    let totalDocs = 0;
    for (const r of rows ?? []) {
      totalDocs = Number(r.total);
      const docType = r.doc_type || 'unknown';
      const entity = r.entity || 'unknown';
      byType[docType] = (byType[docType] || 0) + Number(r.cnt);
      byEntity[entity] = (byEntity[entity] || 0) + Number(r.cnt);
    }
    return { totalDocs, backend: 'pgvector', byType, byEntity };
  } catch {
    return { totalDocs: 0, backend: 'pgvector_unreachable', byType: {}, byEntity: {} };
  }
}

// ---------------------------------------------------------------------------
// Internal: tiny chunker (no LangChain dependency on the runtime path)
// ---------------------------------------------------------------------------

/**
 * Splitter recursivo simple. No es identico al de LangChain pero produce
 * chunks comparables (~1000 chars, overlap 250) usando los mismos
 * separadores semanticos: H2 → H3 → parrafo → linea → frase → palabra.
 *
 * Por que reescribimos en vez de seguir importando RecursiveCharacterTextSplitter:
 *   - Para la ruta CALIENTE (uploads en runtime) no queremos arrastrar
 *     `@langchain/textsplitters` y su dependency tree dentro de las
 *     funciones serverless.
 *   - Para el ingest offline (`scripts`-equivalent) seguimos pudiendo usar
 *     el splitter de LangChain; ver `src/lib/rag/ingest.ts`.
 */
function chunkText(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return text.trim() ? [text.trim()] : [];

  const separators = ['\n## ', '\n### ', '\n#### ', '\n\n', '\n', '. ', ' '];
  const out: string[] = [];

  function recurse(input: string, depth: number) {
    if (input.length <= size) {
      const trimmed = input.trim();
      if (trimmed) out.push(trimmed);
      return;
    }
    const sep = separators[depth] ?? ' ';
    const parts = input.split(sep);
    let buf = '';
    for (const part of parts) {
      const candidate = buf ? buf + sep + part : part;
      if (candidate.length > size) {
        if (buf) {
          // overlap: arrastra los ultimos `overlap` chars al siguiente buffer.
          const tail = buf.length > overlap ? buf.slice(-overlap) : buf;
          out.push(buf.trim());
          buf = tail + sep + part;
        } else {
          // un solo fragmento ya excede `size` ⇒ recursa con el siguiente separador.
          recurse(part, depth + 1);
          buf = '';
        }
      } else {
        buf = candidate;
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }

  recurse(text, 0);
  return out.filter((c) => c.length > 0);
}
