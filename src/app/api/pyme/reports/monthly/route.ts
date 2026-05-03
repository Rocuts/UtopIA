import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { getDb } from '@/lib/db/client';
import { reports } from '@/lib/db/schema';
import { generateMonthlyReport } from '@/lib/agents/pyme/orchestrator';
import { monthlyReportBodySchema } from '@/lib/validation/pyme-schemas';
import { assertBookOwned, HttpError } from '../../_lib/ownership';

// ---------------------------------------------------------------------------
// /api/pyme/reports/monthly — POST genera y persiste el reporte del mes.
// ---------------------------------------------------------------------------
// 1. Verifica ownership del libro.
// 2. Llama `generateMonthlyReport(bookId, workspaceId, year, month, language)`
//    que produce summary + narrativa + alertas.
// 3. Inserta en `reports` con `kind = 'pyme_monthly'`. La UI lista todos los
//    reports del workspace via los endpoints existentes.
//
// `maxDuration = 300` por la llamada al LLM summarizer (puede tardar 20-40s
// en frio + agregaciones SQL del summary).
// ---------------------------------------------------------------------------
export const maxDuration = 300;

const MAX_JSON_BODY = 64 * 1024;

export async function POST(req: NextRequest) {
  try {
    const contentLength = req.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_JSON_BODY) {
      return NextResponse.json(
        { ok: false, error: 'payload_too_large' },
        { status: 413 },
      );
    }

    const ws = await getOrCreateWorkspace();
    const json = await req.json();
    const body = monthlyReportBodySchema.parse(json);

    const book = await assertBookOwned(body.bookId, ws.id);

    const payload = await generateMonthlyReport(
      body.bookId,
      ws.id,
      body.year,
      body.month,
      body.language,
    );

    const db = getDb();
    const [persisted] = await db
      .insert(reports)
      .values({
        workspaceId: ws.id,
        kind: 'pyme_monthly',
        title: `Pyme — ${book.name} — ${body.year}-${String(body.month).padStart(2, '0')}`,
        // `data` es jsonb. drizzle serializa el objeto JS directo.
        data: payload as unknown as Record<string, unknown>,
      })
      .returning();

    return NextResponse.json(
      { ok: true, report: persisted },
      { status: 201 },
    );
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
    console.error('[pyme/reports/monthly][POST]', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'internal_error',
      },
      { status: 500 },
    );
  }
}
