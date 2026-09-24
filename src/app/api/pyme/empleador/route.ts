import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { requireAuthSession } from '@/lib/auth/require-session';
import { getEmpleador114_1, setEmpleador114_1 } from '@/lib/db/workspace-empleador';

// ---------------------------------------------------------------------------
// /api/pyme/empleador — condición del empleador frente al Art. 114-1 E.T.
// ---------------------------------------------------------------------------
// La exoneración de salud del empleador (8,5 %), SENA (2 %) e ICBF (3 %) por
// trabajadores que devenguen < 10 SMMLV aplica a sociedades y personas
// jurídicas declarantes de renta y a personas naturales empleadoras con dos o
// más trabajadores. No se asume: el workspace la declara aquí.
//   GET → { ok, beneficiario114_1: boolean | null }
//   PUT { beneficiario114_1: boolean | null } → mismo shape
// Auditoría contab-nomina-07 / -19.
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  beneficiario114_1: z.boolean().nullable(),
});

export async function GET() {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;
  try {
    const ws = await getOrCreateWorkspace();
    return NextResponse.json({ ok: true, beneficiario114_1: await getEmpleador114_1(ws.id) });
  } catch (err) {
    console.error('[pyme/empleador][GET]', err);
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;
  try {
    const body = bodySchema.parse(await req.json());
    const ws = await getOrCreateWorkspace();
    const value = await setEmpleador114_1(ws.id, body.beneficiario114_1);
    return NextResponse.json({ ok: true, beneficiario114_1: value });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: 'invalid_input', details: err.flatten() },
        { status: 400 },
      );
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    console.error('[pyme/empleador][PUT]', err);
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
