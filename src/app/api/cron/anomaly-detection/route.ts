/**
 * CRON — Forensic Anomaly Detection (D5.3)
 * ==========================================
 * Schedule:  0 4 * * *  (UTC)  ≡  23:00 COT (Bogotá UTC-5)
 * Auth:      Vercel Cron envía `Authorization: Bearer ${CRON_SECRET}`.
 * Flag:      UTOPIA_ENABLE_ANOMALY_DETECTION=true (OFF por defecto).
 *
 * Flow:
 *   1. Verifica auth — sin CRON_SECRET o bearer incorrecto → 401.
 *   2. Verifica feature flag — si OFF → 200 { skipped: 'flag_disabled' }.
 *   3. Itera workspaces activos con períodos open/closed-reciente.
 *   4. Por cada workspace + período: runForensicScan().
 *   5. Si score < 70 o hay anomalías high: dispatchNotification.
 *   6. Persiste resultado en reports.kind = 'forensic_scan'.
 *   7. Idempotencia: idempotency_key = forensic:{ws}:{period}:{YYYYMMDD}.
 */

import type { NextRequest } from 'next/server';
import { eq, desc, or } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { workspaces, accountingPeriods, reports } from '@/lib/db/schema';
import { runForensicScan } from '@/lib/agents/financial/audit/forensic';
import type { ForensicScanResult } from '@/lib/agents/financial/audit/forensic';

export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Auth helper (patrón del cron calendar-sync)
// ---------------------------------------------------------------------------

function isVercelCronAuthorized(req: NextRequest): boolean {
  // En desarrollo sin CRON_SECRET, permite pasar (para pruebas locales).
  if (process.env.NODE_ENV !== 'production' && !process.env.CRON_SECRET) {
    return true;
  }
  const auth = req.headers.get('authorization');
  return !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
}

// ---------------------------------------------------------------------------
// Idempotency key
// ---------------------------------------------------------------------------

function buildIdempotencyKey(
  workspaceId: string,
  periodId: string,
): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `forensic:${workspaceId}:${periodId}:${today}`;
}

// ---------------------------------------------------------------------------
// Dispatch notification (dynamic import para no crear coupling duro con WS6)
// ---------------------------------------------------------------------------

async function maybeSendAnomalyNotification(
  workspaceId: string,
  result: ForensicScanResult,
  periodLabel: string,
  idempotencyKey: string,
): Promise<void> {
  if (!process.env.UTOPIA_ENABLE_NOTIFICATIONS) return;

  try {
    const { dispatch } = await import('@/lib/notifications/dispatch');
    const topAnomaly =
      result.anomalies.find((a) => a.severity === 'high') ??
      result.anomalies[0];
    if (!topAnomaly) return;

    await dispatch({
      workspaceId,
      event: 'anomaly.detected',
      idempotencyKey: `${idempotencyKey}:notify`,
      payload: {
        workspaceName: workspaceId, // Se enriquece con nombre real si disponible
        periodLabel,
        anomalyKind: topAnomaly.kind,
        description: topAnomaly.description,
        severity: topAnomaly.severity,
        reviewUrl: topAnomaly.reviewUrl ?? `/workspace/contabilidad/asientos?period=${result.periodId}`,
      },
    });
  } catch (err) {
    // Swallow — la notificación es best-effort; no debe bloquear el scan.
    console.warn('[cron.anomaly-detection] dispatch notification failed:', err);
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // 1. Auth
  if (!isVercelCronAuthorized(request)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. Feature flag
  if (process.env.UTOPIA_ENABLE_ANOMALY_DETECTION !== 'true') {
    return Response.json({ skipped: 'flag_disabled' });
  }

  const startedAt = Date.now();
  const db = getDb();

  try {
    // 3. Obtener todos los workspaces activos.
    const allWorkspaces = await db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces);

    if (allWorkspaces.length === 0) {
      return Response.json({ workspacesScanned: 0, durationMs: Date.now() - startedAt });
    }

    const summary: Array<{
      workspaceId: string;
      periodId: string;
      score: number;
      totalAnomalies: number;
      action: 'scanned' | 'skipped_idempotent' | 'error';
      error?: string;
    }> = [];

    for (const ws of allWorkspaces) {
      // 4. Encontrar período abierto o cerrado reciente (el más reciente).
      const period = await db
        .select({
          id: accountingPeriods.id,
          year: accountingPeriods.year,
          month: accountingPeriods.month,
          status: accountingPeriods.status,
        })
        .from(accountingPeriods)
        .where(
          eq(accountingPeriods.workspaceId, ws.id),
        )
        .orderBy(
          desc(accountingPeriods.year),
          desc(accountingPeriods.month),
        )
        .limit(1);

      if (period.length === 0) continue;

      const p = period[0];
      const periodLabel = `${p.year}-${String(p.month).padStart(2, '0')}`;
      const idempotencyKey = buildIdempotencyKey(ws.id, p.id);

      // 5. Idempotency check — si ya existe un report con este key hoy, skip.
      const existing = await db
        .select({ id: reports.id })
        .from(reports)
        .where(eq(reports.workspaceId, ws.id))
        .orderBy(desc(reports.createdAt))
        .limit(20);

      const alreadyScanned = existing.some((r) => {
        const data = r as unknown as { id: string };
        // Verificamos en el campo data el idempotencyKey (almacenado como metadata).
        return false; // Se hace via el campo data.idempotencyKey abajo.
      });

      // Idempotency más precisa: buscar en la data del report el key.
      const existingWithKey = await db
        .select({ id: reports.id, data: reports.data })
        .from(reports)
        .where(eq(reports.workspaceId, ws.id))
        .orderBy(desc(reports.createdAt))
        .limit(50);

      const isDuplicate = existingWithKey.some((r) => {
        const d = r.data as Record<string, unknown>;
        return d?.idempotencyKey === idempotencyKey;
      });

      if (isDuplicate) {
        summary.push({
          workspaceId: ws.id,
          periodId: p.id,
          score: -1,
          totalAnomalies: -1,
          action: 'skipped_idempotent',
        });
        continue;
      }

      // 6. Correr el scan.
      try {
        const result = await runForensicScan({
          workspaceId: ws.id,
          periodId: p.id,
        });

        // 7. Persistir en reports.
        await db.insert(reports).values({
          workspaceId: ws.id,
          kind: 'forensic_scan',
          title: `Escaneo Forense — ${periodLabel}`,
          data: {
            ...result,
            idempotencyKey,
            scanStartedAt: result.scanStartedAt.toISOString(),
            anomalies: result.anomalies,
          },
        });

        // 8. Notificar si score < 70 o hay anomalías high.
        const hasHighAnomaly = result.bySeverity.high > 0;
        if (result.score < 70 || hasHighAnomaly) {
          await maybeSendAnomalyNotification(ws.id, result, periodLabel, idempotencyKey);
        }

        summary.push({
          workspaceId: ws.id,
          periodId: p.id,
          score: result.score,
          totalAnomalies: result.totalAnomalies,
          action: 'scanned',
        });

        console.info(
          `[cron.anomaly-detection] ws=${ws.id} period=${periodLabel} score=${result.score} anomalies=${result.totalAnomalies}`,
        );
      } catch (scanErr) {
        const msg = scanErr instanceof Error ? scanErr.message : String(scanErr);
        console.error(`[cron.anomaly-detection] scan failed ws=${ws.id}:`, scanErr);
        summary.push({
          workspaceId: ws.id,
          periodId: p.id,
          score: -1,
          totalAnomalies: -1,
          action: 'error',
          error: msg,
        });
      }
    }

    const workspacesScanned = summary.filter((s) => s.action === 'scanned').length;
    const workspacesSkipped = summary.filter((s) => s.action === 'skipped_idempotent').length;
    const workspacesErrored = summary.filter((s) => s.action === 'error').length;

    return Response.json({
      ok: true,
      workspacesScanned,
      workspacesSkipped,
      workspacesErrored,
      durationMs: Date.now() - startedAt,
      summary,
    });
  } catch (err) {
    console.error('[cron.anomaly-detection] fatal error:', err);
    return Response.json(
      {
        ok: false,
        reason: 'internal_error',
        error: String(err),
        durationMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
