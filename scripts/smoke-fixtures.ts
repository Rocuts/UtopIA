#!/usr/bin/env tsx
// ─── scripts/smoke-fixtures.ts ───────────────────────────────────────────────
//
// Bootstrap idempotente para el smoke runner.
// Prepara todos los fixtures que el runner necesita sin requerir env vars
// manuales (SMOKE_CHART_ACCOUNT_ID, SMOKE_FA_*, SMOKE_PYME_ENTRY_IDS).
//
// Pasos (idempotentes):
//   1. PUC seed       — chart_of_accounts para el workspace
//   2. Tax rules seed — reglas tributarias built-in (workspace_id = NULL)
//   3. Provisions     — provisions_config Colombia 2026 (via raw SQL)
//   4. Accounting period del mes actual (status='open')
//   5. Resolve UUIDs por código PUC
//   6. Pyme book + 3 pyme_entries confirmed
//
// NOTA: `provisions-config-co-2026.ts` usa `server-only` y `repository.ts`
// también. Para evitar ese import chain en un script Node.js, las provisiones
// se crean mediante SQL crudo (misma lógica, sin el import problemático).

import 'dotenv/config';

import { drizzle } from 'drizzle-orm/node-postgres';
import { sql as drizzleSql, eq, and, count, like, or } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { seedPucForWorkspace } from '@/lib/db/seeds/puc-pyme-colombia';
import { seedTaxRulesCo2026 } from '@/lib/db/seeds/tax-rules-co-2026';
import { getSmokePool } from './smoke-test-1plus1/db-helpers';

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export interface SmokeChartAccountIds {
  bank: string | null;            // 111005 o 111010 (Bancos, postable)
  cash: string | null;            // 110505 (Caja general)
  fixedAssetCpu: string | null;   // 152805 (Equipo cómputo)
  accumDeprecCpu: string | null;  // 159215 (Depreciación acumulada cómputo)
  expenseDeprecCpu: string | null; // 516015 (Gasto depreciación cómputo)
}

export interface SmokeFixturesResult {
  workspaceId: string;
  periodId: string;
  chartAccountIds: SmokeChartAccountIds;
  pymeBookId: string;
  pymeEntryIds: string[];
  warnings: string[];
}

// ─── Provisiones Colombia 2026 — definición inline (evita server-only) ───────

interface ProvisionRaw {
  provision_type: string;
  rate: string;
  base_account_codes: string[];
  expense_code: string;
  expense_name: string;
  liability_code: string;
  liability_name: string;
}

const PROVISIONS_RAW: ProvisionRaw[] = [
  { provision_type: 'prima',               rate: '0.083300', base_account_codes: ['510506','510527'], expense_code: '510536', expense_name: 'Gasto Prima de Servicios',                   liability_code: '261020', liability_name: 'Prima de Servicios por pagar' },
  { provision_type: 'cesantias',           rate: '0.083300', base_account_codes: ['510506','510527'], expense_code: '510530', expense_name: 'Gasto Cesantias',                             liability_code: '261005', liability_name: 'Cesantias consolidadas por pagar' },
  { provision_type: 'intereses_cesantias', rate: '0.010000', base_account_codes: ['261005'],          expense_code: '510530', expense_name: 'Gasto Intereses sobre Cesantias',              liability_code: '261010', liability_name: 'Intereses sobre Cesantias por pagar' },
  { provision_type: 'vacaciones',          rate: '0.041700', base_account_codes: ['510506','510527'], expense_code: '510506', expense_name: 'Gasto Vacaciones',                            liability_code: '261015', liability_name: 'Vacaciones por pagar' },
  { provision_type: 'salud',               rate: '0.085000', base_account_codes: ['510506','510527'], expense_code: '510568', expense_name: 'Gasto Seguridad Social en Salud Empleador',   liability_code: '261020', liability_name: 'SGSSS por pagar Empleador' },
  { provision_type: 'pension',             rate: '0.120000', base_account_codes: ['510506','510527'], expense_code: '510568', expense_name: 'Gasto Pensiones Empleador',                   liability_code: '261020', liability_name: 'Pensiones AFP por pagar' },
  { provision_type: 'arl',                 rate: '0.005220', base_account_codes: ['510506','510527'], expense_code: '510568', expense_name: 'Gasto ARL Empleador',                         liability_code: '261020', liability_name: 'ARL por pagar' },
  { provision_type: 'parafiscales',        rate: '0.090000', base_account_codes: ['510506','510527'], expense_code: '510568', expense_name: 'Gasto Parafiscales',                          liability_code: '261020', liability_name: 'Parafiscales por pagar' },
  { provision_type: 'income_tax',          rate: '0.350000', base_account_codes: [],                 expense_code: '540505', expense_name: 'Gasto Impuesto de Renta y Complementarios',  liability_code: '240805', liability_name: 'Impuesto sobre la Renta por pagar' },
];

// ─── Helper: upsert chart_of_accounts por código (para provisiones) ──────────

async function upsertAccountRaw(
  pool: import('pg').Pool,
  workspaceId: string,
  code: string,
  name: string,
  type: 'GASTO' | 'PASIVO',
): Promise<string> {
  // Intentar obtener primero
  const sel = await pool.query<{ id: string }>(
    `SELECT id FROM chart_of_accounts WHERE workspace_id = $1 AND code = $2 LIMIT 1`,
    [workspaceId, code],
  );
  if (sel.rows[0]) return sel.rows[0].id;

  // Insertar si no existe — level 4, postable
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO chart_of_accounts
       (workspace_id, code, name, type, level, is_postable, currency, active)
     VALUES ($1, $2, $3, $4::account_type, 4, true, 'COP', true)
     ON CONFLICT (workspace_id, code) DO NOTHING
     RETURNING id`,
    [workspaceId, code, name, type],
  );

  if (ins.rows[0]) return ins.rows[0].id;

  // Race condition: alguien lo insertó entre el SELECT y el INSERT
  const sel2 = await pool.query<{ id: string }>(
    `SELECT id FROM chart_of_accounts WHERE workspace_id = $1 AND code = $2 LIMIT 1`,
    [workspaceId, code],
  );
  if (sel2.rows[0]) return sel2.rows[0].id;

  throw new Error(`No se pudo upsert cuenta ${code} para workspace ${workspaceId}`);
}

// ─── bootstrapSmokeFixtures ───────────────────────────────────────────────────

export async function bootstrapSmokeFixtures(
  workspaceId: string,
  options?: { skipPuc?: boolean; skipTaxRules?: boolean; skipProvisions?: boolean },
): Promise<SmokeFixturesResult> {
  const pool = getSmokePool();
  const db = drizzle(pool, { schema });
  const warnings: string[] = [];

  // ── 1. PUC seed ─────────────────────────────────────────────────────────────
  if (!options?.skipPuc) {
    const { chartOfAccounts } = schema;
    const coaCount = await db
      .select({ n: drizzleSql<number>`count(*)::int` })
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.workspaceId, workspaceId));

    const existing = coaCount[0]?.n ?? 0;
    if (existing === 0) {
      const inserted = await seedPucForWorkspace(db, workspaceId);
      if (inserted === 0) {
        warnings.push('PUC seed: 0 cuentas insertadas (posible falla). Verifica chart_of_accounts.');
      }
    }
  }

  // ── 2. Tax rules seed (workspace_id = NULL, built-in) ─────────────────────
  if (!options?.skipTaxRules) {
    try {
      await seedTaxRulesCo2026();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Las reglas pueden ya existir — ON CONFLICT DO UPDATE, así que un error
      // real aquí es grave. Advertimos pero no abortamos.
      warnings.push(`Tax rules seed: ${msg}`);
    }
  }

  // ── 3. Provisions config (raw SQL — evita server-only chain) ───────────────
  if (!options?.skipProvisions) {
    const provCount = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM provisions_config WHERE workspace_id = $1`,
      [workspaceId],
    );
    const existingProv = Number(provCount.rows[0]?.n ?? '0');

    if (existingProv === 0) {
      for (const def of PROVISIONS_RAW) {
        try {
          const expId = await upsertAccountRaw(pool, workspaceId, def.expense_code, def.expense_name, 'GASTO');
          const liabId = await upsertAccountRaw(pool, workspaceId, def.liability_code, def.liability_name, 'PASIVO');

          await pool.query(
            `INSERT INTO provisions_config
               (workspace_id, provision_type, rate, base_account_codes,
                expense_account_id, liability_account_id, cadence, active)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'monthly', true)
             ON CONFLICT (workspace_id, provision_type) DO NOTHING`,
            [
              workspaceId,
              def.provision_type,
              def.rate,
              JSON.stringify(def.base_account_codes),
              expId,
              liabId,
            ],
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Provision ${def.provision_type}: ${msg}`);
        }
      }
    }
  }

  // ── 4. Accounting period del mes actual (status='open') ───────────────────
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed
  const startsAt = new Date(year, month - 1, 1);
  const endsAt = new Date(year, month, 0, 23, 59, 59, 999); // último día del mes

  const periodRes = await pool.query<{ id: string }>(
    `INSERT INTO accounting_periods
       (workspace_id, year, month, starts_at, ends_at, status)
     VALUES ($1, $2, $3, $4, $5, 'open')
     ON CONFLICT (workspace_id, year, month) DO NOTHING
     RETURNING id`,
    [workspaceId, year, month, startsAt.toISOString(), endsAt.toISOString()],
  );

  let periodId: string;
  if (periodRes.rows[0]) {
    periodId = periodRes.rows[0].id;
  } else {
    // Ya existía — obtener el id
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM accounting_periods
       WHERE workspace_id = $1 AND year = $2 AND month = $3
       LIMIT 1`,
      [workspaceId, year, month],
    );
    if (!existing.rows[0]) {
      throw new Error(`No se pudo crear ni obtener accounting_period ${year}-${month} para workspace ${workspaceId}`);
    }
    periodId = existing.rows[0].id;
  }

  // ── 5. Resolve chart_of_accounts UUIDs por código PUC ────────────────────
  async function resolveAccount(codePattern: string, fallbackPatterns: string[] = []): Promise<string | null> {
    const patterns = [codePattern, ...fallbackPatterns];
    for (const pattern of patterns) {
      const res = await pool.query<{ id: string }>(
        `SELECT id FROM chart_of_accounts
         WHERE workspace_id = $1
           AND code LIKE $2
           AND is_postable = true
         ORDER BY code ASC
         LIMIT 1`,
        [workspaceId, pattern + '%'],
      );
      if (res.rows[0]) return res.rows[0].id;
    }
    return null;
  }

  const bank = await resolveAccount('111005', ['111010', '1110']);
  const cash = await resolveAccount('110505', ['110510', '1105']);
  const fixedAssetCpu = await resolveAccount('152805', ['152810', '152405', '1528', '1524']);
  const accumDeprecCpu = await resolveAccount('159215', ['159210', '1592']);
  const expenseDeprecCpu = await resolveAccount('516015', ['516010', '516005', '5160']);

  if (!bank) warnings.push('No se encontró cuenta bancaria postable (111005/111010) en chart_of_accounts.');
  if (!fixedAssetCpu) warnings.push('No se encontró cuenta de activo fijo cómputo (152805) en chart_of_accounts.');
  if (!accumDeprecCpu) warnings.push('No se encontró cuenta depreciación acumulada (159215) en chart_of_accounts.');
  if (!expenseDeprecCpu) warnings.push('No se encontró cuenta gasto depreciación (516015) en chart_of_accounts.');

  // ── 6. Pyme book + 3 entries confirmed ────────────────────────────────────
  // Buscar o crear pyme book por nombre (pyme_books no tiene unique constraint)
  let pymeBookId: string;
  {
    const existingBook = await pool.query<{ id: string }>(
      `SELECT id FROM pyme_books WHERE workspace_id = $1 AND name = 'Smoke Test Book' LIMIT 1`,
      [workspaceId],
    );
    if (existingBook.rows[0]) {
      pymeBookId = existingBook.rows[0].id;
    } else {
      const bookRes = await pool.query<{ id: string }>(
        `INSERT INTO pyme_books (workspace_id, name, currency)
         VALUES ($1, 'Smoke Test Book', 'COP')
         RETURNING id`,
        [workspaceId],
      );
      if (!bookRes.rows[0]) {
        throw new Error(`No se pudo crear pyme book para workspace ${workspaceId}`);
      }
      pymeBookId = bookRes.rows[0].id;
    }
  }

  // Verificar si ya hay entries confirmados en este libro
  const existingEntries = await pool.query<{ id: string }>(
    `SELECT id FROM pyme_entries WHERE book_id = $1 AND status = 'confirmed' LIMIT 5`,
    [pymeBookId],
  );

  let pymeEntryIds: string[];
  if (existingEntries.rows.length >= 3) {
    pymeEntryIds = existingEntries.rows.slice(0, 3).map((r) => r.id);
  } else {
    // Insertar 3 entries de prueba
    const entryDate = new Date(year, month - 1, 15).toISOString(); // día 15 del mes actual
    const entries = await pool.query<{ id: string }>(
      `INSERT INTO pyme_entries
         (book_id, entry_date, description, kind, amount, category, status, confidence)
       VALUES
         ($1, $2, 'Venta efectivo smoke test',    'ingreso', '50000',  'ventas',       'confirmed', '1.000'),
         ($1, $2, 'Transporte smoke test',         'egreso',  '20000',  'transporte',   'confirmed', '1.000'),
         ($1, $2, 'Papeleria smoke test',           'egreso',  '35000',  'papeleria',    'confirmed', '1.000')
       RETURNING id`,
      [pymeBookId, entryDate],
    );
    pymeEntryIds = entries.rows.map((r) => r.id);
  }

  return {
    workspaceId,
    periodId,
    chartAccountIds: {
      bank,
      cash,
      fixedAssetCpu,
      accumDeprecCpu,
      expenseDeprecCpu,
    },
    pymeBookId,
    pymeEntryIds,
    warnings,
  };
}
