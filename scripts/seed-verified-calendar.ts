// scripts/seed-verified-calendar.ts
//
// Seed inicial de la tabla `verified_calendars` con el calendario oficial 2026.
// Útil para tener Postgres poblado sin esperar al primer disparo del cron
// (que correrá diariamente desde producción).
//
// Uso:
//   npm run db:seed-calendar
//
// Idempotente: cada ejecución inserta una nueva row con `last_verified_at = now()`,
// y `getVerifiedNational()` siempre lee la más reciente.

import { getDb } from '@/lib/db/client';
import { verifiedCalendars } from '@/lib/db/schema';
import { scrapeDIANCalendar } from '@/lib/scrapers/dian-scraper';

async function main() {
  const year = 2026;
  console.log(`Scraping DIAN calendar ${year} …`);
  const result = await scrapeDIANCalendar(year);
  if (!result) {
    console.error(
      'Scraping failed — DIAN sources unreachable or format changed.',
    );
    process.exit(1);
  }

  console.log(
    `Scraped ${result.deadlines.length} deadlines from ${result.source} (${result.sourceUrl}).`,
  );
  console.log(`Source hash: ${result.hash.slice(0, 16)}…`);

  const db = getDb();
  const inserted = await db
    .insert(verifiedCalendars)
    .values({
      year,
      slug: 'national',
      decreeNumber: 'Decreto 2229 de 2023',
      decreeHash: result.hash,
      payload: result.deadlines,
      source: result.source,
      sourceUrl: result.sourceUrl,
    })
    .returning({ id: verifiedCalendars.id });

  const rowId = inserted[0]?.id ?? '(unknown)';
  console.log(
    `Inserted ${result.deadlines.length} deadlines into verified_calendars (row ${rowId}).`,
  );
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
