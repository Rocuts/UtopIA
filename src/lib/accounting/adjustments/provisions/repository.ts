// ─── WS4 — Provisions repository ────────────────────────────────────────────
//
// Responsabilidades:
//   - Cargar provisionsConfig activos del workspace (con códigos PUC).
//   - Cargar saldos del período por cuenta (para calcular base de provisiones).

import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import {
  provisionsConfig,
  chartOfAccounts,
  journalLines,
  journalEntries,
} from '@/lib/db/schema';
import type { ProvisionsConfigRow } from '@/lib/db/schema';
import type { PeriodAccountBalance } from './calculator';

// ---------------------------------------------------------------------------
// listActiveProvisionsConfig
// ---------------------------------------------------------------------------

export async function listActiveProvisionsConfig(
  workspaceId: string,
): Promise<
  Array<
    ProvisionsConfigRow & {
      expenseAccountCode: string;
      liabilityAccountCode: string;
    }
  >
> {
  const db = getDb();

  // Load configs
  const configs = await db
    .select()
    .from(provisionsConfig)
    .where(
      and(
        eq(provisionsConfig.workspaceId, workspaceId),
        eq(provisionsConfig.active, true),
      ),
    );

  if (configs.length === 0) return [];

  // Load codes for expense and liability accounts in one query
  const accountIds = [
    ...new Set([
      ...configs.map((c) => c.expenseAccountId),
      ...configs.map((c) => c.liabilityAccountId),
    ]),
  ];

  const accounts = await db
    .select({ id: chartOfAccounts.id, code: chartOfAccounts.code })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
      ),
    );

  const codeMap = new Map(
    accounts.filter((a) => accountIds.includes(a.id)).map((a) => [a.id, a.code]),
  );

  return configs.map((c) => ({
    ...c,
    expenseAccountCode: codeMap.get(c.expenseAccountId) ?? '',
    liabilityAccountCode: codeMap.get(c.liabilityAccountId) ?? '',
  }));
}

// ---------------------------------------------------------------------------
// getPeriodAccountBalances
// ---------------------------------------------------------------------------

/**
 * Retorna los saldos débito/crédito de todas las cuentas que tienen movimiento
 * en el período dado. El resultado incluye el código PUC para que el calculator
 * pueda hacer match con `base_account_codes`.
 */
export async function getPeriodAccountBalances(
  workspaceId: string,
  periodId: string,
): Promise<PeriodAccountBalance[]> {
  const db = getDb();

  // Agregamos por cuenta todos los journal_lines del período (posteados y drafts).
  // En MVP incluimos 'draft' también — WS5 puede optar por solo 'posted' si quiere.
  const result = await db.execute(
    sql`
      SELECT
        coa.code,
        COALESCE(SUM(jl.debit), 0)::text  AS total_debit,
        COALESCE(SUM(jl.credit), 0)::text AS total_credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN chart_of_accounts coa ON coa.id = jl.account_id
      WHERE je.workspace_id = ${workspaceId}
        AND je.period_id    = ${periodId}
        AND je.status IN ('posted', 'draft')
      GROUP BY coa.code
      ORDER BY coa.code
    `,
  );

  const rows = (
    result as unknown as {
      rows?: Array<{ code: string; total_debit: string; total_credit: string }>;
    }
  ).rows ?? (Array.isArray(result) ? result : []) as Array<{ code: string; total_debit: string; total_credit: string }>;

  return rows.map((r) => ({
    code: r.code,
    totalDebit: r.total_debit ?? '0.00',
    totalCredit: r.total_credit ?? '0.00',
  }));
}
