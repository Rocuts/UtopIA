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

  // Saldo OFICIAL del período (auditoría contab-nomina-16): sólo asientos
  // posteados. Los borradores no forman parte del mayor y la provisión (la de
  // renta incluida) se POSTEA, así que no puede calcularse sobre ellos. Los
  // reversos netean solos: el original sigue 'posted' junto a su reverso
  // (ver double-entry/service.ts). El asiento de cierre anual (traslado a
  // patrimonio) no es movimiento del período y se excluye.
  const result = await db.execute(
    sql`
      SELECT
        coa.code,
        jl.cost_center_id::text AS cost_center_id,
        jl.third_party_id::text AS third_party_id,
        COALESCE(SUM(jl.debit), 0)::text  AS total_debit,
        COALESCE(SUM(jl.credit), 0)::text AS total_credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN chart_of_accounts coa ON coa.id = jl.account_id
      WHERE je.workspace_id = ${workspaceId}
        AND je.period_id    = ${periodId}
        AND je.status = 'posted'
        AND je.source_type <> 'closing'
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries o
          WHERE o.id = je.reversal_of_entry_id AND o.source_type = 'closing'
        )
      GROUP BY coa.code, jl.cost_center_id, jl.third_party_id
      ORDER BY coa.code
    `,
  );

  type Row = {
    code: string;
    cost_center_id: string | null;
    third_party_id: string | null;
    total_debit: string;
    total_credit: string;
  };
  const rows = (result as unknown as { rows?: Row[] }).rows
    ?? ((Array.isArray(result) ? result : []) as Row[]);

  // Una fila por (cuenta, centro de costo, tercero): la base de provisiones se
  // reparte por centro de costo y la exoneración 114-1 se evalúa por
  // trabajador. Las sumas por cuenta (renta) no cambian.
  return rows.map((r) => ({
    code: r.code,
    costCenterId: r.cost_center_id ?? null,
    thirdPartyId: r.third_party_id ?? null,
    totalDebit: r.total_debit ?? '0.00',
    totalCredit: r.total_credit ?? '0.00',
  }));
}
