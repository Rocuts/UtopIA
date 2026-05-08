// ---------------------------------------------------------------------------
// sendInsightAlert — envío de Insight via Resend (email).
// ---------------------------------------------------------------------------
// El Sentinel Workflow (P6) llama a esta función después de upsertear un
// alert en `sentinel_alerts`. Si:
//   - No hay RESEND_API_KEY en env → no-op + log warn (no rompe el workflow).
//   - No hay recipient en options → no-op + log warn (workspace anónimo).
//   - dryRun=true → no-op + log info (para tests/staging).
// ---------------------------------------------------------------------------

import 'server-only';
import { render } from '@react-email/components';

import { InsightAlertEmail } from '@/emails/InsightAlertEmail';
import type { Insight, SendInsightOptions, SendInsightResult } from './insight-types';

const FROM_DEFAULT = 'UtopIA · 1+1 <noreply@utopia.systems>';
const FROM_ENV_KEY = 'NOTIFICATIONS_FROM_ADDRESS';

let resendInstance: { emails: { send: (input: unknown) => Promise<{ data?: { id?: string }; error?: { message?: string } | null }> } } | null = null;
let resendInitTried = false;

async function getResend() {
  if (resendInitTried) return resendInstance;
  resendInitTried = true;
  const key = process.env.RESEND_API_KEY;
  if (!key || key.length === 0) {
    console.warn('[sentinel-insight] RESEND_API_KEY not set — emails disabled.');
    return null;
  }
  try {
    const { Resend } = await import('resend');
    resendInstance = new Resend(key) as unknown as typeof resendInstance;
    return resendInstance;
  } catch (err) {
    console.warn('[sentinel-insight] failed to load resend SDK:', err);
    return null;
  }
}

export async function sendInsightAlert(
  insight: Insight,
  options: SendInsightOptions = {},
): Promise<SendInsightResult> {
  const recipient = options.recipient?.trim();
  if (!recipient) {
    console.warn('[sentinel-insight] no recipient — skipping email send.', {
      pillar: insight.pillar,
      severity: insight.severity,
      dedupKey: insight.dedupKey,
    });
    return { emailSent: false, skipped: 'no_recipient' };
  }

  if (options.dryRun) {
    console.info('[sentinel-insight] dryRun — would send', {
      to: recipient,
      subject: insight.subject,
      pillar: insight.pillar,
      severity: insight.severity,
    });
    return { emailSent: false, skipped: 'dry_run' };
  }

  const resend = await getResend();
  if (!resend) {
    return { emailSent: false, skipped: 'resend_unavailable' };
  }

  try {
    const html = await render(
      InsightAlertEmail({
        insight: { ...insight, language: options.language ?? insight.language ?? 'es' },
      }),
    );
    const subject = insight.subject;
    const from = process.env[FROM_ENV_KEY] ?? FROM_DEFAULT;

    const { data, error } = await resend.emails.send({
      from,
      to: recipient,
      subject,
      html,
    });

    if (error) {
      const msg = error.message ?? 'unknown_resend_error';
      console.warn('[sentinel-insight] resend error:', msg);
      return { emailSent: false, error: msg };
    }

    return { emailSent: true, emailMessageId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[sentinel-insight] send failed:', msg);
    return { emailSent: false, error: msg };
  }
}

// Para tests: limpiar el cache del SDK.
export function _resetResendCache() {
  resendInstance = null;
  resendInitTried = false;
}
