// ---------------------------------------------------------------------------
// RAG schema initialization (idempotent).
// ---------------------------------------------------------------------------
//
// Crea la extension `vector`, la tabla `rag_chunks` y los indices HNSW + GIN
// si no existen. Se llama lazy desde `searchDocuments()` y `addDocumentsToStore()`
// en el primer uso por cada Fluid Compute instance, gobernado por un flag
// in-memory para no spammear DDL en cada request.
//
// Por que no via drizzle-kit:
//   - El Agente 0.C maneja el journal de migraciones de Drizzle. El RAG
//     necesita primitivas (extension `vector`, columna GENERATED tsvector,
//     indice HNSW con `vector_cosine_ops`) que la introspeccion de
//     drizzle-kit aun no genera correctamente.
//   - `CREATE ... IF NOT EXISTS` es idempotente y barato cuando ya existen.
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';

let initPromise: Promise<void> | null = null;

/**
 * Idempotent. Crea extension, tabla, columna generada tsvector e indices.
 * Se memoiza con `initPromise` para que multiples requests concurrentes en
 * la misma instancia compartan una sola DDL roundtrip.
 */
export function initRagSchema(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const db = getDb();
    // 1. Extension pgvector (Neon Marketplace ya la incluye en planes serverless).
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

    // 2. Tabla. La columna `tsv` es GENERATED ALWAYS AS ... STORED — esto le
    //    da BM25 sin tener que mantenerla manualmente en cada INSERT/UPDATE.
    //    `coalesce` defiende del caso `contextual_prefix` NULL.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS rag_chunks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid,
        source text NOT NULL,
        doc_type varchar(64),
        entity varchar(64),
        year integer,
        section text,
        content text NOT NULL,
        contextual_prefix text,
        embedding vector(1536) NOT NULL,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        tsv tsvector GENERATED ALWAYS AS (
          to_tsvector('spanish', coalesce(contextual_prefix, '') || ' ' || content)
        ) STORED
      )
    `);

    // 3. Indices: GIN para BM25 lexico, HNSW para coseno semantico, btree
    //    para tenant filter. Todos `IF NOT EXISTS` ⇒ idempotente.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS rag_chunks_tsv_idx
        ON rag_chunks USING GIN (tsv)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS rag_chunks_hnsw_idx
        ON rag_chunks USING hnsw (embedding vector_cosine_ops)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS rag_chunks_ws_idx
        ON rag_chunks (workspace_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS rag_chunks_source_idx
        ON rag_chunks (source)
    `);
  })().catch((err) => {
    // Permitir reintentar si la primera vez falla (ej. Neon en cold start).
    initPromise = null;
    throw err;
  });
  return initPromise;
}

/** Para tests / scripts: forzar re-init en el siguiente uso. */
export function resetRagInit(): void {
  initPromise = null;
}
