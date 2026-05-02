// ---------------------------------------------------------------------------
// Opening Balance Importer — public surface (Ola 1.D)
// ---------------------------------------------------------------------------
// Re-export estable para callers (route handler, server actions, agentes).
// Los modulos internos (`import.ts`, `parser.ts`) NO deben importarse
// directamente desde fuera del directorio.
// ---------------------------------------------------------------------------

export {
  parseOpeningBalanceFile,
  type ParseFileResult,
} from './parser';

export { importOpeningBalance } from './import';

export {
  OpeningBalanceError,
  OPENING_ERR,
  OPENING_BALANCING_ACCOUNT_CODE,
  PUC_MISMATCH_THRESHOLD,
  type OpeningBalanceErrorCode,
  type OpeningBalanceImport,
  type OpeningBalanceLine,
  type ImportResult,
} from './types';
