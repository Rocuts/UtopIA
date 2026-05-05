import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { promoteEntries, isOcrPromoteEnabled } from '@/lib/agents/pyme/promote';
import { DoubleEntryError } from '@/lib/accounting/types';

// ---------------------------------------------------------------------------
// POST /api/pyme/promote
// ---------------------------------------------------------------------------
// Promueve pyme_entries confirmados a journal_entries en estado 'draft'.
//
// Feature flag: UTOPIA_ENABLE_OCR_PROMOTE=true (OFF por defecto).
// Si el flag está apagado, responde 503.
//
// Body: { pymeEntryIds: string[], periodId: string, applyTaxEngine?: boolean }
// Response: PromoteResult (200) | 400 | 422 | 503
// ---------------------------------------------------------------------------

export const maxDuration = 60; // segundos — el bridge puede hacer varias queries

const MAX_ENTRIES_PER_REQUEST = 200;

const promoteBodySchema = z.object({
  pymeEntryIds: z
    .array(z.string().uuid())
    .min(1, 'Se requiere al menos un renglón.')
    .max(MAX_ENTRIES_PER_REQUEST, `Máximo ${MAX_ENTRIES_PER_REQUEST} renglones por solicitud.`),
  periodId: z.string().uuid('periodId debe ser un UUID válido.'),
  applyTaxEngine: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Feature flag ─────────────────────────────────────────────────────────
  if (!isOcrPromoteEnabled()) {
    return NextResponse.json(
      { ok: false, error: 'feature_disabled', message: 'El puente OCR→Libro Mayor está desactivado.' },
      { status: 503 },
    );
  }

  // ── Workspace (cookie httpOnly) ──────────────────────────────────────────
  let workspaceId: string;
  try {
    const ws = await getOrCreateWorkspace();
    workspaceId = ws.id;
  } catch {
    return NextResponse.json({ ok: false, error: 'workspace_error' }, { status: 500 });
  }

  // ── Parsear body ─────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json', message: 'El cuerpo de la solicitud no es JSON válido.' },
      { status: 400 },
    );
  }

  const parsed = promoteBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'validation_error',
        message: parsed.error.issues.map((i) => i.message).join('; '),
        issues: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  const { pymeEntryIds, periodId, applyTaxEngine } = parsed.data;

  // ── Ejecutar bridge ───────────────────────────────────────────────────────
  try {
    const result = await promoteEntries({
      workspaceId,
      pymeEntryIds,
      periodId,
      applyTaxEngine,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof DoubleEntryError) {
      return NextResponse.json(
        { ok: false, error: err.code, message: err.message },
        { status: 422 },
      );
    }

    const message = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[pyme/promote] unexpected error', { workspaceId, message });

    return NextResponse.json(
      { ok: false, error: 'internal_error', message },
      { status: 500 },
    );
  }
}
