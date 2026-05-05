// ---------------------------------------------------------------------------
// fingerprint.ts — Deduplicate bank transactions by SHA-256.
//
// Exported as a standalone module so it's independently testable.
// The fingerprint is stored in `bank_transactions.fingerprint` (VARCHAR 64)
// and a UNIQUE INDEX `bt_ws_acc_fp_uniq` on (workspace_id, bank_account_id,
// fingerprint) ensures idempotent re-imports via ON CONFLICT DO NOTHING.
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import type { ParsedBankTransaction } from './types';

/**
 * Compute a stable SHA-256 fingerprint for a bank transaction.
 *
 * Canonical form:
 *   `${bankAccountId}|${postedAt YYYY-MM-DD}|${amountCop}|${first 80 chars of normalized description}`
 *
 * NOTE: `amountCop` is already a string coming from the parser (NUMERIC(20,2)
 * compatible). We normalize it to a fixed-point decimal before hashing so that
 * "1000.00" and "1000" produce the same hash.
 */
export function fingerprintTransaction(
  t: ParsedBankTransaction,
  bankAccountId: string,
): string {
  const date = t.postedAt.toISOString().slice(0, 10);
  // Normalize the amount: parse as float, round to 2 decimals, stringify.
  const amount = parseFloat(t.amountCop).toFixed(2);
  const desc = t.description
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  const canonical = `${bankAccountId}|${date}|${amount}|${desc}`;
  return sha256Hex(canonical);
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
