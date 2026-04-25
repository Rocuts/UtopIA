// scripts/db-migrate.ts
// Aplica las migraciones generadas por `drizzle-kit generate` contra
// la DATABASE_URL del entorno. Diseñado para correr en CI o local sin TTY.
//
// Uso:
//   npm run db:migrate

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Run `vercel env pull .env.local --yes`.');
    process.exit(1);
  }

  const sql = neon(url);
  const db = drizzle(sql);

  console.log('Applying migrations from src/lib/db/migrations …');
  await migrate(db, { migrationsFolder: './src/lib/db/migrations' });
  console.log('Migrations applied.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
