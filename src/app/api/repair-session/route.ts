// ---------------------------------------------------------------------------
// /api/repair-session — Phase 3 persistencia del chat "Doctor de Datos".
//
// GET  ?conversationId=xxx  → { session: PersistedSession | null }
// PUT  body=PersistedSession → { ok: true }
//
// El workspace se identifica vía cookie httpOnly `utopia_workspace_id`. Si la
// cookie no existe, `getOrCreateWorkspace()` la crea (y setea response cookie)
// — el flujo es idéntico al resto de endpoints autenticados-anónimos.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  loadSession,
  upsertSession,
  type PersistedSession,
} from '@/lib/agents/repair/persistence';
import { getOrCreateWorkspace } from '@/lib/db/workspace';

export const runtime = 'nodejs';

// ─── Schemas ────────────────────────────────────────────────────────────────
//
// Mismo shape que `/api/repair-chat` pero con campos extra (status,
// provisional). Se mantienen sincronizados a mano: si se cambia un límite en
// repair-chat, replicarlo aquí.

const adjustmentSchema = z.object({
  id: z.string().min(1).max(100),
  accountCode: z.string().min(1).max(10),
  accountName: z.string().min(1).max(200),
  amount: z
    .number()
    .refine((n) => Number.isFinite(n), 'amount debe ser finito'),
  rationale: z.string().min(1).max(2_000),
  status: z.enum(['proposed', 'applied', 'rejected']),
  proposedAt: z.string().min(1).max(40),
  appliedAt: z.string().min(1).max(40).optional(),
  rejectedAt: z.string().min(1).max(40).optional(),
});

const provisionalSchema = z
  .object({
    active: z.boolean(),
    reason: z.string().max(2_000),
  })
  .nullable();

const putBodySchema = z.object({
  conversationId: z.string().min(1).max(100),
  errorMessage: z.string().min(1).max(20_000),
  rawCsv: z.string().max(500_000).nullable(),
  language: z.enum(['es', 'en']),
  companyName: z.string().max(200).optional(),
  period: z.string().max(20).optional(),
  provisional: provisionalSchema.optional(),
  status: z.enum(['open', 'closed']),
  adjustments: z.array(adjustmentSchema).max(50),
});

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get('conversationId');
    if (!conversationId || conversationId.length === 0) {
      return NextResponse.json(
        { error: 'missing_conversation_id' },
        { status: 400 },
      );
    }
    if (conversationId.length > 100) {
      return NextResponse.json(
        { error: 'invalid_conversation_id' },
        { status: 400 },
      );
    }

    const ws = await getOrCreateWorkspace();
    const session = await loadSession(ws.id, conversationId);
    return NextResponse.json({ session });
  } catch (error) {
    console.error('[repair-session.GET]', error);
    return NextResponse.json(
      { error: 'failed_to_load_repair_session' },
      { status: 500 },
    );
  }
}

// ─── PUT ────────────────────────────────────────────────────────────────────

export async function PUT(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = putBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_body',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const ws = await getOrCreateWorkspace();
    const session: PersistedSession = {
      conversationId: parsed.data.conversationId,
      errorMessage: parsed.data.errorMessage,
      rawCsv: parsed.data.rawCsv,
      language: parsed.data.language,
      companyName: parsed.data.companyName,
      period: parsed.data.period,
      provisional: parsed.data.provisional ?? null,
      status: parsed.data.status,
      adjustments: parsed.data.adjustments,
    };
    await upsertSession(ws.id, session);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : 'unknown_persistence_error';
    console.error('[repair-session.PUT]', detail);
    if (detail === 'repair_session_conflict_other_workspace') {
      return NextResponse.json({ error: detail }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'failed_to_save_repair_session' },
      { status: 500 },
    );
  }
}
