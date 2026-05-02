// ---------------------------------------------------------------------------
// Domain types for the accounting core (Ola 1 Fase 1).
//
// These interfaces describe the *input shapes* used by the double-entry
// service and route handlers. They are intentionally decoupled from Drizzle's
// `$inferInsert` types (`NewJournalEntryRow`, `NewJournalLineRow`) because
// callers should NOT have to know about server-managed fields like
// `entryNumber`, `version`, `totalDebit`, `totalCredit`, or `functional*`
// columns. The service computes those from `lines`.
//
// Monetary amounts are passed as strings (not numbers) to preserve NUMERIC
// precision end-to-end. Postgres NUMERIC(20,2) is exact; JavaScript `number`
// loses precision past 2^53. The validator parses these strings into BigInt
// (centavos) for sum comparisons. See `validate.ts`.
// ---------------------------------------------------------------------------

export interface JournalLineInput {
  /** UUID of `chart_of_accounts` row. Must be postable, same workspace. */
  accountId: string;
  /** Optional: third party (customer/supplier/employee). */
  thirdPartyId?: string | null;
  /** Optional: cost center for analytical accounting. */
  costCenterId?: string | null;
  /** NUMERIC string, e.g. "1234567.89". Must be >= 0; exclusive vs credit. */
  debit: string;
  /** NUMERIC string. Must be >= 0; exclusive vs debit. */
  credit: string;
  /** ISO-4217 code. Default 'COP'. Ola 1: only COP supported. */
  currency?: string;
  /** Decimal string with up to 8 fractional digits. Default '1'. */
  exchangeRate?: string;
  /** Free-text line description (sub-description under the entry's). */
  description?: string | null;
  /** Free-form analytical dimensions (project, channel, etc.). */
  dimensions?: Record<string, unknown> | null;
}

export type SourceType =
  | 'manual'
  | 'import'
  | 'invoice'
  | 'payment'
  | 'depreciation'
  | 'adjustment'
  | 'closing'
  | 'reversal'
  | 'ai_generated'
  | 'opening';

export interface CreateEntryInput {
  workspaceId: string;
  /** UUID of an existing `accounting_periods` row in this workspace. */
  periodId: string;
  /** Date the entry is recognized (must fall within period's range). */
  entryDate: Date;
  /** Header description; mandatory for audit trail. */
  description: string;
  /** Origin of the entry (drives downstream behavior). Default 'manual'. */
  sourceType?: SourceType;
  /** UUID of upstream record (e.g. invoice id). Optional. */
  sourceId?: string | null;
  /** Free-text reference (e.g. invoice number "FE-1234"). */
  sourceRef?: string | null;
  /** At least 2 lines, balanced. */
  lines: JournalLineInput[];
  /** Free-form metadata persisted on the journal entry. */
  metadata?: Record<string, unknown> | null;
  /**
   * 'draft' (default): saved but not posted; mutable, not in trial balance.
   * 'posted': immediate posting; same TX, no separate post step.
   */
  status?: 'draft' | 'posted';
  /** UUID of user creating it (auth not yet wired — pass null for now). */
  createdBy?: string | null;
}

export interface PostEntryInput {
  entryId: string;
  workspaceId: string;
  postedBy?: string | null;
}

export interface ReverseEntryInput {
  /** UUID of the original posted entry. */
  originalEntryId: string;
  workspaceId: string;
  /** Why we're reversing — required for audit. Stored in metadata.reason. */
  reason: string;
  /** Date for the reversal entry. Defaults to `new Date()`. */
  entryDate?: Date;
  postedBy?: string | null;
}

export interface VoidDraftInput {
  entryId: string;
  workspaceId: string;
}

// ---------------------------------------------------------------------------
// Errors
//
// Single error class with a typed `code` so route handlers can map cleanly to
// HTTP status codes without string-matching error messages.
// ---------------------------------------------------------------------------

export class DoubleEntryError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'DoubleEntryError';
    this.code = code;
    this.details = details;
  }
}

export const ERR = {
  /** sum(debit) !== sum(credit) on the lines array. */
  UNBALANCED: 'UNBALANCED',
  /** < 2 lines, both sides non-zero on a line, negative amounts, etc. */
  INVALID_LINES: 'INVALID_LINES',
  /** Account exists but is_postable=false (it's a parent / heading). */
  ACCOUNT_NOT_POSTABLE: 'ACCOUNT_NOT_POSTABLE',
  /** Period status != 'open' (closed or locked). */
  PERIOD_NOT_OPEN: 'PERIOD_NOT_OPEN',
  /** Trying to post/void a non-draft entry. */
  ENTRY_NOT_DRAFT: 'ENTRY_NOT_DRAFT',
  /** Entry id not found OR belongs to another workspace. */
  ENTRY_NOT_FOUND: 'ENTRY_NOT_FOUND',
  /** Trying to reverse an entry that's already reversed. */
  ALREADY_REVERSED: 'ALREADY_REVERSED',
  /** Trying to reverse a non-posted entry. */
  ENTRY_NOT_POSTED: 'ENTRY_NOT_POSTED',
  /** Postgres serialization_failure / deadlock_detected after retries. */
  CONCURRENCY: 'CONCURRENCY',
  /** Workspace id does not match the entity's workspace_id. */
  WORKSPACE_MISMATCH: 'WORKSPACE_MISMATCH',
} as const;

export type DoubleEntryErrorCode = (typeof ERR)[keyof typeof ERR];

// ---------------------------------------------------------------------------
// Service result types
// ---------------------------------------------------------------------------

import type { JournalEntryRow, JournalLineRow } from '@/lib/db/schema';

export interface EntryWithLines {
  entry: JournalEntryRow;
  lines: JournalLineRow[];
}
