// ─── WS5 — Step: period-hash ─────────────────────────────────────────────────
// Computa el hash SHA-256 encadenado del período.
//
// Algoritmo documentado en README.md:
//   1. Obtener previous_period_hash (o '0'*64 si es el primer cierre).
//   2. Cargar todas las journal_entries posteadas del período + sus lines.
//   3. Serializar de forma canónica y determinista (canonical.ts).
//   4. sha256(canonical || '\n||OVERRIDE=...' || '\n||PREVIOUS=...').
//   5. Persistir en monthly_close_runs.

import { createHash } from 'node:crypto';
import type { CloseMonthInput, PeriodHashResult } from '@/lib/accounting/closing/types';
import { getPostedEntriesForPeriod, getPreviousPeriodHash, updateCloseRun } from '../repository';
import { buildCanonicalPayload } from '../canonical';

export async function computePeriodHash(
  input: CloseMonthInput & { runId: string; override: boolean },
): Promise<PeriodHashResult> {
  'use step';

  const { workspaceId, periodId, runId, override } = input;

  // 1. Hash del período anterior
  const previousPeriodHash = await getPreviousPeriodHash(workspaceId, periodId);

  // 2. Entries posteadas del período (incluye el asiento de cierre recién creado)
  const entries = await getPostedEntriesForPeriod(workspaceId, periodId);

  // 3. Payload canónico
  const payload = buildCanonicalPayload(entries, override, previousPeriodHash);

  // 4. SHA-256
  const periodHash = createHash('sha256').update(payload, 'utf8').digest('hex');

  // 5. Persistir en monthly_close_runs
  await updateCloseRun(runId, {
    periodHash,
    previousPeriodHash,
  });

  const linesCount = entries.reduce((sum, e) => sum + e.lines.length, 0);

  return {
    periodHash,
    entriesCount: entries.length,
    linesCount,
  };
}
