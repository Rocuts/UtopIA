import { NextResponse } from 'next/server';
import { searchWeb, formatSearchResultsForLLM } from '@/lib/search/web-search';
import { webSearchRequestSchema } from '@/lib/validation/schemas';

/**
 * POST /api/web-search
 * Standalone web search endpoint — used by voice mode and as a general-purpose
 * search tool for when local RAG knowledge is insufficient.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = webSearchRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query.' }, { status: 400 });
    }

    const searchResponse = await searchWeb(parsed.data.query);
    const formattedContext = formatSearchResultsForLLM(searchResponse.results);

    return NextResponse.json({
      context: formattedContext || 'No relevant web results found.',
      results: searchResponse.results,
      searchedAt: searchResponse.searchedAt,
    });
  } catch (error) {
    console.error('Web search error.');
    return NextResponse.json(
      { error: 'Internal server error during web search.' },
      { status: 500 }
    );
  }
}
