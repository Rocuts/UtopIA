// ─── WS4 — Fixed assets repository (queries + update tras post) ──────────────
//
// Responsabilidades:
//   - Cargar los activos fijos activos de un workspace.
//   - Actualizar accumulated_depreciation y last_depreciated_period_id
//     DESPUÉS de que WS5 (o el endpoint con post:true) haya posteado el asiento.

import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import {
  accountingPeriods,
  fixedAssets,
} from '@/lib/db/schema';
import type { FixedAssetRow, AccountingPeriodRow } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// listActiveFixedAssets
// ---------------------------------------------------------------------------

/**
 * Retorna todos los activos fijos activos del workspace, incluyendo el
 * período de última depreciación si aplica (join lazy para evitar N+1).
 */
export async function listActiveFixedAssets(
  workspaceId: string,
): Promise<
  Array<
    FixedAssetRow & {
      lastDepreciatedPeriod: { year: number; month: number } | null;
    }
  >
> {
  const db = getDb();

  // Cargamos activos activos y no dados de baja.
  const assets = await db
    .select()
    .from(fixedAssets)
    .where(
      and(
        eq(fixedAssets.workspaceId, workspaceId),
        eq(fixedAssets.active, true),
        isNull(fixedAssets.disposedAt),
      ),
    );

  if (assets.length === 0) return [];

  // Cargamos en una sola query todos los períodos referenciados.
  const periodIds = [
    ...new Set(
      assets
        .map((a) => a.lastDepreciatedPeriodId)
        .filter((id): id is string => id !== null && id !== undefined),
    ),
  ];

  let periodsMap = new Map<string, AccountingPeriodRow>();
  if (periodIds.length > 0) {
    const periods = await db
      .select()
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.workspaceId, workspaceId),
          // Drizzle inArray from 'drizzle-orm'
          // We use a raw SQL approach compatible with any length:
          // inArray is imported from drizzle-orm but we're keeping imports minimal.
          // Use a filter post-fetch since list is already bounded by workspace.
        ),
      );
    periodsMap = new Map(
      periods
        .filter((p) => periodIds.includes(p.id))
        .map((p) => [p.id, p]),
    );
  }

  return assets.map((a) => {
    const period = a.lastDepreciatedPeriodId
      ? periodsMap.get(a.lastDepreciatedPeriodId)
      : undefined;
    return {
      ...a,
      lastDepreciatedPeriod: period
        ? { year: period.year, month: period.month }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// updateAfterDepreciation
// ---------------------------------------------------------------------------

/**
 * Actualiza `accumulated_depreciation` y `last_depreciated_period_id` para
 * un lote de activos. Se llama DESPUÉS de que el asiento ha sido posteado.
 *
 * Esta función NO verifica si el período ya fue aplicado — eso lo hace el
 * caller (el endpoint con post:true verifica last_depreciated_period_id
 * antes de postear para evitar doble entrada).
 */
export async function updateAfterDepreciation(
  updates: Array<{
    fixedAssetId: string;
    newAccumulatedDepreciation: string; // NUMERIC string
    periodId: string;
  }>,
): Promise<void> {
  if (updates.length === 0) return;
  const db = getDb();

  // Actualizaciones individuales — en MVP el lote es pequeño (< 100 activos).
  // Para volúmenes mayores, usar UPDATE ... FROM (VALUES ...) en SQL raw.
  await Promise.all(
    updates.map((u) =>
      db
        .update(fixedAssets)
        .set({
          accumulatedDepreciation: u.newAccumulatedDepreciation,
          lastDepreciatedPeriodId: u.periodId,
          updatedAt: new Date(),
        })
        .where(eq(fixedAssets.id, u.fixedAssetId)),
    ),
  );
}
