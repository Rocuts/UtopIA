# RAG sobre Neon pgvector

> Migracion completada en Ola 0.D (mayo 2026). Reemplaza el HNSWLib local que en
> Vercel se degradaba a `MemoryVectorStore` vacio porque el index ocupaba 285 MB
> (limite del bundle de Functions = 250 MB). En produccion el RAG estaba VACIO
> en cold start y los agentes caian a `search_web` siempre.

## Arquitectura

- **Almacenamiento**: tabla `rag_chunks` en Neon Postgres con extension
  `pgvector` 0.8.
- **Hybrid search**: BM25 (`tsvector('spanish')` con GIN index) +
  similaridad coseno (HNSW index sobre `vector(1536)`), fusionados con
  Reciprocal Rank Fusion (k = 60).
- **Reranking**: opcional, `cohere/rerank-v3.5` (multilingue) via AI SDK
  v6 native `rerank()`. Si `COHERE_API_KEY` no esta seteada, se usa el
  ranking RRF directo.
- **Embeddings**: `text-embedding-3-small` (1536 dim, $0.02/1M tokens)
  via `embedMany` de `@ai-sdk/openai`. El provider chain es el mismo que
  el resto del codebase, eliminando la dependencia que tenia
  `@langchain/openai` para abrir su propio cliente.
- **Multi-tenant**: la columna `workspace_id` es nullable. `NULL` ⇒
  corpus global (E.T., NIIF, decretos, doctrina DIAN). Un UUID ⇒
  documentos subidos por ese tenant especifico. Las queries de un
  tenant siempre incluyen `(workspace_id IS NULL OR workspace_id = $tenant)`.

## Schema (`src/lib/db/schema.ts` → `ragChunks`)

```sql
rag_chunks (
  id                uuid PK,
  workspace_id      uuid NULL,            -- NULL = global, UUID = tenant
  source            text NOT NULL,        -- nombre de archivo o etiqueta logica
  doc_type          varchar(64),          -- 'ley' | 'decreto' | 'niif' | 'user_upload' | ...
  entity            varchar(64),          -- 'DIAN' | 'CTCP' | ...
  year              integer,
  section           text,
  content           text NOT NULL,
  contextual_prefix text,                 -- patron Anthropic Contextual Retrieval
  embedding         vector(1536) NOT NULL,
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  tsv               tsvector GENERATED ALWAYS AS (
                      to_tsvector('spanish', coalesce(contextual_prefix,'') || ' ' || content)
                    ) STORED
)

INDEX rag_chunks_tsv_idx     USING GIN (tsv)
INDEX rag_chunks_hnsw_idx    USING hnsw (embedding vector_cosine_ops)
INDEX rag_chunks_ws_idx      ON (workspace_id)
INDEX rag_chunks_source_idx  ON (source)
```

La columna `tsv` es `GENERATED ALWAYS AS ... STORED` — Drizzle aun no
emite esa sintaxis, asi que la creacion DDL real vive en
`src/lib/rag/init.ts` con `CREATE TABLE IF NOT EXISTS`. Es idempotente y
se llama lazy desde la primera invocacion de `searchDocuments` o
`addDocumentsToStore`.

## API

### `searchDocuments(query, k?, filter?)`

Devuelve un string formateado listo para alimentar a un LLM. Filtros
soportados:

| Campo            | Tipo                | Comportamiento                                    |
|------------------|---------------------|---------------------------------------------------|
| `workspaceId`    | `string` (uuid)     | Busca en `NULL ∪ tenant`. Default: solo global.  |
| `docType`        | `string`            | Filtro exacto (alias compat: `type`).            |
| `entity`         | `string`            | Filtro exacto.                                    |
| `year`           | `number \| string`  | Filtro exacto.                                    |

Algoritmo:

1. `embedMany(value=[query])` ⇒ vector 1536d.
2. CTE en SQL:
   - `vector_hits` = top 30 por `embedding <=> $vec` ASC.
   - `lex_hits`    = top 30 por `ts_rank(tsv, plainto_tsquery('spanish', $q))` DESC.
   - `fused`       = `SUM(1 / (60 + rank_i))` por id, ordenado DESC.
3. Top 30 al rerank Cohere (si `COHERE_API_KEY`) ⇒ top K final. Sin
   Cohere se devuelve top K del RRF.

### `addDocumentsToStore(texts, metadata)`

Chunkea (~1000 chars, overlap 250), embed con `embedMany` (parallel = 5)
e inserta. `metadata.workspaceId` opcional; sin el, queda como global.

### `invalidateVectorStore()`

No-op (Postgres es transactionally consistent). Se preserva por
compatibilidad con el upload route.

## Variables de entorno

| Var                      | Default                    | Notas                                                         |
|--------------------------|----------------------------|---------------------------------------------------------------|
| `OPENAI_API_KEY`         | requerido                  | Ya provisionada — embeddings + LLMs.                         |
| `DATABASE_URL`           | requerido (pooled)         | Endpoint `*-pooler.<region>.aws.neon.tech` de Neon.         |
| `COHERE_API_KEY`         | opcional                   | Activa rerank Cohere. Sin ella se usa RRF puro.              |
| `OPENAI_MODEL_EMBEDDINGS`| `text-embedding-3-small`   | Override solo si cambias el modelo (recordar cambiar dims).  |
| `CONTEXTUAL_RETRIEVAL`   | `0`                        | `1` activa generacion de prefix LLM (Anthropic style) en ingest. |
| `PURGE_BEFORE_INGEST`    | `0`                        | `1` borra rows globales antes de re-ingestar el corpus.      |

## Ingesta (corpus global, `npm run db:ingest`)

```bash
# Ingestar src/data/tax_docs/*.md como corpus global
npm run db:ingest

# Ingestar y purgar primero (re-ejecucion limpia)
PURGE_BEFORE_INGEST=1 npm run db:ingest

# Activar contextual retrieval (Anthropic-style, +30% coste, -35% retrieval failures)
CONTEXTUAL_RETRIEVAL=1 npm run db:ingest
```

`db:ingest` carga `.env.local` automaticamente (via `dotenv`), llama
`initRagSchema()` (idempotente) y bulk-inserta en lotes de 200.

## Comportamiento multi-tenant

- **Lectura global** (default): `searchDocuments(q)` busca solo en
  `workspace_id IS NULL` ⇒ E.T., decretos, doctrina, etc.
- **Lectura del tenant**: `searchDocuments(q, k, { workspaceId })` busca
  en `global ∪ tenant`. Asi un tendero que sube su factura puede
  encontrarla y a la vez seguir teniendo acceso al Estatuto.
- **Escritura por tenant**: `addDocumentsToStore(text, { workspaceId, source, docType: 'user_upload' })`.
- **Aislamiento**: nunca buscamos `workspace_id = $A` desde el tenant
  `$B`. La clausula es siempre `(workspace_id IS NULL OR workspace_id = $self)`.

## Migration plan (proximas olas)

- **Ola 1 — upload route con workspaceId**: cuando la cookie
  `utopia_workspace_id` se vuelva el-pivote-canonico para uploads, el
  upload route pasara `workspaceId` a `addDocumentsToStore`. Hoy los
  uploads quedan como `global` (visible para todos los tenants) hasta
  que esa cookie sea garantia.
- **Ola 2 — limpiar deps legacy**: remover `hnswlib-node`,
  `@langchain/community/vectorstores/*`, y eventualmente
  `@langchain/openai` cuando ningun consumer lo importe.
- **Ola 3 — ingesta normatividad 2026**: ingest masivo de
  Ley 2277/2022, Decreto 1265/2025, Resoluciones DIAN 2026,
  jurisprudencia Consejo de Estado, ZOMAC/ZF.

## Acciones manuales del usuario

1. **`COHERE_API_KEY`** (opcional, recomendado): provisionarla en Vercel
   (`vercel env add COHERE_API_KEY production`) cuando se quiera activar
   rerank. Sin ella el sistema funciona usando RRF directo.
2. **Re-ingest**: ejecutar `PURGE_BEFORE_INGEST=1 npm run db:ingest` la
   primera vez tras desplegar (la tabla en pgvector arranca vacia; el
   index 285 MB del HNSWLib viejo no se migra).
