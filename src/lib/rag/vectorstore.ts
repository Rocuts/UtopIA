import { OpenAIEmbeddings } from '@langchain/openai';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';
import path from 'path';

const vectorStorePath = path.join(process.cwd(), 'src', 'data', 'vector_store');

let cachedStore: HNSWLib | null = null;
let cachedEmbeddings: OpenAIEmbeddings | null = null;

/**
 * Returns a singleton HNSWLib vector store instance.
 * Loads from disk once, then serves from memory on subsequent calls.
 */
export async function getVectorStore(): Promise<HNSWLib> {
  if (cachedStore) return cachedStore;

  cachedEmbeddings = new OpenAIEmbeddings({
    modelName: 'text-embedding-3-small',
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  cachedStore = await HNSWLib.load(vectorStorePath, cachedEmbeddings);
  return cachedStore;
}

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
 */
export async function searchDocuments(
  query: string,
  k: number = 8,
  filter?: { docType?: string; entity?: string; year?: string }
): Promise<string> {
  const store = await getVectorStore();

  let results;

  if (filter && (filter.docType || filter.entity || filter.year)) {
    results = await store.similaritySearch(query, k, (doc) => {
      if (filter.docType && doc.metadata.docType !== filter.docType) return false;
      if (filter.entity && doc.metadata.entity !== filter.entity) return false;
      if (filter.year && doc.metadata.year !== filter.year) return false;
      return true;
    });
  } else {
    results = await store.similaritySearch(query, k);
  }

  if (results.length === 0) return 'No relevant tax or accounting documents found.';

  return results
    .map(doc => `Source: [${doc.metadata.source || 'Tax/Accounting Document'}]\n${doc.pageContent}`)
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
