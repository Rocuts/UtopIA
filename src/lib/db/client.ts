import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { attachDatabasePool } from '@vercel/functions';
import * as schema from './schema';

// ---------------------------------------------------------------------------
// Driver: pg.Pool + drizzle-orm/node-postgres + attachDatabasePool.
//
// Por que NO neon-http / WebSocket:
// - `drizzle-orm/neon-http` es HTTP one-shot y NO soporta `db.transaction()`
//   real (requerido para partida doble en el modulo contable).
// - WebSocket via `@neondatabase/serverless` no sobrevive entre requests bajo
//   Fluid Compute (instancias reutilizadas) y produce conexiones colgadas.
//
// Patron canonico (best-practice Vercel mayo 2026 para Fluid Compute):
//   pg.Pool sobre TCP + attachDatabasePool() para que la plataforma cierre
//   las conexiones de forma ordenada cuando la instancia se evicta.
//
// IMPORTANTE: `DATABASE_URL` debe apuntar al endpoint POOLED de Neon
//   (postgres://...@<host>-pooler.<region>.aws.neon.tech/...). El pool
//   local mantiene un maximo de 5 conexiones por instancia; Neon hace el
//   resto del pooling del lado del servidor.
//
// Lazy init: Next.js evalua codigo top-level en build, donde DATABASE_URL
// puede no estar disponible. NO crear el pool hasta el primer getDb().
//
// Singleton in-process: dentro de la misma instancia Fluid Compute reusamos
// pool y drizzle wrapper.
// ---------------------------------------------------------------------------

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _pool: Pool | null = null;

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        'DATABASE_URL is not set. Run `vercel env pull .env.local --yes` after `vercel integration add neon`. The connection string MUST point to the Neon pooled endpoint (host contains `-pooler`).',
      );
    }
    _pool = new Pool({ connectionString: url, max: 5 });
    attachDatabasePool(_pool);
    _db = drizzle(_pool, { schema });
  }
  return _db;
}

export { schema };
