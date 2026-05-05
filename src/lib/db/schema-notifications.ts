// ─── Schema split: Notifications (Ola 1+1 Élite, WS6) ───────────────────────
//
// notification_subscriptions ← suscripciones por canal (email/web_push/whatsapp)
// notification_log           ← bitácora de envíos para auditoría y reintentos
//
// MVP: solo el canal `email` está activo. Las columnas de Web Push (endpoint,
// p256dh, auth) están presentes para que cuando WS6.1 implemente el canal
// no haya que migrar el schema.

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Ciclo 2-step seguro: workspaces se define antes de `export *` en schema.ts.
import { workspaces } from './schema';

// ---------------------------------------------------------------------------
// notification_subscriptions
// ---------------------------------------------------------------------------

/**
 * Una row por (workspace, canal, recipient_id). `recipient_id` es:
 *   - email: la dirección de correo (lowercased).
 *   - web_push: hash determinístico de `endpoint`.
 *   - whatsapp: el número en formato E.164 sin '+'.
 *
 * `events` = lista de eventos que esta suscripción quiere recibir:
 *   ['period.locked', 'period.locked.with_warnings', 'anomaly.detected',
 *    'reconciliation.broken', 'health_check.failed']
 *
 * Si `events = ['*']` recibe todos. Default `[]` significa NO recibir nada
 * (la suscripción debe especificar explícitamente).
 */
export const notificationSubscriptions = pgTable(
  'notification_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 16 }).notNull(),
    recipientId: text('recipient_id').notNull(),
    email: text('email'),
    webPushEndpoint: text('web_push_endpoint'),
    webPushP256dh: text('web_push_p256dh'),
    webPushAuth: text('web_push_auth'),
    whatsappNumber: text('whatsapp_number'),
    userAgent: text('user_agent'),
    label: text('label'),
    events: jsonb('events')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => ({
    wsChannelRecUniq: uniqueIndex('ns_ws_channel_rec_uniq').on(
      t.workspaceId,
      t.channel,
      t.recipientId,
    ),
    byChannel: index('ns_channel_idx').on(t.workspaceId, t.channel, t.active),
  }),
);

// ---------------------------------------------------------------------------
// notification_log — bitácora de envíos
// ---------------------------------------------------------------------------

/**
 * Cada intento de envío deja una row aquí, para:
 *   - Audit (qué se envió, cuándo, a quién, con qué payload).
 *   - Retry (jobs futuros pueden detectar `status='failed'` y reintentar).
 *   - Idempotencia (si `idempotency_key` ya existe, no se reenvía).
 *
 * `status`:
 *   - 'pending'   ⇒ encolada (futuro, cuando entren Queues).
 *   - 'sent'      ⇒ proveedor aceptó.
 *   - 'delivered' ⇒ webhook de proveedor confirmó entrega (futuro).
 *   - 'failed'    ⇒ proveedor rechazó o error de red.
 *   - 'skipped'   ⇒ idempotency hit u otra razón documentada.
 */
export const notificationLog = pgTable(
  'notification_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(
      () => notificationSubscriptions.id,
      { onDelete: 'set null' },
    ),
    event: varchar('event', { length: 48 }).notNull(),
    channel: varchar('channel', { length: 16 }).notNull(),
    recipientId: text('recipient_id').notNull(),
    payload: jsonb('payload').notNull(),
    providerMessageId: text('provider_message_id'),
    idempotencyKey: text('idempotency_key'),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => ({
    idempotencyUniq: uniqueIndex('nl_idempotency_uniq').on(
      t.workspaceId,
      t.idempotencyKey,
    ),
    byEvent: index('nl_event_idx').on(t.workspaceId, t.event, t.sentAt),
    byStatus: index('nl_status_idx').on(t.workspaceId, t.status, t.sentAt),
  }),
);

// ---------------------------------------------------------------------------
// Types inferidos
// ---------------------------------------------------------------------------

export type NotificationSubscriptionRow =
  typeof notificationSubscriptions.$inferSelect;
export type NewNotificationSubscriptionRow =
  typeof notificationSubscriptions.$inferInsert;

export type NotificationLogRow = typeof notificationLog.$inferSelect;
export type NewNotificationLogRow = typeof notificationLog.$inferInsert;
