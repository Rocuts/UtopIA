import 'server-only';
// ---------------------------------------------------------------------------
// WS2 — account-mapper: categoría/pucHint → UUID en chart_of_accounts
// ---------------------------------------------------------------------------
// Estrategia en tres pasos:
//
//   1. Búsqueda exacta: si pucHint existe y hay una cuenta `code=pucHint`,
//      `is_postable=true` en el workspace → úsala.
//      Si la cuenta tiene requires_cost_center=true y no hay costCenterId,
//      se emite un warning en el AccountMapping pero el caller decide.
//
//   2. Fallback dinámico via findAccountForKind():
//      Prefijos de código PUC PYMES (Decreto 2706/2012) por kind + palabras
//      clave de la descripción/categoría. UNA sola query con CASE-WHEN
//      scoring — sin N round-trips.
//
//      Orden de prefijos por kind (todos existen en el seed):
//        ingreso: '4135', '4170', '421'   (operacional → no-operacional)
//        egreso:  '5105','5110','5120','5135','5145','5205','530','531','540'
//
//      Si hay costCenterId: intenta cualquier cuenta postable del kind.
//      Si NO hay costCenterId: filtra requires_cost_center=false primero;
//        si no hay ninguna sin CC, intenta igual con CC y avisa (warning);
//        si tampoco hay ninguna con CC, retorna accountId=null → skipped.
//
//   3. Sin pucHint y sin match → accountId=null → caller agrega a skipped.
//
// Cuentas de contrapartida: 110505 (Caja general) — normalmente sin CC.
// ---------------------------------------------------------------------------

import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { chartOfAccounts } from '@/lib/db/schema';
import { findAccountForKind } from './repository';
import type { AccountMapping } from './types';

// ---------------------------------------------------------------------------
// Prefijos de fallback por kind (todos existentes en el PUC PYMES seed)
// ---------------------------------------------------------------------------

/**
 * Prefijos PUC ordenados de más a menos específico para ingresos.
 * El mapper prueba en este orden y toma el primero que existe en DB.
 *   4135xx → Comercio al por mayor/menor (ventas)
 *   4170xx → Actividades de servicios
 *   4175xx → Devoluciones en ventas (no ideal pero postable)
 *   421xxx → Ingresos financieros (no operacional)
 */
const INGRESO_PREFIXES_ALL = ['4135', '4170', '4175', '421'];

/**
 * Prefijos PUC ordenados de más a menos específico para egresos.
 * Solo se listan grupos que están en el seed.
 *   5105xx → Gastos de personal
 *   5110xx → Honorarios
 *   5120xx → Arrendamientos
 *   5135xx → Servicios (agua, energía, teléfono, correo, internet)
 *   5145xx → Mantenimiento y reparaciones
 *   5160xx → Depreciaciones (sin CC en seed)
 *   5205xx → Gastos de personal ventas
 *   530xxx → No operacionales financieros (sin CC)
 *   531xxx → Gastos extraordinarios (sin CC)
 *   540xxx → Impuesto de renta (sin CC)
 */
const EGRESO_PREFIXES_ALL = [
  '5105', '5110', '5120', '5135', '5145', '5160',
  '5205', '530', '531', '540',
];

// ---------------------------------------------------------------------------
// Cuenta de contrapartida: 110505 (Caja general)
// ---------------------------------------------------------------------------

export const CAJA_PUC_CODE = '110505';
export const CAJA_PUC_NAME = 'Caja general';

// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------

export interface MapCategoryOptions {
  /** UUID del cost center default para líneas que lo requieran. null = sin CC. */
  costCenterId?: string | null;
}

/**
 * Resuelve la cuenta contable para un pyme_entry dado su pucHint, kind y
 * descripción/categoría.
 *
 * @param workspaceId  UUID del workspace.
 * @param pucHint      Código PUC sugerido por el OCR (puede ser null).
 * @param kind         'ingreso' | 'egreso'.
 * @param description  Descripción del entry (para heurísticas).
 * @param category     Categoría clasificada (para heurísticas).
 * @param options      Opciones adicionales (costCenterId).
 */
export async function mapCategoryToAccount(
  workspaceId: string,
  pucHint: string | null,
  kind: 'ingreso' | 'egreso',
  description?: string | null,
  category?: string | null,
  options?: MapCategoryOptions,
): Promise<AccountMapping> {
  const db = getDb();
  const costCenterId = options?.costCenterId ?? null;
  const hasCostCenter = !!costCenterId;

  // ── Paso 1: búsqueda exacta por pucHint ────────────────────────────────
  if (pucHint && pucHint.trim().length > 0) {
    const rows = await db
      .select()
      .from(chartOfAccounts)
      .where(
        and(
          eq(chartOfAccounts.workspaceId, workspaceId),
          eq(chartOfAccounts.code, pucHint.trim()),
          eq(chartOfAccounts.isPostable, true),
          eq(chartOfAccounts.active, true),
        ),
      )
      .limit(1);

    if (rows.length > 0) {
      const acct = rows[0];
      // Si la cuenta requiere CC y no tenemos → el caller skipeará si
      // hasCostCenter=false. Informamos via requiresCostCenter para que
      // index.ts tome la decisión.
      return {
        pymeEntryId: '',
        accountId: acct.requiresCostCenter && !hasCostCenter ? null : acct.id,
        accountCode: acct.code,
        accountName: acct.name,
        isExact: true,
        fallbackCode: null,
        requiresCostCenter: acct.requiresCostCenter,
      };
    }
    // Si el pucHint no existe en DB, caemos al fallback dinámico.
  }

  // ── Paso 2: fallback dinámico por kind ──────────────────────────────────
  // Determinamos prefijos según kind.
  const prefixesAll =
    kind === 'ingreso' ? INGRESO_PREFIXES_ALL : EGRESO_PREFIXES_ALL;

  // Con costCenterId → buscamos cualquier cuenta postable.
  // Sin costCenterId → buscamos primero sin CC. Si no hay, fallamos.
  const found = await findAccountForKind({
    workspaceId,
    kind,
    candidateCodePrefixes: prefixesAll,
    requireWithoutCostCenter: !hasCostCenter,
  });

  if (found) {
    return {
      pymeEntryId: '',
      accountId: found.id,
      accountCode: found.code,
      accountName: found.name,
      isExact: false,
      fallbackCode: found.code,
      requiresCostCenter: found.requiresCostCenter,
    };
  }

  // No se encontró nada.
  return {
    pymeEntryId: '',
    accountId: null,
    accountCode: null,
    accountName: null,
    isExact: false,
    fallbackCode: null,
    requiresCostCenter: false,
  };
}

/**
 * Resuelve el UUID de la cuenta de caja (110505) para el workspace.
 * Retorna null si no existe en chart_of_accounts.
 */
export async function resolveCajaAccount(
  workspaceId: string,
): Promise<{ id: string; code: string; name: string; requiresCostCenter: boolean } | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
        eq(chartOfAccounts.code, CAJA_PUC_CODE),
        eq(chartOfAccounts.isPostable, true),
        eq(chartOfAccounts.active, true),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  return {
    id: rows[0].id,
    code: rows[0].code,
    name: rows[0].name,
    requiresCostCenter: rows[0].requiresCostCenter,
  };
}
