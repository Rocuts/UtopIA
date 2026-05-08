// ---------------------------------------------------------------------------
// GET  /api/sentinel/alerts                       → lista alerts del workspace
// GET  /api/sentinel/alerts?countOnly=1           → solo contadores (badge)
// PATCH /api/sentinel/alerts                      → resolver / posponer
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getDb } from '@/lib/db/client';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/workflows/sentinel/repository';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const countOnly = url.searchParams.get('countOnly') === '1';
    const statusParam = url.searchParams.get('status');
    const pillarParam = url.searchParams.get('pillar');

    const ws = await getOrCreateWorkspace();
    const db = getDb();

    if (countOnly) {
      const counts = await repo.countAlerts(db, ws.id);
      return NextResponse.json(counts, {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const status = statusParam
      ? statusParam.split(',').filter((s): s is 'pending' | 'snoozed' | 'resolved' | 'escalated' =>
          ['pending', 'snoozed', 'resolved', 'escalated'].includes(s),
        )
      : undefined;
    const pillar = pillarParam
      ? pillarParam.split(',').filter((p): p is 'escudo' | 'valor' | 'verdad' | 'futuro' =>
          ['escudo', 'valor', 'verdad', 'futuro'].includes(p),
        )
      : undefined;

    const rows = await repo.listAlertsForWorkspace(db, ws.id, { status, pillar, limit: 100 });
    const alerts = rows.map((r) => ({
      id: r.id,
      pillar: r.pillar,
      severity: r.severity,
      triggerCode: r.triggerCode,
      status: r.status,
      dedupKey: r.dedupKey,
      ...(r.payload as Record<string, unknown>),
      createdAt: r.createdAt.toISOString(),
      snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      escalatedAt: r.escalatedAt?.toISOString() ?? null,
      repeatedCount: r.repeatedCount,
    }));
    return NextResponse.json(
      { alerts },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sentinel_alerts_get_failed';
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

const patchBodySchema = z.object({
  alertId: z.string().uuid(),
  action: z.enum(['resolve', 'snooze', 'unsnooze']),
  /** Solo para snooze: días desde ahora. Default 7. */
  days: z.number().int().min(1).max(60).optional(),
});

export async function PATCH(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = patchBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();
    const { alertId, action, days } = parsed.data;

    // Confirmar que el alert pertenece al workspace antes de actuar.
    const alert = await repo.findAlertById(db, alertId);
    if (!alert || alert.workspaceId !== ws.id) {
      return NextResponse.json(
        { error: 'alert_not_found' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (action === 'resolve') {
      const row = await repo.resolveAlert(db, alertId);
      return NextResponse.json({ ok: true, alert: row }, { status: 200 });
    }
    if (action === 'snooze') {
      const row = await repo.snoozeAlert(db, alertId, days ?? 7);
      return NextResponse.json({ ok: true, alert: row }, { status: 200 });
    }
    if (action === 'unsnooze') {
      const row = await repo.unsnoozeAlert(db, alertId);
      return NextResponse.json({ ok: true, alert: row }, { status: 200 });
    }
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sentinel_alerts_patch_failed';
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
