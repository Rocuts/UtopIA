// scripts/smoke-test-1plus1/db-helpers.ts
// ---------------------------------------------------------------------------
// Minimal pg.Pool wrapper para uso exclusivo del smoke runner y el bootstrap.
// Patrón idéntico a scripts/apply-elite-migrations.ts.
// ---------------------------------------------------------------------------

import { Pool } from 'pg';

let pool: Pool | null = null;

export function getSmokePool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  pool = new Pool({ connectionString: url, max: 1 });
  return pool;
}

export async function closeSmokePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
