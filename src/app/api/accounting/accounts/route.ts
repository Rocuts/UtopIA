import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  buildTree,
  listAccounts,
  createAccount,
  AccountValidationError,
  AccountConflictError,
  AccountNotFoundError,
  type ListAccountsOpts,
} from '@/lib/accounting/chart-of-accounts';
import {
  createAccountBodySchema,
  listAccountsQuerySchema,
} from '@/lib/validation/accounting-schemas';

// ---------------------------------------------------------------------------
// /api/accounting/accounts — colección PUC del workspace.
// ---------------------------------------------------------------------------
// GET   /api/accounting/accounts                 → lista plana (cuentas activas)
// GET   /api/accounting/accounts?tree=1           → árbol jerárquico
// GET   /api/accounting/accounts?postable=1       → solo auxiliares
// GET   /api/accounting/accounts?type=ACTIVO      → filtro por tipo NIIF
// GET   /api/accounting/accounts?search=110       → autocomplete (code prefix
//                                                   o name ilike)
// GET   /api/accounting/accounts?active=0         → incluye desactivadas
// POST  /api/accounting/accounts                  → CreateAccountInput
//
// PATCH/DELETE de un id específico viven en `[id]/route.ts`.
// El reseed inicial vive en `seed/route.ts`.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

// JSON endpoints chicos (CreateAccountInput es minúsculo). 32KB rechaza abuso.
const MAX_JSON_BODY = 32 * 1024;

function asBool(v: string | undefined): boolean {
  return v === '1' || v === 'true';
}

export async function GET(req: NextRequest) {
  try {
    const ws = await getOrCreateWorkspace();
    const url = new URL(req.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const query = listAccountsQuerySchema.parse(params);

    const tree = asBool(query.tree);
    const postableOnly = asBool(query.postable);
    // Default: activeOnly=true (omitir 'active' query param ⇒ solo activas).
    const activeOnly = query.active === undefined ? true : asBool(query.active);

    if (tree) {
      const nodes = await buildTree(ws.id, { activeOnly });
      return NextResponse.json({ ok: true, tree: nodes });
    }

    const opts: ListAccountsOpts = {
      activeOnly,
      postableOnly,
      type: query.type,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    };
    const accounts = await listAccounts(ws.id, opts);
    return NextResponse.json({ ok: true, accounts });
  } catch (err) {
    return handleError(err, '[accounting/accounts][GET]');
  }
}

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
    const body = createAccountBodySchema.parse(json);

    const account = await createAccount({
      workspaceId: ws.id,
      code: body.code,
      name: body.name,
      parentCode: body.parentCode ?? null,
      type: body.type,
      isPostable: body.isPostable,
      requiresThirdParty: body.requiresThirdParty,
      requiresCostCenter: body.requiresCostCenter,
      currency: body.currency,
    });
    return NextResponse.json({ ok: true, account }, { status: 201 });
  } catch (err) {
    return handleError(err, '[accounting/accounts][POST]');
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
