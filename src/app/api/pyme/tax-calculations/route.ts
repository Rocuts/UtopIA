import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme-empleados';
import { saveTaxCalculationBodySchema } from '@/lib/validation/pyme-schemas';
import { requireAuthSession } from '@/lib/auth/require-session';

// ---------------------------------------------------------------------------
// /api/pyme/tax-calculations — historial de la balanza RST vs Ordinario.
// ---------------------------------------------------------------------------
// GET:  último cálculo guardado del workspace (para precargar el slider).
// POST: guarda una comparativa (botón "Guardar cálculo" de Mis Pagos — bajo
//       demanda, nunca en cada movimiento del slider).
// Equivalente al `tax_calculations` propuesto en el handoff Supabase.
// ---------------------------------------------------------------------------

const MAX_JSON_BODY = 64 * 1024;

export async function GET() {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const ws = await getOrCreateWorkspace();
    const latest = await repo.getLatestTaxCalculation(ws.id);
    return NextResponse.json({ ok: true, latest });
  } catch (err) {
    return handleError(err, '[pyme/tax-calculations][GET]');
  }
}

export async function POST(req: NextRequest) {
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

    const ws = await getOrCreateWorkspace();
    const body = saveTaxCalculationBodySchema.parse(await req.json());

    const saved = await repo.saveTaxCalculation({
      workspaceId: ws.id,
      annualSalesCop: body.annualSalesCop.toFixed(2),
      rstGroup: body.rstGroup,
      rstCop: body.rstCop.toFixed(2),
      ordinarioCop: body.ordinarioCop.toFixed(2),
      recommended: body.recommended,
      savingsCop: body.savingsCop.toFixed(2),
      semaforoLevel: body.semaforoLevel,
    });

    return NextResponse.json({ ok: true, saved }, { status: 201 });
  } catch (err) {
    return handleError(err, '[pyme/tax-calculations][POST]');
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
