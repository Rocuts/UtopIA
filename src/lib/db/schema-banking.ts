// ─── Schema split: Bank Reconciliation (Ola 1+1 Élite, WS3) ─────────────────
//
// Importación de extractos bancarios + matching heurístico contra el
// libro mayor para detectar diferencias antes del cierre mensual.
//
// Modelo:
//   bank_accounts        ← cuentas bancarias del workspace, mapeadas al PUC
//   bank_statement_imports ← cada subida de CSV/OFX, con resumen
//   bank_transactions    ← cada movimiento del extracto (deduplicado por fingerprint)
//   bank_reconciliations ← snapshot del estado de conciliación por (período, cuenta)
//
// `matched_journal_line_id` es FK soft (sin REFERENCES) para evitar contención
// de locks: la conciliación se rehace muchas veces y no debe lockear el
// libro mayor.

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

// Importamos directamente de schema.ts; el ciclo es 2-step y funciona
// porque las FK son closures lazy y las tablas core se definen antes de
// los `export *` finales de schema.ts.
import { accountingPeriods, chartOfAccounts, workspaces } from './schema';

// ---------------------------------------------------------------------------
// bank_accounts — catálogo de cuentas bancarias del workspace
// ---------------------------------------------------------------------------

/**
 * Una fila por cuenta bancaria. El campo `account_id` apunta a la cuenta
 * del PUC que registra los movimientos contables (ej. 1110 Bancos —
 * Bancolombia Ahorros 123456). Esto permite que la conciliación sepa
 * qué subset de `journal_lines` debe matchear.
 */
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => chartOfAccounts.id),
    bankName: text('bank_name').notNull(),
    accountNumber: varchar('account_number', { length: 32 }).notNull(),
    accountKind: varchar('account_kind', { length: 16 })
      .notNull()
      .default('savings'),
    currency: varchar('currency', { length: 3 }).notNull().default('COP'),
    holderName: text('holder_name'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    wsAccUniq: uniqueIndex('ba_ws_acc_uniq').on(
      t.workspaceId,
      t.bankName,
      t.accountNumber,
    ),
    byPucAccount: index('ba_account_idx').on(t.workspaceId, t.accountId),
  }),
);

// ---------------------------------------------------------------------------
// bank_statement_imports — cada subida de CSV/OFX
// ---------------------------------------------------------------------------

export const bankStatementImports = pgTable(
  'bank_statement_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    format: varchar('format', { length: 16 }).notNull().default('csv'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    startingBalance: numeric('starting_balance', { precision: 20, scale: 2 }),
    endingBalance: numeric('ending_balance', { precision: 20, scale: 2 }),
    transactionCount: integer('transaction_count').notNull().default(0),
    duplicatesSkipped: integer('duplicates_skipped').notNull().default(0),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    errorMessage: text('error_message'),
    importedBy: uuid('imported_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byBank: index('bsi_bank_idx').on(t.bankAccountId, t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// bank_transactions — movimientos individuales del extracto
// ---------------------------------------------------------------------------

/**
 * `amount` es **signed**: positivo = abono al cliente (entrada de efectivo),
 * negativo = cargo (salida). Esto permite SUM directo sin ramificar.
 *
 * `fingerprint = sha256(bankAccountId || posted_at_iso || amount || normalized_description)`.
 * Garantiza idempotencia en re-imports: si el banco re-emite el mismo
 * período, el unique index sobre `(workspace_id, bank_account_id, fingerprint)`
 * descarta duplicados con `ON CONFLICT DO NOTHING`.
 *
 * Matching state:
 *   - `matched_journal_line_id` NULL ⇒ pendiente.
 *   - `matched_journal_line_id` valor + `match_method='exact'` ⇒ match heurístico de monto+fecha.
 *   - `matched_journal_line_id` valor + `match_method='manual'` ⇒ usuario lo asignó en UI.
 *   - `matched_journal_line_id` valor + `match_method='llm'` ⇒ matcher LLM (futuro).
 */
export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'cascade' }),
    importId: uuid('import_id').references(() => bankStatementImports.id, {
      onDelete: 'set null',
    }),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
    valueDate: timestamp('value_date', { withTimezone: true }),
    description: text('description').notNull(),
    reference: text('reference'),
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
    runningBalance: numeric('running_balance', { precision: 20, scale: 2 }),
    currency: varchar('currency', { length: 3 }).notNull().default('COP'),
    matchedJournalLineId: uuid('matched_journal_line_id'),
    matchConfidence: numeric('match_confidence', { precision: 4, scale: 3 }),
    matchMethod: varchar('match_method', { length: 16 }),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    matchedBy: uuid('matched_by'),
    externalId: text('external_id'),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    rawPayload: jsonb('raw_payload'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    fingerprintUniq: uniqueIndex('bt_ws_acc_fp_uniq').on(
      t.workspaceId,
      t.bankAccountId,
      t.fingerprint,
    ),
    byPostedAt: index('bt_posted_idx').on(
      t.workspaceId,
      t.bankAccountId,
      t.postedAt,
    ),
    byMatch: index('bt_unmatched_idx').on(
      t.workspaceId,
      t.bankAccountId,
      t.matchedJournalLineId,
    ),
    confidenceCheck: check(
      'bt_confidence_chk',
      sql`${t.matchConfidence} IS NULL OR (${t.matchConfidence} >= 0 AND ${t.matchConfidence} <= 1)`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// bank_reconciliations — snapshot del estado de conciliación por período/cuenta
// ---------------------------------------------------------------------------

/**
 * Una row por (período, cuenta bancaria, intento). Cada vez que el usuario
 * pulsa "reconciliar" o el cron del cierre mensual evalúa, se crea una
 * nueva row con el estado actual. La última row por (período, cuenta) es
 * la "vigente" para esa combinación.
 *
 * Status:
 *   - 'open' ⇒ todavía hay diferencias o transacciones sin matchear.
 *   - 'balanced' ⇒ saldo libro mayor == saldo extracto, todas las transacciones matched.
 *   - 'reviewed' ⇒ el revisor fiscal aceptó la diferencia (ej. cheques en circulación).
 */
export const bankReconciliations = pgTable(
  'bank_reconciliations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => accountingPeriods.id, { onDelete: 'cascade' }),
    ledgerBalance: numeric('ledger_balance', { precision: 20, scale: 2 }).notNull(),
    bankBalance: numeric('bank_balance', { precision: 20, scale: 2 }).notNull(),
    difference: numeric('difference', { precision: 20, scale: 2 }).notNull(),
    matchedCount: integer('matched_count').notNull().default(0),
    unmatchedCount: integer('unmatched_count').notNull().default(0),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    reconciledBy: uuid('reconciled_by'),
    notes: text('notes'),
    detailsJson: jsonb('details_json'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byPeriod: index('br_period_idx').on(
      t.workspaceId,
      t.periodId,
      t.bankAccountId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Types inferidos
// ---------------------------------------------------------------------------

export type BankAccountRow = typeof bankAccounts.$inferSelect;
export type NewBankAccountRow = typeof bankAccounts.$inferInsert;

export type BankStatementImportRow = typeof bankStatementImports.$inferSelect;
export type NewBankStatementImportRow =
  typeof bankStatementImports.$inferInsert;

export type BankTransactionRow = typeof bankTransactions.$inferSelect;
export type NewBankTransactionRow = typeof bankTransactions.$inferInsert;

export type BankReconciliationRow = typeof bankReconciliations.$inferSelect;
export type NewBankReconciliationRow = typeof bankReconciliations.$inferInsert;
