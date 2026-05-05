// ─── D5.3 — Forensic repository: queries sobre el libro mayor ────────────────
//
// Todas las queries son read-only y operan sobre journal_entries +
// journal_lines + third_parties + third_party_tax_profile.
// Devuelven tipos mínimos para las reglas — no expone el shape completo de
// Drizzle hacia arriba.

import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  journalEntries,
  journalLines,
  thirdParties,
} from '@/lib/db/schema';
import { thirdPartyTaxProfile } from '@/lib/db/schema-tax';

// ---------------------------------------------------------------------------
// Tipos locales
// ---------------------------------------------------------------------------

export interface PostedEntry {
  id: string;
  entryNumber: number;
  entryDate: Date;
}

export interface JournalLineAmount {
  entryId: string;
  debit: string;   // NUMERIC string
  credit: string;  // NUMERIC string
  thirdPartyId: string | null;
}

export interface ThirdPartySummary {
  thirdPartyId: string;
  totalAmountCop: number;
  entryIds: string[];
  hasVerifiedProfile: boolean;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Retorna todas las journal_entries con status='posted' del período,
 * ordenadas por entry_number ASC.
 */
export async function getPostedEntriesForPeriod(
  workspaceId: string,
  periodId: string,
): Promise<PostedEntry[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.entryDate,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.workspaceId, workspaceId),
        eq(journalEntries.periodId, periodId),
        eq(journalEntries.status, 'posted'),
      ),
    )
    .orderBy(journalEntries.entryNumber);

  return rows as PostedEntry[];
}

/**
 * Retorna todas las journal_lines de un período (filtrado via join con
 * journal_entries para respetar workspace + period).
 * Incluye solo líneas de entries posted.
 */
export async function getJournalLinesForPeriod(
  workspaceId: string,
  periodId: string,
): Promise<JournalLineAmount[]> {
  const db = getDb();
  const rows = await db
    .select({
      entryId: journalLines.entryId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      thirdPartyId: journalLines.thirdPartyId,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.workspaceId, workspaceId),
        eq(journalEntries.periodId, periodId),
        eq(journalEntries.status, 'posted'),
      ),
    );

  return rows as JournalLineAmount[];
}

/**
 * Para cada tercero presente en las líneas del período, determina:
 *  - si apareció en períodos anteriores (si no → first-time).
 *  - si tiene perfil tributario verificado (verified_at IS NOT NULL).
 *  - monto total involucrado y lista de entry IDs.
 *
 * Retorna solo los terceros que aparecen POR PRIMERA VEZ en este período
 * y tienen monto total > threshold.
 */
export async function getNewThirdPartiesForPeriod(
  workspaceId: string,
  periodId: string,
  minAmountCop: number = 5_000_000,
): Promise<ThirdPartySummary[]> {
  const db = getDb();

  // 1. Terceros del período actual con suma de montos y entry IDs.
  const currentRows = await db
    .select({
      thirdPartyId: journalLines.thirdPartyId,
      entryId: journalLines.entryId,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.workspaceId, workspaceId),
        eq(journalEntries.periodId, periodId),
        eq(journalEntries.status, 'posted'),
      ),
    );

  // Agrupar por tercero
  const byThirdParty = new Map<
    string,
    { totalAmountCop: number; entryIds: Set<string> }
  >();
  for (const row of currentRows) {
    if (!row.thirdPartyId) continue;
    const existing = byThirdParty.get(row.thirdPartyId) ?? {
      totalAmountCop: 0,
      entryIds: new Set<string>(),
    };
    existing.totalAmountCop +=
      parseFloat(row.debit ?? '0') + parseFloat(row.credit ?? '0');
    existing.entryIds.add(row.entryId);
    byThirdParty.set(row.thirdPartyId, existing);
  }

  if (byThirdParty.size === 0) return [];

  // 2. Filtrar los que superan el umbral de monto.
  const candidates = [...byThirdParty.entries()].filter(
    ([, v]) => v.totalAmountCop >= minAmountCop,
  );
  if (candidates.length === 0) return [];

  const thirdPartyIds = candidates.map(([id]) => id);

  // 3. Verificar si aparecen en períodos anteriores.
  // Un tercero es "nuevo" si no existe ninguna línea en otro período posted
  // de este workspace donde status='posted' y period_id != periodId.
  const previousRows = await db
    .select({ thirdPartyId: journalLines.thirdPartyId })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.workspaceId, workspaceId),
        sql`${journalEntries.periodId} != ${periodId}`,
        eq(journalEntries.status, 'posted'),
        sql`${journalLines.thirdPartyId} = ANY(${sql.raw(`ARRAY[${thirdPartyIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})`,
      ),
    );

  const seenBefore = new Set(
    previousRows
      .map((r) => r.thirdPartyId)
      .filter((id): id is string => id !== null),
  );

  // 4. Solo los que NO aparecen antes.
  const newThirdPartyIds = thirdPartyIds.filter((id) => !seenBefore.has(id));
  if (newThirdPartyIds.length === 0) return [];

  // 5. Verificar si tienen perfil tributario verificado.
  const profiles = await db
    .select({
      thirdPartyId: thirdPartyTaxProfile.thirdPartyId,
      verifiedAt: thirdPartyTaxProfile.verifiedAt,
    })
    .from(thirdPartyTaxProfile)
    .where(
      and(
        eq(thirdPartyTaxProfile.workspaceId, workspaceId),
        sql`${thirdPartyTaxProfile.thirdPartyId} = ANY(${sql.raw(`ARRAY[${newThirdPartyIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})`,
      ),
    );

  const profileMap = new Map(
    profiles.map((p) => [p.thirdPartyId, p.verifiedAt]),
  );

  return newThirdPartyIds.map((id) => {
    const agg = byThirdParty.get(id)!;
    const verifiedAt = profileMap.get(id);
    return {
      thirdPartyId: id,
      totalAmountCop: agg.totalAmountCop,
      entryIds: [...agg.entryIds],
      hasVerifiedProfile: verifiedAt != null,
    };
  });
}
