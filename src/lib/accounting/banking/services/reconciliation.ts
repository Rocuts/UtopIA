// ---------------------------------------------------------------------------
// services/reconciliation.ts — Run heuristic matching and snapshot reconciliation.
//
// Flow:
//   1. Run heuristicMatcher.findMatches()
//   2. For each result with confidence ≥ AUTO_MATCH_THRESHOLD → matchTransaction()
//      (1:1: una línea contable concilia a lo sumo un movimiento bancario)
//   3. Count matched/unmatched transactions POSTED IN THE PERIOD
//   4. Ledger balance ACCUMULATED to the period cut-off vs the ending balance
//      of the bank statement of the SAME period (auditoría contab-nomina-09).
//      No statement for the period → not reconcilable (N/D), never '0'.
//   5. Insert bank_reconciliations snapshot
//
// Returns: { matchedCount, unmatchedCount, ledgerBalance, bankBalance, difference, status }
// ---------------------------------------------------------------------------

import 'server-only';
import { heuristicMatcher, AUTO_MATCH_THRESHOLD } from '../matcher/heuristic';
import {
  matchTransaction,
  getMatchCounts,
  getLedgerBalanceForAccount,
  getPeriodBounds,
  getStatementImportForPeriod,
  upsertReconciliation,
  getBankAccount,
} from '../repository';
import {
  BankingError,
  BANK_ERR,
  isBankReconEnabled,
  reconciliationFigures,
  reconciliationStatusFor,
} from '../types';

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
  /** Saldo en libros acumulado al corte del período. */
  ledgerBalance: string;
  /** Saldo final del extracto del período; null si no hay (no conciliable). */
  bankBalance: string | null;
  /** libros − extracto; null si no conciliable. */
  difference: string | null;
  /** 'balanced' sólo con diferencia 0 y sin movimientos pendientes. */
  status: 'balanced' | 'open';
  blocking: boolean;
  reconcilable: boolean;
  reason: string | null;
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === '23505';
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
  const period = await getPeriodBounds(workspaceId, periodId);
  if (!period) {
    throw new BankingError(BANK_ERR.INVALID_INPUT, `Período ${periodId} no encontrado.`);
  }

  // 1. Run matcher.
  const matchResults = await heuristicMatcher.findMatches({
    workspaceId,
    bankAccountId,
    dayWindow,
    amountToleranceCop,
  });

  // 2. Apply auto-matches, 1:1 (contab-nomina-10): una línea contable ya usada
  //    en esta corrida no concilia otro movimiento; el índice único parcial de
  //    la migración 0022 cubre corridas concurrentes.
  let autoMatched = 0;
  const usedLineIds = new Set<string>();
  for (const result of matchResults) {
    const best = result.bestCandidate;
    if (!best || best.confidence < AUTO_MATCH_THRESHOLD) continue;
    if (usedLineIds.has(best.journalLineId)) continue;
    try {
      await matchTransaction(
        result.bankTransactionId,
        best.journalLineId,
        best.confidence.toFixed(3),
        'exact',
        reconciledBy,
      );
      usedLineIds.add(best.journalLineId);
      autoMatched++;
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }

  // 3. Final counts for the period being reconciled.
  const { matched: matchedCount, unmatched: unmatchedCount } = await getMatchCounts(
    workspaceId,
    bankAccountId,
    { from: period.startsAt, to: period.endsAt },
  );

  // 4. Balances: ledger accumulated to the cut-off vs statement of the period.
  const ledgerBalance = await getLedgerBalanceForAccount(
    workspaceId,
    account.accountId,
    periodId,
  );
  const statement = await getStatementImportForPeriod(workspaceId, bankAccountId, period);
  const bankBalance = statement?.endingBalance ?? null;

  const fig = reconciliationFigures(ledgerBalance, bankBalance);
  const status = reconciliationStatusFor(fig.difference, unmatchedCount);

  // 5. Snapshot reconciliation.
  const recon = await upsertReconciliation({
    workspaceId,
    bankAccountId,
    periodId,
    ledgerBalance,
    bankBalance,
    difference: fig.difference,
    matchedCount,
    unmatchedCount,
    status,
    reconciledAt: new Date(),
    reconciledBy: reconciledBy ?? null,
    notes: fig.reason,
  });

  return {
    reconciliationId: recon.id,
    autoMatched,
    matchedCount,
    unmatchedCount,
    ledgerBalance,
    bankBalance,
    difference: fig.difference,
    status,
    blocking: fig.blocking,
    reconcilable: fig.reconcilable,
    reason: fig.reason,
  };
}
