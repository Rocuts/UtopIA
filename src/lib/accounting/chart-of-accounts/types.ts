// ---------------------------------------------------------------------------
// Domain types — Plan Único de Cuentas (PUC PYMES Colombia).
// ---------------------------------------------------------------------------
//
// El PUC es jerárquico (5 niveles) y se persiste como self-referenced tree
// en `chart_of_accounts.parentId`. Estos tipos son los DTOs que consume la
// UI y la API; reusan `ChartOfAccountsRow` (Drizzle $inferSelect) para no
// duplicar la forma de fila — solo añaden la dimensión "children" para el
// árbol y un par de helpers semánticos por clase.
//
// Referencias normativas:
//  - Decreto 2706/2012 (Grupo 3 / microempresas — base PUC PYMES).
//  - Decreto 2420/2015 Anexo 2 (PUC para preparadores Grupo 2 NIIF PYMES).
//  - Resoluciones SuperSociedades (códigos numéricos por clase).
//
// Niveles:
//   1 = Clase     (1 dígito  — ej "1", "2")
//   2 = Grupo     (2 dígitos — ej "11", "13")
//   3 = Cuenta    (4 dígitos — ej "1105", "1110")
//   4 = Subcuenta (6 dígitos — ej "110505", "110510")
//   5 = Auxiliar  (7-16 dígitos — ej "11050501")
//
// Solo nivel 4-5 puede ser `isPostable=true` (las cuentas de niveles 1-3
// son agrupadores, NO admiten movimientos en `journal_lines` — el trigger
// `journal_lines_account_postable` lo enforce).
// ---------------------------------------------------------------------------

import type { ChartOfAccountsRow } from '@/lib/db/schema';

/**
 * Nodo del árbol del PUC. Igual a una row del CoA + array de hijos. Usado
 * por `buildTree(workspaceId)` para alimentar el componente
 * `ChartOfAccountsTree` (Agente E, Ola 1.E).
 */
export interface AccountTreeNode extends ChartOfAccountsRow {
  children: AccountTreeNode[];
}

/**
 * Resumen estático de las 9 clases del PUC. Útil para UI (sidebar de
 * navegación, filtros por clase, breadcrumbs) sin ir a la DB.
 */
export interface AccountClassSummary {
  /** Primer dígito del código — id de la clase. */
  code: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
  /** Nombre canónico. */
  name: string;
  /** Tipo NIIF (mismo enum que `accountTypeEnum`). */
  type:
    | 'ACTIVO'
    | 'PASIVO'
    | 'PATRIMONIO'
    | 'INGRESO'
    | 'GASTO'
    | 'COSTO'
    | 'ORDEN_DEUDORA'
    | 'ORDEN_ACREEDORA';
}

/**
 * Catálogo estático de las 9 clases del PUC PYMES (sin tocar DB).
 * Sirve para validar coherencia código ↔ tipo en `createAccount`.
 *
 * Mapping clase 5 = GASTO, 6 = COSTO de ventas, 7 = COSTO de producción.
 * Ambas (6 y 7) llevan tipo `COSTO` en el enum `account_type` — la separación
 * 6 vs 7 se conserva en el código (primer dígito) para reportería.
 */
export const ACCOUNT_CLASSES: readonly AccountClassSummary[] = [
  { code: '1', name: 'ACTIVO', type: 'ACTIVO' },
  { code: '2', name: 'PASIVO', type: 'PASIVO' },
  { code: '3', name: 'PATRIMONIO', type: 'PATRIMONIO' },
  { code: '4', name: 'INGRESOS', type: 'INGRESO' },
  { code: '5', name: 'GASTOS', type: 'GASTO' },
  { code: '6', name: 'COSTO DE VENTAS', type: 'COSTO' },
  { code: '7', name: 'COSTOS DE PRODUCCIÓN', type: 'COSTO' },
  { code: '8', name: 'CUENTAS DE ORDEN DEUDORAS', type: 'ORDEN_DEUDORA' },
  { code: '9', name: 'CUENTAS DE ORDEN ACREEDORAS', type: 'ORDEN_ACREEDORA' },
] as const;

/**
 * Naturaleza contable de cada clase (debe / crédito). Esto es lo que un
 * saldo "normal" implica: una cuenta de clase 1 (ACTIVO) sube por el debe
 * y baja por el haber. Útil para validar saldos iniciales (Agente 1.D) y
 * para reportes (P&L, Balance) sin recalcular por tipo cada vez.
 */
export const CLASS_NATURE: Readonly<Record<string, 'debit' | 'credit'>> = {
  '1': 'debit', // ACTIVO
  '2': 'credit', // PASIVO
  '3': 'credit', // PATRIMONIO
  '4': 'credit', // INGRESO
  '5': 'debit', // GASTO
  '6': 'debit', // COSTO DE VENTAS
  '7': 'debit', // COSTO DE PRODUCCIÓN
  '8': 'debit', // ORDEN DEUDORA
  '9': 'credit', // ORDEN ACREEDORA
} as const;

/**
 * Type guard: lookup `type` por código de clase. Devuelve `null` si la clase
 * no existe (código vacío o primer dígito inválido).
 */
export function getClassSummary(
  classCode: string,
): AccountClassSummary | null {
  return ACCOUNT_CLASSES.find((c) => c.code === classCode) ?? null;
}
