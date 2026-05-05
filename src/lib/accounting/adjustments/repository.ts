// ─── WS4 — Shared repository helpers for adjustments calculators ─────────────
//
// Helpers compartidos:
//   - getPeriod: carga y valida que el período esté abierto.
//   - getAccountByCode: busca un chartOfAccounts por código dentro del workspace.
//
// Estas utilidades NO son de escritura — solo lecturas. La escritura
// (actualizar accumulated_depreciation, last_depreciated_period_id, etc.)
// vive en cada sub-repository (depreciation/repository.ts, etc.).

import 'server-only';

import { and, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { accountingPeriods, chartOfAccounts } from '@/lib/db/schema';
import type { AccountingPeriodRow, ChartOfAccountsRow } from '@/lib/db/schema';

import { AdjustmentsError, ADJ_ERR } from './types';

// ---------------------------------------------------------------------------
// getPeriod
// ---------------------------------------------------------------------------

/**
 * Carga el período por ID, verifica que pertenezca al workspace y que su
 * estado sea 'open'. Si no, lanza `AdjustmentsError(ADJ_PERIOD_NOT_OPEN)`.
 */
export async function getPeriod(
  workspaceId: string,
  periodId: string,
): Promise<AccountingPeriodRow> {
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

  const period = rows[0];
  if (!period) {
    throw new AdjustmentsError(
      ADJ_ERR.PERIOD_NOT_FOUND,
      `Período ${periodId} no encontrado en el workspace.`,
    );
  }
  if (period.status !== 'open') {
    throw new AdjustmentsError(
      ADJ_ERR.PERIOD_NOT_OPEN,
      `Período ${period.year}-${String(period.month).padStart(2, '0')} está en estado "${period.status}" — solo períodos abiertos pueden recibir ajustes.`,
    );
  }
  return period;
}

// ---------------------------------------------------------------------------
// getAccountByCode
// ---------------------------------------------------------------------------

/**
 * Busca una cuenta por su código PUC dentro del workspace.
 * Retorna undefined si no existe (el caller decide si crear o lanzar error).
 */
export async function getAccountByCode(
  workspaceId: string,
  code: string,
): Promise<ChartOfAccountsRow | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
        eq(chartOfAccounts.code, code),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Inserta una cuenta PUC si no existe. Idempotente (ON CONFLICT DO NOTHING).
 * Retorna el id de la cuenta (nueva o existente).
 */
export async function upsertAccountByCode(
  workspaceId: string,
  code: string,
  name: string,
  type: 'ACTIVO' | 'PASIVO' | 'PATRIMONIO' | 'INGRESO' | 'GASTO' | 'COSTO',
): Promise<{ id: string; created: boolean }> {
  const existing = await getAccountByCode(workspaceId, code);
  if (existing) return { id: existing.id, created: false };

  const db = getDb();
  const [inserted] = await db
    .insert(chartOfAccounts)
    .values({
      workspaceId,
      code,
      name,
      type,
      level: 4,
      isPostable: true,
      active: true,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) return { id: inserted.id, created: true };

  // Race: insertado por otra sesión entre el SELECT y el INSERT.
  const refetch = await getAccountByCode(workspaceId, code);
  if (refetch) return { id: refetch.id, created: false };

  throw new AdjustmentsError(
    ADJ_ERR.CONFIG_MISSING,
    `No se pudo insertar ni recuperar la cuenta PUC ${code}.`,
  );
}
