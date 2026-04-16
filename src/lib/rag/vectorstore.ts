import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import type { VectorStore } from '@langchain/core/vectorstores';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------

/**
 * Returns the correct storage path depending on the runtime environment.
 * Vercel serverless functions have a read-only filesystem except for /tmp.
 */
export function getStoragePath(subdir: string): string {
  if (process.env.VERCEL) {
    return path.join('/tmp', subdir);
  }
  return path.join(process.cwd(), 'src', 'data', subdir);
}

/**
 * On Vercel, the bundled data files are read-only at process.cwd().
 * Returns the bundled path if it exists, otherwise /tmp.
 */
function getReadablePath(subdir: string): string {
  if (process.env.VERCEL) {
    const bundled = path.join(process.cwd(), 'src', 'data', subdir);
    try {
      if (fs.existsSync(bundled)) return bundled;
    } catch { /* fall through */ }
    return path.join('/tmp', subdir);
  }
  return path.join(process.cwd(), 'src', 'data', subdir);
}

// ---------------------------------------------------------------------------
// Singleton vector store with HNSWLib → MemoryVectorStore fallback
// ---------------------------------------------------------------------------

let cachedStore: VectorStore | null = null;
let cachedEmbeddings: OpenAIEmbeddings | null = null;
let usingMemoryFallback = false;

function getEmbeddings(): OpenAIEmbeddings {
  if (!cachedEmbeddings) {
    cachedEmbeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small',
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
  }
  return cachedEmbeddings;
}

/**
 * Try loading HNSWLib (native C++). If it fails (e.g. on Vercel serverless
 * where the native binary isn't available), fall back to MemoryVectorStore
 * (pure JS, works everywhere but is ephemeral).
 */
async function createStore(): Promise<VectorStore> {
  const embeddings = getEmbeddings();
  const vectorStorePath = getReadablePath('vector_store');

  // Attempt 1: HNSWLib (fast, persistent, requires native addon)
  try {
    const { HNSWLib } = await import('@langchain/community/vectorstores/hnswlib');
    const store = await HNSWLib.load(vectorStorePath, embeddings);
    console.log('[vectorstore] Loaded HNSWLib from disk:', vectorStorePath);
    return store;
  } catch (hnswError) {
    console.warn(
      '[vectorstore] HNSWLib unavailable:',
      hnswError instanceof Error ? hnswError.message : hnswError,
    );
  }

  // Attempt 2: MemoryVectorStore (pure JS, no native deps, ephemeral)
  try {
    const { MemoryVectorStore } = await import('@langchain/classic/vectorstores/memory');
    const store = new MemoryVectorStore(embeddings);
    usingMemoryFallback = true;
    console.log('[vectorstore] Using MemoryVectorStore fallback (ephemeral, no native deps).');
    return store;
  } catch (memError) {
    console.warn(
      '[vectorstore] MemoryVectorStore also failed:',
      memError instanceof Error ? memError.message : memError,
    );
  }

  // Attempt 3: Bare minimum — empty placeholder that won't crash
  const { MemoryVectorStore } = await import('@langchain/classic/vectorstores/memory');
  usingMemoryFallback = true;
  return new MemoryVectorStore(embeddings);
}

/**
 * Returns a singleton vector store instance.
 * Uses HNSWLib when available, falls back to MemoryVectorStore.
 */
export async function getVectorStore(): Promise<VectorStore> {
  if (cachedStore) return cachedStore;
  cachedStore = await createStore();
  return cachedStore;
}

/**
 * Invalidate the cached store (e.g., after document upload).
 */
export function invalidateVectorStore(): void {
  cachedStore = null;
  cachedEmbeddings = null;
}

// ---------------------------------------------------------------------------
// Add documents (used by upload route)
// ---------------------------------------------------------------------------

/**
 * Add documents to the vector store and persist if possible.
 * Returns the number of chunks added, or 0 if vectorization failed.
 */
export async function addDocumentsToStore(
  texts: string[],
  metadata: Record<string, string>,
): Promise<number> {
  try {
    const { RecursiveCharacterTextSplitter } = await import('@langchain/textsplitters');

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 250,
    });

    const chunks = await splitter.splitText(texts.join('\n\n'));
    const contextPrefix = `[Documento Contable/Tributario: ${metadata.context} — Archivo: ${metadata.source}]`;

    const docs = chunks.map(
      (chunk) =>
        new Document({
          pageContent: `${contextPrefix}\n\n${chunk}`,
          metadata: {
            ...metadata,
            type: 'user_upload',
            uploadedAt: new Date().toISOString(),
          },
        }),
    );

    const store = await getVectorStore();
    await store.addDocuments(docs);

    // Persist to disk if using HNSWLib
    if (!usingMemoryFallback) {
      try {
        const savePath = getStoragePath('vector_store');
        await (store as unknown as { save(dir: string): Promise<void> }).save(savePath);
      } catch (saveErr) {
        console.warn('[vectorstore] Could not persist:', saveErr instanceof Error ? saveErr.message : saveErr);
      }
    }

    return docs.length;
  } catch (error) {
    console.warn(
      '[vectorstore] addDocumentsToStore failed:',
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Perform similarity search with configurable k and optional metadata filters.
 * Returns formatted context string ready for LLM consumption.
 */
export async function searchDocuments(
  query: string,
  k: number = 8,
  filter?: { docType?: string; entity?: string; year?: string; type?: string },
): Promise<string> {
  const safeQuery = query.slice(0, 2000);
  const safeK = Math.max(1, Math.min(k, 20));

  const store = await getVectorStore();

  let results;

  if (filter && (filter.docType || filter.entity || filter.year || filter.type)) {
    results = await store.similaritySearch(safeQuery, safeK, (doc: Document) => {
      if (filter.docType && doc.metadata.docType !== filter.docType) return false;
      if (filter.entity && doc.metadata.entity !== filter.entity) return false;
      if (filter.year && doc.metadata.year !== filter.year) return false;
      if (filter.type && doc.metadata.type !== filter.type) return false;
      return true;
    });
  } else {
    results = await store.similaritySearch(safeQuery, safeK);
  }

  if (results.length === 0) {
    return 'NO_RESULTS: No se encontraron documentos relevantes en la base de conocimiento local. No inventes información — usa search_web o indica al usuario que no encontraste resultados confiables.';
  }

  return results
    .map((doc: Document, i: number) => {
      const m = doc.metadata;
      const source = m.source || 'Documento tributario';
      const docType = m.docType && m.docType !== 'unknown' ? ` | Tipo: ${m.docType}` : '';
      const year = m.year && m.year !== 'unknown' ? ` | Año: ${m.year}` : '';
      const entity = m.entity && m.entity !== 'unknown' ? ` | Entidad: ${m.entity.toUpperCase()}` : '';
      return `[Resultado ${i + 1} — Fuente: ${source}${docType}${year}${entity}]\n${doc.pageContent}`;
    })
    .join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getStoreStats(): Promise<{
  totalDocs: number;
  backend: string;
  byType: Record<string, number>;
  byEntity: Record<string, number>;
}> {
  const store = await getVectorStore();
  const backend = usingMemoryFallback ? 'MemoryVectorStore' : 'HNSWLib';

  // MemoryVectorStore doesn't expose docstore the same way
  if (usingMemoryFallback) {
    return { totalDocs: 0, backend, byType: {}, byEntity: {} };
  }

  try {
    const allDocs = (store as unknown as { docstore: { _docs: Map<string, Document> } }).docstore._docs;
    const byType: Record<string, number> = {};
    const byEntity: Record<string, number> = {};
    let totalDocs = 0;

    for (const [, doc] of allDocs) {
      totalDocs++;
      const docType = doc.metadata.docType || 'unknown';
      const entity = doc.metadata.entity || 'unknown';
      byType[docType] = (byType[docType] || 0) + 1;
      byEntity[entity] = (byEntity[entity] || 0) + 1;
    }

    return { totalDocs, backend, byType, byEntity };
  } catch {
    return { totalDocs: 0, backend, byType: {}, byEntity: {} };
  }
}
