// ---------------------------------------------------------------------------
// Libro mayor por líneas — GET /api/accounting/journal?view=ledger
// ---------------------------------------------------------------------------
// Integración W3-C (hallazgo nuevo de IW5b): `LedgerView` pedía líneas del
// mayor por cuenta/período y la API sólo listaba asientos, así que
// /workspace/contabilidad/mayor quedaba «en preparación».
//
// Contrato:
//   - Sólo asientos contabilizados (status 'posted'; 'reversed' por filas
//     históricas anteriores a la migración 0022). Los borradores no son libro.
//     Original y reverso aparecen ambos: el mayor muestra la anulación.
//   - Orden: fecha, número de asiento, número de línea.
//   - `balance` de cada línea = saldo acumulado de SU cuenta (débito −
//     crédito) después de la línea, en centavos exactos (BigInt). Con período
//     seleccionado arranca en el saldo anterior de la cuenta (Σ de los
//     períodos previos, mismos filtros de tercero/centro); sin período arranca
//     en 0 desde el primer movimiento.
//   - `truncated` = había más líneas que el límite: el cliente debe decirlo
//     (un mayor recortado sin aviso parece completo).
// ---------------------------------------------------------------------------

import { and, asc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import {
  accountingPeriods,
  chartOfAccounts,
  costCenters,
  journalEntries,
  journalLines,
  thirdParties,
} from '@/lib/db/schema';
import { DoubleEntryError, ERR } from '../types';

export const LEDGER_DEFAULT_LIMIT = 2_000;
export const LEDGER_MAX_LIMIT = 5_000;

export interface LedgerLinesParams {
  workspaceId: string;
  periodId?: string;
  accountId?: string;
  /** NIT (prefijo) o razón social (contiene). */
  thirdParty?: string;
  /** Código del centro de costo (prefijo). */
  costCenter?: string;
  limit?: number;
}

export interface LedgerLineView {
  id: string;
  entryId: string;
  entryNumber: number;
  entryDate: string;
  status: 'draft' | 'posted' | 'reversed' | 'voided';
  reversedByEntryId: string | null;
  sourceType: string;
  description: string | null;
  account: { id: string; code: string; name: string };
  thirdParty: { id: string; legalName: string; identification: string } | null;
  costCenter: { id: string; code: string; name: string } | null;
  /** NUMERIC(20,2) como string ("1234.56"). */
  debit: string;
  credit: string;
  /** Saldo acumulado de la cuenta tras la línea (débito − crédito), "−1234.56". */
  balance: string;
}

export interface LedgerOpeningBalance {
  accountId: string;
  /** Saldo anterior al período (débito − crédito). */
  balance: string;
}

export interface LedgerLinesResult {
  lines: LedgerLineView[];
  /** Saldos anteriores al período por cuenta (vacío sin período). */
  openingBalances: LedgerOpeningBalance[];
  truncated: boolean;
  limit: number;
}

const POSTED_STATUSES = ['posted', 'reversed'] as const;
const SCALE = BigInt(100);
const ZERO = BigInt(0);

/** NUMERIC con signo ("-1234.5", "12", "0.07") → centavos. */
export function numericToCents(raw: string | number | null | undefined): bigint {
  const t = String(raw ?? '0').trim() || '0';
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m) throw new Error('numericToCents: valor no numérico');
  const cents = BigInt(m[2] || '0') * SCALE + BigInt(((m[3] ?? '') + '00').slice(0, 2));
  return m[1] ? -cents : cents;
}

/** Centavos → NUMERIC string con 2 decimales ("-1234.56"). */
export function centsToNumeric(c: bigint): string {
  const neg = c < ZERO;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / SCALE}.${(a % SCALE).toString().padStart(2, '0')}`;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Filtros de cuenta / tercero / centro comunes a líneas y saldo anterior. */
function lineFilters(params: LedgerLinesParams): SQL[] {
  const conds: SQL[] = [
    eq(journalLines.workspaceId, params.workspaceId),
    eq(journalEntries.workspaceId, params.workspaceId),
    inArray(journalEntries.status, [...POSTED_STATUSES]),
  ];
  if (params.accountId) conds.push(eq(journalLines.accountId, params.accountId));
  const tp = params.thirdParty?.trim();
  if (tp) {
    const q = escapeLike(tp);
    conds.push(
      or(ilike(thirdParties.identification, `${q}%`), ilike(thirdParties.legalName, `%${q}%`))!,
    );
  }
  const cc = params.costCenter?.trim();
  if (cc) conds.push(ilike(costCenters.code, `${escapeLike(cc)}%`));
  return conds;
}

export async function listLedgerLines(params: LedgerLinesParams): Promise<LedgerLinesResult> {
  const db = getDb();
  const limit = Math.min(Math.max(params.limit ?? LEDGER_DEFAULT_LIMIT, 1), LEDGER_MAX_LIMIT);

  // Saldo anterior: sólo con período seleccionado (del mismo workspace).
  const opening = new Map<string, bigint>();
  if (params.periodId) {
    const [period] = await db
      .select({ year: accountingPeriods.year, month: accountingPeriods.month })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.id, params.periodId),
          eq(accountingPeriods.workspaceId, params.workspaceId),
        ),
      );
    if (!period) {
      throw new DoubleEntryError(ERR.ENTRY_NOT_FOUND, 'Período no encontrado en el workspace');
    }
    const prior = await db
      .select({
        accountId: journalLines.accountId,
        balance: sql<string>`coalesce(sum(${journalLines.debit}), 0) - coalesce(sum(${journalLines.credit}), 0)`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accountingPeriods, eq(accountingPeriods.id, journalEntries.periodId))
      .leftJoin(thirdParties, eq(thirdParties.id, journalLines.thirdPartyId))
      .leftJoin(costCenters, eq(costCenters.id, journalLines.costCenterId))
      .where(
        and(
          ...lineFilters(params),
          sql`(${accountingPeriods.year} < ${period.year} OR (${accountingPeriods.year} = ${period.year} AND ${accountingPeriods.month} < ${period.month}))`,
        ),
      )
      .groupBy(journalLines.accountId);
    for (const r of prior) {
      const c = numericToCents(r.balance);
      if (c !== ZERO) opening.set(r.accountId, c);
    }
  }

  const conds = lineFilters(params);
  if (params.periodId) conds.push(eq(journalEntries.periodId, params.periodId));

  const rows = await db
    .select({
      id: journalLines.id,
      entryId: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.entryDate,
      status: journalEntries.status,
      reversedByEntryId: journalEntries.reversedByEntryId,
      sourceType: journalEntries.sourceType,
      entryDescription: journalEntries.description,
      lineDescription: journalLines.description,
      accountId: chartOfAccounts.id,
      accountCode: chartOfAccounts.code,
      accountName: chartOfAccounts.name,
      thirdPartyId: thirdParties.id,
      thirdPartyName: thirdParties.legalName,
      thirdPartyIdentification: thirdParties.identification,
      costCenterId: costCenters.id,
      costCenterCode: costCenters.code,
      costCenterName: costCenters.name,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalLines.accountId))
    .leftJoin(thirdParties, eq(thirdParties.id, journalLines.thirdPartyId))
    .leftJoin(costCenters, eq(costCenters.id, journalLines.costCenterId))
    .where(and(...conds))
    .orderBy(
      asc(journalEntries.entryDate),
      asc(journalEntries.entryNumber),
      asc(journalLines.lineNumber),
    )
    .limit(limit + 1);

  const truncated = rows.length > limit;
  const running = new Map(opening);
  const lines: LedgerLineView[] = rows.slice(0, limit).map((r) => {
    const bal =
      (running.get(r.accountId) ?? ZERO) + numericToCents(r.debit) - numericToCents(r.credit);
    running.set(r.accountId, bal);
    return {
      id: r.id,
      entryId: r.entryId,
      entryNumber: r.entryNumber,
      entryDate: r.entryDate instanceof Date ? r.entryDate.toISOString() : String(r.entryDate),
      status: r.status,
      reversedByEntryId: r.reversedByEntryId ?? null,
      sourceType: r.sourceType,
      description: r.lineDescription ?? r.entryDescription ?? null,
      account: { id: r.accountId, code: r.accountCode, name: r.accountName },
      thirdParty: r.thirdPartyId
        ? {
            id: r.thirdPartyId,
            legalName: r.thirdPartyName ?? '',
            identification: r.thirdPartyIdentification ?? '',
          }
        : null,
      costCenter: r.costCenterId
        ? { id: r.costCenterId, code: r.costCenterCode ?? '', name: r.costCenterName ?? '' }
        : null,
      debit: centsToNumeric(numericToCents(r.debit)),
      credit: centsToNumeric(numericToCents(r.credit)),
      balance: centsToNumeric(bal),
    };
  });

  return {
    lines,
    openingBalances: [...opening.entries()].map(([accountId, c]) => ({
      accountId,
      balance: centsToNumeric(c),
    })),
    truncated,
    limit,
  };
}
