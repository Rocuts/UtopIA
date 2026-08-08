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

/**
 * Similaridad coseno minima para que un chunk cuente como evidencia del canal
 * vectorial.
 *
 * Why existe: sin umbral, `ORDER BY embedding <=> q LIMIT 30` devuelve SIEMPRE
 * los 30 chunks mas cercanos del corpus, existan o no chunks relevantes. El
 * unico disparador de NO_RESULTS era "cero filas", que con corpus no vacio no
 * ocurria nunca: el rail anti-alucinacion de los especialistas ("si search_docs
 * retorna NO_RESULTS ... escala a search_web o admite desconocimiento") era
 * codigo muerto y el agente redactaba con aplomo sobre normativa que no
 * respondia la pregunta.
 *
 * CALIBRADO 2026-08 contra el corpus de produccion (Neon pgvector, 71.273
 * chunks, `text-embedding-3-small`) con `scripts/rag-calibrate-threshold.ts`:
 * 20 consultas normativas colombianas reales (incluidas las citas cortas que
 * mandan los especialistas, tipo "Art. 240 E.T. tarifa") contra 16
 * consultas-ruido de control, seis de ellas adversariales (tramites y salud en
 * Colombia, que rozan el vocabulario de un corpus con Codigo Penal, Codigo de
 * Minas y resoluciones de MinSalud).
 *
 *   ruido      top1: max 0.447  (peor caso: "instrucciones para armar un
 *                                mueble de melamina")
 *   normativa  rank-30 min: 0.508 (peor caso: "Art. 240 E.T. tarifa")
 *
 * Las poblaciones se separan limpiamente; la banda que conserva el 100% del
 * recall actual con 0% de fuga es [0.448, 0.508] y 0.48 es su punto medio
 * (margen +0.033 sobre el ruido, -0.028 bajo la normativa peor rankeada).
 *
 * El 0.30 anterior dejaba pasar el 69% de las consultas-ruido con 12,3 chunks
 * de promedio: la consulta de control "receta de arepas de choclo con queso"
 * (top1=0.355, rank30=0.312) entregaba sus 30 candidatos al especialista
 * rotulados "Fuente:".
 *
 * Se ajusta con `RAG_MIN_COSINE_SIMILARITY`. Recalibrar tras cualquier cambio
 * de modelo de embeddings o ampliacion grande del corpus.
 */
const MIN_COSINE_SIMILARITY = clamp01(
  Number(process.env.RAG_MIN_COSINE_SIMILARITY ?? '0.48'),
  0.48,
);

/**
 * Score minimo del rerank de Cohere para conservar un chunk. `rerank-v3.5`
 * devuelve scores calibrados en [0,1]; por debajo de este piso el documento no
 * responde la consulta.
 *
 * SIN CALIBRAR y no calibrable hoy: `COHERE_API_KEY` no esta configurada en
 * ningun entorno, asi que esta rama no se ejecuta nunca. Cuando se active hay
 * que repetir el ejercicio de `scripts/rag-calibrate-threshold.ts` sobre los
 * scores del reranker. Mientras tanto el gate real vive en
 * `MIN_COSINE_SIMILARITY` + `requiereCorroboracionSemantica()`, que SI corren
 * en la ruta sin reranker. `RAG_MIN_RERANK_SCORE` lo ajusta.
 */
const MIN_RERANK_SCORE = clamp01(
  Number(process.env.RAG_MIN_RERANK_SCORE ?? '0.05'),
  0.05,
);

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) return fallback;
  return value;
}

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
  /**
   * Similaridad coseno (1 - distancia) frente a la consulta. `null` cuando el
   * chunk entro SOLO por el canal lexico (no supero el umbral vectorial).
   */
  cosine_sim: number | null;
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
  //   - vector_hits: top PER_CHANNEL_LIMIT por similaridad coseno, DESCARTANDO
  //     lo que no supere MIN_COSINE_SIMILARITY (ver constante).
  //   - lex_hits  : top PER_CHANNEL_LIMIT por ts_rank('spanish', plainto_tsquery).
  //   - fusion    : RRF score = sum(1 / (k + rank_i)) sobre cada canal donde aparece.
  //
  // Sin CTE `base` compartida: PostgreSQL solo inlinea una CTE referenciada UNA
  // vez; con tres referencias la materializaba y el `ORDER BY embedding <=> ...`
  // corria sobre un resultset intermedio SIN indices, anulando
  // `rag_chunks_hnsw_idx` y convirtiendo cada search_docs en un scan secuencial
  // del corpus del tenant. Ahora cada canal filtra directamente sobre
  // `rag_chunks` y el SELECT final vuelve por id.
  //
  // El filtro de distancia va FUERA del subselect ordenado (patron recomendado
  // por pgvector): dentro del WHERE impediria el index scan HNSW.
  //
  // `DISTINCT ON (md5(content))` en el SELECT final: el corpus tiene 51,4% de
  // chunks repetidos porque el ingest no es idempotente y corrio dos veces
  // (decreto_1625_2016.md: 9.800 chunks, 4.892 contenidos distintos). Sin
  // deduplicar, el especialista recibia 4,7 de 8 contenidos distintos — el 41%
  // de su ventana era el mismo parrafo dos veces, gastando tokens y reforzando
  // artificialmente lo duplicado frente a lo unico. Se conserva la copia con
  // mayor rrf_score y, entre empates, la que trae distancia vectorial (la que
  // aporta corroboracion semantica); el orden final vuelve a ser por
  // relevancia. Esto NO arregla la causa — hace falta un indice unico
  // (source, md5(content)) en el ingest — pero corta el sintoma en la ruta
  // caliente sin borrar una sola fila. Ver scripts/rag-corpus-dedup-report.ts.
  const filterClause: SQL = sql`${tenantClause} ${docTypeClause} ${entityClause} ${yearClause}`;

  const rows = await db.execute<ChunkRow>(sql`
    WITH vector_hits AS (
      SELECT id, dist, ROW_NUMBER() OVER (ORDER BY dist ASC) AS rnk
      FROM (
        SELECT id, embedding <=> ${embLiteral}::vector AS dist
        FROM rag_chunks
        WHERE ${filterClause}
        ORDER BY embedding <=> ${embLiteral}::vector ASC
        LIMIT ${PER_CHANNEL_LIMIT}
      ) v
      WHERE v.dist <= ${1 - MIN_COSINE_SIMILARITY}
    ),
    lex_hits AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY lex_rank DESC) AS rnk
      FROM (
        SELECT id, ts_rank(tsv, plainto_tsquery('spanish', ${query})) AS lex_rank
        FROM rag_chunks
        WHERE ${filterClause}
        AND tsv @@ plainto_tsquery('spanish', ${query})
        ORDER BY ts_rank(tsv, plainto_tsquery('spanish', ${query})) DESC
        LIMIT ${PER_CHANNEL_LIMIT}
      ) l
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
    SELECT * FROM (
      SELECT DISTINCT ON (md5(c.content))
        c.id,
        c.source,
        c.doc_type,
        c.entity,
        c.year,
        c.content,
        c.contextual_prefix,
        c.metadata,
        fused.rrf_score,
        (1 - vector_hits.dist) AS cosine_sim
      FROM fused
      JOIN rag_chunks c ON c.id = fused.id
      LEFT JOIN vector_hits ON vector_hits.id = fused.id
      ORDER BY md5(c.content), fused.rrf_score DESC, vector_hits.dist ASC NULLS LAST
    ) d
    ORDER BY d.rrf_score DESC
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

/**
 * Gate de corroboracion semantica. Corre SIEMPRE, con o sin reranker.
 *
 * Por que existe: `maybeRerank()` salia con `rows.slice(0, topN)` antes de
 * evaluar `MIN_RERANK_SCORE` cuando no hay `COHERE_API_KEY` — que es el estado
 * real de todos los entornos. El unico filtro vivo en esa ruta era el umbral
 * coseno del canal vectorial, y los chunks que entran SOLO por el canal lexico
 * (`cosine_sim === null`) lo esquivaban por completo: llegaban al especialista
 * rotulados "Fuente:" sin ninguna prueba semantica de que respondieran la
 * consulta. Basta una consulta de una palabra que aparezca en cualquier
 * decreto del corpus.
 *
 * Por que NO se les aplica el umbral coseno directamente: medido con
 * `scripts/rag-calibrate-threshold.ts`, los hits lexicos de consultas
 * normativas legitimas tienen p05 = 0.447 de coseno — por debajo de cualquier
 * umbral defendible. Filtrarlos costaria recall real (son los match exactos de
 * cita, "articulo 771-5") sin cerrar ninguna fuga: las 16 consultas-ruido de
 * control producen CERO hits lexicos, porque `plainto_tsquery` exige todos los
 * lexemas (semantica AND).
 *
 * La regla correcta es de corroboracion, no de puntaje: si el canal vectorial
 * no aporto ni un solo chunk sobre el umbral, el corpus no habla del tema y una
 * coincidencia de palabras no es una fuente. Si SI aporto, los hits lexicos
 * suman precision y se conservan enteros.
 */
function requiereCorroboracionSemantica(rows: ChunkRow[]): ChunkRow[] {
  if (rows.length === 0) return rows;
  const corroborado = rows.some((r) => r.cosine_sim != null);
  if (corroborado) return rows;
  console.info(
    `[vectorstore] descartados ${rows.length} hits SOLO-lexicos: ningun chunk ` +
      `supero el umbral coseno ${MIN_COSINE_SIMILARITY} ⇒ sin corroboracion semantica`,
  );
  return [];
}

async function maybeRerank(
  query: string,
  rows: ChunkRow[],
  topN: number,
): Promise<ChunkRow[]> {
  // Sin reranker el corte es puramente por ranking RRF; el gate de relevancia
  // ya se aplico aguas arriba (umbral coseno + corroboracion semantica).
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
    // Con reranker disponible, SU score manda como gate de relevancia: es una
    // senal cross-encoder mucho mejor que la distancia coseno del bi-encoder.
    // Un chunk que el reranker puntua por debajo del piso no responde la
    // consulta y no debe entregarse al especialista como "fuente".
    const kept = ranking.filter((r) => r.score >= MIN_RERANK_SCORE);
    if (kept.length === 0) {
      console.info(
        `[vectorstore] rerank descarto los ${ranking.length} candidatos ` +
          `(top score=${ranking[0]?.score ?? 'n/a'} < ${MIN_RERANK_SCORE})`,
      );
    }
    return kept.map((r) => rows[r.originalIndex]);
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
 * Mensaje unico de "sin fuente". Los prompts de especialista lo detectan por el
 * prefijo `NO_RESULTS:` para escalar a `search_web` o admitir desconocimiento.
 */
function noResultsMessage(): string {
  return [
    'NO_RESULTS: Ningun fragmento del corpus (Neon pgvector) supera el umbral de relevancia para esta consulta.',
    'ACCION OBLIGATORIA: invoca la tool "search_web" con una query enfocada en normativa colombiana',
    '(ej: "Art. 240 ET Ley 2277/2022 site:dian.gov.co") para obtener fuentes oficiales. NO inventes citas',
    'y NO respondas con normativa de memoria: si search_web tampoco encuentra, di que no hallaste fuente confiable.',
  ].join(' ');
}

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

    // Observabilidad para calibrar MIN_COSINE_SIMILARITY: sin este log no hay
    // forma de saber si el umbral esta cortando de mas o de menos.
    const top1Sim = rrfHits.reduce<number | null>(
      (acc, r) => (r.cosine_sim != null && (acc === null || r.cosine_sim > acc) ? r.cosine_sim : acc),
      null,
    );
    console.info(
      `[vectorstore] top1_sim=${top1Sim ?? 'n/a'} hits=${rrfHits.length} threshold=${MIN_COSINE_SIMILARITY}`,
    );

    // Gate de relevancia que SI corre sin COHERE_API_KEY (ver la funcion).
    const corroborados = requiereCorroboracionSemantica(rrfHits);

    if (corroborados.length === 0) {
      backendStatus = 'pgvector_empty';
      return noResultsMessage();
    }

    backendStatus = 'pgvector';
    const top = await maybeRerank(safeQuery, corroborados, safeK);

    // El reranker puede vaciar el conjunto: entregar cero fuentes es la
    // respuesta correcta, entregar chunks irrelevantes rotulados "Fuente:" no.
    if (top.length === 0) {
      backendStatus = 'pgvector_empty';
      return noResultsMessage();
    }

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
 * Si NO, queda como global (corpus oficial) — permitido SOLO para corpus
 * normativo, nunca para `user_upload` (ver la guardia mas abajo).
 *
 * Devuelve la cantidad de chunks insertados (0 si vectorizacion fallo).
 *
 * LANZA si un `user_upload` llega sin `workspaceId`.
 */
export async function addDocumentsToStore(
  texts: string[],
  metadata: Record<string, string>,
): Promise<number> {
  const workspaceId = metadata.workspaceId?.trim() || null;
  const docType = metadata.docType || 'user_upload';

  // -------------------------------------------------------------------------
  // Guardia multi-tenant. FUERA del try: un upload sin tenant es un error de
  // programacion del caller, no un fallo degradable.
  //
  // Modo de fallo que cierra: `workspace_id NULL` significa "corpus global", y
  // toda query de cualquier tenant incluye `workspace_id IS NULL`. Un documento
  // de cliente insertado sin workspaceId queda recuperable por CUALQUIER otro
  // tenant via `search_docs`. Ya paso: la auditoria 2026-08 encontro 1.892
  // chunks `user_upload` globales — tres balances de prueba y un documento de
  // defensa ante la DIAN de clientes reales (ultimo 2026-05-28). El leak del
  // lado del caller se cerro en 8ff6c0ab (2026-06-10), pero la libreria seguia
  // sin defensa propia y cualquier caller nuevo lo reabria en silencio.
  //
  // Por que lanzar y no devolver 0: devolver 0 es indistinguible de "el
  // embedding fallo" — el caller lo trata como no-critico y el bug vuelve a
  // pasar desapercibido, que es exactamente como llegamos a los 1.892 chunks.
  // Los residuos se limpian con `scripts/rag-purge-orphan-uploads.ts`.
  // -------------------------------------------------------------------------
  if (docType === 'user_upload' && !workspaceId) {
    throw new Error(
      `[vectorstore] Rechazado: doc_type='user_upload' sin workspaceId (source="${
        metadata.source ?? 'sin nombre'
      }"). Un chunk con workspace_id NULL entra al corpus GLOBAL y seria ` +
        'recuperable por cualquier otro tenant. Pasa metadata.workspaceId, o ' +
        'usa un docType de corpus normativo si el documento es publico.',
    );
  }

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
