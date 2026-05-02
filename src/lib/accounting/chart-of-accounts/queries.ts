import 'server-only';
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  like,
  or,
  sql,
} from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  chartOfAccounts,
  journalLines,
  type ChartOfAccountsRow,
} from '@/lib/db/schema';
import {
  CLASS_NATURE,
  type AccountTreeNode,
} from './types';

// ---------------------------------------------------------------------------
// Lecturas del PUC.
// ---------------------------------------------------------------------------
// Todas las funciones reciben `workspaceId` como primer argumento. Multi-tenancy
// se garantiza por el unique index `coa_ws_code_uniq` (workspace_id, code) y
// por el filtro explícito en cada query — NO depender del cookie aquí; eso es
// responsabilidad del route handler.
//
// Las funciones devuelven `ChartOfAccountsRow[]` (Drizzle $inferSelect) tal
// cual, sin transformaciones. La construcción del árbol vive en `buildTree()`
// para que las listas planas (autocomplete, filtros) no paguen el costo del
// nesting.
// ---------------------------------------------------------------------------

export interface ListAccountsOpts {
  /** Filtra por enum `account_type` (ej. 'ACTIVO'). */
  type?:
    | 'ACTIVO'
    | 'PASIVO'
    | 'PATRIMONIO'
    | 'INGRESO'
    | 'GASTO'
    | 'COSTO'
    | 'ORDEN_DEUDORA'
    | 'ORDEN_ACREEDORA';
  /** Solo cuentas con `is_postable = true` (auxiliares). */
  postableOnly?: boolean;
  /** Solo cuentas con `active = true`. Default true. */
  activeOnly?: boolean;
  /**
   * Búsqueda por código o nombre (case-insensitive). Patrón `prefix%` para
   * código (autocomplete por dígitos), `%text%` para nombre.
   */
  search?: string;
  /** LIMIT — default 1000 (suficiente para el PUC PYMES completo). */
  limit?: number;
  /** OFFSET — default 0. */
  offset?: number;
}

/**
 * Cuenta única por (workspaceId, code). Devuelve null si no existe.
 */
export async function getAccount(
  workspaceId: string,
  code: string,
): Promise<ChartOfAccountsRow | null> {
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
  return rows[0] ?? null;
}

/**
 * Cuenta única por id, scoped al workspace para evitar leak cross-tenant.
 */
export async function getAccountById(
  workspaceId: string,
  id: string,
): Promise<ChartOfAccountsRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
        eq(chartOfAccounts.id, id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Lista plana de cuentas con filtros opcionales. Ordenada por `code` asc
 * (el código numérico ordenado lexicográficamente coincide con la jerarquía
 * porque PUC usa códigos prefijo: '11' < '1105' < '110505').
 */
export async function listAccounts(
  workspaceId: string,
  opts: ListAccountsOpts = {},
): Promise<ChartOfAccountsRow[]> {
  const db = getDb();
  const activeOnly = opts.activeOnly ?? true;
  const limit = Math.max(1, Math.min(opts.limit ?? 1000, 5000));
  const offset = Math.max(0, opts.offset ?? 0);

  const filters = [eq(chartOfAccounts.workspaceId, workspaceId)];
  if (activeOnly) filters.push(eq(chartOfAccounts.active, true));
  if (opts.postableOnly) filters.push(eq(chartOfAccounts.isPostable, true));
  if (opts.type) filters.push(eq(chartOfAccounts.type, opts.type));

  if (opts.search && opts.search.trim().length > 0) {
    const term = opts.search.trim();
    // Si es todo dígitos → prefix match en `code` (autocomplete por número).
    // Si trae letras → ilike en name. Soportamos ambas con `or()` para que
    // una búsqueda mixta como "110 caja" siga funcionando.
    const isNumeric = /^\d+$/.test(term);
    if (isNumeric) {
      filters.push(like(chartOfAccounts.code, `${term}%`));
    } else {
      const namePattern = `%${term}%`;
      const codePattern = `${term}%`;
      // OR: code prefix OR name ilike.
      filters.push(
        or(
          like(chartOfAccounts.code, codePattern),
          ilike(chartOfAccounts.name, namePattern),
        )!,
      );
    }
  }

  return db
    .select()
    .from(chartOfAccounts)
    .where(and(...filters))
    .orderBy(asc(chartOfAccounts.code))
    .limit(limit)
    .offset(offset);
}

/**
 * Construye el árbol jerárquico completo del PUC para un workspace.
 *
 * Implementación: 1 SELECT ordenado por `code asc`, single-pass O(n) que
 * indexa por id y resuelve `parentId` durante el recorrido. NO hay query
 * recursiva — para PYMES PUC son <500 nodos, esto cabe holgado en memoria.
 *
 * Las cuentas con `parentId = null` quedan en el array raíz (las 9 clases).
 * Cualquier cuenta con `parentId` apuntando a una row inexistente o de otro
 * workspace queda silenciosamente como huérfana (defensivo: nunca debería
 * pasar dado el FK self-reference + el unique index, pero si pasa NO queremos
 * romper el render del árbol). Esa fila orphan también se incluye en el
 * resultado raíz para que el usuario pueda verla y corregir.
 */
export async function buildTree(
  workspaceId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<AccountTreeNode[]> {
  const flat = await listAccounts(workspaceId, {
    activeOnly: opts.activeOnly ?? true,
    limit: 5000,
  });

  // Index por id para resolver parents en O(1).
  const byId = new Map<string, AccountTreeNode>();
  for (const row of flat) {
    byId.set(row.id, { ...row, children: [] });
  }

  const roots: AccountTreeNode[] = [];
  for (const row of flat) {
    const node = byId.get(row.id)!;
    if (row.parentId && byId.has(row.parentId)) {
      byId.get(row.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/**
 * Retorna todas las descendientes (incluyendo la cuenta misma) cuyo `code`
 * tenga `parentCode` como prefijo. Útil para reportes que agregan saldos
 * por nodo (ej. "saldo de la cuenta 1105 = sum de todas 1105*").
 */
export async function getDescendants(
  workspaceId: string,
  code: string,
): Promise<ChartOfAccountsRow[]> {
  const db = getDb();
  return db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
        // `code` igual al input O empieza con el prefix (no usamos `>=` por
        // claridad del intent — like es eficiente con btree de varchar).
        or(
          eq(chartOfAccounts.code, code),
          like(chartOfAccounts.code, `${code}%`),
        )!,
      ),
    )
    .orderBy(asc(chartOfAccounts.code));
}

/**
 * Determina si una cuenta es "hoja contable": is_postable=true O bien
 * no tiene hijos. Las hojas son las únicas que pueden recibir movimientos
 * en `journal_lines` (regla del trigger `journal_lines_account_postable`).
 *
 * Devuelve false si la cuenta no existe.
 */
export async function isLeafAccount(
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const account = await getAccountById(workspaceId, id);
  if (!account) return false;
  if (account.isPostable) return true;
  // Si no es postable, verificamos que no tenga children. Una cuenta
  // intermedia sin hijos = un caso degenerado del seed inicial; permitimos
  // tratarla como hoja para que el usuario pueda hacerla postable luego.
  const db = getDb();
  const rows = await db
    .select({ id: chartOfAccounts.id })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
        eq(chartOfAccounts.parentId, id),
      ),
    )
    .limit(1);
  return rows.length === 0;
}

/**
 * Cuenta cuántos `journal_lines` referencian una cuenta. >0 ⇒ no se puede
 * desactivar ni recodificar. Usado por mutations.
 */
export async function countMovementsForAccount(
  workspaceId: string,
  accountId: string,
): Promise<number> {
  const db = getDb();
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(journalLines)
    .where(
      and(
        eq(journalLines.workspaceId, workspaceId),
        eq(journalLines.accountId, accountId),
      ),
    );
  return Number(result[0]?.count ?? 0);
}

/**
 * Carga múltiples cuentas por id (bulk). Filtra por workspace para evitar
 * leak. Devuelve solo las encontradas — no lanza si faltan.
 */
export async function getAccountsByIds(
  workspaceId: string,
  ids: string[],
): Promise<ChartOfAccountsRow[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  return db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
        inArray(chartOfAccounts.id, ids),
      ),
    );
}

// ---------------------------------------------------------------------------
// Helpers semánticos puros (no tocan DB).
// ---------------------------------------------------------------------------

/**
 * Extrae el primer dígito del código (id de clase PUC). Devuelve string vacío
 * si el código está vacío.
 */
export function getClassFromCode(code: string): string {
  return code.length === 0 ? '' : code.charAt(0);
}

/**
 * Naturaleza (debit|credit) según primer dígito. Lanza para códigos inválidos
 * para forzar al caller a sanear primero — usar `try/catch` o validar antes.
 */
export function getNatureFromCode(code: string): 'debit' | 'credit' {
  const cls = getClassFromCode(code);
  const nature = CLASS_NATURE[cls];
  if (!nature) {
    throw new Error(
      `Invalid PUC code "${code}": first digit must be 1-9 (got "${cls}").`,
    );
  }
  return nature;
}
