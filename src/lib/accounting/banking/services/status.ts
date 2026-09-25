// ---------------------------------------------------------------------------
// services/status.ts — BankReconciliationPort implementation.
//
// Consumed by WS5 (monthly close health check) to determine whether
// bank reconciliation is a blocking gate for the period close.
//
// Auditoría contab-nomina-09/-11: saldo en libros acumulado al corte vs saldo
// final del extracto del MISMO período; sin extracto → no conciliable (N/D,
// bloquea), nunca '0'; tolerancia absoluta en centavos; 'balanced' sólo con
// diferencia 0.
// ---------------------------------------------------------------------------

import 'server-only';
import {
  listBankAccounts,
  getLatestReconciliations,
  getMatchCounts,
  getLedgerBalanceForAccount,
  getPeriodBounds,
  getStatementImportForPeriod,
} from '../repository';
import {
  RECON_NOT_AVAILABLE,
  isReconciliationBlocking,
  reconciliationFigures,
  reconciliationStatusFor,
  type BankReconciliationPort,
  type ReconciliationStatus,
} from '../types';

export const bankReconciliationPort: BankReconciliationPort = {
  async getReconciliationStatus({ workspaceId, periodId }) {
    const accounts = await listBankAccounts(workspaceId);
    if (accounts.length === 0) return [];
    const period = await getPeriodBounds(workspaceId, periodId);
    if (!period) return [];

    // Load latest snapshots for this period.
    const snapshots = await getLatestReconciliations(workspaceId, periodId);
    const snapshotByAccount = new Map(snapshots.map((s) => [s.bankAccountId, s]));

    const results: ReconciliationStatus[] = [];

    for (const account of accounts) {
      const snapshot = snapshotByAccount.get(account.id);
      const label = `${account.bankName} ${account.accountNumber}`;

      if (snapshot) {
        // Use persisted snapshot.
        const reconcilable = snapshot.bankBalance !== null && snapshot.difference !== null;
        const blocking = isReconciliationBlocking(snapshot.difference);
        results.push({
          bankAccountId: account.id,
          bankAccountLabel: label,
          ledgerBalanceCop: snapshot.ledgerBalance,
          bankBalanceCop: snapshot.bankBalance,
          differenceCop: snapshot.difference ?? RECON_NOT_AVAILABLE,
          matchedCount: snapshot.matchedCount,
          unmatchedCount: snapshot.unmatchedCount,
          // 'reviewed' (aceptado por el revisor) se respeta; el resto se
          // recalcula: 'balanced' sólo con diferencia 0.
          status:
            snapshot.status === 'reviewed'
              ? 'reviewed'
              : reconciliationStatusFor(snapshot.difference, snapshot.unmatchedCount),
          blocking,
          reconcilable,
          reason: reconcilable ? null : snapshot.notes ?? 'No conciliable: sin saldo de extracto del período.',
        });
      } else {
        // No reconciliation run yet — compute on-the-fly.
        const [ledgerBalance, counts, statement] = await Promise.all([
          getLedgerBalanceForAccount(workspaceId, account.accountId, periodId),
          getMatchCounts(workspaceId, account.id, { from: period.startsAt, to: period.endsAt }),
          getStatementImportForPeriod(workspaceId, account.id, period),
        ]);

        const bankBalance = statement?.endingBalance ?? null;
        const fig = reconciliationFigures(ledgerBalance, bankBalance);

        results.push({
          bankAccountId: account.id,
          bankAccountLabel: label,
          ledgerBalanceCop: ledgerBalance,
          bankBalanceCop: bankBalance,
          differenceCop: fig.difference ?? RECON_NOT_AVAILABLE,
          matchedCount: counts.matched,
          unmatchedCount: counts.unmatched,
          lastStatementDate: statement?.periodEnd ?? undefined,
          status: reconciliationStatusFor(fig.difference, counts.unmatched),
          blocking: fig.blocking,
          reconcilable: fig.reconcilable,
          reason: fig.reason,
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
): Promise<{ ledger: string | null; bank: string | null; difference: string | null; blocking: boolean }> {
  const statuses = await bankReconciliationPort.getReconciliationStatus({
    workspaceId,
    periodId,
  });
  const found = statuses.find((s) => s.bankAccountId === bankAccountId);
  if (!found) {
    // Cuenta sin estado: no se inventa un 0 conciliado.
    return { ledger: null, bank: null, difference: null, blocking: true };
  }
  return {
    ledger: found.ledgerBalanceCop,
    bank: found.bankBalanceCop,
    difference: found.differenceCop === RECON_NOT_AVAILABLE ? null : found.differenceCop,
    blocking: found.blocking,
  };
}
