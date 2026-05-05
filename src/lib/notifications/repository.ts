import 'server-only';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { notificationLog, notificationSubscriptions } from '@/lib/db/schema';
import type { NewNotificationLogRow, NotificationSubscriptionRow } from '@/lib/db/schema';
import type { NotificationChannel, NotificationEvent } from './types';

// ---------------------------------------------------------------------------
// getActiveSubscriptions
// ---------------------------------------------------------------------------

/**
 * Returns all active subscriptions for a workspace that have opted in to the
 * given event.  Supports both exact-event subscriptions and wildcard `['*']`.
 *
 * Optionally filtered by `channels` (default: all).
 */
export async function getActiveSubscriptions(
  workspaceId: string,
  event: NotificationEvent,
  channels?: NotificationChannel[],
): Promise<NotificationSubscriptionRow[]> {
  const db = getDb();

  let rows = await db
    .select()
    .from(notificationSubscriptions)
    .where(
      and(
        eq(notificationSubscriptions.workspaceId, workspaceId),
        eq(notificationSubscriptions.active, true),
      ),
    );

  // Filter by channel if requested.
  if (channels && channels.length > 0) {
    rows = rows.filter((r) => channels.includes(r.channel as NotificationChannel));
  }

  // Filter by event: subscription must include the event OR the wildcard '*'.
  rows = rows.filter((r) => {
    const events = (r.events ?? []) as string[];
    return events.includes('*') || events.includes(event);
  });

  return rows;
}

// ---------------------------------------------------------------------------
// checkIdempotency
// ---------------------------------------------------------------------------

/**
 * Returns existing log rows for a (workspaceId, idempotencyKey) pair that
 * have already been sent or skipped.  An empty array means "not seen yet".
 */
export async function checkIdempotency(
  workspaceId: string,
  idempotencyKey: string,
) {
  const db = getDb();
  return db
    .select()
    .from(notificationLog)
    .where(
      and(
        eq(notificationLog.workspaceId, workspaceId),
        eq(notificationLog.idempotencyKey, idempotencyKey),
        inArray(notificationLog.status, ['sent', 'skipped']),
      ),
    );
}

// ---------------------------------------------------------------------------
// insertLog
// ---------------------------------------------------------------------------

export async function insertLog(row: NewNotificationLogRow) {
  const db = getDb();
  const [inserted] = await db
    .insert(notificationLog)
    .values(row)
    .onConflictDoNothing({ target: [notificationLog.workspaceId, notificationLog.idempotencyKey] })
    .returning();
  return inserted ?? null;
}

// ---------------------------------------------------------------------------
// insertLogs — batch version used by dispatch
// ---------------------------------------------------------------------------

export async function insertLogs(rows: NewNotificationLogRow[]) {
  if (rows.length === 0) return;
  const db = getDb();
  await db.insert(notificationLog).values(rows).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Subscription CRUD helpers (used by API routes)
// ---------------------------------------------------------------------------

export async function createSubscription(
  workspaceId: string,
  channel: NotificationChannel,
  email: string,
  events: NotificationEvent[],
  label?: string,
) {
  const db = getDb();
  const [row] = await db
    .insert(notificationSubscriptions)
    .values({
      workspaceId,
      channel,
      recipientId: email.toLowerCase(),
      email: email.toLowerCase(),
      events,
      label: label ?? null,
      active: true,
    })
    .onConflictDoUpdate({
      target: [
        notificationSubscriptions.workspaceId,
        notificationSubscriptions.channel,
        notificationSubscriptions.recipientId,
      ],
      set: { events, active: true, label: label ?? null },
    })
    .returning();
  return row;
}

export async function listSubscriptions(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(notificationSubscriptions)
    .where(eq(notificationSubscriptions.workspaceId, workspaceId));
}

export async function updateSubscriptionActive(
  id: string,
  workspaceId: string,
  active: boolean,
) {
  const db = getDb();
  const [row] = await db
    .update(notificationSubscriptions)
    .set({ active })
    .where(
      and(
        eq(notificationSubscriptions.id, id),
        eq(notificationSubscriptions.workspaceId, workspaceId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteSubscription(id: string, workspaceId: string) {
  const db = getDb();
  await db
    .delete(notificationSubscriptions)
    .where(
      and(
        eq(notificationSubscriptions.id, id),
        eq(notificationSubscriptions.workspaceId, workspaceId),
      ),
    );
}

export async function findSubscriptionById(id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(notificationSubscriptions)
    .where(eq(notificationSubscriptions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Recent notification log (for AlertDashboard)
// ---------------------------------------------------------------------------

export async function getRecentLog(workspaceId: string, days = 30) {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(notificationLog)
    .where(
      and(
        eq(notificationLog.workspaceId, workspaceId),
        isNotNull(notificationLog.sentAt),
      ),
    )
    .orderBy(notificationLog.sentAt)
    .limit(200);
}
