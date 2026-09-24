// ─── WS5 — Step: notify ──────────────────────────────────────────────────────
// Llama a NotificationsPort (WS6) para disparar el email de cierre.
// Si WS6 no está activo, retorna gracefully.
//
// Auditoría ratios-kpis-08:
//   - Los 4 KPIs de pilares viajaban como '0'/0 literales y la plantilla los
//     imprimía como cifras del cliente. Ahora: provisión de impuestos, EBITDA
//     y flujo de caja libre NO tienen base verificada en este paso ⇒ null; el
//     % de documentos verificados es el real del workspace o null (sin
//     documentos). `PeriodLockedPayload` acepta null (IW4) y la plantilla
//     muestra "N/D": el correo de cierre sale siempre, sin inventar 0 %.
//   - El puerto se cargaba con un import dinámico excluido del bundler, así que
//     en runtime el alias '@/' no se resolvía. Ahora el bundler resuelve el
//     especificador (el mismo barrel ya se importa estáticamente en
//     /api/notifications/dispatch).

import type { CloseMonthInput } from '@/lib/accounting/closing/types';
import type { NotificationsPort, PeriodLockedPayload } from '@/lib/notifications/types';
import { getDb } from '@/lib/db/client';
import { queryDocumentsVerifiedPct } from '@/lib/kpis/pillar-view';
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

  // % real de documentos pyme confirmados; null = sin documentos o error.
  let documentsVerifiedPct: number | null = null;
  try {
    documentsVerifiedPct = await queryDocumentsVerifiedPct(getDb(), workspaceId);
  } catch {
    documentsVerifiedPct = null;
  }

  let notificationsPort: NotificationsPort;
  try {
    const mod = (await import('@/lib/notifications')) as { notificationsPort?: NotificationsPort };
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
    // Sin base verificada en este paso ⇒ null (la plantilla pinta "N/D").
    pillars: {
      resiliencia: { totalProvisionTaxesCop: null },
      valor: { ebitdaCop: null },
      verdad: { documentsVerifiedPct },
      futuro: { freeCashFlowProjectedCop: null },
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
