// ---------------------------------------------------------------------------
// /api/cron/sentinel — Ejecutor periódico del Sentinel (cada 6h en producción).
// ---------------------------------------------------------------------------
// Vercel Cron lo invoca con header `x-vercel-cron-id`. Itera todos los
// workspaces con periodos abiertos y dispara `runSentinelCheck` por cada uno.
//
// Por ahora pasa `preprocessed=null` — el orquestador detecta el caso y
// emite findings vacíos. Una iteración posterior cargará el último TB
// preprocesado por workspace desde una tabla `preprocessed_balance_snapshots`
// (TODO Ola Élite +1).
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

export const maxDuration = 300;

export async function GET(req: Request) {
  // Vercel Cron envía un header firmado. Para MVP aceptamos también un
  // bearer en el header `Authorization` (configurable vía env CRON_SECRET).
  const cronHeader = req.headers.get('x-vercel-cron-id');
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  const authorized = Boolean(cronHeader) || (expected && auth === expected);
  if (!authorized) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

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
