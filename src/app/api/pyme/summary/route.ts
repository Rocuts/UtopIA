import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme';
import { summaryQuerySchema } from '@/lib/validation/pyme-schemas';
import { assertBookOwned, HttpError } from '../_lib/ownership';
import { requireAuthSession } from '@/lib/auth/require-session';

// ---------------------------------------------------------------------------
// GET /api/pyme/summary?bookId=&year=&month=
// ---------------------------------------------------------------------------
// Agregación liviana para los heros del área Pyme (PymeHub, Mi Libro):
// totales del mes (ingresos/egresos/margen + comparativo N-1) vía
// `monthlySummary` + ingresos acumulados del año (`annualIngresos`) para el
// semáforo de tope IVA/RST. Sin LLM — solo SQL (a diferencia del POST
// /api/pyme/reports/monthly que genera narrativa).
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const ws = await getOrCreateWorkspace();
    const url = new URL(req.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const query = summaryQuerySchema.parse(params);

    await assertBookOwned(query.bookId, ws.id);

    const [summary, yearIngresos] = await Promise.all([
      repo.monthlySummary(query.bookId, query.year, query.month),
      repo.annualIngresos(query.bookId, query.year),
    ]);

    return NextResponse.json({ ok: true, summary, yearIngresos });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: 'invalid_input', details: err.flatten() },
        { status: 400 },
      );
    }
    if (err instanceof HttpError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.status },
      );
    }
    console.error('[pyme/summary][GET]', err);
    return NextResponse.json(
      { ok: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}
