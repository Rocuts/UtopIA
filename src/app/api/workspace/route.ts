import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { workspaces } from '@/lib/db/schema';
import { getOrCreateWorkspace } from '@/lib/db/workspace';

export async function GET() {
  try {
    const ws = await getOrCreateWorkspace();
    return NextResponse.json({ workspace: ws });
  } catch (error) {
    console.error('[workspace.GET]', error);
    return NextResponse.json(
      { error: 'failed_to_resolve_workspace' },
      { status: 500 },
    );
  }
}

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  nit: z
    .string()
    .trim()
    .min(8)
    .max(24)
    .regex(/^[0-9.\-]+$/, 'NIT inválido')
    .optional(),
});

export async function PATCH(req: Request) {
  try {
    const ws = await getOrCreateWorkspace();
    const json = await req.json().catch(() => null);
    const parsed = UpdateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_body', issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const db = getDb();
    const [updated] = await db
      .update(workspaces)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(workspaces.id, ws.id))
      .returning();
    return NextResponse.json({ workspace: updated });
  } catch (error) {
    console.error('[workspace.PATCH]', error);
    return NextResponse.json(
      { error: 'failed_to_update_workspace' },
      { status: 500 },
    );
  }
}
