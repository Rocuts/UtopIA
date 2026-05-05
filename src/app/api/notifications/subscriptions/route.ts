import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/notifications/repository';

// ---------------------------------------------------------------------------
// GET  /api/notifications/subscriptions  — list subscriptions for workspace
// POST /api/notifications/subscriptions  — create or upsert a subscription
//
// MVP: only `channel === 'email'` is accepted. web_push and whatsapp are
// rejected with 400 channel_disabled_in_mvp (D3 decision).
// ---------------------------------------------------------------------------

const CreateSubscriptionSchema = z.object({
  channel: z.enum(['email', 'web_push', 'whatsapp']),
  email: z.string().email().optional(),
  events: z
    .array(
      z.enum([
        'period.locked',
        'period.locked.with_warnings',
        'reconciliation.broken',
        'health_check.failed',
        'anomaly.detected',
      ]),
    )
    .min(1, 'Debes seleccionar al menos un evento'),
  label: z.string().max(128).optional(),
  // web_push fields (deferred — D3)
  webPushEndpoint: z.string().optional(),
  webPushP256dh: z.string().optional(),
  webPushAuth: z.string().optional(),
  // whatsapp fields (deferred — D3)
  whatsappNumber: z.string().optional(),
});

export async function GET() {
  try {
    const workspace = await getOrCreateWorkspace();
    const items = await repo.listSubscriptions(workspace.id);
    return NextResponse.json({ items });
  } catch (err) {
    console.error('[api/notifications/subscriptions] GET error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = CreateSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { channel, email, events, label } = parsed.data;

  // MVP: only email channel is supported (D3 decision).
  if (channel !== 'email') {
    return NextResponse.json(
      {
        error: 'channel_disabled_in_mvp',
        message:
          'Solo el canal email está disponible en esta versión. Web Push y WhatsApp estarán disponibles próximamente.',
      },
      { status: 400 },
    );
  }

  if (!email) {
    return NextResponse.json(
      { error: 'validation_error', message: 'El campo email es requerido para el canal email.' },
      { status: 400 },
    );
  }

  try {
    const workspace = await getOrCreateWorkspace();
    const row = await repo.createSubscription(
      workspace.id,
      'email',
      email,
      events,
      label,
    );
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    console.error('[api/notifications/subscriptions] POST error', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
