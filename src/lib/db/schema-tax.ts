// ─── Schema split: Smart-Tax Engine (Ola 1+1 Élite, WS1) ────────────────────
//
// Tablas para el motor de cálculo automático de IVA, ReteFuente, ICA, ReteIVA.
// Re-exportadas desde `schema.ts` — Drizzle Kit las descubre automáticamente.
//
// FK → workspaces, chartOfAccounts, thirdParties: usamos `() => ...` para
// evitar circulares al evaluar el módulo (Drizzle resuelve el callback al
// generar el SQL, no al cargar el TS).
//
// Owner: WS1 (Sonnet 4.6 #1) — pero el SHAPE de las tablas es responsabilidad
// de Opus 4.7 (este archivo) para mantener coherencia de migraciones.

import {
  boolean,
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
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Importamos directamente del módulo padre. El ciclo schema ↔ schema-tax
// es seguro porque (a) `workspaces` y `thirdParties` se definen ANTES de
// los `export *` al final de schema.ts, y (b) las FK usan `() => table.col`
// (closures lazy), nunca acceso directo en top-level.
import { chartOfAccounts, thirdParties, workspaces } from './schema';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Tipos de impuesto colombianos cubiertos por el motor.
 * - IVA: Impuesto al Valor Agregado (Art. 420 ET).
 * - RETEFUENTE: Retención en la fuente sobre renta (Decreto 2418/2013 + 359/2025).
 * - RETEIVA: Retención de IVA (Art. 437-1 ET).
 * - ICA: Impuesto de Industria y Comercio (Ley 14/1983 + ordenanzas municipales).
 * - CREE: derogado en 2017 — slot reservado para reactivación o impuestos similares.
 * - INC: Impuesto Nacional al Consumo (Art. 512-1 ET).
 */
export const taxTypeEnum = pgEnum('tax_type', [
  'IVA',
  'RETEFUENTE',
  'RETEIVA',
  'ICA',
  'CREE',
  'INC',
]);

/**
 * Régimen tributario del tercero. Combinable con flags `is_*` en
 * `third_party_tax_profile` para casos compuestos (ej. Gran Contribuyente
 * autorretenedor responsable de IVA).
 *
 * Mapeo a las nomenclaturas DIAN 2026 (post-Ley 1943/2018):
 * - regimen_comun ↔ "Responsable de IVA"
 * - regimen_simplificado ↔ "No responsable de IVA"
 * - regimen_simple ↔ Régimen Simple de Tributación (Art. 903-916 ET)
 */
export const taxRegimeEnum = pgEnum('tax_regime_kind', [
  'gran_contribuyente',
  'autorretenedor',
  'regimen_comun',
  'regimen_simplificado',
  'regimen_simple',
  'persona_natural',
  'no_responsable_iva',
  'no_residente',
]);

// ---------------------------------------------------------------------------
// uvt_constants — histórico oficial de UVT por año
// ---------------------------------------------------------------------------

/**
 * Valor histórico de la Unidad de Valor Tributario por año.
 * Permite recalcular retenciones aplicables en períodos pasados sin
 * confiar en una constante hardcoded que cambia cada enero.
 *
 * Seed inicial: 2025 = 49.799, 2026 = 52.374. El cron `calendar-sync`
 * (futuro) se encargará de validar contra DIAN cada enero.
 */
export const uvtConstants = pgTable('uvt_constants', {
  year: integer('year').primaryKey(),
  valueCop: numeric('value_cop', { precision: 14, scale: 2 }).notNull(),
  decreeRef: text('decree_ref'),
  source: text('source'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// tax_rules — catálogo de reglas built-in + overrides por workspace
// ---------------------------------------------------------------------------

/**
 * Cada regla expresa: "cuando aplica, qué tasa, qué cuenta del PUC, y bajo
 * qué umbral".
 *
 * `workspace_id NULL` ⇒ regla nacional built-in (no editable). Cuando un
 * workspace quiere sobre-escribir (ej. tarifa ICA municipal específica),
 * crea una row con su `workspace_id` y `code` igual al built-in: el motor
 * resuelve por preferencia tenant-first.
 *
 * `applicable_triggers` (JSONB) modela las condiciones de activación:
 *   {
 *     transactionTypes: ('purchase'|'sale'|'service_purchase'|'service_sale')[],
 *     supplierRegimes?: TaxRegimeKind[],
 *     customerRegimes?: TaxRegimeKind[],
 *     economicActivities?: string[],   // CIIU
 *     cityCode?: string,                // DANE (ej. 11001 Bogotá)
 *     minBaseUvt?: number,              // umbral en UVT
 *     minBaseAmount?: number            // umbral en COP (para casos sin UVT)
 *   }
 *
 * `account_natures`: para una regla de IVA Descontable la cuenta de impuesto
 * suma como activo (débito); para una de IVA por Pagar suma como pasivo
 * (crédito). El generador de líneas usa esto para colocar el monto en el
 * lado correcto de la `journal_lines`.
 */
export const taxRules = pgTable(
  'tax_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    code: varchar('code', { length: 48 }).notNull(),
    taxType: taxTypeEnum('tax_type').notNull(),
    description: text('description').notNull(),
    rate: numeric('rate', { precision: 8, scale: 6 }).notNull(),
    baseAccountCode: varchar('base_account_code', { length: 16 }),
    taxAccountCode: varchar('tax_account_code', { length: 16 }),
    accountSide: varchar('account_side', { length: 8 }).notNull(),
    applyThresholdUvt: numeric('apply_threshold_uvt', {
      precision: 12,
      scale: 4,
    }),
    applyThresholdCop: numeric('apply_threshold_cop', {
      precision: 20,
      scale: 2,
    }),
    applicableTriggers: jsonb('applicable_triggers')
      .$type<{
        transactionTypes?: Array<
          'purchase' | 'sale' | 'service_purchase' | 'service_sale'
        >;
        supplierRegimes?: string[];
        customerRegimes?: string[];
        economicActivities?: string[];
        cityCode?: string;
        minBaseUvt?: number;
        minBaseAmount?: number;
      }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    isDeductible: boolean('is_deductible').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    wsCodeUniq: uniqueIndex('tr_ws_code_uniq').on(t.workspaceId, t.code),
    typeIdx: index('tr_type_idx').on(t.taxType, t.isActive),
  }),
);

// ---------------------------------------------------------------------------
// third_party_tax_profile — perfil tributario expandido del tercero
// ---------------------------------------------------------------------------

/**
 * Extiende `third_parties` con los flags y atributos necesarios para que
 * el motor decida qué reglas aplicar. Una fila por (workspace, third_party).
 *
 * Por qué tabla aparte y no columnas directas en `third_parties`: queremos
 * que el módulo Smart-Tax sea desactivable (drop tabla = motor desactivado)
 * sin alterar el shape de `third_parties` que ya consumen otros módulos.
 *
 * `regime` puede coexistir con `is_gran_contribuyente=true` (ej. una persona
 * jurídica del régimen común que además es gran contribuyente). El motor
 * evalúa los flags en orden de precedencia legal.
 */
export const thirdPartyTaxProfile = pgTable(
  'third_party_tax_profile',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    thirdPartyId: uuid('third_party_id')
      .notNull()
      .references(() => thirdParties.id, { onDelete: 'cascade' }),
    regime: taxRegimeEnum('regime').notNull().default('persona_natural'),
    isGranContribuyente: boolean('is_gran_contribuyente')
      .notNull()
      .default(false),
    isAutorretenedor: boolean('is_autorretenedor').notNull().default(false),
    isResponsableIva: boolean('is_responsable_iva').notNull().default(true),
    isRegimenSimple: boolean('is_regimen_simple').notNull().default(false),
    cityCode: varchar('city_code', { length: 8 }),
    economicActivity: varchar('economic_activity', { length: 16 }),
    resolutionRef: text('resolution_ref'),
    notes: text('notes'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    wsTpUniq: uniqueIndex('tptp_ws_tp_uniq').on(t.workspaceId, t.thirdPartyId),
  }),
);

// ---------------------------------------------------------------------------
// tax_engine_audits — bitácora de las decisiones del motor
// ---------------------------------------------------------------------------

/**
 * Cada vez que el motor evalúa una transacción, guarda la decisión: qué
 * reglas matched, qué líneas propuestas, qué overrides aplicó el usuario.
 * Sirve para entrenar el clasificador, debuggear y auditar.
 *
 * `journal_entry_id` es nullable: si la propuesta nunca se posteó (preview
 * descartado), igual queda registrada para análisis.
 */
export const taxEngineAudits = pgTable(
  'tax_engine_audits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    journalEntryId: uuid('journal_entry_id'),
    matchedRuleIds: jsonb('matched_rule_ids').$type<string[]>().notNull(),
    inputContext: jsonb('input_context').notNull(),
    proposedLines: jsonb('proposed_lines').notNull(),
    appliedLines: jsonb('applied_lines'),
    overrideReason: text('override_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    wsIdx: index('tea_ws_idx').on(t.workspaceId, t.createdAt),
    entryIdx: index('tea_entry_idx').on(t.journalEntryId),
  }),
);

// ---------------------------------------------------------------------------
// Types inferidos
// ---------------------------------------------------------------------------

export type UvtConstantRow = typeof uvtConstants.$inferSelect;
export type NewUvtConstantRow = typeof uvtConstants.$inferInsert;

export type TaxRuleRow = typeof taxRules.$inferSelect;
export type NewTaxRuleRow = typeof taxRules.$inferInsert;

export type ThirdPartyTaxProfileRow = typeof thirdPartyTaxProfile.$inferSelect;
export type NewThirdPartyTaxProfileRow =
  typeof thirdPartyTaxProfile.$inferInsert;

export type TaxEngineAuditRow = typeof taxEngineAudits.$inferSelect;
export type NewTaxEngineAuditRow = typeof taxEngineAudits.$inferInsert;

/** Re-export for downstream consumers (e.g. WS2 OCR bridge). */
export type TaxRegimeKind = (typeof taxRegimeEnum.enumValues)[number];
export type TaxType = (typeof taxTypeEnum.enumValues)[number];
