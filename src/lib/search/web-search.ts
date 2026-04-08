/**
 * Tavily Web Search — AI-optimized search for Colombian tax and accounting documentation.
 * Used as a fallback when local RAG doesn't have sufficient context.
 *
 * Tavily returns pre-ranked, AI-ready snippets with relevance scores,
 * making it ideal for feeding into LLM tool-calling pipelines.
 */

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface WebSearchResponse {
  results: WebSearchResult[];
  query: string;
  searchedAt: string;
}

// Trusted Colombian tax, accounting, and regulatory domains
const TAX_ACCOUNTING_DOMAINS = [
  'dian.gov.co',
  'secretariasenado.gov.co',
  'funcionpublica.gov.co',
  'minhacienda.gov.co',
  'superfinanciera.gov.co',
  'ctcp.gov.co',
  'jcc.gov.co',
  'supersociedades.gov.co',
  'actualicese.com',
  'gerencie.com',
  'ambitojuridico.com',
  'consultorcontable.com',
  'accounter.co',
];

export async function searchWeb(
  query: string,
  options?: {
    maxResults?: number;
    searchDepth?: 'basic' | 'advanced';
    includeDomains?: string[];
  }
): Promise<WebSearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    console.warn('TAVILY_API_KEY not set. Web search disabled.');
    return { results: [], query, searchedAt: new Date().toISOString() };
  }

  const {
    maxResults = 5,
    searchDepth = 'advanced',
    includeDomains = TAX_ACCOUNTING_DOMAINS,
  } = options ?? {};

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: `normativa tributaria contable Colombia: ${query}`,
        search_depth: searchDepth,
        include_domains: includeDomains,
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Tavily API error: ${response.status}`, errorText);
      return { results: [], query, searchedAt: new Date().toISOString() };
    }

    const data = await response.json();

    const results: WebSearchResult[] = (data.results || []).map(
      (r: { title?: string; url?: string; content?: string; score?: number }) => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
        score: r.score || 0,
      })
    );

    return {
      results,
      query,
      searchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Web search failed:', error);
    return { results: [], query, searchedAt: new Date().toISOString() };
  }
}

/**
 * Format web search results into a context string suitable for LLM consumption.
 */
export function formatSearchResultsForLLM(results: WebSearchResult[]): string {
  if (results.length === 0) return '';

  return results
    .map(
      (r, i) =>
        `[Web Source ${i + 1}] ${r.title}\nURL: ${r.url}\nRelevance: ${(r.score * 100).toFixed(0)}%\n${r.content}`
    )
    .join('\n\n---\n\n');
}
