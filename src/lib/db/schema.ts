import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
// cuadernos de papel. El usuario fotografia paginas → OCR Vision (gpt-5.4)
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

// ─── Modulo RAG (Neon pgvector + hybrid search) ────────────────────────────
//
// Reemplaza el HNSWLib local que en Vercel caía a MemoryVectorStore vacío
// (el index 285 MB excede 250 MB de Functions). Usa pgvector 0.8 con HNSW +
// tsvector('spanish') para hybrid search BM25+vector con RRF.
//
// Multi-tenant: una sola tabla `rag_chunks`. `workspace_id NULL` ⇒ corpus
// global (E.T., NIIF, decretos, doctrina DIAN). `workspace_id <uuid>` ⇒
// docs subidos por un tenant especifico.
//
// `embedding`: 1536 dim ← `text-embedding-3-small` (OpenAI). Si en el
// futuro se cambia el modelo, generar una nueva tabla `rag_chunks_v2` y
// migrar progresivamente — no se puede mezclar dimensiones distintas en
// un mismo HNSW index.
//
// `tsv` es una columna GENERATED en SQL crudo (Drizzle aun no expone la
// sintaxis GENERATED ALWAYS AS ... STORED para tsvector con conversion
// `to_tsvector('spanish', ...)`). Se materializa en `src/lib/rag/init.ts`
// con CREATE TABLE IF NOT EXISTS, y aqui solo declaramos la columna como
// metadata para que Drizzle pueda hacer queries que la referencien si
// hace falta. Por ahora ni siquiera la exportamos al Drizzle schema —
// las queries hibridas usan `sql` raw.
//
// `contextual_prefix` implementa el patron de Anthropic Contextual
// Retrieval (50-100 tokens generados por gpt-5.4-mini que ubican el
// chunk dentro del documento completo). Se concatena con `content` para
// el tsvector de busqueda lexica.
export const ragChunks = pgTable(
  'rag_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // NULL = corpus global (E.T., NIIF, normativa). UUID = docs del tenant.
    workspaceId: uuid('workspace_id'),
    source: text('source').notNull(),
    docType: varchar('doc_type', { length: 64 }),
    entity: varchar('entity', { length: 64 }),
    year: integer('year'),
    section: text('section'),
    content: text('content').notNull(),
    contextualPrefix: text('contextual_prefix'),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    wsIdx: index('rag_ws_idx').on(t.workspaceId),
    sourceIdx: index('rag_source_idx').on(t.source),
    // Indices HNSW + GIN(tsvector) se crean en init.ts con SQL raw,
    // ya que Drizzle aun no soporta `USING hnsw (...)` declarativo.
  }),
);

export type RagChunk = typeof ragChunks.$inferSelect;
export type NewRagChunk = typeof ragChunks.$inferInsert;

// ─── Núcleo contable PYME — partida doble (Ola 1) ───────────────────────────
//
// Modelo "1+1" para PYMES colombianas: chart_of_accounts (PUC PYMES Decreto
// 2706/2012 + 2420/2015 Anexo 2), accounting_periods (year/month con
// status open|closed|locked), third_parties (NIT/CC del libro auxiliar),
// cost_centers (dimensión analítica), journal_entries + journal_lines
// (libro mayor con partida doble exacta).
//
// Reglas duras del libro mayor (enforced en DB con triggers + checks):
//  1. journal_entries.totalDebit = journal_entries.totalCredit (CHECK).
//  2. journal_lines.debit y credit son no-negativos y mutuamente exclusivos
//     (CHECK: solo uno puede ser >0 por fila).
//  3. journal_lines.debit + credit > 0 (no se permiten líneas en cero).
//  4. Una entry posted NO se puede modificar (trigger
//     `journal_entries_immutable`). Para corregir → reversal entry que
//     apunte vía `reversalOfEntryId`.
//  5. No se pueden insertar journal_lines en un período cerrado/bloqueado
//     (trigger `journal_lines_period_check` lee
//     accounting_periods.status del período del entry).
//  6. journal_lines.accountId debe apuntar a una cuenta con `is_postable
//     = true` (trigger `journal_lines_account_postable`). Las cuentas de
//     nivel 1-3 (clase/grupo/cuenta) NO son postables; solo nivel 4-5
//     (subcuenta/auxiliar) lo son.
//
// Multi-currency forward-compat: hoy todo es COP, pero `currency`,
// `exchangeRate`, `functionalDebit`, `functionalCredit` ya existen para
// soportar empresas con operaciones USD/EUR sin migrar el schema.
//
// `metadata` y `dimensions` (jsonb) permiten extensibilidad sin alter
// table: tags arbitrarios, IDs externos (factura, contrato), referencias
// a documentos OCR, etc. Las dimensiones que se vuelvan estables migran
// a columnas indexadas.
//
// Numeración: `entry_number` es UNIQUE por (workspace_id, period_id), se
// asigna al pasar de draft → posted (correlativo gap-less por período).
// Drafts pueden tener entry_number=0 o reservado; el aplicador del Ola 1.B
// se encarga del próximo número en una transacción serializable.

export const accountTypeEnum = pgEnum('account_type', [
  'ACTIVO',
  'PASIVO',
  'PATRIMONIO',
  'INGRESO',
  'GASTO',
  'COSTO',
  'ORDEN_DEUDORA',
  'ORDEN_ACREEDORA',
]);

export const periodStatusEnum = pgEnum('period_status', [
  'open',
  'closed',
  'locked',
]);

export const entryStatusEnum = pgEnum('entry_status', [
  'draft',
  'posted',
  'reversed',
]);

export const sourceTypeEnum = pgEnum('source_type', [
  'manual',
  'import',
  'invoice',
  'payment',
  'depreciation',
  'adjustment',
  'closing',
  'reversal',
  'ai_generated',
  'opening',
]);

export const chartOfAccounts = pgTable(
  'chart_of_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 16 }).notNull(),
    name: text('name').notNull(),
    type: accountTypeEnum('type').notNull(),
    parentId: uuid('parent_id'),
    level: integer('level').notNull(),
    isPostable: boolean('is_postable').notNull().default(false),
    currency: varchar('currency', { length: 3 }).notNull().default('COP'),
    requiresThirdParty: boolean('requires_third_party')
      .notNull()
      .default(false),
    requiresCostCenter: boolean('requires_cost_center')
      .notNull()
      .default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    wsCodeUniq: uniqueIndex('coa_ws_code_uniq').on(t.workspaceId, t.code),
    parentIdx: index('coa_parent_idx').on(t.parentId),
    wsTypeIdx: index('coa_ws_type_idx').on(t.workspaceId, t.type),
  }),
);

export const accountingPeriods = pgTable(
  'accounting_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    month: integer('month').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: periodStatusEnum('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
  },
  (t) => ({
    wsYmUniq: uniqueIndex('period_ws_ym_uniq').on(
      t.workspaceId,
      t.year,
      t.month,
    ),
    monthCheck: check(
      'period_month_chk',
      sql`${t.month} BETWEEN 1 AND 13`,
    ),
    wsStatusIdx: index('period_ws_status_idx').on(t.workspaceId, t.status),
  }),
);

export const thirdParties = pgTable(
  'third_parties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    identificationType: varchar('identification_type', {
      length: 8,
    }).notNull(),
    identification: varchar('identification', { length: 32 }).notNull(),
    verificationDigit: varchar('verification_digit', { length: 1 }),
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    taxRegime: varchar('tax_regime', { length: 32 }),
    isCustomer: boolean('is_customer').notNull().default(false),
    isSupplier: boolean('is_supplier').notNull().default(false),
    isEmployee: boolean('is_employee').notNull().default(false),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    city: varchar('city', { length: 64 }),
    country: varchar('country', { length: 3 }).notNull().default('COL'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('tp_ws_id_uniq').on(
      t.workspaceId,
      t.identificationType,
      t.identification,
    ),
    wsActiveIdx: index('tp_ws_active_idx').on(t.workspaceId, t.active),
  }),
);

export const costCenters = pgTable(
  'cost_centers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 16 }).notNull(),
    name: text('name').notNull(),
    parentId: uuid('parent_id'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('cc_ws_code_uniq').on(t.workspaceId, t.code),
  }),
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => accountingPeriods.id, { onDelete: 'restrict' }),
    entryNumber: integer('entry_number').notNull(),
    entryDate: timestamp('entry_date', { withTimezone: true }).notNull(),
    status: entryStatusEnum('status').notNull().default('draft'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    postedBy: uuid('posted_by'),
    reversalOfEntryId: uuid('reversal_of_entry_id'),
    reversedByEntryId: uuid('reversed_by_entry_id'),
    sourceType: sourceTypeEnum('source_type').notNull().default('manual'),
    sourceId: uuid('source_id'),
    sourceRef: text('source_ref'),
    description: text('description').notNull(),
    totalDebit: numeric('total_debit', { precision: 20, scale: 2 }).notNull(),
    totalCredit: numeric('total_credit', { precision: 20, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('COP'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb('metadata'),
  },
  (t) => ({
    uniqNumber: uniqueIndex('je_ws_period_num_uniq').on(
      t.workspaceId,
      t.periodId,
      t.entryNumber,
    ),
    byDate: index('je_ws_date_idx').on(t.workspaceId, t.entryDate),
    byPeriod: index('je_ws_period_status_idx').on(
      t.workspaceId,
      t.periodId,
      t.status,
    ),
    bySource: index('je_source_idx').on(
      t.workspaceId,
      t.sourceType,
      t.sourceId,
    ),
    balanceCheck: check(
      'je_balanced_chk',
      sql`${t.totalDebit} = ${t.totalCredit}`,
    ),
  }),
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'restrict' }),
    lineNumber: integer('line_number').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => chartOfAccounts.id),
    thirdPartyId: uuid('third_party_id').references(() => thirdParties.id),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    debit: numeric('debit', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),
    credit: numeric('credit', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),
    currency: varchar('currency', { length: 3 }).notNull().default('COP'),
    exchangeRate: numeric('exchange_rate', { precision: 18, scale: 8 })
      .notNull()
      .default('1'),
    functionalDebit: numeric('functional_debit', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),
    functionalCredit: numeric('functional_credit', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),
    description: text('description'),
    dimensions: jsonb('dimensions'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqLine: uniqueIndex('jl_entry_line_uniq').on(t.entryId, t.lineNumber),
    byAccount: index('jl_ws_account_idx').on(t.workspaceId, t.accountId),
    byThirdParty: index('jl_ws_tp_idx').on(t.workspaceId, t.thirdPartyId),
    byCostCenter: index('jl_ws_cc_idx').on(t.workspaceId, t.costCenterId),
    signCheck: check(
      'jl_single_side_chk',
      sql`${t.debit} >= 0 AND ${t.credit} >= 0 AND (${t.debit} = 0 OR ${t.credit} = 0)`,
    ),
    positiveCheck: check(
      'jl_positive_chk',
      sql`${t.debit} + ${t.credit} > 0`,
    ),
  }),
);

export type ChartOfAccountsRow = typeof chartOfAccounts.$inferSelect;
export type NewChartOfAccountsRow = typeof chartOfAccounts.$inferInsert;
export type AccountingPeriodRow = typeof accountingPeriods.$inferSelect;
export type NewAccountingPeriodRow = typeof accountingPeriods.$inferInsert;
export type ThirdPartyRow = typeof thirdParties.$inferSelect;
export type NewThirdPartyRow = typeof thirdParties.$inferInsert;
export type CostCenterRow = typeof costCenters.$inferSelect;
export type NewCostCenterRow = typeof costCenters.$inferInsert;
export type JournalEntryRow = typeof journalEntries.$inferSelect;
export type NewJournalEntryRow = typeof journalEntries.$inferInsert;
export type JournalLineRow = typeof journalLines.$inferSelect;
export type NewJournalLineRow = typeof journalLines.$inferInsert;
