// ─── D5.3 — Forensic repository: queries sobre el libro mayor ────────────────
//
// Todas las queries son read-only y operan sobre journal_entries +
// journal_lines + third_parties + third_party_tax_profile.
// Devuelven tipos mínimos para las reglas — no expone el shape completo de
// Drizzle hacia arriba.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  accountingPeriods,
  journalEntries,
  journalLines,
} from '@/lib/db/schema';
import { thirdPartyTaxProfile } from '@/lib/db/schema-tax';
import { numericToCents } from '@/lib/accounting/double-entry/ledger';

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
  /**
   * Movimiento del tercero en el período, en centavos: el MAYOR de sus lados
   * (Σ débitos o Σ créditos), no la suma de ambos — factura y pago de la misma
   * compra son una sola transacción (auditoria-calidad-27).
   */
  totalAmountCents: bigint;
  entryIds: string[];
  hasVerifiedProfile: boolean;
}

// ---------------------------------------------------------------------------
// Pares anulados (contab-nomina-01)
// ---------------------------------------------------------------------------
// Desde WP10 un asiento reversado conserva status='posted' (sólo gana
// reversed_by_entry_id) y su reverso (source_type 'reversal') también es
// 'posted': ambos netean en el libro. Las pruebas de MONTOS (Benford, montos
// repetidos, sesgo a redondos, terceros nuevos) no deben contarlos: el mismo
// monto aparecería dos veces y un tercero anulado conservaría un monto
// material. La prueba de NUMERACIÓN sí los incluye (el reverso consume un
// número del consecutivo; excluirlo fabricaría huecos).
function sinParesAnulados() {
  return [
    sql`${journalEntries.reversedByEntryId} IS NULL`,
    sql`${journalEntries.sourceType} <> 'reversal'`,
  ];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Retorna todas las journal_entries con status='posted' del período,
 * ordenadas por entry_number ASC. Incluye originales reversados y reversos:
 * la usan huecos de numeración y horarios de registro, que evalúan el acto de
 * registrar, no el monto.
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
 * Incluye solo líneas de entries posted que NO forman un par anulado
 * (original reversado o reverso).
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
        ...sinParesAnulados(),
      ),
    );

  return rows as JournalLineAmount[];
}

/**
 * Para cada tercero presente en las líneas del período, determina:
 *  - si apareció en períodos ANTERIORES (inicio anterior al del período
 *    evaluado; si no → first-time). Los períodos posteriores no cuentan: re-
 *    escanear un período histórico debe detectar los terceros que entonces
 *    eran nuevos (auditoria-calidad-27).
 *  - si tiene perfil tributario verificado (verified_at IS NOT NULL).
 *  - movimiento del período (el mayor de sus lados, en centavos) y entry IDs.
 *
 * Retorna solo los terceros que aparecen POR PRIMERA VEZ en este período
 * y tienen movimiento ≥ threshold.
 */
export async function getNewThirdPartiesForPeriod(
  workspaceId: string,
  periodId: string,
  minAmountCop: number = 5_000_000,
): Promise<ThirdPartySummary[]> {
  const db = getDb();
  const ZERO = BigInt(0);
  const minCents = BigInt(Math.round(minAmountCop * 100));

  // 1. Terceros del período actual con sus lados y entry IDs.
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
        ...sinParesAnulados(),
      ),
    );

  // Agrupar por tercero
  const byThirdParty = new Map<
    string,
    { debit: bigint; credit: bigint; entryIds: Set<string> }
  >();
  for (const row of currentRows) {
    if (!row.thirdPartyId) continue;
    const existing = byThirdParty.get(row.thirdPartyId) ?? {
      debit: ZERO,
      credit: ZERO,
      entryIds: new Set<string>(),
    };
    existing.debit += numericToCents(row.debit);
    existing.credit += numericToCents(row.credit);
    existing.entryIds.add(row.entryId);
    byThirdParty.set(row.thirdPartyId, existing);
  }

  if (byThirdParty.size === 0) return [];

  const movimiento = (v: { debit: bigint; credit: bigint }) =>
    v.debit > v.credit ? v.debit : v.credit;

  // 2. Filtrar los que superan el umbral de monto.
  const candidates = [...byThirdParty.entries()].filter(
    ([, v]) => movimiento(v) >= minCents,
  );
  if (candidates.length === 0) return [];

  const thirdPartyIds = candidates.map(([id]) => id);

  // 3. Verificar si aparecen en períodos ANTERIORES del workspace.
  const previousRows = await db
    .select({ thirdPartyId: journalLines.thirdPartyId })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(accountingPeriods, eq(journalEntries.periodId, accountingPeriods.id))
    .where(
      and(
        eq(journalEntries.workspaceId, workspaceId),
        eq(journalEntries.status, 'posted'),
        sql`${accountingPeriods.startsAt} < (SELECT ap.starts_at FROM accounting_periods ap WHERE ap.id = ${periodId} AND ap.workspace_id = ${workspaceId})`,
        inArray(journalLines.thirdPartyId, thirdPartyIds),
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
        inArray(thirdPartyTaxProfile.thirdPartyId, newThirdPartyIds),
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
      totalAmountCents: movimiento(agg),
      entryIds: [...agg.entryIds],
      hasVerifiedProfile: verifiedAt != null,
    };
  });
}
