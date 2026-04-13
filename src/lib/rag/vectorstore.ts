import { OpenAIEmbeddings } from '@langchain/openai';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
import { Document } from '@langchain/core/documents';
import path from 'path';

/**
 * Returns the correct storage path depending on the runtime environment.
 * Vercel serverless functions have a read-only filesystem except for /tmp.
 */
function getStoragePath(subdir: string): string {
  if (process.env.VERCEL) {
    return path.join('/tmp', subdir);
  }
  return path.join(process.cwd(), 'src', 'data', subdir);
}

const vectorStorePath = getStoragePath('vector_store');

let cachedStore: HNSWLib | null = null;
let cachedEmbeddings: OpenAIEmbeddings | null = null;

/**
 * Returns a singleton HNSWLib vector store instance.
 * Loads from disk once, then serves from memory on subsequent calls.
 *
 * On Vercel (read-only filesystem), gracefully falls back to an empty
 * in-memory vector store if the persisted store cannot be loaded.
 * This ensures the chat endpoint degrades to NO_RESULTS instead of crashing.
 */
export async function getVectorStore(): Promise<HNSWLib> {
  if (cachedStore) return cachedStore;

  cachedEmbeddings = new OpenAIEmbeddings({
    modelName: 'text-embedding-3-small',
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  try {
    cachedStore = await HNSWLib.load(vectorStorePath, cachedEmbeddings);
  } catch (error) {
    console.warn(
      '[vectorstore] Could not load persisted vector store from disk. ' +
      'Creating empty in-memory store as fallback. ' +
      'RAG searches will return NO_RESULTS until documents are uploaded. ' +
      `Path attempted: ${vectorStorePath}`,
      error instanceof Error ? error.message : error
    );
    // Create an empty in-memory store so downstream code never crashes
    cachedStore = await HNSWLib.fromDocuments(
      [new Document({ pageContent: '', metadata: { _placeholder: true } })],
      cachedEmbeddings
    );
  }

  return cachedStore;
}

/** Re-export getStoragePath for use by other modules (e.g. upload route). */
export { getStoragePath };

/**
 * Invalidate the cached store (e.g., after re-ingestion or document upload).
 */
export function invalidateVectorStore(): void {
  cachedStore = null;
  cachedEmbeddings = null;
}

/**
 * Perform similarity search with configurable k and optional metadata filters.
 * Returns formatted context string ready for LLM consumption.
 *
 * @param query  - The search query text (max 2000 chars).
 * @param k      - Number of results to return (1-20, default 8).
 * @param filter - Optional metadata filter. Supports `docType`, `entity`, `year`,
 *                 and a generic `type` field (e.g. `{ type: 'user_upload' }`).
 */
export async function searchDocuments(
  query: string,
  k: number = 8,
  filter?: { docType?: string; entity?: string; year?: string; type?: string }
): Promise<string> {
  // Bounds-check inputs
  const safeQuery = query.slice(0, 2000);
  const safeK = Math.max(1, Math.min(k, 20));

  const store = await getVectorStore();

  let results;

  if (filter && (filter.docType || filter.entity || filter.year || filter.type)) {
    results = await store.similaritySearch(safeQuery, safeK, (doc) => {
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
    .map((doc, i) => {
      const m = doc.metadata;
      const source = m.source || 'Documento tributario';
      const docType = m.docType && m.docType !== 'unknown' ? ` | Tipo: ${m.docType}` : '';
      const year = m.year && m.year !== 'unknown' ? ` | Año: ${m.year}` : '';
      const entity = m.entity && m.entity !== 'unknown' ? ` | Entidad: ${m.entity.toUpperCase()}` : '';
      return `[Resultado ${i + 1} — Fuente: ${source}${docType}${year}${entity}]\n${doc.pageContent}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Returns aggregate statistics about the vector store contents.
 */
export async function getStoreStats(): Promise<{
  totalDocs: number;
  byType: Record<string, number>;
  byEntity: Record<string, number>;
}> {
  const store = await getVectorStore();
  const allDocs = store.docstore._docs;

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

  return { totalDocs, byType, byEntity };
}
