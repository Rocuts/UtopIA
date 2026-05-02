// scripts/db-migrate.ts
// Aplica las migraciones generadas por `drizzle-kit generate` contra
// la DATABASE_URL del entorno. Diseñado para correr en CI o local sin TTY.
//
// Uso:
//   npm run db:migrate
//
// Driver: pg.Pool + drizzle-orm/node-postgres (TCP). El driver neon-http
// fue retirado del runtime porque no soporta `db.transaction()`. Para
// migraciones one-shot el pool se crea, ejecuta `migrate()` y se cierra
// explicitamente con `pool.end()`.

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Run `vercel env pull .env.local --yes`.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  try {
    console.log('Applying migrations from src/lib/db/migrations …');
    await migrate(db, { migrationsFolder: './src/lib/db/migrations' });
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
