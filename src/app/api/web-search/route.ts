import { NextResponse } from 'next/server';
import { searchWeb, formatSearchResultsForLLM } from '@/lib/search/web-search';

/**
 * POST /api/web-search
 * Standalone web search endpoint — used by voice mode and as a general-purpose
 * search tool for when local RAG knowledge is insufficient.
 */
export async function POST(req: Request) {
  try {
    const { query } = await req.json();

    if (!query) {
      return NextResponse.json({ error: 'Query is required.' }, { status: 400 });
    }

    const searchResponse = await searchWeb(query);

    const formattedContext = formatSearchResultsForLLM(searchResponse.results);

    return NextResponse.json({
      context: formattedContext || 'No relevant web results found.',
      results: searchResponse.results,
      searchedAt: searchResponse.searchedAt,
    });
  } catch (error) {
    console.error('❌ Error in web search route:', error);
    return NextResponse.json(
      { error: 'Internal server error during web search.' },
      { status: 500 }
    );
  }
}
