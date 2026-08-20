// ─── Schema split: API público de clientes (/api/v1) ────────────────────────
//
// Tablas del API B2B server-to-server. Spec autoritativa:
// docs/spec/api-clientes-v1.md (§5 modelo de datos, §8 llaves, §9 webhooks).
//
// Modelo:
//   api_keys              ← llaves utop_sk_* por workspace (HMAC-pepper en reposo)
//   api_idempotency_keys  ← replay/mismatch/concurrencia de Idempotency-Key (TTL 24 h)
//   api_trial_balances    ← remisiones de balance PUC (raw cifrado, summary sin PII)
//   api_webhook_endpoints ← endpoints Standard Webhooks del workspace
//   api_webhook_messages  ← 1 mensaje por (evento, endpoint) con estado de entrega
//   api_webhook_attempts  ← bitácora de cada intento (schedule Svix, 8 max)
//
// Los PK uuid los genera la APP como UUIDv7 (src/lib/api/ids.ts) — el uuid ES
// el ID público (`tb_…`) decodificado, así que NO llevan defaultRandom.
// `raw_rows_encrypted` y `secret_encrypted` usan el vault AES-256-GCM
// (src/lib/security/vault.ts) — Ley 1581: la contabilidad remitida puede
// contener nombres de personas naturales.

import {
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// Ciclo 2-step seguro: ver nota en schema.ts sobre los splits (FK lazy).
import { workspaces } from './schema';

// ---------------------------------------------------------------------------
// api_keys — credenciales de cliente (máquina-a-máquina, nunca usuarios)
// ---------------------------------------------------------------------------

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** hex de HMAC-SHA256(pepper, token). Lo único persistido de la llave. */
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    /** Versión del pepper usada — rotación sin re-emitir llaves de golpe. */
    pepperVersion: smallint('pepper_version').notNull().default(1),
    /** p.ej. 'utop_sk_live_' — para UI/listados, jamás el token. */
    prefix: text('prefix').notNull(),
    last4: varchar('last4', { length: 4 }).notNull(),
    /** Scopes granulares deny-by-default: 'trial_balances:read', … */
    scopes: text('scopes').array().notNull(),
    rpmRead: integer('rpm_read').notNull().default(120),
    rpmWrite: integer('rpm_write').notNull().default(20),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    createdBy: text('created_by'),
    /** Rotación con gracia 7 días (patrón Stripe): nueva → vieja. */
    rotatedFromKeyId: uuid('rotated_from_key_id').references(
      (): AnyPgColumn => apiKeys.id,
      { onDelete: 'set null' },
    ),
    /** Actualizado con throttle de 1/min — no castiga cada request. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('api_keys_key_hash_idx').on(t.keyHash),
    index('api_keys_workspace_idx').on(t.workspaceId),
  ],
);

export type ApiKeyRow = typeof apiKeys.$inferSelect;

// ---------------------------------------------------------------------------
// api_idempotency_keys — semántica Stripe + códigos del draft IETF
// ---------------------------------------------------------------------------

export const apiIdempotencyKeys = pgTable(
  'api_idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Identificador lógico del endpoint, p.ej. 'trial-balances.create'. */
    endpoint: text('endpoint').notNull(),
    idemKey: varchar('idem_key', { length: 255 }).notNull(),
    /** sha256 hex del body crudo — detecta reuso con payload distinto (422). */
    requestFingerprint: varchar('request_fingerprint', { length: 64 }).notNull(),
    /** 'processing' (en vuelo → 409) | 'completed' (replay). */
    status: text('status').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<unknown>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('api_idem_scope_idx').on(t.workspaceId, t.endpoint, t.idemKey),
  ],
);

export type ApiIdempotencyKeyRow = typeof apiIdempotencyKeys.$inferSelect;

// ---------------------------------------------------------------------------
// api_trial_balances — remisiones externas (NO tocan journal_lines)
// ---------------------------------------------------------------------------

export const apiTrialBalances = pgTable(
  'api_trial_balances',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** 'csv' | 'rows' — cómo llegó la remisión. */
    source: text('source').notNull(),
    periodLabel: text('period_label').notNull(),
    /** Envelope vault AES-256-GCM del JSON de RawAccountRow[]. */
    rawRowsEncrypted: text('raw_rows_encrypted').notNull(),
    rowCount: integer('row_count').notNull(),
    /** 'balanced' | 'unbalanced' — ecuación en cents del snapshot primario. */
    status: text('status').notNull(),
    /** Resumen SIN PII: totales cents como string, delta, counts de findings. */
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
    preprocessorVersion: text('preprocessor_version').notNull(),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('api_tb_workspace_created_idx').on(t.workspaceId, t.createdAt)],
);

export type ApiTrialBalanceRow = typeof apiTrialBalances.$inferSelect;

// ---------------------------------------------------------------------------
// api_webhook_endpoints — receptores Standard Webhooks del workspace
// ---------------------------------------------------------------------------

export const apiWebhookEndpoints = pgTable(
  'api_webhook_endpoints',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    description: text('description'),
    /** Suscripción por tipo: 'ping', 'trial_balance.processed'. */
    events: text('events').array().notNull(),
    /** Envelope vault del secreto whsec_ (debe ser recuperable para firmar). */
    secretEncrypted: text('secret_encrypted').notNull(),
    /** 'enabled' | 'disabled'. */
    status: text('status').notNull().default('enabled'),
    /** Inicio del fallo continuo; null al primer 2xx. Desactivación a los 5 días. */
    firstFailingAt: timestamp('first_failing_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('api_whe_workspace_idx').on(t.workspaceId)],
);

export type ApiWebhookEndpointRow = typeof apiWebhookEndpoints.$inferSelect;

// ---------------------------------------------------------------------------
// api_webhook_messages — un mensaje por (evento × endpoint)
// ---------------------------------------------------------------------------

export const apiWebhookMessages = pgTable(
  'api_webhook_messages',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => apiWebhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    /** 'pending' | 'delivered' | 'exhausted'. */
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('api_whm_status_next_idx').on(t.status, t.nextAttemptAt)],
);

export type ApiWebhookMessageRow = typeof apiWebhookMessages.$inferSelect;

// ---------------------------------------------------------------------------
// api_webhook_attempts — bitácora por intento
// ---------------------------------------------------------------------------

export const apiWebhookAttempts = pgTable(
  'api_webhook_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => apiWebhookMessages.id, { onDelete: 'cascade' }),
    attemptN: integer('attempt_n').notNull(),
    responseStatus: integer('response_status'),
    error: text('error'),
    elapsedMs: integer('elapsed_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('api_wha_message_idx').on(t.messageId)],
);

export type ApiWebhookAttemptRow = typeof apiWebhookAttempts.$inferSelect;
