/**
 * Aplica las 5 migraciones nuevas de la Ola 1+1 Élite (0005-0009) directamente
 * contra la DATABASE_URL del entorno, sin pasar por drizzle-kit push (que
 * quiere dropear la columna `tsv` de rag_chunks creada fuera de Drizzle por
 * src/lib/rag/init.ts y causaría pérdida del corpus de RAG colombiano).
 *
 * Cada SQL file es idempotente:
 *   - CREATE TABLE IF NOT EXISTS
 *   - DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$
 *   - CREATE INDEX IF NOT EXISTS
 *   - CREATE OR REPLACE VIEW
 *
 * Re-ejecutar el script es seguro: no duplica nada y no altera datos.
 *
 * Uso:
 *   npx dotenv -e .env.local -- tsx scripts/apply-elite-migrations.ts
 *
 * Salida: estado por migración + tiempo total.
 */

import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'src/lib/db/migrations';
const ELITE_TAGS = [
  '0005_smart_tax',
  '0006_banking',
  '0007_adjustments_close',
  '0008_notifications',
  '0009_pillar_view',
] as const;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✗ DATABASE_URL no está set. Corre `vercel env pull .env.local --yes`.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const startedAt = Date.now();

  try {
    for (const tag of ELITE_TAGS) {
      const filePath = join(MIGRATIONS_DIR, `${tag}.sql`);
      const sql = readFileSync(filePath, 'utf-8');
      const stepStart = Date.now();
      try {
        await pool.query(sql);
        const ms = Date.now() - stepStart;
        console.log(`  ✓ ${tag.padEnd(28)} ${ms.toString().padStart(5)} ms`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${tag.padEnd(28)} ${message}`);
        throw err;
      }
    }

    const totalMs = Date.now() - startedAt;
    console.log(`\nOK · 5 migraciones aplicadas en ${totalMs} ms`);
    console.log(`Tablas creadas: tax_rules, third_party_tax_profile, tax_engine_audits,`);
    console.log(`  uvt_constants, bank_accounts, bank_statement_imports,`);
    console.log(`  bank_transactions, bank_reconciliations, fixed_assets,`);
    console.log(`  deferred_assets, provisions_config, monthly_close_runs,`);
    console.log(`  notification_subscriptions, notification_log`);
    console.log(`Vista creada: pillar_kpis_view`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\nFalló la aplicación de migraciones:', err);
  process.exit(1);
});
