// ---------------------------------------------------------------------------
// /api/cron/sentinel — Ejecutor periódico del Sentinel (cada 6h en producción).
// ---------------------------------------------------------------------------
// Vercel Cron lo invoca con header `x-vercel-cron-id`. Itera todos los
// workspaces con periodos abiertos y dispara `runSentinelCheck` por cada uno.
//
// Carga el último TB preprocesado del workspace vía el cache de balances
// (getCachedPreprocessedBalance). Si no hay periodo abierto o la carga falla,
// pasa `preprocessed=null` y el orquestador devuelve `pillars: null`
// ("sin datos" — nunca un 'critical' inventado).
//
// Respuesta: { ok: true, processed: number, errors: Record<string, string> }
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { workspaces, accountingPeriods } from '@/lib/db/schema';
import { runSentinelCheck } from '@/lib/workflows/sentinel/orchestrator';
import {
  findComparativePeriod,
  getCachedPreprocessedBalance,
  getLatestOpenPeriod,
} from '@/lib/cache/preprocessed-balance';
import { checkCronAuth } from '@/lib/security/cron-auth';

export const maxDuration = 300;

export async function GET(req: Request) {
  // Fail-closed: CRON_SECRET must be configured; bearer token must match
  // (timingSafeEqual vía helper compartido — antes `!==` de strings).
  const authError = checkCronAuth(req);
  if (authError) return authError;

  try {
    const db = getDb();
    // Workspaces con al menos un periodo 'open' — los demás se omiten.
    const rows = await db
      .selectDistinct({ workspaceId: workspaces.id })
      .from(workspaces)
      .innerJoin(accountingPeriods, eq(accountingPeriods.workspaceId, workspaces.id))
      .where(eq(accountingPeriods.status, 'open'));

    const errors: Record<string, string> = {};
    let processed = 0;
    for (const r of rows) {
      try {
        // Resolver último periodo abierto del workspace + cargar preprocessed
        // (con curator inyectado). Si la carga falla, igual disparamos el
        // workflow con preprocessed=null (los triggers se omiten gracefully).
        const period = await getLatestOpenPeriod(r.workspaceId);
        let preprocessed = null;
        if (period) {
          try {
            const comparative = await findComparativePeriod(r.workspaceId, period);
            const result = await getCachedPreprocessedBalance(
              r.workspaceId,
              period.id,
              comparative?.id,
            );
            preprocessed = result.balance;
          } catch (loadErr) {
            console.warn(`[cron/sentinel] load failed for ${r.workspaceId}:`, loadErr);
          }
        }
        await runSentinelCheck(
          { workspaceId: r.workspaceId, periodId: period?.id ?? null, dryRun: false },
          preprocessed,
        );
        processed += 1;
      } catch (err) {
        errors[r.workspaceId] = err instanceof Error ? err.message : String(err);
      }
    }

    return NextResponse.json(
      { ok: true, processed, errors },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sentinel_cron_failed';
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
