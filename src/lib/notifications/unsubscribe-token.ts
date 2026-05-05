/**
 * HMAC-SHA256 tokens for one-click unsubscribe links.
 *
 * token = base64url(HMAC-SHA256(subscriptionId, UTOPIA_INTERNAL_SECRET))
 *
 * The token is appended to the email as ?token=<x> so recipients can
 * unsubscribe without logging in. The route /api/notifications/unsubscribe
 * verifies the signature before deactivating the subscription.
 */
import { createHmac, timingSafeEqual } from 'crypto';

function secret(): string {
  const s = process.env.UTOPIA_INTERNAL_SECRET;
  if (!s) throw new Error('UTOPIA_INTERNAL_SECRET is not set');
  return s;
}

export function buildUnsubscribeToken(subscriptionId: string): string {
  const mac = createHmac('sha256', secret())
    .update(subscriptionId)
    .digest('base64url');
  return mac;
}

export function verifyUnsubscribeToken(
  subscriptionId: string,
  token: string,
): boolean {
  try {
    const expected = buildUnsubscribeToken(subscriptionId);
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function buildUnsubscribeUrl(
  subscriptionId: string,
  baseUrl?: string,
): string {
  const base = baseUrl ?? process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.utopia.co';
  const token = buildUnsubscribeToken(subscriptionId);
  return `${base}/api/notifications/unsubscribe?token=${encodeURIComponent(token)}&id=${encodeURIComponent(subscriptionId)}`;
}
