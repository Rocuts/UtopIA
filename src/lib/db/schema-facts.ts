// ─── Schema split: Hechos del negocio (memoria de contexto empresarial) ──────
//
// Tablas para la memoria de hechos duraderos del negocio y su audit trail de
// cálculo. Re-exportadas desde `schema.ts` — Drizzle Kit las descubre solo.
//
// FK → workspaces: callback lazy `() => workspaces.id` (patrón schema-tax.ts).
// supersededById es self-FK: usa `AnyPgColumn` + callback para el forward-ref.
//
// Append-only: un hecho nunca se edita en sitio. Una "edición" crea una fila
// nueva `active` y marca la vieja `revoked` con `supersededById` (auditoría DIAN).

import {
  type AnyPgColumn,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { workspaces } from './schema';

// ─── Enums ───────────────────────────────────────────────────────────────────

/** Tipo de hecho. Piloto implementa `narrative` + `donation`; el resto son
 *  slots forward-compat sin handler hasta sus olas. */
export const factKindEnum = pgEnum('fact_kind', [
  'narrative',
  'donation',
  'leasing',
  'loss_carryforward',
]);

/** Ciclo de vida. `revoked` es soft-delete — nunca se borra la fila. */
export const factStatusEnum = pgEnum('fact_status', ['active', 'revoked']);

/** Origen del registro: capturado por chat o entrado a mano en el panel. */
export const factSourceEnum = pgEnum('fact_source', ['chat', 'manual']);

// ─── workspace_facts ─────────────────────────────────────────────────────────

export const workspaceFacts = pgTable(
  'workspace_facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: factKindEnum('kind').notNull(),
    title: text('title').notNull(),
    // Narrativa anclada en las palabras del usuario. Siempre existe.
    body: text('body').notNull(),
    // Enriquecimiento tipado por kind. null para `narrative`. Montos MoneyCop.
    structured: jsonb('structured').$type<Record<string, unknown>>(),
    // Vigencia fiscal. null ⇒ vigente para cualquier reporte.
    fiscalPeriod: varchar('fiscal_period', { length: 8 }),
    status: factStatusEnum('status').notNull().default('active'),
    // Cadena de versiones: apunta a la fila que ESTA fila reemplazó.
    supersededById: uuid('superseded_by_id').references(
      (): AnyPgColumn => workspaceFacts.id,
      { onDelete: 'set null' },
    ),
    source: factSourceEnum('source').notNull().default('chat'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    // Lookup de reconciliación: hechos activos del mismo kind+período.
    index('idx_facts_reconcile').on(
      t.workspaceId,
      t.kind,
      t.fiscalPeriod,
      t.status,
    ),
  ],
);

// ─── fact_decision_records ───────────────────────────────────────────────────
//
// Audit trail inmutable por cálculo. Junto con el registro de reglas
// vigencia-fechado, da auditabilidad bitemporal SIN store bitemporal:
// reconstruye "qué regla y qué inputs produjeron este número, y cuándo".
// Sin path de UPDATE — solo INSERT.

export const factDecisionRecords = pgTable('fact_decision_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  factId: uuid('fact_id')
    .notNull()
    .references(() => workspaceFacts.id, { onDelete: 'cascade' }),
  ruleKey: varchar('rule_key', { length: 64 }).notNull(),
  ruleVersion: varchar('rule_version', { length: 32 }).notNull(),
  // Inputs y resultado del cálculo. Montos como MoneyCop strings.
  inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull(),
  resultado: jsonb('resultado').$type<Record<string, unknown>>().notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Tipos inferidos ─────────────────────────────────────────────────────────

export type WorkspaceFact = typeof workspaceFacts.$inferSelect;
export type NewWorkspaceFact = typeof workspaceFacts.$inferInsert;
export type FactDecisionRecord = typeof factDecisionRecords.$inferSelect;
export type NewFactDecisionRecord = typeof factDecisionRecords.$inferInsert;
