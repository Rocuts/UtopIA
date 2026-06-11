import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme-empleados';
import { updateEmpleadoBodySchema } from '@/lib/validation/pyme-schemas';
import { requireAuthSession } from '@/lib/auth/require-session';

// ---------------------------------------------------------------------------
// /api/pyme/empleados/[id] — edición y retiro (Ola 8).
// ---------------------------------------------------------------------------
// PATCH:  edita campos del registro (scoped por workspace en el WHERE —
//         un id de otro tenant devuelve 404, nunca 403, para no filtrar
//         existencia).
// DELETE: retiro lógico (activo=false) — preserva trazabilidad.
// ---------------------------------------------------------------------------

const MAX_JSON_BODY = 64 * 1024;

const idSchema = z.string().uuid();

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const contentLength = req.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_JSON_BODY) {
      return NextResponse.json(
        { ok: false, error: 'payload_too_large' },
        { status: 413 },
      );
    }

    const { id } = await ctx.params;
    const empleadoId = idSchema.parse(id);
    const ws = await getOrCreateWorkspace();
    const body = updateEmpleadoBodySchema.parse(await req.json());

    const updated = await repo.updateEmpleado(empleadoId, ws.id, {
      ...body,
      salarioCop: body.salarioCop !== undefined ? body.salarioCop.toFixed(2) : undefined,
    });

    if (!updated) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, empleado: updated });
  } catch (err) {
    return handleError(err, '[pyme/empleados/[id]][PATCH]');
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const { id } = await ctx.params;
    const empleadoId = idSchema.parse(id);
    const ws = await getOrCreateWorkspace();

    const ok = await repo.deactivateEmpleado(empleadoId, ws.id);
    if (!ok) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err, '[pyme/empleados/[id]][DELETE]');
  }
}

function handleError(err: unknown, tag: string) {
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { ok: false, error: 'invalid_input', details: err.flatten() },
      { status: 400 },
    );
  }
  console.error(tag, err);
  return NextResponse.json(
    { ok: false, error: 'internal_error' },
    { status: 500 },
  );
}
