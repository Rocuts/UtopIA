import 'server-only';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  sql,
} from 'drizzle-orm';
import { getDb } from './client';
import {
  pymeBooks,
  pymeEntries,
  pymeUploads,
  type NewPymeBook,
  type NewPymeEntry,
  type NewPymeUpload,
  type PymeBook,
  type PymeEntry,
  type PymeUpload,
} from './schema';

// Repo functions del modulo Pyme. Patron lazy `getDb()` (igual a workspace.ts)
// para mantener verde el build cuando DATABASE_URL no esta provisionado.
//
// Tenant scoping: solo `getBook` / `listBooks` filtran por workspaceId. Las
// demas funciones asumen que el caller (handler API) ya validó la ownership
// via `getBook(bookId, ws.id)` antes de mutar entries/uploads.

// ─── Books ──────────────────────────────────────────────────────────────────

export async function createBook(input: NewPymeBook): Promise<PymeBook> {
  const db = getDb();
  const [created] = await db.insert(pymeBooks).values(input).returning();
  return created;
}

export async function listBooks(workspaceId: string): Promise<PymeBook[]> {
  const db = getDb();
  return db
    .select()
    .from(pymeBooks)
    .where(eq(pymeBooks.workspaceId, workspaceId))
    .orderBy(desc(pymeBooks.createdAt));
}

export async function getBook(
  bookId: string,
  workspaceId: string,
): Promise<PymeBook | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(pymeBooks)
    .where(
      and(eq(pymeBooks.id, bookId), eq(pymeBooks.workspaceId, workspaceId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Lectura de libro por id sin verificar workspace. Uso interno del orchestrator
 * (que ya recibio un upload cuyo bookId esta verificado upstream). NO exponer
 * desde route handlers — usa `getBook(bookId, workspaceId)` para esos.
 */
export async function getBookById(bookId: string): Promise<PymeBook | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(pymeBooks)
    .where(eq(pymeBooks.id, bookId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Devuelve los `id`s de libros propiedad del workspace. Sirve como filtro
 * para mutaciones scoped (`updateEntryScoped`, `deleteEntryScoped`) que
 * deben verificar ownership en una sola query atomica (sin TOCTOU window).
 */
export async function listBookIds(workspaceId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: pymeBooks.id })
    .from(pymeBooks)
    .where(eq(pymeBooks.workspaceId, workspaceId));
  return rows.map((r) => r.id);
}

// ─── Uploads ────────────────────────────────────────────────────────────────

export async function createUpload(
  input: NewPymeUpload,
): Promise<PymeUpload> {
  const db = getDb();
  const [created] = await db.insert(pymeUploads).values(input).returning();
  return created;
}

export async function updateUploadStatus(
  uploadId: string,
  status: 'pending' | 'processing' | 'done' | 'failed',
  errorMessage?: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(pymeUploads)
    .set({
      ocrStatus: status,
      errorMessage: errorMessage ?? null,
    })
    .where(eq(pymeUploads.id, uploadId));
}

export async function getUpload(uploadId: string): Promise<PymeUpload | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(pymeUploads)
    .where(eq(pymeUploads.id, uploadId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Atomic claim: marca un upload como `processing` SOLO si esta en `pending`.
 * Reemplaza el dúo no-atomico `getUpload + updateUploadStatus('processing')`
 * que abria una ventana de race entre dos `waitUntil` concurrentes (ambos
 * podian leer `pending` y entrar al pipeline). UPDATE...WHERE...RETURNING es
 * una operacion atomica en Postgres: el primer caller obtiene el row, los
 * siguientes ven `null` y deben tratarlo como idempotente (ya procesado).
 */
export async function claimUploadForProcessing(
  uploadId: string,
): Promise<PymeUpload | null> {
  const db = getDb();
  const [claimed] = await db
    .update(pymeUploads)
    .set({ ocrStatus: 'processing' })
    .where(
      and(
        eq(pymeUploads.id, uploadId),
        eq(pymeUploads.ocrStatus, 'pending'),
      ),
    )
    .returning();
  return claimed ?? null;
}

/**
 * Cuenta uploads recientes de un libro (ventana en ms). Usado por el endpoint
 * POST /api/pyme/uploads para imponer el limite de 5 fotos por minuto del
 * spec §4.11 (cap de costo OCR ~$0.015/foto).
 */
export async function countRecentUploads(
  bookId: string,
  windowMs: number,
): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const db = getDb();
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(pymeUploads)
    .where(
      and(
        eq(pymeUploads.bookId, bookId),
        gte(pymeUploads.createdAt, since),
      ),
    );
  return Number(row?.c ?? 0);
}

// ─── Entries ────────────────────────────────────────────────────────────────

export async function insertEntries(
  entries: NewPymeEntry[],
): Promise<PymeEntry[]> {
  if (entries.length === 0) return [];
  const db = getDb();
  return db.insert(pymeEntries).values(entries).returning();
}

export async function listEntries(args: {
  bookId: string;
  status?: 'draft' | 'confirmed';
  kind?: 'ingreso' | 'egreso';
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<PymeEntry[]> {
  const db = getDb();
  const filters = [eq(pymeEntries.bookId, args.bookId)];
  if (args.status) filters.push(eq(pymeEntries.status, args.status));
  if (args.kind) filters.push(eq(pymeEntries.kind, args.kind));
  if (args.fromDate) filters.push(gte(pymeEntries.entryDate, args.fromDate));
  if (args.toDate) filters.push(lt(pymeEntries.entryDate, args.toDate));

  return db
    .select()
    .from(pymeEntries)
    .where(and(...filters))
    .orderBy(asc(pymeEntries.entryDate), asc(pymeEntries.createdAt))
    .limit(args.limit ?? 100)
    .offset(args.offset ?? 0);
}

export async function updateEntry(
  entryId: string,
  patch: Partial<
    Pick<
      PymeEntry,
      | 'entryDate'
      | 'description'
      | 'kind'
      | 'amount'
      | 'category'
      | 'pucHint'
      | 'status'
    >
  >,
): Promise<PymeEntry | null> {
  const db = getDb();
  const [updated] = await db
    .update(pymeEntries)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(pymeEntries.id, entryId))
    .returning();
  return updated ?? null;
}

export async function deleteEntry(entryId: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(pymeEntries)
    .where(eq(pymeEntries.id, entryId))
    .returning({ id: pymeEntries.id });
  return deleted.length > 0;
}

/**
 * Update scoped por workspace: actualiza el entry SOLO si su `bookId` esta
 * en la lista de libros propiedad del workspace. Cierra la ventana TOCTOU del
 * patron previo (verificar ownership con un SELECT y luego UPDATE — entre
 * ambas queries un actor podia mover el entry de libro). Una sola query.
 */
export async function updateEntryScoped(
  entryId: string,
  ownedBookIds: string[],
  patch: Partial<
    Pick<
      PymeEntry,
      | 'entryDate'
      | 'description'
      | 'kind'
      | 'amount'
      | 'category'
      | 'pucHint'
      | 'status'
    >
  >,
): Promise<PymeEntry | null> {
  if (ownedBookIds.length === 0) return null;
  const db = getDb();
  const [updated] = await db
    .update(pymeEntries)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(pymeEntries.id, entryId),
        inArray(pymeEntries.bookId, ownedBookIds),
      ),
    )
    .returning();
  return updated ?? null;
}

/**
 * Delete scoped por workspace. Misma motivacion que `updateEntryScoped`.
 */
export async function deleteEntryScoped(
  entryId: string,
  ownedBookIds: string[],
): Promise<boolean> {
  if (ownedBookIds.length === 0) return false;
  const db = getDb();
  const result = await db
    .delete(pymeEntries)
    .where(
      and(
        eq(pymeEntries.id, entryId),
        inArray(pymeEntries.bookId, ownedBookIds),
      ),
    )
    .returning({ id: pymeEntries.id });
  return result.length > 0;
}

/**
 * Devuelve hasta `limit` categorias distintas usadas previamente en el libro.
 * Usado por el orchestrator para alimentar `knownCategories` al extractor y al
 * categorizer — asi el modelo prefiere reusar nombres exactos en vez de
 * inventar variantes ortograficas ("Mercancia" vs "mercancias").
 */
export async function listKnownCategories(
  bookId: string,
  limit = 50,
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ category: pymeEntries.category })
    .from(pymeEntries)
    .where(
      and(eq(pymeEntries.bookId, bookId), isNotNull(pymeEntries.category)),
    )
    .limit(limit);
  return rows
    .map((r) => r.category)
    .filter((c): c is string => typeof c === 'string' && c.length > 0);
}

// ─── Monthly summary ────────────────────────────────────────────────────────

export interface MonthlySummary {
  bookId: string;
  year: number;
  month: number;
  totals: {
    ingresos: number;
    egresos: number;
    margen: number;
    margenPct: number;
  };
  topIngresoCategories: { category: string; amount: number }[];
  topEgresoCategories: { category: string; amount: number }[];
  previous: {
    ingresos: number;
    egresos: number;
    margen: number;
  } | null;
  entryCount: number;
}

// Agregacion mensual con comparativo vs N-1. Filtra siempre por
// status = 'confirmed' — los drafts NO entran a reportes.
//
// `numeric` columns vienen como string desde drizzle-orm/neon-http;
// convertimos con Number() antes de devolver. Los rangos de fecha se
// calculan en JS (month es 0-indexed en `new Date(...)`).
export async function monthlySummary(
  bookId: string,
  year: number,
  month: number,
): Promise<MonthlySummary> {
  const db = getDb();

  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 1);
  const prevFrom = new Date(year, month - 2, 1);
  const prevTo = from;

  // Totales del mes actual + entryCount en una sola pasada.
  const [totalsRow] = await db
    .select({
      ingresos: sql<string>`COALESCE(SUM(CASE WHEN ${pymeEntries.kind} = 'ingreso' THEN ${pymeEntries.amount} ELSE 0 END), 0)`,
      egresos: sql<string>`COALESCE(SUM(CASE WHEN ${pymeEntries.kind} = 'egreso' THEN ${pymeEntries.amount} ELSE 0 END), 0)`,
      entryCount: sql<number>`COUNT(*)::int`,
    })
    .from(pymeEntries)
    .where(
      and(
        eq(pymeEntries.bookId, bookId),
        eq(pymeEntries.status, 'confirmed'),
        gte(pymeEntries.entryDate, from),
        lt(pymeEntries.entryDate, to),
      ),
    );

  const ingresos = Number(totalsRow?.ingresos ?? 0);
  const egresos = Number(totalsRow?.egresos ?? 0);
  const margen = ingresos - egresos;
  const margenPct = ingresos > 0 ? margen / ingresos : 0;
  const entryCount = Number(totalsRow?.entryCount ?? 0);

  // Top categorias ingreso.
  const topIngresoRows = await db
    .select({
      category: sql<string | null>`${pymeEntries.category}`,
      amount: sql<string>`COALESCE(SUM(${pymeEntries.amount}), 0)`,
    })
    .from(pymeEntries)
    .where(
      and(
        eq(pymeEntries.bookId, bookId),
        eq(pymeEntries.status, 'confirmed'),
        eq(pymeEntries.kind, 'ingreso'),
        gte(pymeEntries.entryDate, from),
        lt(pymeEntries.entryDate, to),
      ),
    )
    .groupBy(pymeEntries.category)
    .orderBy(desc(sql`SUM(${pymeEntries.amount})`))
    .limit(5);

  // Top categorias egreso.
  const topEgresoRows = await db
    .select({
      category: sql<string | null>`${pymeEntries.category}`,
      amount: sql<string>`COALESCE(SUM(${pymeEntries.amount}), 0)`,
    })
    .from(pymeEntries)
    .where(
      and(
        eq(pymeEntries.bookId, bookId),
        eq(pymeEntries.status, 'confirmed'),
        eq(pymeEntries.kind, 'egreso'),
        gte(pymeEntries.entryDate, from),
        lt(pymeEntries.entryDate, to),
      ),
    )
    .groupBy(pymeEntries.category)
    .orderBy(desc(sql`SUM(${pymeEntries.amount})`))
    .limit(5);

  // Mes anterior — devolvemos `null` si no hay rows confirmadas.
  const [prevRow] = await db
    .select({
      ingresos: sql<string>`COALESCE(SUM(CASE WHEN ${pymeEntries.kind} = 'ingreso' THEN ${pymeEntries.amount} ELSE 0 END), 0)`,
      egresos: sql<string>`COALESCE(SUM(CASE WHEN ${pymeEntries.kind} = 'egreso' THEN ${pymeEntries.amount} ELSE 0 END), 0)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(pymeEntries)
    .where(
      and(
        eq(pymeEntries.bookId, bookId),
        eq(pymeEntries.status, 'confirmed'),
        gte(pymeEntries.entryDate, prevFrom),
        lt(pymeEntries.entryDate, prevTo),
      ),
    );

  const prevCount = Number(prevRow?.count ?? 0);
  const previous =
    prevCount > 0
      ? {
          ingresos: Number(prevRow?.ingresos ?? 0),
          egresos: Number(prevRow?.egresos ?? 0),
          margen:
            Number(prevRow?.ingresos ?? 0) - Number(prevRow?.egresos ?? 0),
        }
      : null;

  return {
    bookId,
    year,
    month,
    totals: {
      ingresos,
      egresos,
      margen,
      margenPct,
    },
    topIngresoCategories: topIngresoRows
      .filter((r) => r.category !== null && r.category !== '')
      .map((r) => ({
        category: r.category as string,
        amount: Number(r.amount),
      })),
    topEgresoCategories: topEgresoRows
      .filter((r) => r.category !== null && r.category !== '')
      .map((r) => ({
        category: r.category as string,
        amount: Number(r.amount),
      })),
    previous,
    entryCount,
  };
}
