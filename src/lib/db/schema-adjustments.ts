// ─── Schema split: NIIF Auto-Adjustments + Monthly Close (Ola 1+1, WS4 + WS5) ─
//
// fixed_assets         ← activos fijos depreciables (Art. 137 ET, NIC 16)
// deferred_assets      ← gastos pagados anticipados a amortizar (NIC 1)
// provisions_config    ← parámetros de provisiones laborales y fiscales
// monthly_close_runs   ← bitácora de cada cierre mensual ejecutado por WS5
//
// El SHAPE lo dicta Opus 4.7 para que WS4 (calculadores) y WS5 (workflow)
// trabajen contra el mismo contrato sin colisionar.

import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Importamos directamente de schema.ts; ciclo 2-step seguro por FK lazy.
import { accountingPeriods, chartOfAccounts, workspaces } from './schema';

// ---------------------------------------------------------------------------
// fixed_assets — activos fijos depreciables
// ---------------------------------------------------------------------------

/**
 * Un activo fijo se relaciona con TRES cuentas del PUC:
 *   - asset_account: ej. 152405 (Equipo de cómputo).
 *   - depreciation_account: ej. 159205 (Depreciación acumulada equipo de cómputo).
 *   - expense_account: ej. 516010 (Depreciación equipo de cómputo).
 *
 * `depreciation_method`:
 *   - 'straight_line' (MVP): cuota mensual = (acquisitionCost - salvageValue) / usefulLifeMonths.
 *   - 'units_of_production' (diferido): requiere unidades producidas por mes.
 *   - 'accelerated' (diferido): usa tabla de % anuales decrecientes.
 *
 * `last_depreciated_period_id` evita doble depreciación. El calculador
 * compara con el período objetivo y solo emite asiento si:
 *   target_period.year * 12 + target_period.month >
 *   last_period.year * 12 + last_period.month.
 */
export const fixedAssets = pgTable(
  'fixed_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 32 }).notNull(),
    name: text('name').notNull(),
    category: varchar('category', { length: 32 }).notNull(),
    assetAccountId: uuid('asset_account_id')
      .notNull()
      .references(() => chartOfAccounts.id),
    depreciationAccountId: uuid('depreciation_account_id')
      .notNull()
      .references(() => chartOfAccounts.id),
    expenseAccountId: uuid('expense_account_id')
      .notNull()
      .references(() => chartOfAccounts.id),
    acquisitionDate: timestamp('acquisition_date', { withTimezone: true }).notNull(),
    acquisitionCost: numeric('acquisition_cost', { precision: 20, scale: 2 }).notNull(),
    salvageValue: numeric('salvage_value', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),
    usefulLifeMonths: integer('useful_life_months').notNull(),
    depreciationMethod: varchar('depreciation_method', { length: 24 })
      .notNull()
      .default('straight_line'),
    accumulatedDepreciation: numeric('accumulated_depreciation', {
      precision: 20,
      scale: 2,
    })
      .notNull()
      .default('0'),
    lastDepreciatedPeriodId: uuid('last_depreciated_period_id').references(
      () => accountingPeriods.id,
    ),
    active: boolean('active').notNull().default(true),
    disposedAt: timestamp('disposed_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    wsCodeUniq: uniqueIndex('fa_ws_code_uniq').on(t.workspaceId, t.code),
    byCategory: index('fa_category_idx').on(t.workspaceId, t.category, t.active),
    usefulLifeCheck: check(
      'fa_useful_life_chk',
      sql`${t.usefulLifeMonths} > 0 AND ${t.usefulLifeMonths} <= 1200`,
    ),
    salvageCheck: check(
      'fa_salvage_chk',
      sql`${t.salvageValue} >= 0 AND ${t.salvageValue} <= ${t.acquisitionCost}`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// deferred_assets — pagos anticipados a amortizar
// ---------------------------------------------------------------------------

/**
 * Casos típicos: seguros pagados por adelantado, arriendos prepagados,
 * comisiones. Se amortizan linealmente entre `amortization_start` y
 * `amortization_end`.
 *
 * Para mes parcial al inicio o al final, el calculador prorratea por días.
 */
export const deferredAssets = pgTable(
  'deferred_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    category: varchar('category', { length: 32 }).notNull().default('other'),
    assetAccountId: uuid('asset_account_id')
      .notNull()
      .references(() => chartOfAccounts.id),
    expenseAccountId: uuid('expense_account_id')
      .notNull()
      .references(() => chartOfAccounts.id),
    totalAmount: numeric('total_amount', { precision: 20, scale: 2 }).notNull(),
    amortizationStart: timestamp('amortization_start', {
      withTimezone: true,
    }).notNull(),
    amortizationEnd: timestamp('amortization_end', {
      withTimezone: true,
    }).notNull(),
    amortizedAmount: numeric('amortized_amount', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),
    lastAmortizedPeriodId: uuid('last_amortized_period_id').references(
      () => accountingPeriods.id,
    ),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byPeriod: index('da_period_idx').on(
      t.workspaceId,
      t.amortizationStart,
      t.amortizationEnd,
    ),
    rangeCheck: check(
      'da_range_chk',
      sql`${t.amortizationEnd} > ${t.amortizationStart}`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// provisions_config — parámetros de provisiones laborales y fiscales
// ---------------------------------------------------------------------------

/**
 * `provision_type`:
 *   - 'prima' (8.33% sobre salarios)
 *   - 'cesantias' (8.33%)
 *   - 'intereses_cesantias' (1% anual sobre cesantías acumuladas)
 *   - 'vacaciones' (4.17%)
 *   - 'salud' (8.5% empleador)
 *   - 'pension' (12% empleador)
 *   - 'arl' (variable según clase de riesgo, 0.522% Clase I)
 *   - 'parafiscales' (9% — 4% Caja + 3% ICBF + 2% SENA)
 *   - 'income_tax' (35% sobre utilidad antes de impuestos, Art. 240 ET)
 *
 * `base_account_codes`: códigos PUC cuyo saldo del período se suma para
 * formar la base de cálculo. Para income_tax es la utilidad neta del P&L.
 *
 * `expense_account` y `liability_account`: dónde se contabilizan el
 * gasto y la obligación al hacer la provisión.
 */
export const provisionsConfig = pgTable(
  'provisions_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provisionType: varchar('provision_type', { length: 32 }).notNull(),
    rate: numeric('rate', { precision: 8, scale: 6 }).notNull(),
    baseAccountCodes: jsonb('base_account_codes')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    expenseAccountId: uuid('expense_account_id')
      .notNull()
      .references(() => chartOfAccounts.id),
    liabilityAccountId: uuid('liability_account_id')
      .notNull()
      .references(() => chartOfAccounts.id),
    cadence: varchar('cadence', { length: 16 }).notNull().default('monthly'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    wsTypeUniq: uniqueIndex('pc_ws_type_uniq').on(
      t.workspaceId,
      t.provisionType,
    ),
  }),
);

// ---------------------------------------------------------------------------
// monthly_close_runs — bitácora del workflow durable de cierre (WS5)
// ---------------------------------------------------------------------------

/**
 * Una row por intento de cierre. `period_id` es UNIQUE para garantizar que
 * el cron mensual no dispare dos veces el mismo cierre (idempotencia).
 *
 * `workflow_run_id` es el id que retorna `start(closeMonthWorkflow)` —
 * permite navegar al dashboard de Vercel Workflow vía
 * `npx workflow web <runId>` para inspeccionar el progreso.
 *
 * `period_hash`:
 *   period_hash = sha256(
 *     canonical_serialize(all journal_entries posteadas del período) ||
 *     previous_period_hash
 *   )
 * Manipular un asiento posteado de un mes cerrado rompe la cadena al
 * recalcular y el frontend lo muestra como tampering evidence.
 *
 * `health_check_results`:
 *   {
 *     unbalancedEntries: number,
 *     bankReconciliationGaps: Array<{ accountId, difference }>,
 *     pendingDocs: number,
 *     warnings: string[],
 *     blocking: boolean,
 *     overrideReason?: string,
 *     overrideBy?: string
 *   }
 */
export const monthlyCloseRuns = pgTable(
  'monthly_close_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => accountingPeriods.id, { onDelete: 'cascade' }),
    workflowRunId: text('workflow_run_id'),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    healthCheckResults: jsonb('health_check_results').$type<{
      unbalancedEntries: number;
      bankReconciliationGaps: Array<{
        accountId: string;
        difference: string;
      }>;
      pendingDocs: number;
      warnings: string[];
      blocking: boolean;
      overrideReason?: string;
      overrideBy?: string;
    }>(),
    depreciationEntryId: uuid('depreciation_entry_id'),
    amortizationEntryId: uuid('amortization_entry_id'),
    provisionEntryIds: jsonb('provision_entry_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    closingEntryId: uuid('closing_entry_id'),
    previousPeriodHash: varchar('previous_period_hash', { length: 64 }),
    periodHash: varchar('period_hash', { length: 64 }),
    pdfReportUrl: text('pdf_report_url'),
    excelReportUrl: text('excel_report_url'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    triggeredBy: uuid('triggered_by'),
  },
  (t) => ({
    periodUniq: uniqueIndex('mcr_period_uniq').on(t.periodId),
    byStatus: index('mcr_status_idx').on(t.workspaceId, t.status, t.startedAt),
  }),
);

// ---------------------------------------------------------------------------
// Types inferidos
// ---------------------------------------------------------------------------

export type FixedAssetRow = typeof fixedAssets.$inferSelect;
export type NewFixedAssetRow = typeof fixedAssets.$inferInsert;

export type DeferredAssetRow = typeof deferredAssets.$inferSelect;
export type NewDeferredAssetRow = typeof deferredAssets.$inferInsert;

export type ProvisionsConfigRow = typeof provisionsConfig.$inferSelect;
export type NewProvisionsConfigRow = typeof provisionsConfig.$inferInsert;

export type MonthlyCloseRunRow = typeof monthlyCloseRuns.$inferSelect;
export type NewMonthlyCloseRunRow = typeof monthlyCloseRuns.$inferInsert;
