// ---------------------------------------------------------------------------
// Regresión — contrato de fases del gating por plan.
//
// Fase 1 (Stripe NO configurado): getUserPlan/getWorkspacePlan/requirePlan
// MUST comportarse como 'enterprise' (sin restricciones) y NO tocar la DB.
// Si esto se rompiera, desplegar este módulo bloquearía funciones existentes
// en producción sin que nadie haya configurado billing.
//
// Fase 2 (resolución real contra la tabla subscription) requiere DB + webhooks
// de Stripe — se verifica en integración / E2E, no aquí. Lo que sí se fija
// aquí es la lógica pura: normalización de plan y ranking.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _internal,
  getUserPlan,
  getWorkspacePlan,
  isBillingEnabled,
  requirePlan,
} from '../plan';

const ORIGINALS = {
  secret: process.env.STRIPE_SECRET_KEY,
  webhook: process.env.STRIPE_WEBHOOK_SECRET,
  authSecret: process.env.BETTER_AUTH_SECRET,
};

function restore(key: keyof typeof ORIGINALS, envName: string) {
  const value = ORIGINALS[key];
  if (value === undefined) delete process.env[envName];
  else process.env[envName] = value;
}

describe('billing/plan — fase 1 (Stripe sin configurar)', () => {
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
  });
  afterEach(() => {
    restore('secret', 'STRIPE_SECRET_KEY');
    restore('webhook', 'STRIPE_WEBHOOK_SECRET');
    restore('authSecret', 'BETTER_AUTH_SECRET');
  });

  it('isBillingEnabled es false sin claves', () => {
    expect(isBillingEnabled()).toBe(false);
  });

  it('isBillingEnabled es false con configuración PARCIAL (solo secret)', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    expect(isBillingEnabled()).toBe(false);
  });

  it('getUserPlan devuelve enterprise (sin restricciones) y no toca la DB', async () => {
    // Sin DATABASE_URL en el entorno de test, tocar getDb() lanzaría.
    await expect(getUserPlan('user-1')).resolves.toBe('enterprise');
  });

  it('getWorkspacePlan devuelve enterprise y no toca la DB', async () => {
    await expect(getWorkspacePlan('11111111-1111-4111-8111-111111111111')).resolves.toBe(
      'enterprise',
    );
  });

  it('requirePlan(pro) y requirePlan(enterprise) pasan en fase 1', async () => {
    const pro = await requirePlan('pro');
    expect(pro.ok).toBe(true);
    const ent = await requirePlan('enterprise');
    expect(ent.ok).toBe(true);
  });
});

describe('billing/plan — lógica pura', () => {
  it('asPlanId normaliza planes desconocidos a free', () => {
    expect(_internal.asPlanId('pro')).toBe('pro');
    expect(_internal.asPlanId('enterprise')).toBe('enterprise');
    expect(_internal.asPlanId('basic')).toBe('free');
    expect(_internal.asPlanId('')).toBe('free');
  });

  it('el ranking ordena free < pro < enterprise', () => {
    expect(_internal.PLAN_RANK.free).toBeLessThan(_internal.PLAN_RANK.pro);
    expect(_internal.PLAN_RANK.pro).toBeLessThan(_internal.PLAN_RANK.enterprise);
  });

  it('solo active y trialing otorgan el plan', () => {
    expect(_internal.ENTITLED_STATUSES).toEqual(['active', 'trialing']);
  });
});
