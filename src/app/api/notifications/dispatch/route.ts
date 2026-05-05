import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { notificationsPort, isNotificationsEnabled } from '@/lib/notifications';

// ---------------------------------------------------------------------------
// POST /api/notifications/dispatch
//
// Internal endpoint — called by WS5 workflow `notify` step (server-to-server).
// Auth: x-utopia-internal-secret header must match process.env.UTOPIA_INTERNAL_SECRET.
//
// This route is in the CSRF allowlist (src/proxy.ts) because it receives
// server-to-server traffic with no browser Origin header.
// ---------------------------------------------------------------------------

const DispatchBodySchema = z.object({
  workspaceId: z.string().uuid(),
  event: z.enum([
    'period.locked',
    'period.locked.with_warnings',
    'reconciliation.broken',
    'health_check.failed',
    'anomaly.detected',
  ]),
  idempotencyKey: z.string().min(1).max(256),
  channels: z
    .array(z.enum(['email', 'web_push', 'whatsapp']))
    .optional(),
  payload: z.record(z.string(), z.unknown()),
});

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = process.env.UTOPIA_INTERNAL_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'notifications_unavailable', reason: 'internal_secret_unset' },
      { status: 503 },
    );
  }

  const providedSecret = req.headers.get('x-utopia-internal-secret');
  if (!providedSecret || providedSecret !== secret) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401 },
    );
  }

  // ── Feature flag ──────────────────────────────────────────────────────────
  if (!isNotificationsEnabled()) {
    return NextResponse.json(
      { error: 'notifications_disabled' },
      { status: 503 },
    );
  }

  // ── Body validation ───────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = DispatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────
  try {
    const result = await notificationsPort.dispatch(parsed.data as unknown as Parameters<typeof notificationsPort.dispatch>[0]);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'dispatch_failed';
    console.error('[api/notifications/dispatch] error', err);
    return NextResponse.json(
      { error: 'dispatch_failed', message },
      { status: 500 },
    );
  }
}
