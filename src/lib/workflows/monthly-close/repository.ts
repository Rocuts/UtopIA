// ─── WS5 — Monthly Close: Queries de repositorio ─────────────────────────────
//
// Queries puras contra la DB. Sin lógica de negocio.
// Todas las funciones aquí son step-safe (full Node.js access).

import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  accountingPeriods,
  chartOfAccounts,
  journalEntries,
  journalLines,
  monthlyCloseRuns,
  workspaces,
} from '@/lib/db/schema';
import type { JournalEntryRow, JournalLineRow, MonthlyCloseRunRow } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Período
// ---------------------------------------------------------------------------

export async function getPeriodById(workspaceId: string, periodId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.id, periodId),
        eq(accountingPeriods.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export function getPeriodLabel(period: { year: number; month: number }): string {
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

/** Retorna el período anterior más reciente con status='closed' o 'locked'. */
export async function getPreviousPeriod(workspaceId: string, year: number, month: number) {
  const db = getDb();
  // Número de meses desde epoch para comparar
  const currentMonthNum = year * 12 + month;
  const rows = await db
    .select()
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.workspaceId, workspaceId),
        sql`(${accountingPeriods.year} * 12 + ${accountingPeriods.month}) < ${currentMonthNum}`,
        sql`${accountingPeriods.status} IN ('closed', 'locked')`,
      ),
    )
    .orderBy(desc(accountingPeriods.year), desc(accountingPeriods.month))
    .limit(1);
  return rows[0] ?? null;
}

/** Hash del período anterior cerrado. Retorna '0'.repeat(64) si es el primero. */
export async function getPreviousPeriodHash(workspaceId: string, periodId: string): Promise<string> {
  const db = getDb();
  // 1. Obtenemos el período actual para saber year/month
  const current = await getPeriodById(workspaceId, periodId);
  if (!current) return '0'.repeat(64);

  // 2. Buscamos el run del período inmediatamente anterior
  const prev = await getPreviousPeriod(workspaceId, current.year, current.month);
  if (!prev) return '0'.repeat(64);

  const runRows = await db
    .select({ periodHash: monthlyCloseRuns.periodHash })
    .from(monthlyCloseRuns)
    .where(eq(monthlyCloseRuns.periodId, prev.id))
    .limit(1);

  return runRows[0]?.periodHash ?? '0'.repeat(64);
}

// ---------------------------------------------------------------------------
// Journal entries del período
// ---------------------------------------------------------------------------

export async function getPostedEntriesForPeriod(
  workspaceId: string,
  periodId: string,
): Promise<Array<JournalEntryRow & { lines: JournalLineRow[] }>> {
  const db = getDb();

  const entries = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.workspaceId, workspaceId),
        eq(journalEntries.periodId, periodId),
        eq(journalEntries.status, 'posted'),
      ),
    )
    .orderBy(asc(journalEntries.entryNumber));

  if (entries.length === 0) return [];

  const entryIds = entries.map((e) => e.id);
  const lines = await db
    .select()
    .from(journalLines)
    .where(
      and(
        eq(journalLines.workspaceId, workspaceId),
        sql`${journalLines.entryId} = ANY(ARRAY[${sql.join(entryIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
      ),
    )
    .orderBy(asc(journalLines.entryId), asc(journalLines.lineNumber));

  const linesByEntry = new Map<string, JournalLineRow[]>();
  for (const line of lines) {
    const arr = linesByEntry.get(line.entryId) ?? [];
    arr.push(line);
    linesByEntry.set(line.entryId, arr);
  }

  return entries.map((e) => ({ ...e, lines: linesByEntry.get(e.id) ?? [] }));
}

export async function getDraftEntriesCount(workspaceId: string, periodId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .select({ cnt: sql<string>`COUNT(*)` })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.workspaceId, workspaceId),
        eq(journalEntries.periodId, periodId),
        eq(journalEntries.status, 'draft'),
      ),
    );
  return parseInt(result[0]?.cnt ?? '0', 10);
}

export async function getUnbalancedPostedEntriesCount(
  workspaceId: string,
  periodId: string,
): Promise<number> {
  const db = getDb();
  const result = await db
    .select({ cnt: sql<string>`COUNT(*)` })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.workspaceId, workspaceId),
        eq(journalEntries.periodId, periodId),
        eq(journalEntries.status, 'posted'),
        sql`${journalEntries.totalDebit} != ${journalEntries.totalCredit}`,
      ),
    );
  return parseInt(result[0]?.cnt ?? '0', 10);
}

// ---------------------------------------------------------------------------
// PUC — cuentas de resultado (INGRESO, GASTO, COSTO)
// ---------------------------------------------------------------------------

export async function getResultAccounts(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
        eq(chartOfAccounts.active, true),
        sql`${chartOfAccounts.type} IN ('INGRESO', 'GASTO', 'COSTO')`,
        eq(chartOfAccounts.isPostable, true),
      ),
    );
}

/** Saldo neto del período para una cuenta (positivo = debe, negativo = haber). */
export async function getAccountPeriodBalance(
  workspaceId: string,
  periodId: string,
  accountId: string,
): Promise<string> {
  const db = getDb();
  const result = await db
    .select({
      totalDebit: sql<string>`COALESCE(SUM(${journalLines.functionalDebit}), 0)`,
      totalCredit: sql<string>`COALESCE(SUM(${journalLines.functionalCredit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.workspaceId, workspaceId),
        eq(journalLines.accountId, accountId),
        eq(journalEntries.periodId, periodId),
        eq(journalEntries.status, 'posted'),
      ),
    );

  const { totalDebit, totalCredit } = result[0] ?? { totalDebit: '0', totalCredit: '0' };
  const balance = parseFloat(totalDebit) - parseFloat(totalCredit);
  return balance.toFixed(2);
}

// ---------------------------------------------------------------------------
// Pending docs (uploads OCR)
// ---------------------------------------------------------------------------

export async function getPendingDocsCount(workspaceId: string): Promise<number> {
  const db = getDb();
  // Contamos pyme_uploads pendientes. Si el módulo no está activo, retorna 0.
  try {
    const result = await db.execute(
      sql`SELECT COUNT(*) AS cnt FROM pyme_uploads WHERE workspace_id = ${workspaceId} AND status = 'pending'`,
    );
    const rows = (result as unknown as { rows?: Array<{ cnt: unknown }> }).rows ?? [];
    return parseInt(String(rows[0]?.cnt ?? '0'), 10);
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export async function getWorkspaceName(workspaceId: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return rows[0]?.name ?? workspaceId;
}

export async function getActiveWorkspacesWithCloseEnabled(): Promise<Array<{ id: string; name: string }>> {
  const db = getDb();
  // MVP: flag global UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW. En el futuro habrá columna per-workspace.
  const rows = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces);
  return rows.map((r) => ({ id: r.id, name: r.name ?? r.id }));
}

// ---------------------------------------------------------------------------
// monthly_close_runs
// ---------------------------------------------------------------------------

export async function getRunByPeriodId(periodId: string): Promise<MonthlyCloseRunRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(monthlyCloseRuns)
    .where(eq(monthlyCloseRuns.periodId, periodId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getRunById(runId: string): Promise<MonthlyCloseRunRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(monthlyCloseRuns)
    .where(eq(monthlyCloseRuns.id, runId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertCloseRun(
  values: Partial<MonthlyCloseRunRow> & { workspaceId: string; periodId: string },
): Promise<MonthlyCloseRunRow> {
  const db = getDb();
  const existing = await getRunByPeriodId(values.periodId);

  if (existing) {
    const { workspaceId: _w, periodId: _p, id: _id, startedAt: _s, ...rest } = values as Record<string, unknown>;
    const updated = await db
      .update(monthlyCloseRuns)
      .set(rest as Partial<MonthlyCloseRunRow>)
      .where(eq(monthlyCloseRuns.id, existing.id))
      .returning();
    return updated[0];
  }

  const inserted = await db
    .insert(monthlyCloseRuns)
    .values({
      workspaceId: values.workspaceId,
      periodId: values.periodId,
      status: values.status ?? 'pending',
      workflowRunId: values.workflowRunId ?? null,
    })
    .returning();
  return inserted[0];
}

export async function updateCloseRun(
  runId: string,
  values: Partial<MonthlyCloseRunRow>,
): Promise<MonthlyCloseRunRow> {
  const db = getDb();
  const rows = await db
    .update(monthlyCloseRuns)
    .set(values)
    .where(eq(monthlyCloseRuns.id, runId))
    .returning();
  return rows[0];
}

/** Períodos abiertos/cerrados elegibles para cierre (status='open', sin run activo). */
export async function getPeriodsEligibleForClose(workspaceId: string) {
  const db = getDb();
  // Buscamos períodos con status='open' del mes anterior
  const now = new Date();
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // getMonth() es 0-based

  const rows = await db
    .select()
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.workspaceId, workspaceId),
        eq(accountingPeriods.year, prevYear),
        eq(accountingPeriods.month, prevMonth),
        sql`${accountingPeriods.status} IN ('open', 'closed')`,
      ),
    )
    .limit(1);
  return rows;
}
