/**
 * GET /api/cron/erp-sync
 *
 * Vercel Cron polling job for ERPs that do NOT support push webhooks.
 * Runs every 2 hours (schedule configured in vercel.ts).
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` OR Vercel-signed header
 * `x-vercel-cron-id`. Both are checked so the route works both in production
 * (Vercel Cron) and locally (curl with CRON_SECRET).
 *
 * Flow per workspace+provider:
 *   1. Load erp_credentials row (provider + metadata with connection config).
 *   2. Call ERPAdapter.fetchTrialBalance(currentPeriod).
 *   3. Revalidate Next.js cache tags.
 *   4. Log workspaceId + provider + duration.
 *
 * Concurrency: all workspaces run via Promise.allSettled — a single failing
 * workspace never blocks others.
 *
 * maxDuration: 300s (configured in vercel.ts ERP sync function entry).
 */

import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { erpCredentials } from '@/lib/db/schema';
import { ERPAdapter } from '@/lib/erp/adapter';
import type { ERPCredentials } from '@/lib/erp/types';
import { getLatestOpenPeriod, getCachedPreprocessedBalance } from '@/lib/cache/preprocessed-balance';

export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function isAuthorized(req: Request): boolean {
  const cronHeader = req.headers.get('x-vercel-cron-id');
  if (cronHeader) return true;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // No secret configured — allow in local dev, reject in production.
    return process.env.NODE_ENV !== 'production';
  }
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${cronSecret}`;
}

// ---------------------------------------------------------------------------
// Current period helper — YYYY-MM for the current calendar month.
// ---------------------------------------------------------------------------

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Per-workspace sync
// ---------------------------------------------------------------------------

interface SyncOutcome {
  workspaceId: string;
  provider: string;
  status: 'ok' | 'error';
  duration: number;
  error?: string;
}

async function syncWorkspace(row: typeof erpCredentials.$inferSelect): Promise<SyncOutcome> {
  const start = Date.now();
  const { workspaceId, provider } = row;

  try {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;

    const credentials: ERPCredentials = {
      provider: provider as ERPCredentials['provider'],
      apiKey: typeof meta.apiKey === 'string' ? meta.apiKey : undefined,
      apiToken: typeof meta.apiToken === 'string' ? meta.apiToken : undefined,
      username: typeof meta.username === 'string' ? meta.username : undefined,
      companyId: typeof meta.companyId === 'string' ? meta.companyId : undefined,
      baseUrl: typeof meta.baseUrl === 'string' ? meta.baseUrl : undefined,
      accessToken: typeof meta.accessToken === 'string' ? meta.accessToken : undefined,
      tenantId: typeof meta.tenantId === 'string' ? meta.tenantId : undefined,
    };

    const period = currentPeriod();
    const adapter = new ERPAdapter({ provider: credentials.provider, credentials });
    await adapter.fetchTrialBalance(period);

    // Revalidate cached consumers — 'max' for ERP-sourced data (fresh signal).
    revalidateTag('workspace-balance', 'max');
    revalidateTag(`pillars-${workspaceId}`, 'max');

    // Refresh preprocessed balance for the latest open accounting period.
    const latestPeriod = await getLatestOpenPeriod(workspaceId);
    if (latestPeriod) {
      await getCachedPreprocessedBalance(workspaceId, latestPeriod.id);
    }

    const duration = Date.now() - start;
    console.info(
      `[erp-sync] ok workspaceId=${workspaceId} provider=${provider} period=${period} duration=${duration}ms`,
    );
    return { workspaceId, provider, status: 'ok', duration };
  } catch (err) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[erp-sync] error workspaceId=${workspaceId} provider=${provider} duration=${duration}ms`,
      message,
    );
    return { workspaceId, provider, status: 'error', duration, error: message };
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();

  // Load all ERP credential rows. The `enabled` flag lives in `metadata.enabled`
  // (no dedicated column yet). Rows without `enabled: false` are treated as active.
  const rows = await db.select().from(erpCredentials);

  const activeRows = rows.filter((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    // If `enabled` is explicitly false, skip. Otherwise assume active.
    return meta.enabled !== false;
  });

  if (activeRows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, outcomes: [] });
  }

  const results = await Promise.allSettled(activeRows.map(syncWorkspace));

  const outcomes: SyncOutcome[] = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    // Should not happen — syncWorkspace never throws — but defensive:
    return {
      workspaceId: activeRows[i].workspaceId,
      provider: activeRows[i].provider,
      status: 'error' as const,
      duration: 0,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

  const errorCount = outcomes.filter((o) => o.status === 'error').length;

  console.info(
    `[erp-sync] complete processed=${outcomes.length} errors=${errorCount}`,
  );

  return NextResponse.json({
    ok: true,
    processed: outcomes.length,
    errors: errorCount,
    outcomes,
  });
}
