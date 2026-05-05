// ---------------------------------------------------------------------------
// banking/index.ts — Public API re-exports for WS3.
//
// Consumers (WS5 health check, UI route handlers) import from here.
// Internal implementation details stay within the module.
// ---------------------------------------------------------------------------

// Types (public contract — frozen, owned by Opus)
export type {
  ParsedBankTransaction,
  ParsedStatement,
  BankStatementParser,
  MatchCandidate,
  MatchResult,
  BankMatcher,
  ReconciliationStatus,
  BankReconciliationPort,
  BankAccountRow,
  BankStatementImportRow,
  BankTransactionRow,
  BankReconciliationRow,
} from './types';
export { BankingError, BANK_ERR, isBankReconEnabled, isReconciliationBlocking } from './types';

// Port implementation (WS5 imports this)
export { bankReconciliationPort, getLedgerVsBankDifference } from './services/status';

// Import service
export { importStatement } from './services/import';
export type { ImportResult, ImportStatementInput } from './services/import';

// Reconciliation service
export { runReconciliation } from './services/reconciliation';
export type { ReconcileInput, ReconcileResult } from './services/reconciliation';

// Repository (exported for route handlers that need direct DB access)
export {
  listBankAccounts,
  getBankAccount,
  createBankAccount,
  updateBankAccount,
  softDeleteBankAccount,
  listTransactions,
  listStatementImports,
  matchTransaction,
} from './repository';

// Fingerprint utility (exposed for testing)
export { fingerprintTransaction, sha256Hex } from './fingerprint';
