import { NextResponse } from 'next/server';
import { searchDocuments } from '@/lib/rag/vectorstore';

export async function POST(req: Request) {
  try {
    const { query } = await req.json();

    if (!query) {
      return NextResponse.json({ error: 'Query is required.' }, { status: 400 });
    }

    const context = await searchDocuments(query, 5);

    return NextResponse.json({ context });
  } catch (error: any) {
    console.error("❌ Error in RAG tool endpoint:", error);
    return NextResponse.json(
      { error: "Internal server error searching legal documents." },
      { status: 500 }
    );
  }
}
