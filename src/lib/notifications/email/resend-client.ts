import 'server-only';
import { Resend } from 'resend';

let _client: Resend | null = null;

/**
 * Lazy singleton for the Resend SDK client.
 *
 * Returns `null` when RESEND_API_KEY is not set (e.g. local dev without key).
 * Callers must treat null as "channel disabled" and skip gracefully.
 */
export function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!_client) _client = new Resend(apiKey);
  return _client;
}
