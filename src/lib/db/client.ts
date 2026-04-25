import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// Lazy initialization — `neon()` throws if DATABASE_URL is missing, and
// Next.js evaluates top-level module code at build time. This pattern
// keeps the build green when env vars haven't been provisioned yet
// (e.g. first deploy before `vercel integration add neon`).
//
// IMPORTANT: do NOT wrap this in a Proxy — auth/db adapters that
// inspect method existence break under Proxy interception.

let _db: ReturnType<typeof createDb> | null = null;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Run `vercel env pull .env.local --yes` after `vercel integration add neon`.',
    );
  }
  const sql = neon(url);
  return drizzle(sql, { schema });
}

export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}

export { schema };
