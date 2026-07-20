// ---------------------------------------------------------------------------
// GET /api/admin/activity — feed unificado de actividad del sistema.
// ---------------------------------------------------------------------------
//
// Combina system_activity_log + agent_telemetry + notification_log +
// tax_engine_audits en un solo timeline filtrable. Es la fuente del visor
// en /admin (ver src/lib/observability/activity-feed.ts).
//
// Query params:
//   ?hours=N         ventana de tiempo (1..720, default 24)
//   ?sources=a,b     activity|agent|notification|tax (default todas)
//   ?categories=a,b  filtra por categoría normalizada
//   ?levels=a,b      debug|info|warn|error
//   ?q=texto         búsqueda libre (message/action/category)
//   ?limit=N         (1..200, default 100)
//   ?offset=N        (>=0, default 0)
//
// SEGURIDAD: idéntico modelo que /api/admin/telemetry — header `x-admin-token`
// comparado contra `UTOPIA_ADMIN_TOKEN`. Sin la env → 503 (fail-closed).
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import {
  queryActivityFeed,
  ALL_SOURCES,
  type ActivitySource,
} from '@/lib/observability/activity-feed';
import type { ActivityLevel } from '@/lib/db/activity-log';
import { checkAdminToken } from '@/lib/security/admin-auth';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const VALID_LEVELS: ActivityLevel[] = ['debug', 'info', 'warn', 'error'];

function csv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req: Request) {
  const denied = checkAdminToken(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const hours = Math.min(
    Math.max(parseInt(url.searchParams.get('hours') ?? '24', 10) || 24, 1),
    720,
  );
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 1),
    200,
  );
  const offset = Math.max(
    parseInt(url.searchParams.get('offset') ?? '0', 10) || 0,
    0,
  );

  const sources = csv(url.searchParams.get('sources')).filter((s): s is ActivitySource =>
    (ALL_SOURCES as string[]).includes(s),
  );
  const levels = csv(url.searchParams.get('levels')).filter(
    (l): l is ActivityLevel => (VALID_LEVELS as string[]).includes(l),
  );
  const categories = csv(url.searchParams.get('categories'));
  const q = url.searchParams.get('q') ?? undefined;

  try {
    const result = await queryActivityFeed({
      hours,
      limit,
      offset,
      sources: sources.length ? sources : undefined,
      levels: levels.length ? levels : undefined,
      categories: categories.length ? categories : undefined,
      q,
    });

    return NextResponse.json(
      {
        ...result,
        page: { limit, offset, hasMore: offset + result.events.length < result.total },
        availableSources: ALL_SOURCES,
        availableLevels: VALID_LEVELS,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[admin/activity] query failed:', err);
    return NextResponse.json(
      {
        error: 'activity query failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
