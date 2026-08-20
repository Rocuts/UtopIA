// ---------------------------------------------------------------------------
// policy.ts — decisiones puras de la entrega de webhooks (schedule Svix).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  DELIVERY_TIMEOUT_MS,
  DISABLE_AFTER_MS,
  isDeliverySuccess,
  RETRY_DELAYS_MS,
  shouldDisableEndpoint,
} from '../policy';

describe('RETRY_DELAYS_MS (schedule Svix)', () => {
  it('tiene 8 intentos y ~28 horas acumuladas', () => {
    expect(RETRY_DELAYS_MS).toHaveLength(8);
    expect(RETRY_DELAYS_MS[0]).toBe(0); // primer intento inmediato
    const totalHours = [...RETRY_DELAYS_MS].reduce<number>((a, b) => a + b, 0) / 3_600_000;
    expect(totalHours).toBeGreaterThan(27);
    expect(totalHours).toBeLessThan(29);
  });
});

describe('isDeliverySuccess', () => {
  it('solo 2xx cuenta como éxito (3xx = fallo, práctica Stripe)', () => {
    expect(isDeliverySuccess(200)).toBe(true);
    expect(isDeliverySuccess(204)).toBe(true);
    expect(isDeliverySuccess(301)).toBe(false);
    expect(isDeliverySuccess(404)).toBe(false);
    expect(isDeliverySuccess(429)).toBe(false);
    expect(isDeliverySuccess(500)).toBe(false);
  });
});

describe('shouldDisableEndpoint', () => {
  const now = new Date('2026-08-19T12:00:00Z');
  const days = (n: number) => new Date(now.getTime() - n * 24 * 3_600_000);

  it('no desactiva sin fallo continuo ni antes de 5 días', () => {
    expect(shouldDisableEndpoint(null, now)).toBe(false);
    expect(shouldDisableEndpoint(days(4), now)).toBe(false);
  });

  it('desactiva al superar 5 días de fallo continuo', () => {
    expect(shouldDisableEndpoint(days(5), now)).toBe(true);
    expect(shouldDisableEndpoint(days(6), now)).toBe(true);
  });

  it('las constantes operativas son las de la spec', () => {
    expect(DELIVERY_TIMEOUT_MS).toBe(10_000);
    expect(DISABLE_AFTER_MS).toBe(5 * 24 * 3_600_000);
  });
});
