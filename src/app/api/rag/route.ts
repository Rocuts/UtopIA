import { NextResponse } from 'next/server';
import { requireAuthSession } from '@/lib/auth/require-session';
import { searchDocuments } from '@/lib/rag/vectorstore';
import { ragRequestSchema } from '@/lib/validation/schemas';
import { getCurrentWorkspaceId } from '@/lib/db/workspace';

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const parsed = ragRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query.' }, { status: 400 });
    }

    // Scoping por workspace: global ∪ workspace del solicitante. Sin cookie,
    // solo global (mismo contrato que las tools del chat).
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? undefined;
    const context = await searchDocuments(parsed.data.query, 5, { workspaceId });

    return NextResponse.json({ context });
  } catch (error) {
    console.error('[rag] search error:', error);
    return NextResponse.json(
      { error: 'Internal server error searching documents.' },
      { status: 500 }
    );
  }
}
