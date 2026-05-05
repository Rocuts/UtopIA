import 'server-only';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { queryPillarKpisRaw, type PillarKpis } from './pillar-view';

// ---------------------------------------------------------------------------
// Pillar KPI cache — wraps queryPillarKpisRaw with Next.js unstable_cache.
//
// Tags: `pillar-kpis:<workspaceId>` — invalidated by postEntry hook (WS6).
// Revalidate: 60s as a TTL safety net even without explicit invalidation.
//
// getCachedPillarKpis is the PRIMARY consumer interface.
// invalidatePillarKpis is called from postEntry (service.ts) — best-effort,
// never throws so the accounting operation is never blocked by cache issues.
// ---------------------------------------------------------------------------

const TAG_PREFIX = 'pillar-kpis:';

export function pillarKpisTag(workspaceId: string): string {
  return `${TAG_PREFIX}${workspaceId}`;
}

export function getCachedPillarKpis(
  workspaceId: string,
  periodId: string,
): Promise<PillarKpis> {
  const fn = unstable_cache(
    async () => queryPillarKpisRaw(getDb(), workspaceId, periodId),
    [`pillar-kpis`, workspaceId, periodId],
    { tags: [pillarKpisTag(workspaceId)], revalidate: 60 },
  );
  return fn();
}

export async function invalidatePillarKpis(
  workspaceId: string,
  _periodId: string,
): Promise<void> {
  // Best-effort — never throws. The postEntry hook wraps this in try/catch.
  // Next.js 16: revalidateTag requires (tag, profile) — 'default' = 5 min stale / 15 min revalidate.
  revalidateTag(pillarKpisTag(workspaceId), 'default');
}
