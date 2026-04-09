import { NextResponse } from 'next/server';
import { searchDocuments } from '@/lib/rag/vectorstore';
import { ragRequestSchema } from '@/lib/validation/schemas';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = ragRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query.' }, { status: 400 });
    }

    const context = await searchDocuments(parsed.data.query, 5);

    return NextResponse.json({ context });
  } catch (error) {
    console.error('RAG endpoint error.');
    return NextResponse.json(
      { error: 'Internal server error searching documents.' },
      { status: 500 }
    );
  }
}
