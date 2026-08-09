// ---------------------------------------------------------------------------
// Cron endpoint auth — constant-time `Authorization: Bearer ${CRON_SECRET}`.
// ---------------------------------------------------------------------------
//
// Shared por las seis rutas /api/cron/*. Todas están en AUTH_EXEMPT_APIS y en
// CSRF_ALLOWLIST (src/proxy.ts) — su única defensa es este chequeo. Antes cada
// ruta comparaba `authHeader !== 'Bearer ${secret}'` con `!==` (no constante en
// tiempo) y dos de ellas (erp-sync, anomaly-detection) fallaban ABIERTO cuando
// CRON_SECRET no estaba configurado. Centralizamos aquí el mismo patrón fail-
// closed + timingSafeEqual que ya usa admin-auth.ts, comparando SÓLO el
// segmento del token (sin el prefijo `Bearer `) para no filtrar longitud del
// prefijo constante en el chequeo.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

/**
 * Returns a NextResponse to short-circuit the handler when the request is NOT
 * authorized (503 when CRON_SECRET is unset → fail-closed; 401 when the
 * `Authorization: Bearer <token>` header is missing or wrong), or `null` when
 * the request is authorized and the handler should proceed.
 */
export function checkCronAuth(req: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'cron endpoint disabled: CRON_SECRET not configured' },
      { status: 503 },
    );
  }
  const header = req.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(cronSecret, 'utf8');
  // Length check first: timingSafeEqual throws on unequal-length buffers.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
