/**
 * GET /api/cron/erp-sync
 *
 * Vercel Cron polling job for ERPs that do NOT support push webhooks.
 * Runs every 2 hours (schedule configured in vercel.ts).
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` only (checkCronAuth, timing-safe).
 * The `x-vercel-cron-id` header is NOT trusted — it's a plain request header
 * any client can spoof. Fail-closed: sin CRON_SECRET configurado, 503.
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
import { loadCredentials } from '@/lib/erp/credentials';
import { getLatestOpenPeriod, getCachedPreprocessedBalance } from '@/lib/cache/preprocessed-balance';
import { checkCronAuth } from '@/lib/security/cron-auth';

export const maxDuration = 300;

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
    let credentials: ERPCredentials;
    try {
      credentials = loadCredentials(row);
    } catch (err) {
      console.error('[cron/erp-sync] credential decrypt failed, skipping workspace', {
        workspaceId,
        provider,
        error: err instanceof Error ? err.message : String(err),
      });
      const duration = Date.now() - start;
      return { workspaceId, provider, status: 'error', duration, error: 'credential_decrypt_failed' };
    }

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
  const authError = checkCronAuth(req);
  if (authError) return authError;

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
    return NextResponse.json({ ok: true, processed: 0, errors: 0 });
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

  // SECURITY: no devolver `outcomes` (contiene workspaceId) en el body — en
  // fase 1 el UUID del workspace ES el bearer del tenant, así que exponerlo
  // en la respuesta habilitaría enumeración/impersonación. Los console.info
  // de syncWorkspace() ya loggean workspaceId al lugar correcto (logs, no
  // response body). Devolvemos sólo contadores agregados.
  return NextResponse.json({
    ok: true,
    processed: outcomes.length,
    errors: errorCount,
  });
}
