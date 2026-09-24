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
 * Estado honesto (auditoría 2026-09, ingesta-18): la ruta ERP → balance
 * persistido → informes todavía no existe. Antes el cron llamaba
 * `adapter.fetchTrialBalance`, descartaba el resultado, revalidaba las caches
 * `workspace-balance` / `pillars-*`, recalculaba el balance preprocesado y
 * registraba «ok»: gastaba cuota del ERP y declaraba una sincronización que no
 * guardaba nada. Igual que el webhook (src/app/api/erp/webhook/[provider]),
 * hasta que la importación persista el cron sólo comprueba que la credencial
 * del workspace se puede abrir y registra `not_persisted`:
 *   - sin lectura del ERP,
 *   - sin revalidación de caches,
 *   - sin recalcular balances.
 *
 * Concurrency: all workspaces run via Promise.allSettled — a single failing
 * workspace never blocks others.
 *
 * maxDuration: 300s (configured in vercel.ts ERP sync function entry).
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { erpCredentials } from '@/lib/db/schema';
import { loadCredentials } from '@/lib/erp/credentials';
import { checkCronAuth } from '@/lib/security/cron-auth';

export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Per-workspace outcome
// ---------------------------------------------------------------------------

interface SyncOutcome {
  workspaceId: string;
  provider: string;
  /** `not_persisted`: credencial válida, pero no hay importación persistente. */
  status: 'not_persisted' | 'error';
  duration: number;
  error?: string;
}

async function syncWorkspace(row: typeof erpCredentials.$inferSelect): Promise<SyncOutcome> {
  const start = Date.now();
  const { workspaceId, provider } = row;

  try {
    loadCredentials(row);
  } catch (err) {
    console.error('[cron/erp-sync] credential decrypt failed, skipping workspace', {
      workspaceId,
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      workspaceId,
      provider,
      status: 'error',
      duration: Date.now() - start,
      error: 'credential_decrypt_failed',
    };
  }

  const duration = Date.now() - start;
  console.info(
    `[erp-sync] workspaceId=${workspaceId} provider=${provider} ` +
      'status=not_persisted (ERP import is not wired to persistence yet)',
  );
  return { workspaceId, provider, status: 'not_persisted', duration };
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
    return NextResponse.json({
      ok: true,
      status: 'not_persisted',
      processed: 0,
      notPersisted: 0,
      errors: 0,
    });
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
  const notPersistedCount = outcomes.filter((o) => o.status === 'not_persisted').length;

  console.info(
    `[erp-sync] complete processed=${outcomes.length} not_persisted=${notPersistedCount} errors=${errorCount}`,
  );

  // SECURITY: no devolver `outcomes` (contiene workspaceId) en el body — en
  // fase 1 el UUID del workspace ES el bearer del tenant, así que exponerlo
  // en la respuesta habilitaría enumeración/impersonación. Los console.info
  // de syncWorkspace() ya loggean workspaceId al lugar correcto (logs, no
  // response body). Devolvemos sólo contadores agregados.
  return NextResponse.json({
    ok: true,
    status: 'not_persisted',
    processed: outcomes.length,
    notPersisted: notPersistedCount,
    errors: errorCount,
  });
}
