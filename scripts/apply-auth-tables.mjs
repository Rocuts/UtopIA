// scripts/apply-auth-tables.mjs
// Provisiona las tablas de BetterAuth (migración 0013_auth_tables) de forma
// IDEMPOTENTE y NO-destructiva: aplica el SQL tal cual (todo es
// CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT
// EXISTS), así que correrlo N veces es seguro y nunca borra datos.
//
// NO usa `db:migrate` (el migrador de drizzle aplica TODAS las migraciones
// pendientes en una sola transacción y podría abortar re-aplicando 0012, que
// no es idempotente). Este script aplica SOLO 0013.
//
// Uso:
//   node scripts/apply-auth-tables.mjs
//     -> lee DATABASE_URL de .env.local (o de process.env si ya está seteada)
//
// Salida: estado antes/después + verificación to_regclass de las 4 tablas.

import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync('.env.local', 'utf8');
    const m = env.match(/^DATABASE_URL=["']?([^"'\n]+)/m);
    if (m) return m[1];
  } catch {
    /* sin .env.local */
  }
  return null;
}

const url = resolveDatabaseUrl();
if (!url) {
  console.error(
    'DATABASE_URL no encontrada. Seteala o corré `vercel env pull .env.local --environment=production --yes`.',
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });

const regclasses = async () =>
  (
    await pool.query(
      `SELECT to_regclass('public."user"')      AS "user",
              to_regclass('public.session')      AS "session",
              to_regclass('public.account')      AS "account",
              to_regclass('public.verification') AS "verification"`,
    )
  ).rows[0];

try {
  console.log('== ANTES ==');
  console.log(await regclasses());

  try {
    const cur = await pool.query(
      `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 3`,
    );
    console.log(
      'cursor drizzle (top-3 created_at):',
      cur.rows.map((r) => String(r.created_at)),
    );
  } catch (e) {
    console.log('cursor drizzle: no legible ->', e.message);
  }

  console.log('\n== APLICANDO 0013_auth_tables.sql (idempotente) ==');
  const sql = readFileSync('src/lib/db/migrations/0013_auth_tables.sql', 'utf8');
  await pool.query(sql);
  console.log('OK (creado o no-op).');

  console.log('\n== DESPUÉS ==');
  const after = await regclasses();
  console.log(after);
  const ok = after.user && after.session && after.account && after.verification;
  console.log(
    ok
      ? '\n✅ tablas de auth presentes: user / session / account / verification'
      : '\n⚠️ faltan tablas — revisar salida',
  );
  process.exit(ok ? 0 : 2);
} finally {
  await pool.end();
}
