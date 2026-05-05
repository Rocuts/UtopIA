// ─── WS5 — Step: notify ──────────────────────────────────────────────────────
// Llama a NotificationsPort (WS6) para disparar el email de cierre.
// Si WS6 no está activo, retorna gracefully.

import type { CloseMonthInput } from '@/lib/accounting/closing/types';
import type { NotificationsPort, PeriodLockedPayload } from '@/lib/notifications/types';
import { getPeriodById, getWorkspaceName } from '../repository';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.utopia.co';

export async function sendLockNotification(
  input: CloseMonthInput & {
    runId: string;
    hash: string;
    withWarnings: boolean;
    pdfUrl: string | null;
  },
): Promise<{ sent: boolean; error?: string }> {
  'use step';

  const notifyEnabled = process.env.UTOPIA_ENABLE_NOTIFICATIONS === 'true';
  if (!notifyEnabled) {
    console.warn('[notify] UTOPIA_ENABLE_NOTIFICATIONS no activo — notificación omitida.');
    return { sent: false };
  }

  const { workspaceId, periodId, hash, withWarnings, runId } = input;

  const [period, workspaceName] = await Promise.all([
    getPeriodById(workspaceId, periodId),
    getWorkspaceName(workspaceId),
  ]);

  if (!period) {
    console.warn('[notify] Período no encontrado — notificación omitida.');
    return { sent: false };
  }

  const periodLabel = `${period.year}-${String(period.month).padStart(2, '0')}`;

  let notificationsPort: NotificationsPort;
  try {
    // Dynamic import with runtime path to prevent Turbopack from statically
    // bundling the WS6 notifications barrel (which has its own peer deps).
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const modPath = '@/lib/notifications' as string;
    const mod = await import(/* webpackIgnore: true */ modPath) as { notificationsPort?: NotificationsPort };
    notificationsPort = mod.notificationsPort as NotificationsPort;
    if (!notificationsPort) throw new Error('notificationsPort no exportado');
  } catch (err) {
    console.warn('[notify] No se pudo cargar NotificationsPort:', err);
    return { sent: false, error: String(err) };
  }

  const payload: PeriodLockedPayload = {
    workspaceName,
    periodLabel,
    periodHash: hash,
    withWarnings,
    overrideReason: input.overrideReason,
    pillars: {
      resiliencia: { totalProvisionTaxesCop: '0' },
      valor: { ebitdaCop: '0' },
      verdad: { documentsVerifiedPct: 0 },
      futuro: { freeCashFlowProjectedCop: '0' },
    },
    links: {
      viewReportUrl: `${BASE_URL}/workspace/contabilidad?run=${runId}`,
      shareReportUrl: input.pdfUrl ?? `${BASE_URL}/workspace/contabilidad?run=${runId}`,
      viewAnomaliesUrl: `${BASE_URL}/workspace/contabilidad/cierre?run=${runId}`,
    },
  };

  try {
    const result = await notificationsPort.dispatch({
      workspaceId,
      event: withWarnings ? 'period.locked.with_warnings' : 'period.locked',
      idempotencyKey: `period.locked:${periodId}:${runId}`,
      payload,
    });

    return { sent: result.sent > 0 };
  } catch (err) {
    console.error('[notify] Error despachando notificación:', err);
    return { sent: false, error: String(err) };
  }
}
