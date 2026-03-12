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
 * Perform similarity search with configurable k.
 * Returns formatted context string ready for LLM consumption.
 */
export async function searchDocuments(query: string, k: number = 5): Promise<string> {
  const store = await getVectorStore();
  const results = await store.similaritySearch(query, k);

  if (results.length === 0) return 'No relevant legal documents found.';

  return results
    .map(doc => `Source: [${doc.metadata.source || 'Legal Document'}]\n${doc.pageContent}`)
    .join('\n\n---\n\n');
}
