// ---------------------------------------------------------------------------
// RAG ingestion pipeline (Neon pgvector + AI SDK).
// ---------------------------------------------------------------------------
//
// Lee `src/data/tax_docs/*.md`, hace chunking semantico con boundaries de
// articulos/secciones, opcionalmente genera contextual prefixes a la Anthropic,
// embed con `text-embedding-3-small` via AI SDK, y persiste todo en
// `rag_chunks` (workspace_id NULL = corpus global).
//
// Flags:
//   --docs-only         (compat con script viejo, ahora siempre vale para nosotros)
//   CONTEXTUAL_RETRIEVAL=1   habilita generacion de prefix contextual con LLM.
//                            Coste +30% en ingesta, -35% retrieval failures.
//                            Default: deshabilitado (los frontmatter ya dan
//                            un prefijo decente).
//   PURGE_BEFORE_INGEST=1   borra rows globales (`workspace_id IS NULL`) antes
//                           de insertar — uselo cuando rehagas todo el corpus.
//
// Uso:
//   npm run db:ingest
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import { sql } from 'drizzle-orm';
import { embedMany, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getDb } from '@/lib/db/client';
import { MODEL_IDS, MODELS } from '@/lib/config/models';
import { initRagSchema } from './init';

// Cargar .env.local cuando se corre por CLI (`tsx`).
dotenv.config({ path: '.env.local' });

if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY not found in .env.local.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error(
    'ERROR: DATABASE_URL not found in .env.local. Run `vercel env pull .env.local --yes` after `vercel integration add neon`.',
  );
  process.exit(1);
}

const docsPath = path.join(process.cwd(), 'src', 'data', 'tax_docs');
const contextualEnabled = process.env.CONTEXTUAL_RETRIEVAL === '1';
const purgeBeforeIngest = process.env.PURGE_BEFORE_INGEST === '1';
// SKIP_EXISTING=1 → no procesar archivos cuya `source` ya este en rag_chunks.
// Util para reanudar un ingest interrumpido sin re-procesar lo ya ingestado.
const skipExisting = process.env.SKIP_EXISTING === '1';

// Tuning for contextual retrieval: huge docs (E.T. completo, DUR, leyes >100KB)
// ya traen frontmatter rico con contexto — el prefix LLM agrega poco valor y
// genera miles de calls secuenciales que cuelgan el ingest. Threshold empirico:
// 100KB ≈ ~30 chunks. Files arriba usan static prefix (frontmatter).
const MAX_CONTEXTUAL_FILE_SIZE = 100 * 1024; // 100KB
const CONTEXTUAL_CONCURRENCY = 5;            // simultaneos LLM calls per file
const CONTEXTUAL_TIMEOUT_MS = 15_000;        // por call individual
const EMBED_TIMEOUT_MS = 90_000;             // por sub-batch de embeddings
const INSERT_TIMEOUT_MS = 30_000;            // por sub-batch de INSERT

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

function parseFrontmatter(text: string): {
  metadata: Record<string, string>;
  content: string;
} {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { metadata: {}, content: text };
  const metadata: Record<string, string> = {};
  match[1].split('\n').forEach((line) => {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      // Quita comillas envolventes (YAML strings tipo `year: "2023"` o `title: 'X'`).
      // Sin esto `Number('"2023"')` = NaN → Postgres rechaza el INSERT entero,
      // bloqueando ~360 normativos. Bug detectado tras corrida fallida 2026-05.
      const raw = rest.join(':').trim();
      const stripped = raw.replace(/^["']|["']$/g, '');
      metadata[key.trim()] = stripped;
    }
  });
  return { metadata, content: match[2] };
}

// ---------------------------------------------------------------------------
// Static contextual prefix from frontmatter (cheap, deterministic)
// ---------------------------------------------------------------------------

function getStaticPrefix(metadata: Record<string, string>, filename: string): string {
  const { type, number, year, entity } = metadata;
  if (type && number && year) {
    switch (type) {
      case 'ley':
        return `Ley ${number} de ${year} — Normativa tributaria colombiana aprobada por el Congreso.`;
      case 'decreto':
        return `Decreto ${number} de ${year} — Decreto reglamentario expedido por la Presidencia.`;
      case 'resolucion':
        if (entity === 'dian')
          return `Resolución DIAN ${number} de ${year} — Regulación administrativa de la DIAN.`;
        return `Resolución ${entity ? entity.toUpperCase() + ' ' : ''}${number} de ${year}.`;
      case 'circular':
        return `Circular ${entity ? entity.toUpperCase() + ' ' : ''}${number} de ${year} — Instrucciones operativas.`;
      case 'decision':
        return `Decisión CAN ${number} — Normativa de la Comunidad Andina de Naciones.`;
      case 'estatuto':
        return 'Estatuto Tributario de Colombia — Código fiscal principal.';
      default:
        break;
    }
  }
  if (type === 'estatuto') return 'Estatuto Tributario de Colombia — Código fiscal principal.';
  if (metadata.title) return metadata.title;
  return `Documento: ${filename}`;
}

// ---------------------------------------------------------------------------
// Anthropic-style contextual retrieval (optional)
// ---------------------------------------------------------------------------

const CONTEXTUAL_PROMPT = `Eres un asistente que ubica un fragmento dentro de un documento juridico-tributario completo.

DOCUMENTO COMPLETO:
{{DOCUMENT}}

FRAGMENTO:
{{CHUNK}}

Genera una sola oración (50-100 tokens) en español neutro que ubique el FRAGMENTO dentro del DOCUMENTO. Mencionar:
- Tipo de norma y año (Ley/Decreto/Resolución/Circular).
- Tema general del documento.
- Tema especifico del fragmento (articulo, capitulo, seccion).

NO incluyas el contenido del fragmento. NO uses listas. SOLO la oración de contexto.`;

async function generateContextualPrefix(
  doc: string,
  chunk: string,
  staticPrefix: string,
): Promise<string> {
  // Truncamos el documento completo para no quemar tokens — los primeros
  // ~10K chars son suficientes para frontmatter + indice + cabecera.
  const trimmedDoc = doc.length > 10000 ? doc.slice(0, 10000) : doc;
  try {
    const { text } = await generateText({
      model: MODELS.CHAT,
      prompt: CONTEXTUAL_PROMPT.replace('{{DOCUMENT}}', trimmedDoc).replace(
        '{{CHUNK}}',
        chunk,
      ),
      maxOutputTokens: 200,
      abortSignal: AbortSignal.timeout(CONTEXTUAL_TIMEOUT_MS),
    });
    const cleaned = text.trim().replace(/^"|"$/g, '');
    return cleaned || staticPrefix;
  } catch (err) {
    // No spamear consola con cada timeout — el fallback es seguro.
    if (err instanceof Error && !err.message.includes('aborted') && !err.message.includes('timeout')) {
      console.warn(
        '  WARN: contextual prefix generation failed, using static fallback:',
        err.message,
      );
    }
    return staticPrefix;
  }
}

/** Async pool simple sin dependencias: ejecuta tareas con concurrencia limitada. */
async function asyncPool<T, R>(
  concurrency: number,
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(runners);
  return results;
}

/**
 * Promise.race con setTimeout que rejecta con error claro si la promesa no
 * resuelve a tiempo. Necesario porque ni `embedMany` ni `db.execute` aceptan
 * AbortSignal en sus firmas actuales — sin esto un socket colgado de OpenAI o
 * Neon duerme el ingest indefinidamente (vimos 13h con 0% CPU).
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Main ingestion
// ---------------------------------------------------------------------------

interface ChunkRecord {
  source: string;
  docType: string;
  entity: string | null;
  year: number | null;
  number: string | null;
  content: string;
  contextualPrefix: string;
}

async function ingestData() {
  console.log('Starting Colombian tax/accounting document ingestion (Neon pgvector)...');
  console.log(`Contextual retrieval: ${contextualEnabled ? 'ENABLED (gpt-5.4-mini)' : 'disabled (frontmatter only)'}`);
  console.log(`Purge before ingest:   ${purgeBeforeIngest ? 'YES (workspace_id IS NULL)' : 'no'}\n`);

  if (!fs.existsSync(docsPath)) {
    console.log(`Creating tax_docs directory at: ${docsPath}`);
    fs.mkdirSync(docsPath, { recursive: true });
  }

  const allFiles = fs
    .readdirSync(docsPath)
    .filter((f) => f.endsWith('.md') || f.endsWith('.txt'));

  if (allFiles.length === 0) {
    console.log('No documents found in tax_docs directory. Add Colombian tax documents and run again.');
    console.log(`Expected path: ${docsPath}`);
    return;
  }

  console.log(`Found ${allFiles.length} files in tax_docs/\n`);

  // Inicializar schema (idempotente).
  await initRagSchema();

  if (purgeBeforeIngest) {
    console.log('Purging existing global corpus rows (workspace_id IS NULL)...');
    const db = getDb();
    await db.execute(sql`DELETE FROM rag_chunks WHERE workspace_id IS NULL`);
  }

  // Resume mode: cargar set de sources ya ingestados (workspace_id IS NULL) para
  // saltarlos y procesar solo lo faltante. Mutuamente excluyente con purge.
  let alreadyIngested = new Set<string>();
  if (skipExisting && !purgeBeforeIngest) {
    const db = getDb();
    const existing = await db.execute(
      sql`SELECT DISTINCT source FROM rag_chunks WHERE workspace_id IS NULL`,
    );
    alreadyIngested = new Set(
      (existing.rows as Array<{ source: string }>).map((r) => r.source),
    );
    console.log(`Resume mode: ${alreadyIngested.size} files already in DB will be skipped.\n`);
  }

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 3000,
    chunkOverlap: 600,
    separators: ['\n## ', '\n### ', '\n#### ', '\n\n', '\n', '. ', ' '],
  });

  const db = getDb();
  const EMBED_BATCH = 100;          // OpenAI embeddings: max ~300K tokens / req
  const INSERT_BATCH = 200;          // Postgres: cubre overhead RTT por batch

  let processed = 0;
  let skipped = 0;
  let totalChunks = 0;
  let contextualUsed = 0;
  let contextualSkippedHuge = 0;

  // Per-file pipeline: chunk → contextual (parallel, size-gated) → embed → insert.
  // Si una file falla, NO bloquea las demás (catch + skipped++).
  // Progreso se preserva en DB inmediatamente — un crash no pierde lo ingestado.
  let resumeSkipped = 0;
  for (const file of allFiles) {
    if (alreadyIngested.has(file)) {
      resumeSkipped++;
      continue;
    }
    const fileStart = Date.now();
    try {
      const filePath = path.join(docsPath, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const fileSize = Buffer.byteLength(raw, 'utf-8');
      const { metadata, content } = parseFrontmatter(raw);
      const staticPrefix = getStaticPrefix(metadata, file);
      const textChunks = await textSplitter.splitText(content);

      if (textChunks.length === 0) {
        skipped++;
        console.warn(`  WARN: ${file} produced 0 chunks — skipped.`);
        continue;
      }

      // Decision: usar contextual LLM o solo static prefix.
      // Files >100KB: ya traen frontmatter rico (year, entity, type, slug, tags),
      // y miles de LLM calls × 2-15s cada uno = horas. Static es suficiente.
      const useContextual =
        contextualEnabled && fileSize <= MAX_CONTEXTUAL_FILE_SIZE;
      if (contextualEnabled && !useContextual) contextualSkippedHuge++;

      const prefixes: string[] = useContextual
        ? await asyncPool(CONTEXTUAL_CONCURRENCY, textChunks, async (chunk) => {
            contextualUsed++;
            return generateContextualPrefix(content, chunk, staticPrefix);
          })
        : textChunks.map(() => staticPrefix);

      const fileRecords: ChunkRecord[] = textChunks.map((chunk, i) => ({
        source: file,
        docType: metadata.type || 'unknown',
        entity: metadata.entity || null,
        year: metadata.year ? Number(metadata.year) : null,
        number: metadata.number || null,
        content: chunk,
        contextualPrefix: prefixes[i],
      }));

      // Embed en sub-batches (algunos files producen >300 chunks → varios calls).
      // Timeout 90s por sub-batch — sin esto OpenAI puede colgar el socket y
      // dormir el ingest indefinidamente (vimos 13h con 0% CPU en sesion previa).
      const embeddings: number[][] = [];
      for (let i = 0; i < fileRecords.length; i += EMBED_BATCH) {
        const slice = fileRecords.slice(i, i + EMBED_BATCH);
        const { embeddings: batch } = await withTimeout(
          embedMany({
            model: openai.embedding(MODEL_IDS.EMBEDDINGS),
            values: slice.map((r) => `${r.contextualPrefix}\n\n${r.content}`),
            maxParallelCalls: 5,
          }),
          EMBED_TIMEOUT_MS,
          `embedMany ${file} batch ${i}/${fileRecords.length}`,
        );
        embeddings.push(...batch);
      }

      // Insert en sub-batches (cubre overhead RTT — un solo INSERT con 200 rows
      // es ~10x más rápido que 200 INSERT separados). Timeout 30s — Neon a veces
      // queda colgada en TLS handshake post-suspend.
      for (let i = 0; i < fileRecords.length; i += INSERT_BATCH) {
        const sliceRecords = fileRecords.slice(i, i + INSERT_BATCH);
        const sliceEmbeddings = embeddings.slice(i, i + INSERT_BATCH);
        const values = sliceRecords.map((r, j) => {
          const embLit = `[${sliceEmbeddings[j].join(',')}]`;
          const meta = JSON.stringify({
            number: r.number,
            sourceType: 'global_corpus',
          });
          return sql`(
            NULL,
            ${r.source},
            ${r.docType},
            ${r.entity},
            ${r.year},
            ${r.content},
            ${r.contextualPrefix},
            ${embLit}::vector,
            ${meta}::jsonb
          )`;
        });

        await withTimeout(
          db.execute(sql`
            INSERT INTO rag_chunks (
              workspace_id, source, doc_type, entity, year, content, contextual_prefix, embedding, metadata
            ) VALUES ${sql.join(values, sql`, `)}
          `),
          INSERT_TIMEOUT_MS,
          `INSERT ${file} batch ${i}/${fileRecords.length}`,
        );
      }

      totalChunks += fileRecords.length;
      processed++;
      const elapsed = ((Date.now() - fileStart) / 1000).toFixed(1);
      const tag = useContextual ? 'ctx' : (contextualEnabled ? 'static-huge' : 'static');
      console.log(
        `  [${processed}/${allFiles.length}] ${file} → ${fileRecords.length} chunks (${tag}, ${elapsed}s) · total ${totalChunks}`,
      );
    } catch (err) {
      skipped++;
      console.warn(`  WARN: Skipping ${file} — ${(err as Error).message}`);
    }
  }

  console.log(
    `\nIngestion complete. Files: ${processed} processed / ${skipped} skipped` +
      (resumeSkipped > 0 ? ` / ${resumeSkipped} resumed-from-DB` : '') +
      `. Chunks: ${totalChunks} new total.` +
      (contextualEnabled
        ? ` Contextual: ${contextualUsed} calls, ${contextualSkippedHuge} files >100KB usaron static.`
        : ''),
  );
  console.log('RAG system ready. Hybrid BM25+vector search active.');
}

ingestData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error during ingestion:', error);
    process.exit(1);
  });
