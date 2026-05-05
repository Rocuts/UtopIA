import 'server-only';
// ---------------------------------------------------------------------------
// WS2 — promote/repository: queries DB propias del bridge
// ---------------------------------------------------------------------------
// Solo toca tablas que el bridge NECESITA leer o marcar. No muta pyme_entries
// status (eso es decisión del caller en index.ts). No invoca createEntry —
// eso también es del index.
// ---------------------------------------------------------------------------

import { and, eq, inArray } from 'drizzle-orm';
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
