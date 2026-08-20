// ─── Webhook delivery — política pura (testeable sin workflow runtime) ──────
//
// Schedule de reintentos Svix (verificado docs.svix.com/retries):
// inmediato, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h ≈ 28 h en 8 intentos.
// Éxito = SOLO 2xx (3xx cuenta como fallo — práctica Stripe). Timeout por
// intento 10 s (número publicado por GitHub). Desactivación del endpoint
// tras 5 días de fallo continuo (patrón Svix), reseteable con cualquier 2xx.

export const RETRY_DELAYS_MS = [
  0,
  5_000,
  300_000, // 5 min
  1_800_000, // 30 min
  7_200_000, // 2 h
  18_000_000, // 5 h
  36_000_000, // 10 h
  36_000_000, // 10 h
] as const;

export const DELIVERY_TIMEOUT_MS = 10_000;

export const DISABLE_AFTER_MS = 5 * 24 * 3_600_000; // 5 días

export function isDeliverySuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

export function shouldDisableEndpoint(
  firstFailingAt: Date | null,
  now: Date,
): boolean {
  if (!firstFailingAt) return false;
  return now.getTime() - firstFailingAt.getTime() >= DISABLE_AFTER_MS;
}
