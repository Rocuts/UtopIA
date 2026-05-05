// ---------------------------------------------------------------------------
// services/reconciliation.ts — Run heuristic matching and snapshot reconciliation.
//
// Flow:
//   1. Run heuristicMatcher.findMatches()
//   2. For each result with confidence ≥ AUTO_MATCH_THRESHOLD → matchTransaction()
//   3. Re-count matched/unmatched
//   4. Compute ledger balance vs bank balance
//   5. Upsert bank_reconciliations row
//
// Returns: { matchedCount, unmatchedCount, ledgerBalance, bankBalance, difference, status }
// ---------------------------------------------------------------------------

import 'server-only';
import { heuristicMatcher, AUTO_MATCH_THRESHOLD } from '../matcher/heuristic';
import {
  matchTransaction,
  getMatchCounts,
  getLedgerBalanceForAccount,
  getLatestStatementImport,
  upsertReconciliation,
  getBankAccount,
} from '../repository';
import { isReconciliationBlocking, BankingError, BANK_ERR, isBankReconEnabled } from '../types';

export interface ReconcileInput {
  workspaceId: string;
  bankAccountId: string;
  periodId: string;
  dayWindow?: number;
  amountToleranceCop?: string;
  reconciledBy?: string;
}

export interface ReconcileResult {
  reconciliationId: string;
  autoMatched: number;
  unmatchedCount: number;
  matchedCount: number;
  ledgerBalance: string;
  bankBalance: string;
  difference: string;
  status: 'balanced' | 'open';
  blocking: boolean;
}

export async function runReconciliation(input: ReconcileInput): Promise<ReconcileResult> {
  if (!isBankReconEnabled()) {
    throw new BankingError(BANK_ERR.ENGINE_DISABLED, 'Conciliación bancaria deshabilitada.');
  }

  const {
    workspaceId,
    bankAccountId,
    periodId,
    dayWindow = 3,
    amountToleranceCop = '1',
    reconciledBy,
  } = input;

  // Verify account.
  const account = await getBankAccount(workspaceId, bankAccountId);
  if (!account) {
    throw new BankingError(
      BANK_ERR.ACCOUNT_NOT_FOUND,
      `Cuenta bancaria ${bankAccountId} no encontrada.`,
    );
  }

  // 1. Run matcher.
  const matchResults = await heuristicMatcher.findMatches({
    workspaceId,
    bankAccountId,
    dayWindow,
    amountToleranceCop,
  });

  // 2. Apply auto-matches.
  let autoMatched = 0;
  for (const result of matchResults) {
    if (
      result.bestCandidate &&
      result.bestCandidate.confidence >= AUTO_MATCH_THRESHOLD
    ) {
      await matchTransaction(
        result.bankTransactionId,
        result.bestCandidate.journalLineId,
        result.bestCandidate.confidence.toFixed(3),
        'exact',
        reconciledBy,
      );
      autoMatched++;
    }
  }

  // 3. Get final counts.
  const { matched: matchedCount, unmatched: unmatchedCount } =
    await getMatchCounts(workspaceId, bankAccountId);

  // 4. Compute balances.
  const ledgerBalance = await getLedgerBalanceForAccount(
    workspaceId,
    account.accountId,
    periodId,
  );

  // Bank balance: ending balance from last completed import.
  const latestImport = await getLatestStatementImport(workspaceId, bankAccountId);
  const bankBalance = latestImport?.endingBalance ?? '0';

  const diff = (parseFloat(ledgerBalance) - parseFloat(bankBalance)).toFixed(2);
  const blocking = isReconciliationBlocking(diff, ledgerBalance);
  const status: 'balanced' | 'open' =
    blocking || unmatchedCount > 0 ? 'open' : 'balanced';

  // 5. Snapshot reconciliation.
  const recon = await upsertReconciliation({
    workspaceId,
    bankAccountId,
    periodId,
    ledgerBalance,
    bankBalance,
    difference: diff,
    matchedCount,
    unmatchedCount,
    status,
    reconciledAt: new Date(),
    reconciledBy: reconciledBy ?? null,
  });

  return {
    reconciliationId: recon.id,
    autoMatched,
    matchedCount,
    unmatchedCount,
    ledgerBalance,
    bankBalance,
    difference: diff,
    status,
    blocking,
  };
}
