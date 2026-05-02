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
    if (key && rest.length) metadata[key.trim()] = rest.join(':').trim();
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
    });
    const cleaned = text.trim().replace(/^"|"$/g, '');
    return cleaned || staticPrefix;
  } catch (err) {
    console.warn(
      '  WARN: contextual prefix generation failed, using static fallback:',
      err instanceof Error ? err.message : err,
    );
    return staticPrefix;
  }
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

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 3000,
    chunkOverlap: 600,
    separators: ['\n## ', '\n### ', '\n#### ', '\n\n', '\n', '. ', ' '],
  });

  const records: ChunkRecord[] = [];
  let processed = 0;
  let skipped = 0;

  for (const file of allFiles) {
    try {
      const filePath = path.join(docsPath, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { metadata, content } = parseFrontmatter(raw);
      const staticPrefix = getStaticPrefix(metadata, file);

      const textChunks = await textSplitter.splitText(content);

      for (const chunk of textChunks) {
        const prefix = contextualEnabled
          ? await generateContextualPrefix(content, chunk, staticPrefix)
          : staticPrefix;
        records.push({
          source: file,
          docType: metadata.type || 'unknown',
          entity: metadata.entity || null,
          year: metadata.year ? Number(metadata.year) : null,
          number: metadata.number || null,
          content: chunk,
          contextualPrefix: prefix,
        });
      }

      processed++;
      if (processed % 20 === 0) {
        console.log(
          `  Processed ${processed}/${allFiles.length} files (${records.length} chunks so far)...`,
        );
      }
    } catch (err) {
      skipped++;
      console.warn(`  WARN: Skipping ${file} — ${(err as Error).message}`);
    }
  }

  console.log(
    `\nProcessed ${processed} files (${skipped} skipped) -> ${records.length} chunks total.`,
  );

  // ---------------------------------------------------------------------
  // Embeddings (batched via AI SDK embedMany)
  // ---------------------------------------------------------------------
  console.log(`Generating embeddings via OpenAI (${MODEL_IDS.EMBEDDINGS})...`);
  const EMBED_BATCH = 100; // text-embedding-3-small max ~300K tokens per request
  const embeddings: number[][] = [];

  for (let i = 0; i < records.length; i += EMBED_BATCH) {
    const slice = records.slice(i, i + EMBED_BATCH);
    const { embeddings: batch } = await embedMany({
      model: openai.embedding(MODEL_IDS.EMBEDDINGS),
      values: slice.map((r) => `${r.contextualPrefix}\n\n${r.content}`),
      maxParallelCalls: 5,
    });
    embeddings.push(...batch);
    console.log(`  Embedded ${embeddings.length}/${records.length}`);
  }

  // ---------------------------------------------------------------------
  // Insert (batched)
  // ---------------------------------------------------------------------
  console.log('Inserting chunks into rag_chunks...');
  const db = getDb();
  const INSERT_BATCH = 200;

  for (let i = 0; i < records.length; i += INSERT_BATCH) {
    const sliceRecords = records.slice(i, i + INSERT_BATCH);
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

    await db.execute(sql`
      INSERT INTO rag_chunks (
        workspace_id, source, doc_type, entity, year, content, contextual_prefix, embedding, metadata
      ) VALUES ${sql.join(values, sql`, `)}
    `);

    console.log(`  Inserted ${Math.min(i + INSERT_BATCH, records.length)}/${records.length}`);
  }

  console.log(`\nIngestion complete. ${records.length} chunks in rag_chunks (workspace_id IS NULL).`);
  console.log('RAG system ready. Hybrid BM25+vector search active.');
}

ingestData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error during ingestion:', error);
    process.exit(1);
  });
