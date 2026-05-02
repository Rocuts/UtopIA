// ---------------------------------------------------------------------------
// Accounting cache helpers (Ola 1.F)
// ---------------------------------------------------------------------------
// Funciones de query que en Ola 2 (`cacheComponents: true` en
// `next.config.ts`) se decoraran con `'use cache'` + `cacheLife('hours')` +
// `cacheTag(...)`. Por AHORA, en Ola 1, el flag NO esta activo y la
// directive `'use cache'` falla en build si se usa sin el experimental.
//
// Estrategia:
//   - Implementamos las funciones como queries normales (no cacheadas).
//   - Cuando Ola 2 active el flag, basta con descomentar las 3 lineas
//     marcadas con `// CACHE_TAG_ENABLE`. Las acciones de Ola 1.F ya emiten
//     `updateTag(...)` para los mismos tags, asi que el plumbing de
//     read-your-writes ya esta listo.
//
// Tags emitidos por las Server Actions y consumidos aqui (Ola 2):
//   - `libro-mayor:${workspaceId}:${periodId}` — para getCachedLedger
//   - `puc:${workspaceId}`                     — para getCachedAccountsTree
//   - `asientos:${workspaceId}`                — para getCachedJournalList
//   - `periodos:${workspaceId}`                — para getCachedPeriods
//
// Sin cache aun, estas funciones siguen siendo utiles porque centralizan
// la forma de las queries que la UI necesita. Mover a cached fetcher sera
// un cambio mecanico de 3 lineas por funcion.
// ---------------------------------------------------------------------------

import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
// CACHE_TAG_ENABLE — descomentar en Ola 2:
// import {
//   unstable_cacheTag as cacheTag,
//   unstable_cacheLife as cacheLife,
// } from 'next/cache';

import { buildTree } from '@/lib/accounting/chart-of-accounts/queries';
import type { AccountTreeNode } from '@/lib/accounting/chart-of-accounts/types';
import { getDb } from '@/lib/db/client';
import {
  accountingPeriods,
  chartOfAccounts,
  journalEntries,
  journalLines,
  type AccountingPeriodRow,
  type ChartOfAccountsRow,
  type JournalEntryRow,
  type JournalLineRow,
} from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Types: shape de retorno esperado por la UI.
// ---------------------------------------------------------------------------

export interface CachedLedgerLine extends JournalLineRow {
  /** Cuenta resuelta (codigo + nombre) — para que la UI no tenga que joinar
   *  client-side. Si la cuenta fue desactivada despues de postear, igual
   *  aparece (el ledger es historico, no se mueve). */
  account: Pick<ChartOfAccountsRow, 'id' | 'code' | 'name' | 'type'>;
}

export interface CachedLedgerEntry {
  entry: JournalEntryRow;
  lines: CachedLedgerLine[];
}

export interface CachedLedger {
  workspaceId: string;
  periodId: string;
  entries: CachedLedgerEntry[];
  /** Cantidad de entries devueltas (despues de paginar). */
  count: number;
}

// ---------------------------------------------------------------------------
// getCachedLedger
//
// Devuelve TODOS los asientos del periodo (entries + lines + cuenta) listos
// para render. Por defecto trae solo posted+reversed (no drafts en el
// reporte oficial); el caller puede pedir drafts via `includeDrafts`.
//
// En Ola 2: agregar `'use cache'` + `cacheLife('hours')` + `cacheTag(...)`.
// Las Server Actions ya emiten `updateTag(\`libro-mayor:${ws}:${period}\`)`,
// asi que apenas se active `cacheComponents`, estas lecturas heredan
// read-your-writes automaticamente.
// ---------------------------------------------------------------------------

export async function getCachedLedger(
  workspaceId: string,
  periodId: string,
  opts: { includeDrafts?: boolean; limit?: number; offset?: number } = {},
): Promise<CachedLedger> {
  // CACHE_TAG_ENABLE — descomentar en Ola 2:
  // 'use cache';
  // cacheLife('hours');
  // cacheTag(`libro-mayor:${workspaceId}:${periodId}`);

  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5_000);
  const offset = Math.max(opts.offset ?? 0, 0);

  const entryConds = [
    eq(journalEntries.workspaceId, workspaceId),
    eq(journalEntries.periodId, periodId),
  ];

  const entries = await db
    .select()
    .from(journalEntries)
    .where(and(...entryConds))
    .orderBy(
      asc(journalEntries.entryDate),
      asc(journalEntries.entryNumber),
    )
    .limit(limit)
    .offset(offset);

  const filteredEntries = opts.includeDrafts
    ? entries
    : entries.filter((e) => e.status !== 'draft');

  if (filteredEntries.length === 0) {
    return { workspaceId, periodId, entries: [], count: 0 };
  }

  // Carga bulk de lineas + cuentas en un solo SELECT con JOIN. Limite
  // defensivo: 5000 entries x promedio 4 lineas = 20k filas, holgado.
  const entryIds = filteredEntries.map((e) => e.id);

  const lineRows = await db
    .select({
      line: journalLines,
      account: {
        id: chartOfAccounts.id,
        code: chartOfAccounts.code,
        name: chartOfAccounts.name,
        type: chartOfAccounts.type,
      },
    })
    .from(journalLines)
    .innerJoin(
      chartOfAccounts,
      eq(journalLines.accountId, chartOfAccounts.id),
    )
    .where(
      and(
        eq(journalLines.workspaceId, workspaceId),
        inArray(journalLines.entryId, entryIds),
      ),
    );

  // Agrupar lineas por entry y ordenar por lineNumber.
  const linesByEntry = new Map<string, CachedLedgerLine[]>();
  for (const row of lineRows) {
    const list = linesByEntry.get(row.line.entryId) ?? [];
    list.push({ ...row.line, account: row.account });
    linesByEntry.set(row.line.entryId, list);
  }
  for (const list of linesByEntry.values()) {
    list.sort((a, b) => a.lineNumber - b.lineNumber);
  }

  return {
    workspaceId,
    periodId,
    entries: filteredEntries.map((entry) => ({
      entry,
      lines: linesByEntry.get(entry.id) ?? [],
    })),
    count: filteredEntries.length,
  };
}

// ---------------------------------------------------------------------------
// getCachedAccountsTree
//
// Arbol jerarquico del PUC del workspace. En Ola 2: cacheado por workspace,
// invalidado via `updateTag(\`puc:${ws.id}\`)` (las account-actions ya lo
// emiten).
// ---------------------------------------------------------------------------

export async function getCachedAccountsTree(
  workspaceId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<AccountTreeNode[]> {
  // CACHE_TAG_ENABLE — descomentar en Ola 2:
  // 'use cache';
  // cacheLife('hours');
  // cacheTag(`puc:${workspaceId}`);

  return buildTree(workspaceId, { activeOnly: opts.activeOnly ?? true });
}

// ---------------------------------------------------------------------------
// getCachedPeriods
//
// Lista los periodos del workspace, opcionalmente filtrada por anio.
// Tag: `periodos:${ws}` global o `periodos:${ws}:${year}` mas especifico.
// ---------------------------------------------------------------------------

export async function getCachedPeriods(
  workspaceId: string,
  opts: { year?: number } = {},
): Promise<AccountingPeriodRow[]> {
  // CACHE_TAG_ENABLE — descomentar en Ola 2:
  // 'use cache';
  // cacheLife('hours');
  // cacheTag(`periodos:${workspaceId}`);
  // if (opts.year) cacheTag(`periodos:${workspaceId}:${opts.year}`);

  const db = getDb();
  const conditions = [eq(accountingPeriods.workspaceId, workspaceId)];
  if (opts.year) conditions.push(eq(accountingPeriods.year, opts.year));

  return db
    .select()
    .from(accountingPeriods)
    .where(and(...conditions))
    .orderBy(asc(accountingPeriods.year), asc(accountingPeriods.month));
}

// ---------------------------------------------------------------------------
// getCachedJournalList
//
// Listado paginado y plano de asientos. Sin lineas (las usa la pagina
// detalle, que tiene su propio fetcher con tag `asiento:${ws}:${id}`).
// ---------------------------------------------------------------------------

export interface CachedJournalListRow {
  entry: JournalEntryRow;
}

export interface CachedJournalList {
  workspaceId: string;
  rows: CachedJournalListRow[];
  limit: number;
  offset: number;
}

export async function getCachedJournalList(
  workspaceId: string,
  opts: {
    periodId?: string;
    status?: 'draft' | 'posted' | 'reversed';
    limit?: number;
    offset?: number;
  } = {},
): Promise<CachedJournalList> {
  // CACHE_TAG_ENABLE — descomentar en Ola 2:
  // 'use cache';
  // cacheLife('hours');
  // cacheTag(`asientos:${workspaceId}`);
  // if (opts.periodId) cacheTag(`libro-mayor:${workspaceId}:${opts.periodId}`);

  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const conds = [eq(journalEntries.workspaceId, workspaceId)];
  if (opts.periodId) conds.push(eq(journalEntries.periodId, opts.periodId));
  if (opts.status) conds.push(eq(journalEntries.status, opts.status));

  const rows = await db
    .select()
    .from(journalEntries)
    .where(and(...conds))
    .orderBy(
      desc(journalEntries.entryDate),
      desc(journalEntries.entryNumber),
    )
    .limit(limit)
    .offset(offset);

  return {
    workspaceId,
    rows: rows.map((entry) => ({ entry })),
    limit,
    offset,
  };
}
