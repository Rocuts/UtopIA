// ---------------------------------------------------------------------------
// Admin endpoint auth — constant-time `x-admin-token` check.
// ---------------------------------------------------------------------------
//
// Shared by /api/admin/* (telemetry, activity). Centralizes the fail-closed
// behavior: if UTOPIA_ADMIN_TOKEN is unset the endpoint is disabled (503), and
// the token comparison uses timingSafeEqual instead of `!==` so the response
// time can't leak the secret (matches erp/webhook + unsubscribe-token).
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

/**
 * Returns a NextResponse to short-circuit the handler when the request is NOT
 * authorized (503 when UTOPIA_ADMIN_TOKEN is unset → fail-closed; 401 when the
 * `x-admin-token` header is missing or wrong), or `null` when the request is
 * authorized and the handler should proceed.
 */
export function checkAdminToken(req: Request): NextResponse | null {
  const adminToken = process.env.UTOPIA_ADMIN_TOKEN;
  if (!adminToken) {
    return NextResponse.json(
      { error: 'admin endpoint disabled: UTOPIA_ADMIN_TOKEN not configured' },
      { status: 503 },
    );
  }
  const provided = req.headers.get('x-admin-token') ?? '';
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(adminToken, 'utf8');
  // Length check first: timingSafeEqual throws on unequal-length buffers.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
