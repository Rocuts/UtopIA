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
  type ListEntriesParams,
} from './service';

export { validateBalance, buildReversalLines } from './validate';

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
