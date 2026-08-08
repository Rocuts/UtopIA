// ---------------------------------------------------------------------------
// Regresión — assert de arranque sobre BETTER_AUTH_URL.
//
// `baseURL` de BetterAuth cae a `https://${VERCEL_URL}` cuando falta
// BETTER_AUTH_URL. En preview eso es deseado (cada deploy efímero emite sus
// cookies para su propio host). En PRODUCCIÓN es un fallo silencioso caro:
// VERCEL_URL es el host interno del deployment, no el dominio canónico, así
// que las cookies de sesión se emiten para un origen distinto del que visita
// el usuario, los callbacks OAuth apuntan a una URL que nadie usa y el login
// "no funciona" sin un solo error en los logs.
//
// El assert convierte ese degradado en un arranque que falla. Sólo aplica en
// la combinación exacta que importa (fase 2 + producción), así que en fase 1 y
// en preview no cambia nada.
//
// Estos tests FALLAN con el código viejo: allí importar el módulo con
// BETTER_AUTH_SECRET + VERCEL_ENV=production y sin BETTER_AUTH_URL resolvía
// tan tranquilo.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dependencias pesadas mockeadas: el test valida la lógica de env, no BetterAuth.
vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }));
vi.mock('better-auth', () => ({
  betterAuth: (config: unknown) => ({ config, api: {} }),
}));
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: () => ({}) }));
vi.mock('better-auth/api', () => ({ APIError: class extends Error {} }));
vi.mock('@better-auth/stripe', () => ({ stripe: () => ({}) }));
vi.mock('stripe', () => ({ default: class {} }));

const VARS = [
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'VERCEL_ENV',
  'VERCEL_URL',
] as const;
const ORIGINAL = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));

beforeEach(() => {
  for (const v of VARS) delete process.env[v];
  vi.resetModules();
});

afterEach(() => {
  for (const v of VARS) {
    const value = ORIGINAL[v];
    if (value === undefined) delete process.env[v];
    else process.env[v] = value;
  }
});

describe('assertAuthUrlConfigured()', () => {
  it('lanza en producción con auth activa y sin BETTER_AUTH_URL', async () => {
    const { assertAuthUrlConfigured } = await import('../config');
    expect(() =>
      assertAuthUrlConfigured({
        BETTER_AUTH_SECRET: 'x'.repeat(32),
        VERCEL_ENV: 'production',
        VERCEL_URL: 'utopia-abc123.vercel.app',
      }),
    ).toThrow(/BETTER_AUTH_URL/);
  });

  it('no lanza si BETTER_AUTH_URL está definida', async () => {
    const { assertAuthUrlConfigured } = await import('../config');
    expect(() =>
      assertAuthUrlConfigured({
        BETTER_AUTH_SECRET: 'x'.repeat(32),
        VERCEL_ENV: 'production',
        BETTER_AUTH_URL: 'https://utopia.sequal.com.co',
      }),
    ).not.toThrow();
  });

  it('no lanza en preview — ahí el fallback a VERCEL_URL es intencional', async () => {
    const { assertAuthUrlConfigured } = await import('../config');
    expect(() =>
      assertAuthUrlConfigured({
        BETTER_AUTH_SECRET: 'x'.repeat(32),
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'utopia-abc123.vercel.app',
      }),
    ).not.toThrow();
  });

  it('no lanza en fase 1 (sin BETTER_AUTH_SECRET) ni en producción', async () => {
    const { assertAuthUrlConfigured } = await import('../config');
    expect(() =>
      assertAuthUrlConfigured({ VERCEL_ENV: 'production' }),
    ).not.toThrow();
  });
});

describe('assert de ARRANQUE (corre al importar el módulo)', () => {
  it('importar config.ts revienta en la combinación prohibida', async () => {
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(32);
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_URL = 'utopia-abc123.vercel.app';

    await expect(import('../config')).rejects.toThrow(/BETTER_AUTH_URL/);
  });

  it('importar config.ts es inocuo en fase 1 (estado actual del proyecto)', async () => {
    await expect(import('../config')).resolves.toBeDefined();
  });
});
