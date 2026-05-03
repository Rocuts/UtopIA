import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  deactivateAccount,
  updateAccount,
  AccountValidationError,
  AccountConflictError,
  AccountNotFoundError,
} from '@/lib/accounting/chart-of-accounts';
import { updateAccountBodySchema } from '@/lib/validation/accounting-schemas';

// ---------------------------------------------------------------------------
// /api/accounting/accounts/[id] — PATCH y DELETE.
// ---------------------------------------------------------------------------
// PATCH:  actualiza campos editables (name, requiresThirdParty,
//         requiresCostCenter, active). NO permite cambiar code/type/parent
//         /level — eso rompería integridad del árbol jerárquico.
// DELETE: soft-delete (active=false). Falla 409 si la cuenta tiene
//         movimientos en `journal_lines`.
// ---------------------------------------------------------------------------

const MAX_JSON_BODY = 16 * 1024;

const idParamSchema = z.string().uuid('id must be a valid UUID');

interface RouteContext {
  // Next.js 15 / App Router: params is a Promise.
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const contentLength = req.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_JSON_BODY) {
      return NextResponse.json(
        { ok: false, error: 'payload_too_large' },
        { status: 413 },
      );
    }

    const ws = await getOrCreateWorkspace();
    const { id } = await ctx.params;
    const accountId = idParamSchema.parse(id);

    const json = await req.json();
    const body = updateAccountBodySchema.parse(json);

    const updated = await updateAccount(ws.id, accountId, body);
    return NextResponse.json({ ok: true, account: updated });
  } catch (err) {
    return handleError(err, '[accounting/accounts/:id][PATCH]');
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const ws = await getOrCreateWorkspace();
    const { id } = await ctx.params;
    const accountId = idParamSchema.parse(id);

    const updated = await deactivateAccount(ws.id, accountId);
    return NextResponse.json({ ok: true, account: updated });
  } catch (err) {
    return handleError(err, '[accounting/accounts/:id][DELETE]');
  }
}

function handleError(err: unknown, tag: string) {
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { ok: false, error: 'invalid_input', details: err.flatten() },
      { status: 400 },
    );
  }
  if (err instanceof AccountValidationError) {
    return NextResponse.json(
      {
        ok: false,
        error: 'validation_error',
        message: err.message,
        field: err.field,
      },
      { status: 400 },
    );
  }
  if (err instanceof AccountConflictError) {
    return NextResponse.json(
      { ok: false, error: 'conflict', message: err.message },
      { status: 409 },
    );
  }
  if (err instanceof AccountNotFoundError) {
    return NextResponse.json(
      { ok: false, error: 'not_found', message: err.message },
      { status: 404 },
    );
  }
  console.error(tag, err);
  return NextResponse.json(
    { ok: false, error: err instanceof Error ? err.message : 'internal_error' },
    { status: 500 },
  );
}
