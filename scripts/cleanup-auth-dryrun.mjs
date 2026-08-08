// scripts/cleanup-auth-dryrun.mjs
// Borra ÚNICAMENTE los datos de prueba creados durante el dry-run local de
// Fase 2 (2026-06-30). Quirúrgico: borra por email/id EXACTOS — nunca toca
// otros usuarios ni otros workspaces anónimos.
//
// Uso:
//   node scripts/cleanup-auth-dryrun.mjs          # muestra qué borraría (dry)
//   node scripts/cleanup-auth-dryrun.mjs --commit # ejecuta el borrado
//
// Al borrar el "user", las filas session/account caen por ON DELETE CASCADE y
// workspaces.user_id se pone NULL por ON DELETE SET NULL (por eso también
// borramos los workspaces de test por id).

import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const TEST_EMAILS = ['admin@utopia.test', 'claim@utopia.test'];
const TEST_WORKSPACE_IDS = [
  'c17eb9f0-588c-49be-b657-3365ee645d86', // anon bootstrap (raw test)
  'ef4ee16f-18d7-4b68-a4f7-8e9a0bd6dde4', // reclamado por claim@utopia.test
];

const COMMIT = process.argv.includes('--commit');

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const m = readFileSync('.env.local', 'utf8').match(
      /^DATABASE_URL=["']?([^"'\n]+)/m,
    );
    if (m) return m[1];
  } catch {
    /* noop */
  }
  return null;
}

const url = resolveDatabaseUrl();
if (!url) {
  console.error('DATABASE_URL no encontrada.');
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });

try {
  const users = await pool.query(
    `SELECT id, email FROM "user" WHERE email = ANY($1)`,
    [TEST_EMAILS],
  );
  const ws = await pool.query(
    `SELECT id, user_id FROM workspaces WHERE id = ANY($1)`,
    [TEST_WORKSPACE_IDS],
  );
  console.log('Usuarios de prueba encontrados:', users.rows);
  console.log('Workspaces de prueba encontrados:', ws.rows);

  if (!COMMIT) {
    console.log(
      '\n(DRY) No se borró nada. Corré con --commit para ejecutar el borrado.',
    );
    process.exit(0);
  }

  await pool.query('BEGIN');
  const delWs = await pool.query(
    `DELETE FROM workspaces WHERE id = ANY($1)`,
    [TEST_WORKSPACE_IDS],
  );
  const delUsers = await pool.query(
    `DELETE FROM "user" WHERE email = ANY($1)`,
    [TEST_EMAILS],
  );
  await pool.query('COMMIT');
  console.log(
    `\n✅ Borrados: ${delWs.rowCount} workspace(s), ${delUsers.rowCount} usuario(s) (session/account por cascade).`,
  );
} catch (e) {
  await pool.query('ROLLBACK').catch(() => {});
  console.error('Error, rollback:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
