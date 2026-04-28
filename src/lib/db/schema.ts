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
import type { ProvisionalFlag } from '@/lib/agents/repair/types';

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

// ─── Phase 3: persistencia del chat "Doctor de Datos" ──────────────────────
//
// Una sesión de repair = una conversación contra el agente de reparación,
// identificada por `conversation_id` (uuid generado en el cliente, único
// global). Hidratamos al montar el chat; autosave en cada mutación del
// ledger. Los `messages` siguen siendo ephemeral por ahora — Phase 3.1 los
// migrará si es necesario.
//
// NOTA sobre `conversation_id` UNIQUE: el cliente lo genera con uuid v4 ⇒
// colisión cross-workspace es 0 en la práctica. Si en el futuro se quisiera
// permitir reutilización por workspace, cambiar a unique compuesto
// (workspace_id, conversation_id).
export const repairSessions = pgTable('repair_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().unique(),
  errorMessage: text('error_message').notNull(),
  rawCsv: text('raw_csv'),
  language: text('language').notNull(),
  companyName: text('company_name'),
  period: text('period'),
  // ProvisionalFlag se persiste tal cual; null cuando el usuario no marcó
  // borrador. El campo se actualiza al cierre del flujo.
  provisional: jsonb('provisional').$type<ProvisionalFlag | null>(),
  // 'open' mientras la conversación sigue activa; 'closed' al regenerar el
  // reporte (consumo del ledger) o al marcar provisional.
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Cada fila = un Adjustment del ledger del cliente. La estrategia de
// upsert es delete+reinsert por session_id (el cliente envía el array
// completo como replay), así que NO hace falta unique sobre adjustment_id;
// pero el campo se conserva por trazabilidad y para correlacionar con
// telemetría / SSE events.
export const repairAdjustments = pgTable('repair_adjustments', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => repairSessions.id, { onDelete: 'cascade' }),
  adjustmentId: text('adjustment_id').notNull(),
  accountCode: text('account_code').notNull(),
  accountName: text('account_name').notNull(),
  amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
  rationale: text('rationale').notNull(),
  status: text('status').notNull(),
  // Multiperiodo (T1+T5): periodo del snapshot al que aplica el ajuste.
  // Nullable: si null, el aplicador usa primary.period como default.
  // Migracion: ALTER TABLE repair_adjustments ADD COLUMN period text;
  period: text('period'),
  proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
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
export type RepairSession = typeof repairSessions.$inferSelect;
export type NewRepairSession = typeof repairSessions.$inferInsert;
export type RepairAdjustment = typeof repairAdjustments.$inferSelect;
export type NewRepairAdjustment = typeof repairAdjustments.$inferInsert;

// ─── Modulo "Contabilidad Pyme" ─────────────────────────────────────────────
//
// Modulo simple para tenderos / microempresas que llevan contabilidad en
// cuadernos de papel. El usuario fotografia paginas → OCR Vision (gpt-4o)
// → renglones estructurados (ingreso/egreso, monto, categoria) → revision
// humana → ledger persistido por workspace.
//
// No comparte tablas con el pipeline NIIF. Cuando se quiera puentear, se
// genera un balance de comprobacion derivado y se enchufa al flujo
// existente (`reports.kind = 'pyme_monthly'` o un export CSV).

export const pymeBooks = pgTable('pyme_books', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('COP'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Una foto subida = una row aqui. `image_url` puede ser:
//  - una URL https de Vercel Blob (preferido)
//  - una data URL `data:image/...;base64,...` (fallback MVP cuando Blob
//    no esta provisionado)
// `page_count` es siempre 1 para fotos individuales — el campo existe
// para soportar PDFs multi-pagina en el futuro.
//
// El estado avanza pending → processing → done | failed. Los entries
// extraidos se persisten en `pyme_entries` con `source_image_url` y
// `source_page` apuntando a esta row.
export const pymeUploads = pgTable('pyme_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id')
    .notNull()
    .references(() => pymeBooks.id, { onDelete: 'cascade' }),
  imageUrl: text('image_url').notNull(),
  mimeType: text('mime_type').notNull(),
  pageCount: integer('page_count').notNull().default(1),
  ocrStatus: text('ocr_status').notNull().default('pending'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Cada renglon del cuaderno. `status = 'draft'` mientras el extractor o el
// usuario no han confirmado; `status = 'confirmed'` cuando el usuario
// presiona "guardar" en EntryReview. Solo los confirmed entran a reportes.
//
// `category` es texto libre (catalogo recomendado en `pyme_categories`,
// pero no FK rigida — un tendero puede inventar categorias on-the-fly).
// `raw_ocr_text` guarda la linea cruda del OCR para auditoria.
export const pymeEntries = pgTable('pyme_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id')
    .notNull()
    .references(() => pymeBooks.id, { onDelete: 'cascade' }),
  uploadId: uuid('upload_id').references(() => pymeUploads.id, {
    onDelete: 'set null',
  }),
  entryDate: timestamp('entry_date', { withTimezone: true }).notNull(),
  description: text('description').notNull(),
  kind: text('kind').notNull(), // 'ingreso' | 'egreso'
  amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
  category: text('category'),
  pucHint: text('puc_hint'), // codigo PUC sugerido (opcional)
  sourceImageUrl: text('source_image_url'),
  sourcePage: integer('source_page'),
  rawOcrText: text('raw_ocr_text'),
  confidence: numeric('confidence', { precision: 4, scale: 3 }), // 0..1
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Catalogo simple de categorias por libro. NO es FK desde `pyme_entries`
// para permitir categorias ad-hoc, pero la UI sugiere desde aqui.
export const pymeCategories = pgTable('pyme_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id')
    .notNull()
    .references(() => pymeBooks.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // 'ingreso' | 'egreso'
  pucHint: text('puc_hint'), // codigo PUC sugerido para futuro export
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PymeBook = typeof pymeBooks.$inferSelect;
export type NewPymeBook = typeof pymeBooks.$inferInsert;
export type PymeUpload = typeof pymeUploads.$inferSelect;
export type NewPymeUpload = typeof pymeUploads.$inferInsert;
export type PymeEntry = typeof pymeEntries.$inferSelect;
export type NewPymeEntry = typeof pymeEntries.$inferInsert;
export type PymeCategory = typeof pymeCategories.$inferSelect;
export type NewPymeCategory = typeof pymeCategories.$inferInsert;
