/**
 * CRON — Calendar Sync (DIAN)
 * ===========================
 * Schedule:  0 11 * * *  (UTC)  ≡  06:00 COT (Bogotá UTC-5, sin DST)
 * Auth:      Vercel Cron envía `Authorization: Bearer ${CRON_SECRET}`.
 * Persist:   Postgres (Neon) — tabla `verifiedCalendars`.
 *
 * Flow:
 *   1. Verifica auth — sin CRON_SECRET o bearer incorrecto → 401.
 *   2. Llama scrapeDIANCalendar(2026) — devuelve { deadlines, source, sourceUrl, hash }.
 *   3. Compara hash con la última row persistida (year=2026, slug='national'):
 *        - hash idéntico → solo refresh `lastVerifiedAt` (la fuente sigue viva).
 *        - hash distinto → INSERT nueva row (mantenemos historial completo).
 *   4. Reporta acción + duración para telemetría/observability.
 *
 * Failure modes:
 *   - scraper_failed (502) → DIAN inalcanzable o cambió formato.
 *   - internal_error (500) → fallo en DB / runtime.
 *
 * Dependencias del sprint (creadas por agentes paralelos):
 *   - src/lib/scrapers/dian-scraper.ts  → scrapeDIANCalendar()
 *   - src/lib/db/schema.ts              → tabla verifiedCalendars
 */

import type { NextRequest } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { verifiedCalendars } from '@/lib/db/schema';
import { scrapeDIANCalendar } from '@/lib/scrapers/dian-scraper';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Auth — Vercel Cron envía Authorization: Bearer ${CRON_SECRET}.
  // Si CRON_SECRET no está provisionado, fallar cerrado.
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const scraped = await scrapeDIANCalendar(2026);
    if (!scraped) {
      console.error(
        '[cron.calendar-sync] scraping failed — DIAN source unreachable or format changed',
      );
      return Response.json(
        { ok: false, reason: 'scraper_failed', durationMs: Date.now() - startedAt },
        { status: 502 },
      );
    }

    const db = getDb();

    // Última row persistida para este año/slug.
    const lastRow = await db
      .select({
        id: verifiedCalendars.id,
        decreeHash: verifiedCalendars.decreeHash,
      })
      .from(verifiedCalendars)
      .where(
        and(eq(verifiedCalendars.year, 2026), eq(verifiedCalendars.slug, 'national')),
      )
      .orderBy(desc(verifiedCalendars.lastVerifiedAt))
      .limit(1);

    // Hash idéntico — la fuente no cambió. Solo refresh `lastVerifiedAt`
    // para confirmar que el cron sigue corriendo y la fuente sigue viva.
    if (lastRow.length > 0 && lastRow[0].decreeHash === scraped.hash) {
      await db
        .update(verifiedCalendars)
        .set({ lastVerifiedAt: new Date() })
        .where(eq(verifiedCalendars.id, lastRow[0].id));

      return Response.json({
        ok: true,
        action: 'refreshed',
        deadlines: scraped.deadlines.length,
        durationMs: Date.now() - startedAt,
      });
    }

    // Hash distinto (o primera vez) — insertar nueva row (historial inmutable).
    await db.insert(verifiedCalendars).values({
      year: 2026,
      slug: 'national',
      decreeNumber: 'Decreto 2229 de 2023',
      decreeHash: scraped.hash,
      payload: scraped.deadlines,
      source: scraped.source,
      sourceUrl: scraped.sourceUrl,
    });

    return Response.json({
      ok: true,
      action: 'inserted',
      deadlines: scraped.deadlines.length,
      hash: scraped.hash.slice(0, 12),
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[cron.calendar-sync] failed:', err);
    return Response.json(
      {
        ok: false,
        reason: 'internal_error',
        error: String(err),
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
