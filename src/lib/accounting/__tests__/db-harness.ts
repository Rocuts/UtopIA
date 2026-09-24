// ---------------------------------------------------------------------------
// Harness para pruebas de integración del libro mayor contra Postgres REAL.
//
// Las pruebas `*.db.test.ts` corren dentro de `npm test` pero se OMITEN
// (describe.skipIf) si no hay `UTOPIA_TEST_DATABASE_URL`. Para ejecutarlas:
//
//   1. Postgres 16 local vacío, p. ej. un cluster privado:
//        initdb -D <dir>/data -A trust -U postgres
//        pg_ctl -D <dir>/data -o "-p 55441 -k <dir> -c listen_addresses=" start
//        psql -h <dir> -p 55441 -U postgres -c 'create database utopia_test'
//   2. Aplicar TODAS las migraciones en orden (0004 falla sólo en
//      rag_chunks/vector si no está pgvector; es irrelevante aquí):
//        for f in $(ls src/lib/db/migrations/*.sql | sort); do
//          psql -h <dir> -p 55441 -U postgres -d utopia_test -q -f $f; done
//   3. UTOPIA_TEST_DATABASE_URL="postgresql://postgres@<dir urlencoded>:55441/utopia_test" \
//        npx vitest run src/lib/accounting src/lib/workflows
//
// Cada prueba crea su propio workspace (aislamiento sin limpiar tablas).
// ---------------------------------------------------------------------------

import { eq } from 'drizzle-orm';

export const TEST_DB_URL = process.env.UTOPIA_TEST_DATABASE_URL ?? '';
export const HAS_TEST_DB = TEST_DB_URL.length > 0;

if (HAS_TEST_DB) {
  // getDb() lee DATABASE_URL de forma perezosa en la primera llamada.
  process.env.DATABASE_URL = TEST_DB_URL;
}

export interface TestPeriod {
  id: string;
  year: number;
  month: number;
  startsAt: Date;
  endsAt: Date;
}

export interface TestLedger {
  workspaceId: string;
  /** code → chart_of_accounts.id del PUC sembrado. */
  acc: Record<string, string>;
  thirdPartyId: string;
  costCenterId: string;
  period(year: number, month: number): Promise<TestPeriod>;
}

/** Workspace nuevo con el PUC PYME sembrado, un tercero y un centro de costo. */
export async function makeLedger(label: string): Promise<TestLedger> {
  const { getDb } = await import('@/lib/db/client');
  const schema = await import('@/lib/db/schema');
  const { seedPucForWorkspace } = await import(
    '@/lib/accounting/chart-of-accounts/mutations'
  );
  const db = getDb();
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name: `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
    .returning();
  await seedPucForWorkspace(w.id);
  const rows = await db
    .select()
    .from(schema.chartOfAccounts)
    .where(eq(schema.chartOfAccounts.workspaceId, w.id));
  const acc: Record<string, string> = {};
  for (const r of rows) acc[r.code] = r.id;
  const [tp] = await db
    .insert(schema.thirdParties)
    .values({
      workspaceId: w.id,
      identificationType: 'NIT',
      identification: '800197268',
      verificationDigit: '4',
      legalName: 'Tercero de prueba',
    })
    .returning();
  const [cc] = await db
    .insert(schema.costCenters)
    .values({ workspaceId: w.id, code: 'ADM', name: 'Administración' })
    .returning();

  const periods = new Map<string, TestPeriod>();
  return {
    workspaceId: w.id,
    acc,
    thirdPartyId: tp.id,
    costCenterId: cc.id,
    async period(year: number, month: number) {
      const key = `${year}-${month}`;
      const hit = periods.get(key);
      if (hit) return hit;
      const startsAt =
        month === 13
          ? new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
          : new Date(Date.UTC(year, month - 1, 1));
      const endsAt =
        month === 13
          ? startsAt
          : new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
      const [p] = await db
        .insert(schema.accountingPeriods)
        .values({ workspaceId: w.id, year, month, startsAt, endsAt, status: 'open' })
        .returning();
      const out = { id: p.id, year, month, startsAt, endsAt };
      periods.set(key, out);
      return out;
    },
  };
}

/** Ejecuta SQL crudo y devuelve las filas. */
export async function rows<T>(query: import('drizzle-orm').SQL): Promise<T[]> {
  const { getDb } = await import('@/lib/db/client');
  const r = await getDb().execute(query);
  return ((r as unknown as { rows?: T[] }).rows ?? []) as T[];
}
