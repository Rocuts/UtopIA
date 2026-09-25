// ---------------------------------------------------------------------------
// /api/accounting/journal
//
// POST   → create a journal entry (status: 'draft' | 'posted')
// GET    → fetch entry by ?id=<uuid>, OR list entries when ?id is absent
//          (`periodId` o su alias `period`, el que envía ContabilidadLanding)
// GET    ?view=ledger&period=…&account=…&thirdParty=…&costCenter=…
//        → líneas del libro mayor con saldo acumulado por cuenta
//          (`listLedgerLines`, consumido por LedgerView). `period`/`periodId`
//          y `account`/`accountId` son equivalentes.
//
// Tenant scoping: cookie-driven via getOrCreateWorkspace() (same model as
// every other anonymous-tenant endpoint in this codebase). Every accounting
// query is scoped by `workspace_id`.
//
// Subroute handlers for posting, reversing and voiding live in
// `journal/post/`, `journal/reverse/`, `journal/void/`.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  createEntry,
  getEntryWithLines,
  listEntries,
  listLedgerLines,
  LEDGER_MAX_LIMIT,
} from '@/lib/accounting/double-entry';
import {
  createEntryBodySchema,
  listEntriesQuerySchema,
} from '@/lib/validation/accounting-schemas';

import { badRequestZod, errorResponse, ok } from '../_shared';
import { requireAuthSession } from '@/lib/auth/require-session';

// Mutating endpoints son dinamicas por defecto bajo Cache Components.
// `export const dynamic = 'force-dynamic'` y `export const runtime = 'nodejs'`
// son incompatibles con `nextConfig.cacheComponents: true` y se eliminaron
// en la Ola 2 (nodejs es el default ahora).

// ─── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = createEntryBodySchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const result = await createEntry({
      workspaceId: ws.id,
      periodId: parsed.data.periodId,
      entryDate: new Date(parsed.data.entryDate),
      description: parsed.data.description,
      sourceType: parsed.data.sourceType,
      sourceId: parsed.data.sourceId ?? null,
      sourceRef: parsed.data.sourceRef ?? null,
      status: parsed.data.status,
      metadata: parsed.data.metadata ?? null,
      lines: parsed.data.lines.map((l) => ({
        accountId: l.accountId,
        thirdPartyId: l.thirdPartyId ?? null,
        costCenterId: l.costCenterId ?? null,
        debit: l.debit,
        credit: l.credit,
        currency: l.currency,
        exchangeRate: l.exchangeRate,
        description: l.description ?? null,
        dimensions: l.dimensions ?? null,
      })),
    });
    return ok(result, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

// ─── GET ───────────────────────────────────────────────────────────────────

/** Filtros de la vista de mayor (no viaja al LLM: `.optional()` es válido). */
const ledgerQuerySchema = z.object({
  periodId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  thirdParty: z.string().max(120).optional(),
  costCenter: z.string().max(16).optional(),
  limit: z.coerce.number().int().min(1).max(LEDGER_MAX_LIMIT).optional(),
});

export async function GET(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  // Parámetro vacío (p. ej. «Todos» en un <select>) = sin filtro.
  const param = (...names: string[]): string | undefined => {
    for (const n of names) {
      const v = url.searchParams.get(n);
      if (v !== null && v.trim() !== '') return v.trim();
    }
    return undefined;
  };

  try {
    const ws = await getOrCreateWorkspace();

    if (id) {
      // Single fetch
      const result = await getEntryWithLines(id, ws.id);
      return ok(result);
    }

    // Ledger mode (LedgerView)
    if (url.searchParams.get('view') === 'ledger') {
      const lp = ledgerQuerySchema.safeParse({
        periodId: param('periodId', 'period'),
        accountId: param('accountId', 'account'),
        thirdParty: param('thirdParty'),
        costCenter: param('costCenter'),
        limit: param('limit'),
      });
      if (!lp.success) return badRequestZod(lp.error);
      const result = await listLedgerLines({
        workspaceId: ws.id,
        periodId: lp.data.periodId,
        accountId: lp.data.accountId,
        thirdParty: lp.data.thirdParty,
        costCenter: lp.data.costCenter,
        limit: lp.data.limit,
      });
      return ok(result);
    }

    // List mode
    const parsed = listEntriesQuerySchema.safeParse({
      periodId: param('periodId', 'period'),
      status: url.searchParams.get('status') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      offset: url.searchParams.get('offset') ?? undefined,
    });
    if (!parsed.success) return badRequestZod(parsed.error);

    const result = await listEntries({
      workspaceId: ws.id,
      periodId: parsed.data.periodId,
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
