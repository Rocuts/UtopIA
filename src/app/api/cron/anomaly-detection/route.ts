/**
 * CRON — Forensic Anomaly Detection (D5.3)
 * ==========================================
 * Schedule:  0 4 * * *  (UTC)  ≡  23:00 COT (Bogotá UTC-5)
 * Auth:      Vercel Cron envía `Authorization: Bearer ${CRON_SECRET}`.
 * Flag:      UTOPIA_ENABLE_ANOMALY_DETECTION=true (OFF por defecto).
 *
 * Flow:
 *   1. Verifica auth (checkCronAuth, timing-safe) — sin CRON_SECRET → 503
 *      (fail-closed); bearer incorrecto → 401.
 *   2. Verifica feature flag — si OFF → 200 { skipped: 'flag_disabled' }.
 *   3. Itera workspaces activos con períodos open/closed-reciente.
 *   4. Por cada workspace + período: runForensicScan().
 *   5. Si score < 70, hay anomalías high o la cobertura es PARCIAL (reglas
 *      sin evaluar: el score no equivale a "limpio", auditoria-calidad-19):
 *      dispatchNotification.
 *   6. Persiste resultado en reports.kind = 'forensic_scan'.
 *   7. Idempotencia: idempotency_key = forensic:{ws}:{period}:{YYYYMMDD}.
 */

import type { NextRequest } from 'next/server';
import { eq, desc, or } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { workspaces, accountingPeriods, reports } from '@/lib/db/schema';
import { runForensicScan } from '@/lib/agents/financial/audit/forensic';
import type { ForensicScanResult } from '@/lib/agents/financial/audit/forensic';
import { checkCronAuth } from '@/lib/security/cron-auth';

export const maxDuration = 300;

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
    const parcial = result.coverage === 'parcial';
    const coberturaNota = parcial
      ? `Escaneo forense con cobertura parcial: ${result.rulesFailed.length} regla(s) no se ` +
        `evaluaron (${result.rulesFailed.join(', ') || 'omitidas'}); el puntaje no equivale a "limpio".`
      : null;
    if (!topAnomaly && !coberturaNota) return;
    const defaultReviewUrl = `/workspace/contabilidad/asientos?period=${result.periodId}`;

    await dispatch({
      workspaceId,
      event: 'anomaly.detected',
      idempotencyKey: `${idempotencyKey}:notify`,
      payload: topAnomaly
        ? {
            workspaceName: workspaceId, // Se enriquece con nombre real si disponible
            periodLabel,
            anomalyKind: topAnomaly.kind,
            description: coberturaNota
              ? `${topAnomaly.description} ${coberturaNota}`
              : topAnomaly.description,
            severity: topAnomaly.severity,
            reviewUrl: topAnomaly.reviewUrl ?? defaultReviewUrl,
          }
        : {
            workspaceName: workspaceId,
            periodLabel,
            anomalyKind: 'cobertura_parcial',
            description: coberturaNota ?? '',
            severity: 'medium',
            reviewUrl: defaultReviewUrl,
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
  // 1. Auth — fail-closed: sin CRON_SECRET configurado, 503 (antes permitía
  // pasar sin secret fuera de NODE_ENV=production, dejando la ruta abierta
  // en cualquier deploy donde NODE_ENV no fuera literalmente 'production').
  const authError = checkCronAuth(request);
  if (authError) return authError;

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
      /** Cobertura del escaneo; 'parcial' = reglas sin evaluar. */
      coverage?: ForensicScanResult['coverage'];
      rulesFailed?: ForensicScanResult['rulesFailed'];
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

        // 8. Notificar si score < 70, hay anomalías high o la cobertura es
        // parcial (un escaneo incompleto con score 100 no es "limpio").
        const hasHighAnomaly = result.bySeverity.high > 0;
        if (result.score < 70 || hasHighAnomaly || result.coverage === 'parcial') {
          await maybeSendAnomalyNotification(ws.id, result, periodLabel, idempotencyKey);
        }

        summary.push({
          workspaceId: ws.id,
          periodId: p.id,
          score: result.score,
          totalAnomalies: result.totalAnomalies,
          coverage: result.coverage,
          rulesFailed: result.rulesFailed,
          action: 'scanned',
        });

        console.info(
          `[cron.anomaly-detection] ws=${ws.id} period=${periodLabel} score=${result.score} anomalies=${result.totalAnomalies} coverage=${result.coverage}`,
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
    console.error('[cron/anomaly-detection] error:', err instanceof Error ? err.message : err);
    return Response.json(
      { ok: false, reason: 'internal_error' },
      { status: 500 },
    );
  }
}
