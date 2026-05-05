import 'server-only';
// ---------------------------------------------------------------------------
// WS2 — promote/repository: queries DB propias del bridge
// ---------------------------------------------------------------------------
// Solo toca tablas que el bridge NECESITA leer o marcar. No muta pyme_entries
// status (eso es decisión del caller en index.ts). No invoca createEntry —
// eso también es del index.
// ---------------------------------------------------------------------------

import { and, eq, inArray, sql as drizzleSql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { pymeEntries, pymeBooks } from '@/lib/db/schema';
import type { GroupedPymeEntry } from './types';

// ---------------------------------------------------------------------------
// Cargar pyme_entries por IDs con validación de workspace
// ---------------------------------------------------------------------------

/**
 * Carga los pyme_entries solicitados, filtrados por:
 *   - id IN pymeEntryIds
 *   - status = 'confirmed'
 *   - book.workspace_id = workspaceId  (JOIN para validar ownership)
 *
 * Devuelve solo los rows que cumplen las tres condiciones. Los que no
 * aparecen en el resultado serán marcados como `skipped` por el caller.
 */
export async function loadConfirmedEntries(
  pymeEntryIds: string[],
  workspaceId: string,
): Promise<GroupedPymeEntry[]> {
  if (pymeEntryIds.length === 0) return [];

  const db = getDb();

  // JOIN pyme_entries → pyme_books para verificar workspace en una sola query.
  // Drizzle no tiene `.join()` en select simple; usamos subquery via `inArray`
  // de book IDs del workspace + filtro por status.
  const bookRows = await db
    .select({ id: pymeBooks.id })
    .from(pymeBooks)
    .where(eq(pymeBooks.workspaceId, workspaceId));

  const ownedBookIds = bookRows.map((b) => b.id);
  if (ownedBookIds.length === 0) return [];

  const rows = await db
    .select({
      id: pymeEntries.id,
      bookId: pymeEntries.bookId,
      entryDate: pymeEntries.entryDate,
      description: pymeEntries.description,
      kind: pymeEntries.kind,
      amount: pymeEntries.amount,
      category: pymeEntries.category,
      pucHint: pymeEntries.pucHint,
    })
    .from(pymeEntries)
    .where(
      and(
        inArray(pymeEntries.id, pymeEntryIds),
        eq(pymeEntries.status, 'confirmed'),
        inArray(pymeEntries.bookId, ownedBookIds),
      ),
    );

  return rows as GroupedPymeEntry[];
}

/**
 * Devuelve el bookId del primer entry del grupo (todos en un grupo son del
 * mismo libro si se agruparon por fecha+kind dentro de un mismo workspace).
 */
export function extractBookId(entries: GroupedPymeEntry[]): string | null {
  return entries[0]?.bookId ?? null;
}

// ---------------------------------------------------------------------------
// Búsqueda dinámica de cuentas por kind y prefijos de código
// ---------------------------------------------------------------------------

export interface FindAccountOptions {
  workspaceId: string;
  /** Tipo contable: ingreso → busca INGRESO; egreso → busca GASTO y COSTO. */
  kind: 'ingreso' | 'egreso';
  /**
   * Prefijos de código PUC en orden de preferencia (más específico primero).
   * El helper intentará casar la primera cuenta que comience con alguno de
   * estos prefijos, probándolos en orden.
   *
   * Algoritmo: una sola query con CASE-WHEN scoring para priorizar los
   * prefijos en orden declarado, evitando N round-trips a la DB. El CASE
   * asigna un peso = posición en el array (0 = más prioritario), y la query
   * ordena ASC por ese peso y luego por código para desempate determinista.
   */
  candidateCodePrefixes: string[];
  /**
   * Si true, filtra a cuentas con requires_cost_center = false.
   * Usar cuando no hay costCenterId disponible.
   */
  requireWithoutCostCenter?: boolean;
}

export interface FoundAccount {
  id: string;
  code: string;
  name: string;
  requiresCostCenter: boolean;
}

/**
 * Busca la primera cuenta postable para el kind dado, priorizando los
 * candidateCodePrefixes en orden. Retorna null si no hay ninguna.
 *
 * Usa una única query con CASE-WHEN para asignar prioridad a cada prefijo,
 * evitando múltiples round-trips. El ORDER BY garantiza determinismo.
 */
export async function findAccountForKind(
  options: FindAccountOptions,
): Promise<FoundAccount | null> {
  const { workspaceId, kind, candidateCodePrefixes, requireWithoutCostCenter } = options;
  if (candidateCodePrefixes.length === 0) return null;

  const db = getDb();

  // Tipos contables para el kind
  const kindTypes: string[] =
    kind === 'ingreso' ? ['INGRESO'] : ['GASTO', 'COSTO'];

  // Construir el CASE-WHEN de prioridad como SQL raw.
  // Genera: CASE WHEN code LIKE 'prefix0%' THEN 0 WHEN ... ELSE 999 END
  const caseWhenParts = candidateCodePrefixes
    .map((prefix, idx) => `WHEN code LIKE '${prefix.replace(/'/g, "''")}%' THEN ${idx}`)
    .join(' ');
  const prioritySql = drizzleSql.raw(
    `CASE ${caseWhenParts} ELSE 999 END`,
  );

  // Filtro adicional para requires_cost_center
  const ccFilter = requireWithoutCostCenter
    ? drizzleSql`AND requires_cost_center = false`
    : drizzleSql``;

  // Ejecutamos con el cliente raw de drizzle para poder usar ORDER BY expresión dinámica.
  const result = await db.execute<{
    id: string;
    code: string;
    name: string;
    requires_cost_center: boolean;
  }>(drizzleSql`
    SELECT id, code, name, requires_cost_center
    FROM chart_of_accounts
    WHERE workspace_id = ${workspaceId}
      AND is_postable = true
      AND active = true
      AND type = ANY(ARRAY[${drizzleSql.raw(kindTypes.map((t) => `'${t}'`).join(', '))}]::account_type[])
      ${ccFilter}
      AND (${drizzleSql.raw(
        candidateCodePrefixes
          .map((p) => `code LIKE '${p.replace(/'/g, "''")}%'`)
          .join(' OR '),
      )})
    ORDER BY ${prioritySql} ASC, code ASC
    LIMIT 1
  `);

  const rows = result.rows ?? (result as unknown as { id: string; code: string; name: string; requires_cost_center: boolean }[]);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) return null;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    requiresCostCenter: row.requires_cost_center,
  };
}
