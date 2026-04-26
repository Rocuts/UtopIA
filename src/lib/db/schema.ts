import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// MVP — schema mínimo funcional, sin auth.
// Identificación de tenant via cookie httpOnly `utopia_workspace_id`.
// Cuando se agregue auth real, vincular `workspaces.id` a `user_id` en
// una tabla `workspace_members` adicional, sin romper este shape.

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  nit: text('nit'),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Vault server-side de credenciales ERP.
// `encrypted_secret` debe quedar cifrado AES-256-GCM con `UTOPIA_VAULT_KEY`
// (el helper de cifrado se añadirá cuando migremos `ERPConnector` desde
// localStorage). Por ahora la columna existe pero no se usa todavía.
export const erpCredentials = pgTable('erp_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Historial de reportes generados.
// `data` guarda el payload completo (Markdown + secciones + metadata).
// `control_totals` se persiste por separado para comparativos N vs N-1
// (necesario para Eje 4 — variaciones >10% entre períodos).
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  title: text('title'),
  data: jsonb('data').notNull(),
  controlTotals: jsonb('control_totals'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Umbrales de alerta por KPI — preparación para Eje 6 (webhooks/email).
// `operator` ∈ { 'lt', 'gt', 'eq' }; `kpi` corresponde a las claves de
// `getDashboardKpis()` (cash_runway, current_ratio, etc).
export const alertThresholds = pgTable('alert_thresholds', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  kpi: text('kpi').notNull(),
  operator: text('operator').notNull(),
  threshold: numeric('threshold').notNull(),
  notifyEmail: text('notify_email'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Snapshot del calendario tributario verificado contra la fuente oficial DIAN.
// Una row por (year, slug) cada vez que el cron confirma o detecta cambios:
// mantenemos historial completo para auditoría y rollback. Las lecturas
// (`getVerifiedNational`) ordenan por `last_verified_at DESC LIMIT 1` para
// quedarse siempre con la última versión válida.
//
// `slug` ∈ { 'national', 'municipal:<city-id>' }
// `payload` ∈ { NationalDeadline[] | MunicipalDeadline[] } según slug
// `decree_hash` permite detectar idempotentemente si la fuente cambió.
export const verifiedCalendars = pgTable('verified_calendars', {
  id: uuid('id').primaryKey().defaultRandom(),
  year: integer('year').notNull(),
  slug: text('slug').notNull(),
  decreeNumber: text('decree_number').notNull(),
  decreeHash: text('decree_hash').notNull(),
  payload: jsonb('payload').notNull(),
  source: text('source').notNull(),
  sourceUrl: text('source_url').notNull(),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type ErpCredential = typeof erpCredentials.$inferSelect;
export type NewErpCredential = typeof erpCredentials.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type AlertThreshold = typeof alertThresholds.$inferSelect;
export type NewAlertThreshold = typeof alertThresholds.$inferInsert;
export type VerifiedCalendar = typeof verifiedCalendars.$inferSelect;
export type NewVerifiedCalendar = typeof verifiedCalendars.$inferInsert;
