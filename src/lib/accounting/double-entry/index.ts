// Public API of the double-entry engine.
//
// External callers (route handlers, agents, AI tools) should import from
// here, not from internal files. The internal split (validate.ts vs
// service.ts) is an implementation detail.

export {
  createEntry,
  getEntryWithLines,
  listEntries,
  postEntry,
  reverseEntry,
  voidDraft,
  type CreateEntryOptions,
  type JournalTx,
  type ListEntriesParams,
} from './service';

export { validateBalance, buildReversalLines, normalizeAmount } from './validate';

export {
  listLedgerLines,
  LEDGER_DEFAULT_LIMIT,
  LEDGER_MAX_LIMIT,
  type LedgerLinesParams,
  type LedgerLinesResult,
  type LedgerLineView,
  type LedgerOpeningBalance,
} from './ledger';

export {
  DoubleEntryError,
  ERR,
  type CreateEntryInput,
  type EntryWithLines,
  type JournalLineInput,
  type PostEntryInput,
  type ReverseEntryInput,
  type SourceType,
  type VoidDraftInput,
  type DoubleEntryErrorCode,
} from '../types';
