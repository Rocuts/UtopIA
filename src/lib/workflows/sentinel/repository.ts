// ---------------------------------------------------------------------------
// Sentinel — repository (Drizzle) para sentinel_alerts.
// ---------------------------------------------------------------------------

import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import {
  type NewSentinelAlertRow,
  type SentinelAlertRow,
  sentinelAlerts,
} from '@/lib/db/schema-sentinel';
import type { Insight } from '@/lib/notifications/insight-types';

type DbInstance = ReturnType<typeof getDb>;

/**
 * Upsert idempotente: si ya existe un row para (workspaceId, dedupKey),
 * actualiza payload + lastNotifiedAt y devuelve el row existente. Si no,
 * inserta uno nuevo con status='pending' y repeatedCount=0.
 */
export async function upsertAlert(
  db: DbInstance,
  insight: Insight,
  meta: { workspaceId: string; periodId?: string | null },
): Promise<{ row: SentinelAlertRow; isNew: boolean }> {
  const insertData: NewSentinelAlertRow = {
    workspaceId: meta.workspaceId,
    periodId: meta.periodId ?? null,
    pillar: insight.pillar,
    triggerCode: insight.triggerCode,
    severity: insight.severity,
    dedupKey: insight.dedupKey,
    status: 'pending',
    payload: insight as unknown as Record<string, unknown>,
    lastNotifiedAt: new Date(),
  };

  const [row] = await db
    .insert(sentinelAlerts)
    .values(insertData)
    .onConflictDoUpdate({
      target: [sentinelAlerts.workspaceId, sentinelAlerts.dedupKey],
      set: {
        payload: insertData.payload,
        severity: insertData.severity,
        triggerCode: insertData.triggerCode,
        // No tocamos status — el escalation lo gestiona aparte.
        updatedAt: new Date(),
      },
    })
    .returning();

  // Detectar si fue insert nuevo: repeatedCount=0 y createdAt en el último
  // segundo. Drizzle no devuelve un flag directo, así que usamos heurística.
  const isNew = row.createdAt.getTime() >= Date.now() - 1500;
  return { row, isNew };
}

export async function findPendingAlertsForWorkspace(
  db: DbInstance,
  workspaceId: string,
): Promise<SentinelAlertRow[]> {
  return db
    .select()
    .from(sentinelAlerts)
    .where(
      and(
        eq(sentinelAlerts.workspaceId, workspaceId),
        inArray(sentinelAlerts.status, ['pending', 'snoozed']),
      ),
    );
}

export async function findAlertById(
  db: DbInstance,
  alertId: string,
): Promise<SentinelAlertRow | null> {
  const rows = await db.select().from(sentinelAlerts).where(eq(sentinelAlerts.id, alertId)).limit(1);
  return rows[0] ?? null;
}

export async function listAlertsForWorkspace(
  db: DbInstance,
  workspaceId: string,
  filters?: {
    status?: ('pending' | 'snoozed' | 'resolved' | 'escalated')[];
    pillar?: ('escudo' | 'valor' | 'verdad' | 'futuro')[];
    limit?: number;
  },
): Promise<SentinelAlertRow[]> {
  const conditions = [eq(sentinelAlerts.workspaceId, workspaceId)];
  if (filters?.status && filters.status.length > 0) {
    conditions.push(inArray(sentinelAlerts.status, filters.status));
  }
  if (filters?.pillar && filters.pillar.length > 0) {
    conditions.push(inArray(sentinelAlerts.pillar, filters.pillar));
  }
  return db
    .select()
    .from(sentinelAlerts)
    .where(and(...conditions))
    .orderBy(sql`${sentinelAlerts.createdAt} DESC`)
    .limit(filters?.limit ?? 100);
}

export async function countAlerts(
  db: DbInstance,
  workspaceId: string,
): Promise<{ pendingTotal: number; pendingCritical: number }> {
  const [row] = await db
    .select({
      total: sql<number>`COUNT(*) FILTER (WHERE ${sentinelAlerts.status} IN ('pending','escalated'))`,
      critical: sql<number>`COUNT(*) FILTER (WHERE ${sentinelAlerts.status} IN ('pending','escalated') AND ${sentinelAlerts.severity} = 'critico')`,
    })
    .from(sentinelAlerts)
    .where(eq(sentinelAlerts.workspaceId, workspaceId));
  return {
    pendingTotal: Number(row?.total ?? 0),
    pendingCritical: Number(row?.critical ?? 0),
  };
}

export async function resolveAlert(db: DbInstance, alertId: string): Promise<SentinelAlertRow | null> {
  const [row] = await db
    .update(sentinelAlerts)
    .set({ status: 'resolved', resolvedAt: new Date(), updatedAt: new Date() })
    .where(eq(sentinelAlerts.id, alertId))
    .returning();
  return row ?? null;
}

export async function snoozeAlert(
  db: DbInstance,
  alertId: string,
  daysFromNow = 7,
): Promise<SentinelAlertRow | null> {
  const until = new Date();
  until.setDate(until.getDate() + daysFromNow);
  const [row] = await db
    .update(sentinelAlerts)
    .set({ status: 'snoozed', snoozedUntil: until, updatedAt: new Date() })
    .where(eq(sentinelAlerts.id, alertId))
    .returning();
  return row ?? null;
}

export async function markEscalated(
  db: DbInstance,
  alertId: string,
  newSeverity: 'critico',
): Promise<SentinelAlertRow | null> {
  const [row] = await db
    .update(sentinelAlerts)
    .set({
      status: 'escalated',
      severity: newSeverity,
      escalatedAt: new Date(),
      lastNotifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(sentinelAlerts.id, alertId))
    .returning();
  return row ?? null;
}

export async function bumpReemitted(
  db: DbInstance,
  alertId: string,
  newSeverity?: 'critico' | 'advertencia' | 'informativo',
): Promise<SentinelAlertRow | null> {
  const update: Partial<SentinelAlertRow> = {
    repeatedCount: sql<number>`${sentinelAlerts.repeatedCount} + 1` as unknown as number,
    lastNotifiedAt: new Date(),
    updatedAt: new Date(),
  };
  if (newSeverity) update.severity = newSeverity;
  const [row] = await db
    .update(sentinelAlerts)
    .set(update)
    .where(eq(sentinelAlerts.id, alertId))
    .returning();
  return row ?? null;
}

export async function unsnoozeAlert(db: DbInstance, alertId: string): Promise<SentinelAlertRow | null> {
  const [row] = await db
    .update(sentinelAlerts)
    .set({ status: 'pending', snoozedUntil: null, lastNotifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(sentinelAlerts.id, alertId))
    .returning();
  return row ?? null;
}
