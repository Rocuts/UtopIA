// ---------------------------------------------------------------------------
// repository.ts — Pure DB queries for the banking module.
//
// All functions take explicit workspaceId; never trust caller-provided ids
// without workspace scoping.
// ---------------------------------------------------------------------------

import 'server-only';
import { and, desc, eq, gte, isNull, lte, not, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  bankAccounts,
  bankStatementImports,
  bankTransactions,
  bankReconciliations,
  type NewBankAccountRow,
  type NewBankStatementImportRow,
  type NewBankTransactionRow,
  type NewBankReconciliationRow,
  type BankAccountRow,
  type BankTransactionRow,
} from '@/lib/db/schema';

// ── Bank Accounts ────────────────────────────────────────────────────────────

export async function listBankAccounts(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.workspaceId, workspaceId), eq(bankAccounts.active, true)))
    .orderBy(bankAccounts.bankName, bankAccounts.accountNumber);
}

export async function getBankAccount(workspaceId: string, id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.workspaceId, workspaceId), eq(bankAccounts.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createBankAccount(data: NewBankAccountRow) {
  const db = getDb();
  const [row] = await db.insert(bankAccounts).values(data).returning();
  return row;
}

export async function updateBankAccount(
  workspaceId: string,
  id: string,
  patch: Partial<Pick<BankAccountRow, 'bankName' | 'accountNumber' | 'accountKind' | 'holderName' | 'active' | 'accountId'>>,
) {
  const db = getDb();
  const [row] = await db
    .update(bankAccounts)
    .set(patch)
    .where(and(eq(bankAccounts.workspaceId, workspaceId), eq(bankAccounts.id, id)))
    .returning();
  return row ?? null;
}

export async function softDeleteBankAccount(workspaceId: string, id: string) {
  return updateBankAccount(workspaceId, id, { active: false });
}

// ── Statement Imports ────────────────────────────────────────────────────────

export async function createStatementImport(data: NewBankStatementImportRow) {
  const db = getDb();
  const [row] = await db.insert(bankStatementImports).values(data).returning();
  return row;
}

export async function updateStatementImport(
  id: string,
  patch: Partial<Pick<typeof bankStatementImports.$inferSelect,
    'transactionCount' | 'duplicatesSkipped' | 'status' | 'errorMessage' |
    'periodStart' | 'periodEnd' | 'startingBalance' | 'endingBalance'>>,
) {
  const db = getDb();
  const [row] = await db
    .update(bankStatementImports)
    .set(patch)
    .where(eq(bankStatementImports.id, id))
    .returning();
  return row ?? null;
}

export async function listStatementImports(workspaceId: string, bankAccountId: string) {
  const db = getDb();
  return db
    .select()
    .from(bankStatementImports)
    .where(
      and(
        eq(bankStatementImports.workspaceId, workspaceId),
        eq(bankStatementImports.bankAccountId, bankAccountId),
      ),
    )
    .orderBy(desc(bankStatementImports.createdAt))
    .limit(20);
}

// ── Bank Transactions ────────────────────────────────────────────────────────

/**
 * Bulk insert with ON CONFLICT DO NOTHING for deduplification.
 * Returns { inserted, skipped }.
 */
export async function bulkInsertTransactions(
  rows: NewBankTransactionRow[],
): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  const db = getDb();

  const result = await db
    .insert(bankTransactions)
    .values(rows)
    .onConflictDoNothing({ target: [bankTransactions.workspaceId, bankTransactions.bankAccountId, bankTransactions.fingerprint] })
    .returning({ id: bankTransactions.id });

  const inserted = result.length;
  const skipped = rows.length - inserted;
  return { inserted, skipped };
}

/** Load all unmatched transactions for a bank account, optionally filtered by date range. */
export async function listUnmatchedTransactions(
  workspaceId: string,
  bankAccountId: string,
  fromDate?: Date,
  toDate?: Date,
): Promise<BankTransactionRow[]> {
  const db = getDb();
  const conditions = [
    eq(bankTransactions.workspaceId, workspaceId),
    eq(bankTransactions.bankAccountId, bankAccountId),
    isNull(bankTransactions.matchedJournalLineId),
  ];
  if (fromDate) conditions.push(gte(bankTransactions.postedAt, fromDate));
  if (toDate) conditions.push(lte(bankTransactions.postedAt, toDate));

  return db
    .select()
    .from(bankTransactions)
    .where(and(...conditions))
    .orderBy(bankTransactions.postedAt);
}

/** All transactions for a bank account (matched + unmatched), paginated. */
export async function listTransactions(
  workspaceId: string,
  bankAccountId: string,
  options: { limit?: number; offset?: number; onlyUnmatched?: boolean } = {},
) {
  const db = getDb();
  const { limit = 50, offset = 0, onlyUnmatched = false } = options;
  const conditions = [
    eq(bankTransactions.workspaceId, workspaceId),
    eq(bankTransactions.bankAccountId, bankAccountId),
  ];
  if (onlyUnmatched) conditions.push(isNull(bankTransactions.matchedJournalLineId));

  return db
    .select()
    .from(bankTransactions)
    .where(and(...conditions))
    .orderBy(desc(bankTransactions.postedAt))
    .limit(limit)
    .offset(offset);
}

/** Mark a transaction as matched by the heuristic or manual method. */
export async function matchTransaction(
  id: string,
  matchedJournalLineId: string,
  matchConfidence: string,
  matchMethod: 'exact' | 'manual' | 'llm',
  matchedBy?: string,
) {
  const db = getDb();
  const [row] = await db
    .update(bankTransactions)
    .set({
      matchedJournalLineId,
      matchConfidence,
      matchMethod,
      matchedAt: new Date(),
      matchedBy: matchedBy ?? null,
    })
    .where(eq(bankTransactions.id, id))
    .returning();
  return row ?? null;
}

/** Return set of journal_line IDs already matched in this workspace. */
export async function getAlreadyMatchedLineIds(workspaceId: string): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ id: bankTransactions.matchedJournalLineId })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.workspaceId, workspaceId),
        not(isNull(bankTransactions.matchedJournalLineId)),
      ),
    );
  return new Set(rows.map((r) => r.id!));
}

// ── Reconciliations ──────────────────────────────────────────────────────────

export async function upsertReconciliation(data: NewBankReconciliationRow) {
  const db = getDb();
  // Always INSERT a new row (each run creates a new snapshot).
  const [row] = await db.insert(bankReconciliations).values(data).returning();
  return row;
}

/** Latest reconciliation snapshot per bank account for a period. */
export async function getLatestReconciliations(
  workspaceId: string,
  periodId: string,
) {
  const db = getDb();
  // We want the latest row per (bank_account_id) for this period.
  // Use a subquery: SELECT DISTINCT ON equivalent via GROUP BY + max(created_at).
  // Since Drizzle doesn't expose DISTINCT ON, use raw SQL for the inner query.
  const rows = await db
    .select()
    .from(bankReconciliations)
    .where(
      and(
        eq(bankReconciliations.workspaceId, workspaceId),
        eq(bankReconciliations.periodId, periodId),
      ),
    )
    .orderBy(bankReconciliations.bankAccountId, desc(bankReconciliations.createdAt));

  // Deduplicate: keep first (latest) per bankAccountId.
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.bankAccountId)) return false;
    seen.add(r.bankAccountId);
    return true;
  });
}

// ── Aggregates for reconciliation math ──────────────────────────────────────

/**
 * Compute ledger balance for a PUC account in a period.
 * Balance = SUM(debit) - SUM(credit) for asset accounts (1xxx).
 * We always return debit - credit (caller interprets sign).
 */
export async function getLedgerBalanceForAccount(
  workspaceId: string,
  pucAccountId: string,
  periodId: string,
): Promise<string> {
  const db = getDb();
  // Import schema pieces directly to avoid circular import.
  const { journalEntries, journalLines } = await import('@/lib/db/schema');

  const result = await db
    .select({
      balance: sql<string>`COALESCE(SUM(${journalLines.debit}) - SUM(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.workspaceId, workspaceId),
        eq(journalLines.accountId, pucAccountId),
        eq(journalEntries.periodId, periodId),
        // Only posted entries count in the ledger balance.
        eq(journalEntries.status, 'posted'),
      ),
    );

  return result[0]?.balance ?? '0';
}

/**
 * Count matched and unmatched transactions for a bank account.
 */
export async function getMatchCounts(
  workspaceId: string,
  bankAccountId: string,
): Promise<{ matched: number; unmatched: number }> {
  const db = getDb();
  const rows = await db
    .select({
      isMatched: sql<boolean>`${bankTransactions.matchedJournalLineId} IS NOT NULL`,
      cnt: sql<string>`COUNT(*)`,
    })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.workspaceId, workspaceId),
        eq(bankTransactions.bankAccountId, bankAccountId),
      ),
    )
    .groupBy(sql`${bankTransactions.matchedJournalLineId} IS NOT NULL`);

  let matched = 0;
  let unmatched = 0;
  for (const r of rows) {
    const count = parseInt(r.cnt, 10);
    if (r.isMatched) matched = count;
    else unmatched = count;
  }
  return { matched, unmatched };
}

/** Latest statement import for a bank account — used to get endingBalance. */
export async function getLatestStatementImport(
  workspaceId: string,
  bankAccountId: string,
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(bankStatementImports)
    .where(
      and(
        eq(bankStatementImports.workspaceId, workspaceId),
        eq(bankStatementImports.bankAccountId, bankAccountId),
        eq(bankStatementImports.status, 'completed'),
      ),
    )
    .orderBy(desc(bankStatementImports.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
