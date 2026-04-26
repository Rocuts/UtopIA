/**
 * Capa de lectura del calendario tributario verificado.
 *
 * Estrategia de fallback (orden de preferencia):
 *   1. `postgres-verified` — última row en `verified_calendars` (escrita por
 *     el cron diario o por `npm run db:seed-calendar`). Es la fuente de
 *     verdad cuando existe.
 *   2. `static-fallback` — `NACIONAL_2026` en `src/data/calendars/`,
 *     marcado `verified=false`. Garantiza que el tool LLM siempre tenga
 *     algo que devolver, aun antes del primer cron run.
 *   3. `none` — solo si el static también está vacío (no debería ocurrir
 *     en producción).
 *
 * Cache in-memory de 1 hora por proceso. El cron invalida explícitamente
 * vía `invalidateCache()` después de escribir nuevas rows. La caché es
 * deliberadamente módulo-local (no Redis): cada serverless function
 * instance mantiene la suya y se beneficia del calentamiento.
 *
 * Nota sobre Edge Config: descartado en MVP — Hobby plan limita a 8 KB
 * por Edge Config y el calendario serializado pesa ~30 KB. Postgres con
 * cache cumple los requisitos sin costo extra.
 */

import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { verifiedCalendars } from '@/lib/db/schema';
import type { NationalDeadline } from '@/data/calendars/types';

export type CalendarSourceKind =
  | 'edge-config'
  | 'postgres-verified'
  | 'static-fallback'
  | 'none';

export interface CalendarSourceResult {
  deadlines: NationalDeadline[];
  source: CalendarSourceKind;
  verifiedAt: Date | null;
  decreeNumber: string | null;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

interface CacheEntry {
  year: number;
  result: CalendarSourceResult;
  cachedAt: number;
}

let cachedNational: CacheEntry | null = null;

function isCacheFresh(entry: CacheEntry | null, year: number): entry is CacheEntry {
  return (
    entry !== null &&
    entry.year === year &&
    Date.now() - entry.cachedAt < CACHE_TTL_MS
  );
}

/**
 * Devuelve el calendario nacional verificado para `year`. Garantizado a
 * resolver: si la DB falla, cae al static fallback. Solo emite `source: 'none'`
 * si tampoco hay datos estáticos para `year`.
 */
export async function getVerifiedNational(
  year: number,
): Promise<CalendarSourceResult> {
  if (isCacheFresh(cachedNational, year)) {
    return cachedNational.result;
  }

  // Intento 1: Postgres
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(verifiedCalendars)
      .where(
        and(
          eq(verifiedCalendars.year, year),
          eq(verifiedCalendars.slug, 'national'),
        ),
      )
      .orderBy(desc(verifiedCalendars.lastVerifiedAt))
      .limit(1);

    if (rows.length > 0) {
      const row = rows[0]!;
      const result: CalendarSourceResult = {
        deadlines: row.payload as NationalDeadline[],
        source: 'postgres-verified',
        verifiedAt: row.lastVerifiedAt,
        decreeNumber: row.decreeNumber,
      };
      cachedNational = { year, result, cachedAt: Date.now() };
      return result;
    }
  } catch (err) {
    console.error(
      '[calendars.source] DB read failed, falling back to static:',
      err,
    );
  }

  // Intento 2: static fallback
  const { getNationalDeadlines } = await import('@/data/calendars');
  const deadlines = getNationalDeadlines(undefined, year);
  const result: CalendarSourceResult = {
    deadlines,
    source: deadlines.length > 0 ? 'static-fallback' : 'none',
    verifiedAt: null,
    decreeNumber: 'Decreto 2229 de 2023',
  };
  // Cacheamos el fallback también — evita martillar la DB cuando aún no hay
  // rows. El cron invalida al insertar la primera versión verificada.
  cachedNational = { year, result, cachedAt: Date.now() };
  return result;
}

/**
 * Invalida el caché in-memory. Llamar desde el cron handler tras insertar
 * una nueva row en `verified_calendars`, o desde tests.
 */
export function invalidateCache(): void {
  cachedNational = null;
}
