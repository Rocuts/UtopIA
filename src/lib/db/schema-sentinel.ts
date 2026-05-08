// ---------------------------------------------------------------------------
// Sentinel — schema (P6).
// ---------------------------------------------------------------------------
// Persiste los alerts emitidos por los 4 triggers (T1-T4) con dedup_key
// único por (workspace, dedup_key) para idempotencia. Los estados gobiernan
// la escalation: pending → snoozed | resolved | escalated.
// ---------------------------------------------------------------------------

import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { workspaces } from './schema';
import { accountingPeriods } from './schema';

export const sentinelPillarEnum = pgEnum('sentinel_pillar', [
  'escudo',
  'valor',
  'verdad',
  'futuro',
]);

export const sentinelSeverityEnum = pgEnum('sentinel_severity', [
  'critico',
  'advertencia',
  'informativo',
]);

export const sentinelStatusEnum = pgEnum('sentinel_status', [
  'pending',
  'snoozed',
  'resolved',
  'escalated',
]);

export const sentinelAlerts = pgTable(
  'sentinel_alerts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => accountingPeriods.id, { onDelete: 'set null' }),
    pillar: sentinelPillarEnum('pillar').notNull(),
    triggerCode: varchar('trigger_code', { length: 8 }).notNull(),
    severity: sentinelSeverityEnum('severity').notNull(),
    /** Idempotency key: dos ejecuciones del mismo trigger sobre los mismos
     *  datos producen el mismo dedupKey y por tanto un upsert, no un insert. */
    dedupKey: text('dedup_key').notNull(),
    status: sentinelStatusEnum('status').notNull().default('pending'),
    /** Snapshot del Insight serializado (vars, hallazgo, impacto, acción). */
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by'),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    /** Cuántas veces el trigger ha re-emitido este alert sin acción del usuario. */
    repeatedCount: integer('repeated_count').notNull().default(0),
    lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqWorkspaceDedup: uniqueIndex('sentinel_alerts_workspace_dedup_unique').on(
      t.workspaceId,
      t.dedupKey,
    ),
    idxStatus: index('sentinel_alerts_status_idx').on(t.workspaceId, t.status),
    idxPillar: index('sentinel_alerts_pillar_idx').on(t.workspaceId, t.pillar),
  }),
);

export type SentinelAlertRow = typeof sentinelAlerts.$inferSelect;
export type NewSentinelAlertRow = typeof sentinelAlerts.$inferInsert;
