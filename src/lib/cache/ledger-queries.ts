// ---------------------------------------------------------------------------
// Ledger queries cached (Ola 2 — Cache Components Next.js 16.2 estable)
// ---------------------------------------------------------------------------
// Helpers de lectura para el libro mayor / PUC / periodos optimizados con
// la directive `'use cache'` + `cacheLife()` + `cacheTag()`. Los tags
// coinciden EXACTAMENTE con los que las Server Actions de
// `src/lib/accounting/actions/*.ts` ya emiten via `updateTag(...)`, asi que
// las invalidaciones son automaticas y read-your-writes funciona out of
// the box.
//
// Diferencia con `accounting-cache.ts`:
//   - `accounting-cache.ts` expone funciones "rich" (entries + lines + cuenta
//     resuelta, con paginacion). Foco: pagina detalle del libro mayor.
//   - `ledger-queries.ts` (este archivo) expone las shapes "delgadas" mas
//     usadas por landing/widgets: lista plana de cuentas activas, lista
//     plana de periodos por anio, ledger crudo (entries + lines flat). Sin
//     hidratacion extra: solo lo que un Server Component necesita para
//     renderizar la primera vista.
//
// Reglas Cache Components (Next.js 16.2):
//   - La directive `'use cache'` debe ser la PRIMERA linea de la funcion.
//   - Los argumentos NO pueden ser non-serializable (no Date, no Map, no
//     funciones). Aqui solo strings, numbers y unions literales — OK.
//   - No se pueden invocar `cookies()`, `headers()` ni `searchParams` dentro
//     de una funcion cached. El caller debe extraerlos antes y pasarlos
//     como args.
// ---------------------------------------------------------------------------

import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
// import { cacheLife, cacheTag } from 'next/cache'; // re-enable when cacheComponents flips

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
// getCachedLedgerByPeriod
//
// Devuelve el libro mayor del periodo en formato JOIN plano: una fila por
// linea, con el entry y la cuenta resuelta. Util para tablas con saldo
// acumulado (la UI calcula el running balance ordenando client-side).
//
// Tag: `libro-mayor:${workspaceId}:${periodId}`. Las acciones de
// `journal-actions.ts` y `period-actions.ts` invalidan exactamente este tag.
// ---------------------------------------------------------------------------

export interface LedgerRow {
  entry: JournalEntryRow;
  line: JournalLineRow;
  account: Pick<ChartOfAccountsRow, 'id' | 'code' | 'name' | 'type'>;
}

export async function getCachedLedgerByPeriod(
  workspaceId: string,
  periodId: string,
): Promise<LedgerRow[]> {
  // 'use cache'; // disabled until cacheComponents flag flips in Ola 4
  // cacheLife('hours');
  // cacheTag(`libro-mayor:${workspaceId}:${periodId}`);

  const db = getDb();
  const rows = await db
    .select({
      entry: journalEntries,
      line: journalLines,
      account: {
        id: chartOfAccounts.id,
        code: chartOfAccounts.code,
        name: chartOfAccounts.name,
        type: chartOfAccounts.type,
      },
    })
    .from(journalEntries)
    .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(
      chartOfAccounts,
      eq(journalLines.accountId, chartOfAccounts.id),
    )
    .where(
      and(
        eq(journalEntries.workspaceId, workspaceId),
        eq(journalEntries.periodId, periodId),
        eq(journalEntries.status, 'posted'),
      ),
    )
    .orderBy(
      asc(journalEntries.entryDate),
      asc(journalEntries.entryNumber),
      asc(journalLines.lineNumber),
    );

  return rows;
}

// ---------------------------------------------------------------------------
// getCachedAccountsTree (flat)
//
// Lista plana de cuentas activas, ordenada por codigo. Para vista de PUC
// jerarquica usar `getCachedAccountsTree` de `accounting-cache.ts`, que
// reusa `buildTree()`.
//
// Tag: `puc:${workspaceId}`. El PUC cambia raramente (seed inicial + altas
// puntuales), por eso `cacheLife('days')`.
// ---------------------------------------------------------------------------

export async function getCachedAccountsFlat(
  workspaceId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<ChartOfAccountsRow[]> {
  // 'use cache'; // disabled until cacheComponents flag flips in Ola 4
  // cacheLife('days');
  // cacheTag(`puc:${workspaceId}`);

  const db = getDb();
  const conds = [eq(chartOfAccounts.workspaceId, workspaceId)];
  if (opts.activeOnly !== false) conds.push(eq(chartOfAccounts.active, true));

  return db
    .select()
    .from(chartOfAccounts)
    .where(and(...conds))
    .orderBy(asc(chartOfAccounts.code));
}

// ---------------------------------------------------------------------------
// getCachedPeriodsByYear
//
// Lista los periodos del workspace para un anio especifico. Si la UI necesita
// "todos los periodos" usar `getCachedPeriods` de `accounting-cache.ts`.
//
// Tags emitidos: el general `periodos:${ws}` y el especifico
// `periodos:${ws}:${year}`. Las period-actions invalidan ambos en cada
// mutacion, asi que cualquier cambio de periodo refresca esta lectura.
// ---------------------------------------------------------------------------

export async function getCachedPeriodsByYear(
  workspaceId: string,
  year: number,
): Promise<AccountingPeriodRow[]> {
  // 'use cache'; // disabled until cacheComponents flag flips in Ola 4
  // cacheLife('hours');
  // cacheTag(`periodos:${workspaceId}`);
  // cacheTag(`periodos:${workspaceId}:${year}`);

  const db = getDb();
  return db
    .select()
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.workspaceId, workspaceId),
        eq(accountingPeriods.year, year),
      ),
    )
    .orderBy(asc(accountingPeriods.month));
}

// ---------------------------------------------------------------------------
// getCachedRecentEntries
//
// Ultimos N asientos del workspace, ordenados por fecha desc. Para la
// landing `/workspace/contabilidad` (widget "Ultimos asientos").
//
// Tag: `asientos:${workspaceId}` global — cualquier alta/edicion/baja de
// asiento en el workspace lo invalida.
// ---------------------------------------------------------------------------

export async function getCachedRecentEntries(
  workspaceId: string,
  limit: number = 10,
): Promise<JournalEntryRow[]> {
  // 'use cache'; // disabled until cacheComponents flag flips in Ola 4
  // cacheLife('hours');
  // cacheTag(`asientos:${workspaceId}`);

  const db = getDb();
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  return db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.workspaceId, workspaceId))
    .orderBy(
      desc(journalEntries.entryDate),
      desc(journalEntries.entryNumber),
    )
    .limit(safeLimit);
}

// Re-export para que un caller pueda hidratar lineas+cuentas a partir de un
// listado de entries cached (caso uso: detalle expandible en la landing).
// Mantenemos esto fuera de `'use cache'` porque depende de inArray() sobre
// un set dinamico de IDs — la cacheabilidad ya la aporta el caller upstream.
export async function fetchLinesForEntries(
  workspaceId: string,
  entryIds: string[],
): Promise<
  Array<JournalLineRow & {
    account: Pick<ChartOfAccountsRow, 'id' | 'code' | 'name' | 'type'>;
  }>
> {
  if (entryIds.length === 0) return [];
  const db = getDb();
  const rows = await db
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

  return rows.map((r) => ({ ...r.line, account: r.account }));
}
