// ---------------------------------------------------------------------------
// matcher/heuristic.ts — Heuristic bank transaction matcher.
//
// Algorithm: for each unmatched bank_transaction, find journal_lines that:
//   1. Belong to the same PUC account mapped to this bank_account.
//   2. Have an entry_date within ±dayWindow days of postedAt.
//   3. Have debit (for cash-in txns) or credit (for cash-out txns) matching
//      the absolute amount within amountToleranceCop.
//
// Confidence scoring (0..1):
//   +0.5  — amount matches exactly (within 1 COP).
//   +0.3  — entry date == postedAt date.
//   +0.1 per day of closeness (up to 0.3 at 0 days apart — covered by +0.3 above
//         so: 1 day off → +0.2, 2 days off → +0.1, 3 days off → +0.0 extra).
//   +0.1  — ≥1 token (>4 chars) from bank description found in journal description.
//
// Auto-match threshold: confidence ≥ 0.7.
//
// Implements: BankMatcher (types.ts)
//
// TODO WS3.1 — LLM matcher:
//   src/lib/accounting/banking/matcher/llm-matcher.ts
//   Export a stub that throws BankingError(BANK_ERR.ENGINE_DISABLED, 'not_implemented').
//   Invoke when heuristic confidence < threshold and UTOPIA_ENABLE_LLM_MATCHER=true.
// ---------------------------------------------------------------------------

import 'server-only';
import { and, between, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  bankAccounts,
  bankTransactions,
  journalLines,
  journalEntries,
} from '@/lib/db/schema';
import type { BankMatcher, MatchCandidate, MatchResult } from '../types';
import { listUnmatchedTransactions } from '../repository';

// ── Score constants ──────────────────────────────────────────────────────────

const SCORE_EXACT_AMOUNT = 0.5;
const SCORE_EXACT_DATE = 0.3;
const SCORE_PROXIMITY_PER_DAY = 0.1; // each day closer (max +0.2 for 1-day diff)
const SCORE_DESCRIPTION_TOKEN = 0.1;
const AUTO_MATCH_THRESHOLD = 0.7;

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 86_400_000);
}

function dateAddDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** Tokens from a string: words longer than 4 chars, lowercased. */
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-záéíóúñ0-9 ]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4),
  );
}

function descriptionScore(bankDesc: string, ledgerDesc: string | null): number {
  if (!ledgerDesc) return 0;
  const bankTokens = tokenize(bankDesc);
  const ledgerTokens = tokenize(ledgerDesc);
  const hasShared = [...bankTokens].some((t) => ledgerTokens.has(t));
  return hasShared ? SCORE_DESCRIPTION_TOKEN : 0;
}

// ── Matcher implementation ────────────────────────────────────────────────────

export const heuristicMatcher: BankMatcher = {
  async findMatches(input) {
    const {
      workspaceId,
      bankAccountId,
      dayWindow = 3,
      amountToleranceCop = '1',
      fromDate,
      toDate,
    } = input;

    const db = getDb();
    const tolerance = parseFloat(amountToleranceCop);

    // 1. Resolve PUC account_id for this bank_account.
    const baRows = await db
      .select({ accountId: bankAccounts.accountId })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, bankAccountId))
      .limit(1);

    if (baRows.length === 0) return [];
    const pucAccountId = baRows[0].accountId;

    // 2. Load unmatched bank transactions.
    const unmatched = await listUnmatchedTransactions(
      workspaceId,
      bankAccountId,
      fromDate,
      toDate,
    );
    if (unmatched.length === 0) return [];

    // 3. Load all already-matched journal_line IDs to exclude them.
    const alreadyMatchedRows = await db
      .select({ id: bankTransactions.matchedJournalLineId })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.workspaceId, workspaceId),
          ne(bankTransactions.bankAccountId, bankAccountId), // exclude self — self is unmatched
          sql`${bankTransactions.matchedJournalLineId} IS NOT NULL`,
        ),
      );
    // Also get matched from same account
    const alreadyMatchedSelfRows = await db
      .select({ id: bankTransactions.matchedJournalLineId })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.workspaceId, workspaceId),
          eq(bankTransactions.bankAccountId, bankAccountId),
          sql`${bankTransactions.matchedJournalLineId} IS NOT NULL`,
        ),
      );
    const excludedLineIds = new Set([
      ...alreadyMatchedRows.map((r) => r.id!),
      ...alreadyMatchedSelfRows.map((r) => r.id!),
    ]);

    // 4. For each unmatched transaction, find candidates in journal_lines.
    const results: MatchResult[] = [];

    for (const tx of unmatched) {
      const postedAt = new Date(tx.postedAt);
      const amount = parseFloat(tx.amount);
      const absAmount = Math.abs(amount);
      const fromWindow = dateAddDays(postedAt, -dayWindow);
      const toWindow = dateAddDays(postedAt, dayWindow);

      // Determine which side of the journal_line to match:
      // - amount > 0 (cash IN to client) → Debit to bank account (asset debit)
      // - amount < 0 (cash OUT) → Credit to bank account (asset credit)
      const matchDebit = amount >= 0;

      // Query candidates from journal_lines.
      // We load candidates for the window and filter in JS for flexibility.
      const amountCol = matchDebit ? journalLines.debit : journalLines.credit;

      const candidates = await db
        .select({
          lineId: journalLines.id,
          entryId: journalLines.entryId,
          entryDate: journalEntries.entryDate,
          lineDesc: journalLines.description,
          entryDesc: journalEntries.description,
          lineAmount: amountCol,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.workspaceId, workspaceId),
            eq(journalLines.accountId, pucAccountId),
            eq(journalEntries.status, 'posted'),
            between(journalEntries.entryDate, fromWindow, toWindow),
          ),
        );

      // Score candidates.
      const scored: MatchCandidate[] = [];

      for (const c of candidates) {
        // Skip already matched.
        if (excludedLineIds.has(c.lineId)) continue;

        const lineAmount = parseFloat(c.lineAmount ?? '0');
        const amountDiff = Math.abs(lineAmount - absAmount);
        if (amountDiff > tolerance) continue; // hard filter

        let confidence = 0;
        const reasons: string[] = [];

        // Amount score
        if (amountDiff <= 1) {
          confidence += SCORE_EXACT_AMOUNT;
          reasons.push('monto exacto');
        }

        // Date score
        const entryDate = new Date(c.entryDate);
        const daysOff = daysBetween(postedAt, entryDate);
        if (daysOff === 0) {
          confidence += SCORE_EXACT_DATE;
          reasons.push('misma fecha');
        } else if (daysOff < dayWindow) {
          // Closer = higher score: 1 day off → +0.2, 2 days → +0.1
          const proximityScore = SCORE_PROXIMITY_PER_DAY * (dayWindow - daysOff);
          confidence += proximityScore;
          reasons.push(`${daysOff}d de diferencia`);
        }

        // Description score
        const ledgerDesc = c.lineDesc ?? c.entryDesc ?? '';
        const dScore = descriptionScore(tx.description, ledgerDesc);
        if (dScore > 0) {
          confidence += dScore;
          reasons.push('descripción coincide');
        }

        // Cap at 1.0
        confidence = Math.min(1, confidence);

        scored.push({
          journalLineId: c.lineId,
          journalEntryId: c.entryId,
          journalEntryDate: entryDate,
          description: ledgerDesc,
          amountCop: lineAmount.toFixed(2),
          confidence,
          reason: reasons.join(', '),
        });
      }

      // Sort by confidence desc.
      scored.sort((a, b) => b.confidence - a.confidence);
      const [best, ...rest] = scored;

      results.push({
        bankTransactionId: tx.id,
        bestCandidate: best ?? null,
        alternativeCandidates: rest.slice(0, 5), // top 5 alternatives for manual review
      });
    }

    return results;
  },
};

export { AUTO_MATCH_THRESHOLD };
