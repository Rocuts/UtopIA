import 'server-only';
import { render as renderAsync } from '@react-email/components';
import { getResend } from './email/resend-client';
import { fromAddress } from './email/from-address';
import { PeriodLockedEmail } from './email/templates/period-locked';
import { ReconBrokenEmail } from './email/templates/recon-broken';
import { HealthFailedEmail } from './email/templates/health-failed';
import { AnomalyDetectedEmail } from './email/templates/anomaly-detected';
import { buildUnsubscribeUrl } from './unsubscribe-token';
import * as repo from './repository';
import { dispatchWebPush } from './web-push';
import { dispatchWhatsApp } from './whatsapp';
import type {
  AnomalyPayload,
  DispatchNotificationInput,
  DispatchResult,
  HealthFailedPayload,
  NotificationChannel,
  NotificationsPort,
  PeriodLockedPayload,
  ReconBrokenPayload,
  isNotificationsEnabled,
} from './types';
import type { NewNotificationLogRow } from '@/lib/db/schema';

// Re-export for callers.
export { isNotificationsEnabled } from './types';

// ---------------------------------------------------------------------------
// Email subject lines per event
// ---------------------------------------------------------------------------

function emailSubject(input: DispatchNotificationInput): string {
  const p = input.payload as unknown as Record<string, unknown>;
  const period = (p.periodLabel as string | undefined) ?? '';
  switch (input.event) {
    case 'period.locked':
      return `🛡️ Cierre de Mes Exitoso — ${period}`;
    case 'period.locked.with_warnings':
      return `⚠️ Cierre con Salvedades — ${period}`;
    case 'reconciliation.broken':
      return `⚠️ Conciliación Bancaria Rota — ${period}`;
    case 'health_check.failed':
      return `🔴 Health Check Fallido — ${period}`;
    case 'anomaly.detected':
      return `🔍 Anomalía Detectada — ${period}`;
    default:
      return '1+1 — Notificación de plataforma';
  }
}

// ---------------------------------------------------------------------------
// Render React email → HTML
// ---------------------------------------------------------------------------

async function renderEmailHtml(
  input: DispatchNotificationInput,
  subscriptionId: string,
): Promise<string | null> {
  const unsubscribeUrl = buildUnsubscribeUrl(subscriptionId);

  try {
    switch (input.event) {
      case 'period.locked':
        return await renderAsync(
          PeriodLockedEmail({
            payload: { ...(input.payload as PeriodLockedPayload), withWarnings: false },
            unsubscribeUrl,
          }),
        );
      case 'period.locked.with_warnings':
        return await renderAsync(
          PeriodLockedEmail({
            payload: { ...(input.payload as PeriodLockedPayload), withWarnings: true },
            unsubscribeUrl,
          }),
        );
      case 'reconciliation.broken':
        return await renderAsync(
          ReconBrokenEmail({ payload: input.payload as ReconBrokenPayload, unsubscribeUrl }),
        );
      case 'health_check.failed':
        return await renderAsync(
          HealthFailedEmail({ payload: input.payload as HealthFailedPayload, unsubscribeUrl }),
        );
      case 'anomaly.detected':
        return await renderAsync(
          AnomalyDetectedEmail({ payload: input.payload as AnomalyPayload, unsubscribeUrl }),
        );
      default:
        return null;
    }
  } catch (err) {
    console.error('[notifications/dispatch] render error', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main dispatch function
// ---------------------------------------------------------------------------

export async function dispatch(
  input: DispatchNotificationInput,
): Promise<DispatchResult> {
  const { isNotificationsEnabled: enabled } = await import('./types');
  if (!enabled()) {
    return { attempted: 0, sent: 0, skipped: 0, failed: 0, perRecipient: [] };
  }

  // 1. Idempotency check.
  const existing = await repo.checkIdempotency(input.workspaceId, input.idempotencyKey);
  if (existing.length > 0) {
    return {
      attempted: existing.length,
      sent: 0,
      skipped: existing.length,
      failed: 0,
      perRecipient: existing.map((e) => ({
        subscriptionId: e.subscriptionId ?? '',
        channel: e.channel as NotificationChannel,
        recipientId: e.recipientId,
        status: 'skipped' as const,
        errorMessage: 'idempotency_hit',
      })),
    };
  }

  // 2. Load active subscriptions for this workspace + event.
  const subs = await repo.getActiveSubscriptions(
    input.workspaceId,
    input.event,
    input.channels,
  );

  if (subs.length === 0) {
    return { attempted: 0, sent: 0, skipped: 0, failed: 0, perRecipient: [] };
  }

  const resend = getResend();
  const from = fromAddress();
  const subject = emailSubject(input);
  const logsToInsert: NewNotificationLogRow[] = [];
  const perRecipient: DispatchResult['perRecipient'] = [];

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // 3. Dispatch per subscription.
  for (const sub of subs) {
    const channel = sub.channel as NotificationChannel;

    if (channel === 'email') {
      if (!resend) {
        // No API key — skip gracefully.
        console.warn('[notifications/dispatch] RESEND_API_KEY not set — skipping email', sub.recipientId);
        perRecipient.push({
          subscriptionId: sub.id,
          channel,
          recipientId: sub.recipientId,
          status: 'skipped',
          errorMessage: 'resend_key_missing',
        });
        skipped++;
        logsToInsert.push({
          workspaceId: input.workspaceId,
          subscriptionId: sub.id,
          event: input.event,
          channel,
          recipientId: sub.recipientId,
          payload: input.payload,
          idempotencyKey: `${input.idempotencyKey}:${sub.id}`,
          status: 'skipped',
          errorMessage: 'resend_key_missing',
          attempts: 1,
        });
        continue;
      }

      const html = await renderEmailHtml(input, sub.id);
      if (!html) {
        perRecipient.push({
          subscriptionId: sub.id,
          channel,
          recipientId: sub.recipientId,
          status: 'failed',
          errorMessage: 'render_failed',
        });
        failed++;
        logsToInsert.push({
          workspaceId: input.workspaceId,
          subscriptionId: sub.id,
          event: input.event,
          channel,
          recipientId: sub.recipientId,
          payload: input.payload,
          idempotencyKey: `${input.idempotencyKey}:${sub.id}`,
          status: 'failed',
          errorMessage: 'render_failed',
          attempts: 1,
        });
        continue;
      }

      try {
        const result = await resend.emails.send({
          from,
          to: sub.recipientId,
          subject,
          html,
        });

        const messageId = (result.data as { id?: string } | null)?.id;
        perRecipient.push({
          subscriptionId: sub.id,
          channel,
          recipientId: sub.recipientId,
          status: 'sent',
          providerMessageId: messageId,
        });
        sent++;
        logsToInsert.push({
          workspaceId: input.workspaceId,
          subscriptionId: sub.id,
          event: input.event,
          channel,
          recipientId: sub.recipientId,
          payload: input.payload,
          providerMessageId: messageId ?? null,
          idempotencyKey: `${input.idempotencyKey}:${sub.id}`,
          status: 'sent',
          attempts: 1,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        perRecipient.push({
          subscriptionId: sub.id,
          channel,
          recipientId: sub.recipientId,
          status: 'failed',
          errorMessage: msg,
        });
        failed++;
        logsToInsert.push({
          workspaceId: input.workspaceId,
          subscriptionId: sub.id,
          event: input.event,
          channel,
          recipientId: sub.recipientId,
          payload: input.payload,
          idempotencyKey: `${input.idempotencyKey}:${sub.id}`,
          status: 'failed',
          errorMessage: msg,
          attempts: 1,
        });
      }
    } else if (channel === 'web_push') {
      const rec = await dispatchWebPush(sub.id, sub.recipientId, input.payload);
      perRecipient.push(rec);
      skipped++;
      logsToInsert.push({
        workspaceId: input.workspaceId,
        subscriptionId: sub.id,
        event: input.event,
        channel,
        recipientId: sub.recipientId,
        payload: input.payload,
        idempotencyKey: `${input.idempotencyKey}:${sub.id}`,
        status: 'skipped',
        errorMessage: rec.errorMessage ?? null,
        attempts: 1,
      });
    } else if (channel === 'whatsapp') {
      const rec = await dispatchWhatsApp(sub.id, sub.recipientId, input.payload);
      perRecipient.push(rec);
      skipped++;
      logsToInsert.push({
        workspaceId: input.workspaceId,
        subscriptionId: sub.id,
        event: input.event,
        channel,
        recipientId: sub.recipientId,
        payload: input.payload,
        idempotencyKey: `${input.idempotencyKey}:${sub.id}`,
        status: 'skipped',
        errorMessage: rec.errorMessage ?? null,
        attempts: 1,
      });
    }
  }

  // 4. Persist all log rows in one batch.
  await repo.insertLogs(logsToInsert);

  return {
    attempted: subs.length,
    sent,
    skipped,
    failed,
    perRecipient,
  };
}
