import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { workspaces } from '@/lib/db/schema';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { requireAuthSession } from '@/lib/auth/require-session';
import type { Workspace } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Proyección pública del workspace.
//
// En fase 1 (tenant anónimo) el UUID del workspace ES el bearer: quien lo
// tenga puede operar como ese tenant. Por eso la cookie `utopia_workspace_id`
// es httpOnly — para que ningún script del navegador la lea. Devolver la fila
// entera aquí anulaba esa protección: el mismo valor viajaba en el body,
// visible para cualquier XSS, extensión o log de red intermedio.
//
// Ningún consumidor del front necesita el id (todos los usos de `workspace.id`
// son server-side, derivados del cookie). Si algún día uno lo necesita, la
// respuesta correcta es un identificador opaco por sesión, NO reexponer el id.
// `userId` se omite por la misma razón: identifica la cuenta dueña del tenant.
//
// Es una LISTA BLANCA, no un `delete ws.id`: así, la próxima columna que se
// agregue a `workspaces` (un token de integración, un secreto de webhook) no
// sale al cliente por omisión. El default seguro es no publicar.
// ---------------------------------------------------------------------------
function toPublicWorkspace(ws: Workspace) {
  return {
    nit: ws.nit,
    name: ws.name,
    representanteLegalNombre: ws.representanteLegalNombre,
    revisorFiscalNombre: ws.revisorFiscalNombre,
    revisorFiscalTp: ws.revisorFiscalTp,
    contadorPublicoNombre: ws.contadorPublicoNombre,
    contadorPublicoTp: ws.contadorPublicoTp,
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
  };
}

export async function GET() {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const ws = await getOrCreateWorkspace();
    return NextResponse.json({ workspace: toPublicWorkspace(ws) });
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
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

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
    return NextResponse.json({ workspace: toPublicWorkspace(updated) });
  } catch (error) {
    console.error('[workspace.PATCH]', error);
    return NextResponse.json(
      { error: 'failed_to_update_workspace' },
      { status: 500 },
    );
  }
}
