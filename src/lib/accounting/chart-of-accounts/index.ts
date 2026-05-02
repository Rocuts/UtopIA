// ---------------------------------------------------------------------------
// Public surface del módulo `chart-of-accounts`.
// ---------------------------------------------------------------------------
//
// Importar desde `@/lib/accounting/chart-of-accounts` (no desde subpaths) para
// que la API pública quede estable. Si algún subpath se desexpone aquí, los
// callers no se rompen.
//
// IMPORTANTE: `rag-export` no se re-exporta desde aquí porque es un
// artefacto preparatorio para Ola 3 (ingesta del PUC al RAG). Quien lo use
// importará explícitamente desde `./rag-export` para dejar la dependencia
// rastreable.
// ---------------------------------------------------------------------------

export type {
  AccountTreeNode,
  AccountClassSummary,
} from './types';
export {
  ACCOUNT_CLASSES,
  CLASS_NATURE,
  getClassSummary,
} from './types';

export type { ListAccountsOpts } from './queries';
export {
  getAccount,
  getAccountById,
  getAccountsByIds,
  listAccounts,
  buildTree,
  getDescendants,
  isLeafAccount,
  countMovementsForAccount,
  getClassFromCode,
  getNatureFromCode,
} from './queries';

export type {
  CreateAccountInput,
  UpdateAccountInput,
  SeedPucEntry,
  SeedPucResult,
} from './mutations';
export {
  AccountValidationError,
  AccountConflictError,
  AccountNotFoundError,
  createAccount,
  updateAccount,
  deactivateAccount,
  seedPucForWorkspace,
  resetPucForWorkspace,
} from './mutations';
