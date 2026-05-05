// ---------------------------------------------------------------------------
// services/import.ts — importStatement: parse CSV → persist bank_transactions
//
// Flow:
//   1. detectParser(filename, content) → parser
//   2. parser.parse() → ParsedStatement
//   3. Create bank_statement_imports row (status='pending')
//   4. Compute fingerprints → bulkInsertTransactions (ON CONFLICT DO NOTHING)
//   5. Update import row with counts + status='completed'
//
// Returns the import row + counts.
// ---------------------------------------------------------------------------

import 'server-only';
import { detectParser } from '../parsers';
import { fingerprintTransaction } from '../fingerprint';
import {
  createStatementImport,
  updateStatementImport,
  bulkInsertTransactions,
  getBankAccount,
} from '../repository';
import { BankingError, BANK_ERR, isBankReconEnabled } from '../types';

export interface ImportResult {
  importId: string;
  inserted: number;
  skipped: number;
  warnings: string[];
  periodStart?: Date;
  periodEnd?: Date;
  endingBalance?: string;
}

export interface ImportStatementInput {
  workspaceId: string;
  bankAccountId: string;
  filename: string;
  content: string | Buffer;
  /** Optional: UUID of the user triggering the import (from auth, if available). */
  importedBy?: string;
}

export async function importStatement(input: ImportStatementInput): Promise<ImportResult> {
  if (!isBankReconEnabled()) {
    throw new BankingError(BANK_ERR.ENGINE_DISABLED, 'Conciliación bancaria deshabilitada.');
  }

  const { workspaceId, bankAccountId, filename, content, importedBy } = input;

  // Verify bank account belongs to workspace.
  const account = await getBankAccount(workspaceId, bankAccountId);
  if (!account) {
    throw new BankingError(
      BANK_ERR.ACCOUNT_NOT_FOUND,
      `Cuenta bancaria ${bankAccountId} no encontrada en el workspace.`,
    );
  }

  // 1. Parse the file.
  const parser = detectParser(filename, content);
  let statement;
  try {
    statement = await parser.parse(filename, content);
  } catch (err) {
    if (err instanceof BankingError) throw err;
    throw new BankingError(
      BANK_ERR.PARSE_FAILED,
      `Error al parsear el archivo: ${(err as Error).message}`,
      err,
    );
  }

  // 2. Create the import record (pending).
  const importRow = await createStatementImport({
    workspaceId,
    bankAccountId,
    filename,
    format: 'csv',
    status: 'pending',
    importedBy: importedBy ?? null,
    periodStart: statement.periodStart ?? null,
    periodEnd: statement.periodEnd ?? null,
    startingBalance: statement.startingBalance ?? null,
    endingBalance: statement.endingBalance ?? null,
    transactionCount: 0,
    duplicatesSkipped: 0,
  });

  try {
    // 3. Build DB rows with fingerprints.
    const rows = statement.transactions.map((tx) => ({
      workspaceId,
      bankAccountId,
      importId: importRow.id,
      postedAt: tx.postedAt,
      valueDate: tx.valueDate ?? null,
      description: tx.description,
      reference: tx.reference ?? null,
      amount: tx.amountCop,
      runningBalance: tx.runningBalance ?? null,
      currency: 'COP' as const,
      externalId: tx.externalId ?? null,
      fingerprint: fingerprintTransaction(tx, bankAccountId),
      rawPayload: tx.rawPayload ?? null,
    }));

    // 4. Bulk insert with dedupe.
    const { inserted, skipped } = await bulkInsertTransactions(rows);

    // 5. Update import row to completed.
    await updateStatementImport(importRow.id, {
      transactionCount: inserted,
      duplicatesSkipped: skipped,
      status: 'completed',
      periodStart: statement.periodStart ?? undefined,
      periodEnd: statement.periodEnd ?? undefined,
      endingBalance: statement.endingBalance ?? undefined,
    });

    return {
      importId: importRow.id,
      inserted,
      skipped,
      warnings: statement.warnings,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      endingBalance: statement.endingBalance,
    };
  } catch (err) {
    // Mark import as failed.
    await updateStatementImport(importRow.id, {
      status: 'failed',
      errorMessage: (err as Error).message,
    }).catch(() => {/* best-effort */});
    throw err;
  }
}
