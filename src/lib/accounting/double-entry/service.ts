// ---------------------------------------------------------------------------
// JournalService — double-entry posting engine.
//
// This is the ONLY module that mutates `journal_entries` / `journal_lines`.
// Everything goes through `db.transaction()` with serializable isolation and
// retry-on-40001 (serialization_failure) / 40P01 (deadlock_detected).
//
// Design choices:
// - Balance validation is at the application layer, INSIDE the transaction
//   (after we've SELECT-FOR-UPDATE'd the period and accounts). DB CHECK
//   constraints are a defense-in-depth backstop, not the primary gate.
// - Tolerance is ZERO. Postgres NUMERIC(20,2) is exact; presentation layers
//   round, but the ledger MUST balance exactly. See `validate.ts`.
// - Posting `draft → posted` is a separate operation (`postEntry`). Callers
//   that want immediate posting pass `status: 'posted'` to `createEntry`,
//   which performs both inserts in the same TX.
// - Reversal: the original is mutated to status='reversed' AND its
//   `reversedByEntryId` is set. The reversing entry has
//   `sourceType='reversal'` and `reversalOfEntryId=original.id`. Both the
//   original update and the new entry insert happen in the same TX. The
//   schema's DB triggers (Ola 1.A) likely also enforce immutability on
//   posted entries; we coordinate by using a SELECT FOR UPDATE on the
//   original and ensuring the trigger sees a consistent transition.
// ---------------------------------------------------------------------------

import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import {
  accountingPeriods,
  chartOfAccounts,
  journalEntries,
  journalLines,
} from '@/lib/db/schema';

import {
  DoubleEntryError,
  ERR,
  type CreateEntryInput,
  type EntryWithLines,
  type JournalLineInput,
  type PostEntryInput,
  type ReverseEntryInput,
  type VoidDraftInput,
} from '../types';
import { buildReversalLines, validateBalance } from './validate';

// ---------------------------------------------------------------------------
// Retry helper for SERIALIZABLE transactions.
//
// Postgres serialization conflicts surface as SQLSTATE 40001
// (`serialization_failure`) or 40P01 (`deadlock_detected`). The standard
// pattern is to retry with exponential backoff. We cap retries at 3.
//
// We DON'T retry on application errors (DoubleEntryError) — those are
// deterministic and a retry would hit them again.
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 50;

function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // node-postgres surfaces SQLSTATE on `code`.
  const code = (err as { code?: unknown }).code;
  return code === '40001' || code === '40P01';
}

async function retryOnSerialization<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof DoubleEntryError) throw err;
      if (!isRetryableError(err) || attempt === MAX_RETRIES) {
        throw err;
      }
      // Exponential backoff with jitter: 50, 100, 200 ms (+/- 25%).
      const base = BASE_BACKOFF_MS * Math.pow(2, attempt);
      const jitter = base * 0.25 * (Math.random() * 2 - 1);
      const wait = Math.max(10, base + jitter);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  // Unreachable, but the compiler can't prove it.
  if (lastErr instanceof Error) {
    throw new DoubleEntryError(
      ERR.CONCURRENCY,
      `Serialization conflict after ${MAX_RETRIES} retries: ${lastErr.message}`,
    );
  }
  throw new DoubleEntryError(
    ERR.CONCURRENCY,
    `Serialization conflict after ${MAX_RETRIES} retries`,
  );
}

// ---------------------------------------------------------------------------
// Internal: assert period is open and same workspace; lock it FOR UPDATE so
// no concurrent transaction can close it under us. Returns the period row.
// ---------------------------------------------------------------------------

async function lockOpenPeriod(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  workspaceId: string,
  periodId: string,
) {
  const rows = await tx
    .select()
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.id, periodId),
        eq(accountingPeriods.workspaceId, workspaceId),
      ),
    )
    .for('update');

  const period = rows[0];
  if (!period) {
    throw new DoubleEntryError(
      ERR.PERIOD_NOT_OPEN,
      `Periodo ${periodId} no encontrado en este workspace.`,
    );
  }
  if (period.status !== 'open') {
    throw new DoubleEntryError(
      ERR.PERIOD_NOT_OPEN,
      `Periodo ${period.year}-${String(period.month).padStart(2, '0')} esta en estado "${period.status}".`,
    );
  }
  return period;
}

// ---------------------------------------------------------------------------
// Internal: fetch and validate that every accountId exists in the workspace
// and is postable. Honors `requiresThirdParty` / `requiresCostCenter` flags.
// ---------------------------------------------------------------------------

async function validateAccounts(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  workspaceId: string,
  lines: JournalLineInput[],
) {
  const uniqueIds = Array.from(new Set(lines.map((l) => l.accountId)));
  if (uniqueIds.length === 0) {
    throw new DoubleEntryError(ERR.INVALID_LINES, 'Sin cuentas en el asiento.');
  }

  const accounts = await tx
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
        inArray(chartOfAccounts.id, uniqueIds),
      ),
    );
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const a = accountMap.get(l.accountId);
    const hint = `linea ${i + 1}`;
    if (!a) {
      throw new DoubleEntryError(
        ERR.INVALID_LINES,
        `${hint}: cuenta ${l.accountId} no existe en este workspace`,
      );
    }
    if (!a.active) {
      throw new DoubleEntryError(
        ERR.INVALID_LINES,
        `${hint}: cuenta ${a.code} (${a.name}) esta inactiva`,
      );
    }
    if (!a.isPostable) {
      throw new DoubleEntryError(
        ERR.ACCOUNT_NOT_POSTABLE,
        `${hint}: cuenta ${a.code} (${a.name}) no es auxiliar (no postable)`,
      );
    }
    if (a.requiresThirdParty && !l.thirdPartyId) {
      throw new DoubleEntryError(
        ERR.INVALID_LINES,
        `${hint}: cuenta ${a.code} requiere tercero`,
      );
    }
    if (a.requiresCostCenter && !l.costCenterId) {
      throw new DoubleEntryError(
        ERR.INVALID_LINES,
        `${hint}: cuenta ${a.code} requiere centro de costo`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: compute the next entry_number for (workspaceId, periodId).
// We hold a row lock on the period (`lockOpenPeriod` already FOR UPDATE'd
// it) to serialize numbering and avoid gaps from concurrent inserts.
// ---------------------------------------------------------------------------

async function nextEntryNumber(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  workspaceId: string,
  periodId: string,
): Promise<number> {
  // node-postgres surfaces SELECT results as `QueryResult.rows`. Drizzle's
  // `tx.execute(sql\`...\`)` returns the underlying `QueryResult`, so we
  // must read `.rows` rather than indexing directly.
  const result = await tx.execute(
    sql`
      SELECT COALESCE(MAX(entry_number), 0) + 1 AS next
      FROM journal_entries
      WHERE workspace_id = ${workspaceId}
        AND period_id = ${periodId}
    `,
  );
  const rows = (result as unknown as { rows?: Array<{ next: unknown }> }).rows
    ?? (Array.isArray(result) ? (result as Array<{ next: unknown }>) : []);
  const first = rows[0];
  if (!first) return 1;
  const raw = first.next;
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// ---------------------------------------------------------------------------
// createEntry — public API
// ---------------------------------------------------------------------------

export async function createEntry(
  input: CreateEntryInput,
): Promise<EntryWithLines> {
  // 1. Pure validation FIRST — fail fast without a TX.
  const { totalDebit, totalCredit } = validateBalance(input.lines);

  if (!input.workspaceId) {
    throw new DoubleEntryError(
      ERR.INVALID_LINES,
      'workspaceId requerido',
    );
  }
  if (!input.periodId) {
    throw new DoubleEntryError(
      ERR.INVALID_LINES,
      'periodId requerido',
    );
  }
  if (!input.description || input.description.trim().length === 0) {
    throw new DoubleEntryError(
      ERR.INVALID_LINES,
      'description requerida',
    );
  }
  if (!(input.entryDate instanceof Date) || isNaN(input.entryDate.getTime())) {
    throw new DoubleEntryError(
      ERR.INVALID_LINES,
      'entryDate invalida',
    );
  }

  const db = getDb();
  const desiredStatus = input.status ?? 'draft';

  return retryOnSerialization(async () =>
    db.transaction(
      async (tx) => {
        const period = await lockOpenPeriod(tx, input.workspaceId, input.periodId);

        // entryDate sanity: must be within period range. Allow same instant.
        if (
          input.entryDate.getTime() < period.startsAt.getTime() ||
          input.entryDate.getTime() > period.endsAt.getTime()
        ) {
          throw new DoubleEntryError(
            ERR.INVALID_LINES,
            `entryDate fuera del rango del periodo ${period.year}-${String(period.month).padStart(2, '0')}`,
          );
        }

        await validateAccounts(tx, input.workspaceId, input.lines);

        const entryNumber = await nextEntryNumber(
          tx,
          input.workspaceId,
          input.periodId,
        );

        const now = new Date();
        const [entry] = await tx
          .insert(journalEntries)
          .values({
            workspaceId: input.workspaceId,
            periodId: input.periodId,
            entryNumber,
            entryDate: input.entryDate,
            description: input.description,
            sourceType: input.sourceType ?? 'manual',
            sourceId: input.sourceId ?? null,
            sourceRef: input.sourceRef ?? null,
            status: desiredStatus,
            postedAt: desiredStatus === 'posted' ? now : null,
            postedBy:
              desiredStatus === 'posted' ? input.createdBy ?? null : null,
            totalDebit,
            totalCredit,
            currency: 'COP',
            createdBy: input.createdBy ?? null,
            metadata: input.metadata ?? null,
          })
          .returning();

        const linesToInsert = input.lines.map((l, idx) => ({
          workspaceId: input.workspaceId,
          entryId: entry.id,
          lineNumber: idx + 1,
          accountId: l.accountId,
          thirdPartyId: l.thirdPartyId ?? null,
          costCenterId: l.costCenterId ?? null,
          debit: l.debit,
          credit: l.credit,
          currency: l.currency ?? 'COP',
          exchangeRate: l.exchangeRate ?? '1',
          // COP-only in Ola 1: functional == nominal.
          functionalDebit: l.debit,
          functionalCredit: l.credit,
          description: l.description ?? null,
          dimensions: l.dimensions ?? null,
        }));
        const inserted = await tx
          .insert(journalLines)
          .values(linesToInsert)
          .returning();

        return { entry, lines: inserted };
      },
      { isolationLevel: 'serializable' },
    ),
  );
}

// ---------------------------------------------------------------------------
// postEntry — flip a draft to posted (immutable thereafter).
// ---------------------------------------------------------------------------

export async function postEntry(
  input: PostEntryInput,
): Promise<EntryWithLines> {
  const db = getDb();

  return retryOnSerialization(async () =>
    db.transaction(
      async (tx) => {
        const rows = await tx
          .select()
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.id, input.entryId),
              eq(journalEntries.workspaceId, input.workspaceId),
            ),
          )
          .for('update');

        const entry = rows[0];
        if (!entry) {
          throw new DoubleEntryError(
            ERR.ENTRY_NOT_FOUND,
            `Asiento ${input.entryId} no encontrado en este workspace`,
          );
        }
        if (entry.status !== 'draft') {
          throw new DoubleEntryError(
            ERR.ENTRY_NOT_DRAFT,
            `Asiento ${entry.entryNumber} ya esta en estado "${entry.status}"`,
          );
        }

        // Re-check period is still open (could have been closed since draft was created).
        await lockOpenPeriod(tx, input.workspaceId, entry.periodId);

        const now = new Date();
        const [updated] = await tx
          .update(journalEntries)
          .set({
            status: 'posted',
            postedAt: now,
            postedBy: input.postedBy ?? entry.postedBy ?? null,
            version: (entry.version ?? 1) + 1,
          })
          .where(eq(journalEntries.id, entry.id))
          .returning();

        const lines = await tx
          .select()
          .from(journalLines)
          .where(eq(journalLines.entryId, entry.id));

        return { entry: updated, lines };
      },
      { isolationLevel: 'serializable' },
    ),
  );
}

// ---------------------------------------------------------------------------
// reverseEntry — create a new posted entry that mirrors the original, and
// mark the original `status='reversed'` + `reversedByEntryId=newEntry.id`.
// ---------------------------------------------------------------------------

export async function reverseEntry(
  input: ReverseEntryInput,
): Promise<EntryWithLines> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw new DoubleEntryError(
      ERR.INVALID_LINES,
      'reason requerida para reversar un asiento',
    );
  }

  const db = getDb();
  const reverseDate = input.entryDate ?? new Date();

  return retryOnSerialization(async () =>
    db.transaction(
      async (tx) => {
        // Lock the original.
        const originalRows = await tx
          .select()
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.id, input.originalEntryId),
              eq(journalEntries.workspaceId, input.workspaceId),
            ),
          )
          .for('update');
        const original = originalRows[0];
        if (!original) {
          throw new DoubleEntryError(
            ERR.ENTRY_NOT_FOUND,
            `Asiento original ${input.originalEntryId} no encontrado`,
          );
        }
        if (original.status !== 'posted') {
          throw new DoubleEntryError(
            ERR.ENTRY_NOT_POSTED,
            `Solo se pueden reversar asientos en estado "posted" (actual: "${original.status}")`,
          );
        }
        if (original.reversedByEntryId) {
          throw new DoubleEntryError(
            ERR.ALREADY_REVERSED,
            `Asiento ${original.entryNumber} ya fue reversado`,
          );
        }

        // The reversal lives in whichever period currently contains
        // `reverseDate`. Find an OPEN period for the workspace that covers it.
        const periodRows = await tx
          .select()
          .from(accountingPeriods)
          .where(
            and(
              eq(accountingPeriods.workspaceId, input.workspaceId),
              sql`${accountingPeriods.startsAt} <= ${reverseDate}`,
              sql`${accountingPeriods.endsAt} >= ${reverseDate}`,
            ),
          )
          .for('update');
        const period = periodRows[0];
        if (!period) {
          throw new DoubleEntryError(
            ERR.PERIOD_NOT_OPEN,
            `No existe periodo que contenga la fecha ${reverseDate.toISOString()}`,
          );
        }
        if (period.status !== 'open') {
          throw new DoubleEntryError(
            ERR.PERIOD_NOT_OPEN,
            `Periodo destino ${period.year}-${String(period.month).padStart(2, '0')} no esta abierto`,
          );
        }

        // Fetch original lines.
        const origLines = await tx
          .select()
          .from(journalLines)
          .where(eq(journalLines.entryId, original.id))
          .orderBy(journalLines.lineNumber);

        const reversalLines = buildReversalLines(
          origLines.map((l) => ({
            accountId: l.accountId,
            thirdPartyId: l.thirdPartyId,
            costCenterId: l.costCenterId,
            debit: l.debit,
            credit: l.credit,
            currency: l.currency,
            exchangeRate: l.exchangeRate,
            description: l.description,
            dimensions: (l.dimensions as Record<string, unknown> | null) ?? null,
          })),
        );

        // Validate (defensive — should always balance since we swap).
        const { totalDebit, totalCredit } = validateBalance(reversalLines);

        const entryNumber = await nextEntryNumber(
          tx,
          input.workspaceId,
          period.id,
        );

        const now = new Date();
        const reversalMetadata: Record<string, unknown> = {
          reason: input.reason,
          originalEntryId: original.id,
          originalEntryNumber: original.entryNumber,
          reversedAt: now.toISOString(),
        };

        const [reversal] = await tx
          .insert(journalEntries)
          .values({
            workspaceId: input.workspaceId,
            periodId: period.id,
            entryNumber,
            entryDate: reverseDate,
            description: `REVERSO de #${original.entryNumber}: ${original.description}`,
            sourceType: 'reversal',
            sourceId: original.id,
            sourceRef: original.sourceRef,
            status: 'posted',
            postedAt: now,
            postedBy: input.postedBy ?? null,
            reversalOfEntryId: original.id,
            totalDebit,
            totalCredit,
            currency: 'COP',
            createdBy: input.postedBy ?? null,
            metadata: reversalMetadata,
          })
          .returning();

        const linesToInsert = reversalLines.map((l, idx) => ({
          workspaceId: input.workspaceId,
          entryId: reversal.id,
          lineNumber: idx + 1,
          accountId: l.accountId,
          thirdPartyId: l.thirdPartyId ?? null,
          costCenterId: l.costCenterId ?? null,
          debit: l.debit,
          credit: l.credit,
          currency: l.currency ?? 'COP',
          exchangeRate: l.exchangeRate ?? '1',
          functionalDebit: l.debit,
          functionalCredit: l.credit,
          description: l.description ?? null,
          dimensions: l.dimensions ?? null,
        }));
        const insertedLines = await tx
          .insert(journalLines)
          .values(linesToInsert)
          .returning();

        // Mark original as reversed.
        await tx
          .update(journalEntries)
          .set({
            status: 'reversed',
            reversedByEntryId: reversal.id,
            version: (original.version ?? 1) + 1,
          })
          .where(eq(journalEntries.id, original.id));

        return { entry: reversal, lines: insertedLines };
      },
      { isolationLevel: 'serializable' },
    ),
  );
}

// ---------------------------------------------------------------------------
// voidDraft — physically delete a draft entry (cascade removes lines via
// onDelete: 'restrict' on lines? ⇒ schema uses 'restrict' for lines.entryId,
// so we delete lines first, then the entry).
// ---------------------------------------------------------------------------

export async function voidDraft(input: VoidDraftInput): Promise<{ ok: true }> {
  const db = getDb();

  return retryOnSerialization(async () =>
    db.transaction(
      async (tx) => {
        const rows = await tx
          .select()
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.id, input.entryId),
              eq(journalEntries.workspaceId, input.workspaceId),
            ),
          )
          .for('update');
        const entry = rows[0];
        if (!entry) {
          throw new DoubleEntryError(
            ERR.ENTRY_NOT_FOUND,
            `Asiento ${input.entryId} no encontrado en este workspace`,
          );
        }
        if (entry.status !== 'draft') {
          throw new DoubleEntryError(
            ERR.ENTRY_NOT_DRAFT,
            `Solo se pueden eliminar drafts (actual: "${entry.status}")`,
          );
        }

        await tx.delete(journalLines).where(eq(journalLines.entryId, entry.id));
        await tx.delete(journalEntries).where(eq(journalEntries.id, entry.id));

        return { ok: true as const };
      },
      { isolationLevel: 'serializable' },
    ),
  );
}

// ---------------------------------------------------------------------------
// getEntryWithLines — read-only fetch with workspace ownership check.
// ---------------------------------------------------------------------------

export async function getEntryWithLines(
  entryId: string,
  workspaceId: string,
): Promise<EntryWithLines> {
  const db = getDb();

  const rows = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.id, entryId),
        eq(journalEntries.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  const entry = rows[0];
  if (!entry) {
    throw new DoubleEntryError(
      ERR.ENTRY_NOT_FOUND,
      `Asiento ${entryId} no encontrado en este workspace`,
    );
  }
  const lines = await db
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, entry.id))
    .orderBy(journalLines.lineNumber);

  return { entry, lines };
}

// ---------------------------------------------------------------------------
// listEntries — paginated read for the workspace, optionally scoped to a
// period and/or a status. Used by /api/accounting/journal GET (list mode).
// ---------------------------------------------------------------------------

export interface ListEntriesParams {
  workspaceId: string;
  periodId?: string;
  status?: 'draft' | 'posted' | 'reversed';
  limit?: number;
  offset?: number;
}

export async function listEntries(params: ListEntriesParams) {
  const db = getDb();
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const offset = Math.max(params.offset ?? 0, 0);

  const conditions: SQL[] = [eq(journalEntries.workspaceId, params.workspaceId)];
  if (params.periodId) conditions.push(eq(journalEntries.periodId, params.periodId));
  if (params.status) conditions.push(eq(journalEntries.status, params.status));

  const rows = await db
    .select()
    .from(journalEntries)
    .where(and(...conditions))
    .orderBy(sql`${journalEntries.entryDate} DESC, ${journalEntries.entryNumber} DESC`)
    .limit(limit)
    .offset(offset);

  return { entries: rows, limit, offset };
}
