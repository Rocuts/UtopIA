// ---------------------------------------------------------------------------
// services/status.ts — BankReconciliationPort implementation.
//
// Consumed by WS5 (monthly close health check) to determine whether
// bank reconciliation is a blocking gate for the period close.
// ---------------------------------------------------------------------------

import 'server-only';
import {
  listBankAccounts,
  getLatestReconciliations,
  getMatchCounts,
  getLedgerBalanceForAccount,
  getLatestStatementImport,
} from '../repository';
import {
  isReconciliationBlocking,
  type BankReconciliationPort,
  type ReconciliationStatus,
} from '../types';

export const bankReconciliationPort: BankReconciliationPort = {
  async getReconciliationStatus({ workspaceId, periodId }) {
    const accounts = await listBankAccounts(workspaceId);
    if (accounts.length === 0) return [];

    // Load latest snapshots for this period.
    const snapshots = await getLatestReconciliations(workspaceId, periodId);
    const snapshotByAccount = new Map(snapshots.map((s) => [s.bankAccountId, s]));

    const results: ReconciliationStatus[] = [];

    for (const account of accounts) {
      const snapshot = snapshotByAccount.get(account.id);
      const label = `${account.bankName} ${account.accountNumber}`;

      if (snapshot) {
        // Use persisted snapshot.
        const blocking = isReconciliationBlocking(snapshot.difference, snapshot.ledgerBalance);
        results.push({
          bankAccountId: account.id,
          bankAccountLabel: label,
          ledgerBalanceCop: snapshot.ledgerBalance,
          bankBalanceCop: snapshot.bankBalance,
          differenceCop: snapshot.difference,
          matchedCount: snapshot.matchedCount,
          unmatchedCount: snapshot.unmatchedCount,
          status: snapshot.status as ReconciliationStatus['status'],
          blocking,
        });
      } else {
        // No reconciliation run yet — compute on-the-fly.
        const [ledgerBalance, counts, latestImport] = await Promise.all([
          getLedgerBalanceForAccount(workspaceId, account.accountId, periodId),
          getMatchCounts(workspaceId, account.id),
          getLatestStatementImport(workspaceId, account.id),
        ]);

        const bankBalance = latestImport?.endingBalance ?? '0';
        const diff = (parseFloat(ledgerBalance) - parseFloat(bankBalance)).toFixed(2);
        const blocking = isReconciliationBlocking(diff, ledgerBalance);

        results.push({
          bankAccountId: account.id,
          bankAccountLabel: label,
          ledgerBalanceCop: ledgerBalance,
          bankBalanceCop: bankBalance,
          differenceCop: diff,
          matchedCount: counts.matched,
          unmatchedCount: counts.unmatched,
          lastStatementDate: latestImport?.periodEnd ?? undefined,
          status: blocking || counts.unmatched > 0 ? 'open' : 'balanced',
          blocking,
        });
      }
    }

    return results;
  },
};

/**
 * Convenience export consumed by WS5 health-check directly.
 * `getLedgerVsBankDifference` matches the WS3 deliverable name in the roadmap.
 */
export async function getLedgerVsBankDifference(
  workspaceId: string,
  periodId: string,
  bankAccountId: string,
): Promise<{ ledger: string; bank: string; difference: string; blocking: boolean }> {
  const statuses = await bankReconciliationPort.getReconciliationStatus({
    workspaceId,
    periodId,
  });
  const found = statuses.find((s) => s.bankAccountId === bankAccountId);
  if (!found) {
    return { ledger: '0', bank: '0', difference: '0', blocking: false };
  }
  return {
    ledger: found.ledgerBalanceCop,
    bank: found.bankBalanceCop,
    difference: found.differenceCop,
    blocking: found.blocking,
  };
}
