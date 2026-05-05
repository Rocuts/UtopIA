/**
 * Returns the "from" address used for all transactional emails.
 *
 * Priority:
 *   1. NOTIFICATIONS_FROM env var (e.g. "UtopIA <noreply@yourdomain.com>")
 *   2. Resend's sandbox default — safe for dev/staging without a verified domain.
 */
export function fromAddress(): string {
  return process.env.NOTIFICATIONS_FROM ?? 'UtopIA <onboarding@resend.dev>';
}
