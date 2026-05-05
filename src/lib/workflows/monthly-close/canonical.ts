// ─── WS5 — Canonical serialization para el period hash ───────────────────────
//
// Algoritmo determinista que convierte journal_entries + journal_lines de
// un período en un string canónico apto para SHA-256.
//
// Reproducible por cualquier auditor: el README de monthly-close documenta
// el algoritmo paso a paso.
//
// REGLAS:
//  1. Entries ordenadas por entry_number ASC (ya garantizado por el query).
//  2. Lines ordenadas por line_number ASC dentro de cada entry.
//  3. Cada line: pipe-separated con campos nulos representados como vacío.
//  4. Entries separadas por \n.
//  5. Payload final: canonical + \n||OVERRIDE=<bool> + \n||PREVIOUS=<hash>.

import type { JournalEntryRow, JournalLineRow } from '@/lib/db/schema';

export type EntryWithLines = JournalEntryRow & { lines: JournalLineRow[] };

/**
 * Serializa una línea de asiento de forma determinista.
 * Campos: accountId|debit|credit|thirdPartyId|costCenterId|description
 */
function canonicalizeLine(line: JournalLineRow): string {
  return [
    line.accountId,
    line.debit,
    line.credit,
    line.thirdPartyId ?? '',
    line.costCenterId ?? '',
    (line.description ?? '').replace(/\|/g, '\\|').replace(/\n/g, '\\n'),
  ].join('|');
}

/**
 * Serializa un asiento completo de forma determinista.
 * Formato:
 *   entry.id|entryDate.toISOString()|entry_number|totalDebit|totalCredit
 *   line1
 *   line2
 *   ...
 */
function canonicalizeEntry(entry: EntryWithLines): string {
  const header = [
    entry.id,
    entry.entryDate instanceof Date
      ? entry.entryDate.toISOString()
      : new Date(entry.entryDate).toISOString(),
    String(entry.entryNumber),
    entry.totalDebit,
    entry.totalCredit,
  ].join('|');

  const sortedLines = [...entry.lines].sort((a, b) => a.lineNumber - b.lineNumber);
  const lineStrings = sortedLines.map(canonicalizeLine).join('\n');

  return `${header}\n${lineStrings}`;
}

/**
 * Genera el payload canónico completo para sha256.
 *
 * @param entries - journal_entries con sus lines, ordenadas por entry_number ASC.
 * @param override - Si el cierre fue forzado con override.
 * @param previousPeriodHash - Hash del período anterior (64 hex chars o '0'*64).
 */
export function buildCanonicalPayload(
  entries: EntryWithLines[],
  override: boolean,
  previousPeriodHash: string,
): string {
  const sortedEntries = [...entries].sort((a, b) => a.entryNumber - b.entryNumber);
  const canonical = sortedEntries.map(canonicalizeEntry).join('\n---\n');

  return [
    canonical,
    `||OVERRIDE=${override ? 'true' : 'false'}`,
    `||PREVIOUS=${previousPeriodHash}`,
  ].join('\n');
}
