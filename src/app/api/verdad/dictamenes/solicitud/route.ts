import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/db/workspace';
import { logApiActivity } from '@/lib/db/activity-log';
import { requireAuthSession } from '@/lib/auth/require-session';

const solicitudSchema = z.object({
  tipo: z.string().max(200).optional(),
  dictamenId: z.string().max(100).optional(),
  razonSocial: z.string().min(2).max(200),
  nit: z.string().min(5).max(30),
  email: z.string().email().max(200),
  contexto: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  const workspace = await requireWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = solicitudSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { tipo, dictamenId, razonSocial, nit, email, contexto } = parsed.data;

    void logApiActivity(req, {
      category: 'api',
      action: 'dictamenes.solicitud.submitted',
      level: 'info',
      message: `Solicitud de dictamen: ${dictamenId ?? tipo ?? 'personalizado'} para ${razonSocial} (${nit})`,
      workspaceId: workspace.id,
      resourceType: 'dictamen',
      resourceId: dictamenId ?? 'custom',
      metadata: { razonSocial, nit, email, contexto, tipo, dictamenId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[dictamenes/solicitud] error:', message);
    return NextResponse.json(
      { error: 'Error al enviar la solicitud. Intente de nuevo.' },
      { status: 500 },
    );
  }
}
