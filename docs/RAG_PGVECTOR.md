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
   - `vector_hits` = top 30 por `embedding <=> $vec` ASC, **filtrado a
     `cosine >= MIN_COSINE_SIMILARITY` (0.48)**.
   - `lex_hits`    = top 30 por `ts_rank(tsv, plainto_tsquery('spanish', $q))` DESC.
   - `fused`       = `SUM(1 / (60 + rank_i))` por id, ordenado DESC.
   - SELECT final con **`DISTINCT ON (md5(content))`** (ver "Duplicacion").
3. **Gate de corroboracion semantica** (corre siempre, ver abajo).
4. Top 30 al rerank Cohere (si `COHERE_API_KEY`) ⇒ top K final. Sin
   Cohere se devuelve top K del RRF.

### Gate de relevancia — por que hay dos

Sin un umbral, `ORDER BY embedding <=> q LIMIT 30` devuelve SIEMPRE los 30
vecinos mas cercanos exista o no algo relevante, y `NO_RESULTS` — el unico
disparador del rail anti-alucinacion de los especialistas — es inalcanzable con
corpus no vacio. El agente entonces redacta con aplomo sobre chunks rotulados
`Fuente:` que no responden la pregunta.

Hay dos gates porque las dos rutas de entrada son distintas:

| Gate | Se aplica a | Valor | Calibrado |
|---|---|---|---|
| `MIN_COSINE_SIMILARITY` | canal vectorial | **0.48** | si, 2026-08 (abajo) |
| corroboracion semantica | hits SOLO-lexicos | — | si, mismo ejercicio |
| `MIN_RERANK_SCORE` | salida de Cohere | 0.05 | **no** — `COHERE_API_KEY` no existe en ningun entorno, esa rama nunca corre |

El gate de **corroboracion semantica** existe porque `maybeRerank()` sale con
`rows.slice(0, topN)` antes de evaluar `MIN_RERANK_SCORE` cuando no hay
`COHERE_API_KEY`: en la practica ese filtro es codigo muerto. Sin el, un chunk
que entra solo por coincidencia de lexemas (`cosine_sim = null`) llegaba al
especialista sin ninguna prueba semantica. La regla es de corroboracion, no de
puntaje: **si el canal vectorial no aporto ni un chunk sobre el umbral, una
coincidencia de palabras no es una fuente**. Si aporto, los hits lexicos se
conservan enteros — su coseno p05 es 0.447, por debajo de cualquier umbral
defendible, y filtrarlos costaria los match exactos de cita (`articulo 771-5`).

### Calibracion del umbral (2026-08)

`scripts/rag-calibrate-threshold.ts`, contra la base de produccion: 20 consultas
normativas colombianas reales (incluidas citas cortas estilo tool-call) vs. 16
consultas-ruido de control, seis adversariales (tramites y salud en Colombia —
el corpus incluye Codigo Penal, Codigo de Minas y resoluciones de MinSalud).

| Poblacion | Medida | Valor |
|---|---|---|
| ruido | top1 max | **0.447** (`"instrucciones para armar un mueble de melamina"`) |
| normativa | top1 min | 0.545 (`"Art. 240 E.T. tarifa"`) |
| normativa | rank-30 min | **0.508** |
| ruido | hits lexicos | **0 en 16/16 consultas** (`plainto_tsquery` es AND) |

Separacion limpia. La banda que conserva el 100% del recall con 0% de fuga es
`[0.448, 0.508]`; **0.48 es su punto medio** (+0.033 sobre el ruido, −0.028 bajo
la normativa peor rankeada).

El 0.30 anterior (nunca calibrado) dejaba pasar el **69% de las consultas-ruido**
con 12,3 chunks de promedio: la consulta de control `"receta de arepas de choclo
con queso"` (top1 = 0.355) entregaba sus 30 candidatos como `Fuente:`.

Recalibrar tras cualquier cambio de modelo de embeddings o ampliacion grande del
corpus:

```bash
npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.scripts.json \
  scripts/rag-calibrate-threshold.ts
```

## Duplicacion del corpus

Medido 2026-08 con `scripts/rag-corpus-dedup-report.ts`: **71.273 chunks pero
34.648 contenidos distintos (51,4% redundante)**. La forma importa — 35.240
copias sobrantes estan **dentro del mismo `source`** (el ingest no es idempotente
y corrio dos veces: `decreto_1625_2016.md` tiene 9.800 chunks y 4.892 distintos)
y solo 1.385 son texto compartido entre normas distintas.

Coste real, no teorico: el especialista recibia **4,7 de 8 contenidos distintos —
el 41% de su ventana era el mismo parrafo repetido**, gastando tokens y
reforzando artificialmente lo duplicado frente a lo unico.

- **Aplicado**: `DISTINCT ON (md5(content))` en el SELECT final de
  `hybridSearch`, conservando la copia de mayor `rrf_score` y, entre empates, la
  que trae distancia vectorial. Medido despues: **8,0/8 distintos**. No borra
  una sola fila.
- **Pendiente (fuera de la frontera del RAG)**: indice unico
  `(source, md5(content))` o UPSERT en el ingest. Es la causa. Sin el, borrar
  filas a mano no sirve: el siguiente `npm run db:ingest` las repone.

### `addDocumentsToStore(texts, metadata)`

Chunkea (~1000 chars, overlap 250), embed con `embedMany` (parallel = 5)
e inserta.

**LANZA si `docType === 'user_upload'` y no viene `metadata.workspaceId`.**
`workspace_id NULL` significa "corpus global" y toda query de todo tenant
incluye esa condicion, asi que un documento de cliente sin tenant queda
recuperable por cualquier otro cliente. Lanza en vez de devolver 0 porque un 0
es indistinguible de "el embedding fallo": el caller lo trata como no-critico y
el bug vuelve a pasar desapercibido — que es exactamente como se acumularon los
1.892 chunks huerfanos (ver abajo). Los `docType` de corpus normativo si pueden
ir sin `workspaceId`.

### `invalidateVectorStore()`

No-op (Postgres es transactionally consistent). Se preserva por
compatibilidad con el upload route.

## Variables de entorno

| Var                      | Default                    | Notas                                                         |
|--------------------------|----------------------------|---------------------------------------------------------------|
| `OPENAI_API_KEY`         | requerido                  | Ya provisionada — embeddings + LLMs.                         |
| `DATABASE_URL`           | requerido (pooled)         | Endpoint `*-pooler.<region>.aws.neon.tech` de Neon.         |
| `COHERE_API_KEY`         | opcional                   | Activa rerank Cohere. Sin ella se usa RRF puro (y `MIN_RERANK_SCORE` no corre). |
| `RAG_MIN_COSINE_SIMILARITY` | `0.48`                  | Umbral del canal vectorial. Calibrado — ver "Calibracion".    |
| `RAG_MIN_RERANK_SCORE`   | `0.05`                     | Piso del rerank Cohere. Sin calibrar (esa rama no corre hoy). |
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

### Uploads huerfanos en el corpus global (residuo historico)

La auditoria 2026-08 encontro **1.892 chunks con `doc_type='user_upload'` y
`workspace_id NULL`** en produccion: cuatro documentos de clientes reales (tres
balances de prueba y un requerimiento de IVA de la DIAN), fechados entre
2026-05-05 y 2026-05-28.

No es un bug vivo: `/api/upload` dejo de indexar sin workspace el 2026-06-10
(commit `8ff6c0ab`) y desde 2026-08 la libreria lo rechaza duro. Son residuos de
antes del fix, pero **siguen siendo recuperables hoy por cualquier tenant**.

Inventario y purga con `scripts/rag-purge-orphan-uploads.ts` — dry-run por
defecto, y el borrado exige `--borrar --confirmar <N>` con el conteo exacto que
reporto el inventario (ancla el DELETE a lo que se reviso; si el conteo cambio,
aborta):

```bash
# inventario, no escribe nada
npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.scripts.json \
  scripts/rag-purge-orphan-uploads.ts

# borrado real
... scripts/rag-purge-orphan-uploads.ts --borrar --confirmar 1892
```

Es una decision del dueno del dato, no del pipeline: los documentos deberian
re-subirse por su dueno para quedar indexados con `workspace_id`.

## Migration plan (proximas olas)

- ~~**Ola 1 — upload route con workspaceId**~~: HECHO (`8ff6c0ab`, 2026-06-10).
  El upload route resuelve el workspace y no indexa si no puede; la libreria
  ademas lanza. Queda pendiente purgar el residuo historico (ver arriba).
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
