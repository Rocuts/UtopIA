// ---------------------------------------------------------------------------
// Regresión — /api/auth/[...all] NO puede devolver 500 en fase 1.
//
// Bug de producción (2026-08-10): `GET /api/auth/get-session` respondía 500 con
// cuerpo vacío en CADA carga de página del despliegue anónimo. Causa: el route
// handler importaba `@/lib/auth/config` de forma estática y BetterAuth, sin
// BETTER_AUTH_SECRET, cae al DEFAULT_SECRET; `validateSecret()` lanza cuando
// NODE_ENV === 'production'. El rechazo es perezoso (vive en `$context`), así
// que solo aflora al despachar la primera petición.
//
// Contrato verificado aquí:
//   Fase 1 (sin secret)  — get-session responde 200 `null`; el resto 503; y el
//                          módulo de config NUNCA se importa.
//   Fase 2 (con secret)  — el handler delega ÍNTEGRAMENTE en BetterAuth, sin
//                          cortocircuito ni relajación del gate.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTH_NOT_CONFIGURED_CODE,
  anonymousPhaseResponse,
} from '../anonymous-phase';

const SECRET_VARS = [
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_SECRETS',
  'AUTH_SECRET',
] as const;

const originalEnv = new Map<string, string | undefined>();

function clearSecrets(): void {
  for (const key of SECRET_VARS) delete process.env[key];
}

function restoreEnv(): void {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  originalEnv.clear();
  for (const key of [...SECRET_VARS, 'DATABASE_URL']) {
    originalEnv.set(key, process.env[key]);
  }
  vi.resetModules();
});

afterEach(() => {
  restoreEnv();
  vi.unstubAllEnvs();
  vi.doUnmock('@/lib/auth/config');
  vi.doUnmock('better-auth/next-js');
});

// ---------------------------------------------------------------------------

describe('anonymousPhaseResponse', () => {
  it('get-session responde 200 con body null (lo mismo que BetterAuth sin cookie)', async () => {
    const res = anonymousPhaseResponse(
      new Request('https://utopia.test/api/auth/get-session'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toBeNull();
  });

  it('get-session con query string sigue siendo 200 null', async () => {
    const res = anonymousPhaseResponse(
      new Request('https://utopia.test/api/auth/get-session?disableCookieCache=true'),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBeNull();
  });

  it('cualquier otro endpoint responde 503 AUTH_NOT_CONFIGURED, nunca 500', async () => {
    for (const path of [
      '/api/auth/sign-in/email',
      '/api/auth/sign-up/email',
      '/api/auth/reset-password',
      '/api/auth/stripe/webhook',
    ]) {
      const res = anonymousPhaseResponse(new Request(`https://utopia.test${path}`));
      expect(res.status).toBe(503);
      const body: unknown = await res.json();
      expect(body).toMatchObject({ code: AUTH_NOT_CONFIGURED_CODE });
    }
  });
});

// ---------------------------------------------------------------------------

describe('/api/auth/[...all] — fase 1 (sin BETTER_AUTH_SECRET)', () => {
  beforeEach(() => {
    clearSecrets();
    // Sin DATABASE_URL, `@/lib/auth/config` lanza al importarse (getDb()). Es
    // la prueba implícita de que el guard corta ANTES del import dinámico.
    delete process.env.DATABASE_URL;
  });

  it('GET get-session devuelve 200 null en vez de 500', async () => {
    const { GET } = await import('@/app/api/auth/[...all]/route');
    const res = await GET(new Request('https://utopia.test/api/auth/get-session'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBeNull();
  });

  it('POST get-session devuelve 200 null en vez de 500', async () => {
    const { POST } = await import('@/app/api/auth/[...all]/route');
    const res = await POST(
      new Request('https://utopia.test/api/auth/get-session', { method: 'POST' }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBeNull();
  });

  it('POST sign-in devuelve 503 explícito, no 500', async () => {
    const { POST } = await import('@/app/api/auth/[...all]/route');
    const res = await POST(
      new Request('https://utopia.test/api/auth/sign-in/email', { method: 'POST' }),
    );
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------

describe('/api/auth/[...all] — fase 2 (con BETTER_AUTH_SECRET)', () => {
  it('delega en BetterAuth y no cortocircuita get-session', async () => {
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(48);

    const seen: string[] = [];
    const delegated = new Response('delegated-to-better-auth', { status: 418 });

    vi.doMock('@/lib/auth/config', () => ({ auth: { handler: async () => delegated } }));
    vi.doMock('better-auth/next-js', () => ({
      toNextJsHandler: () => ({
        GET: async (request: Request) => {
          seen.push(`GET ${new URL(request.url).pathname}`);
          return delegated;
        },
        POST: async (request: Request) => {
          seen.push(`POST ${new URL(request.url).pathname}`);
          return delegated;
        },
      }),
    }));

    const { GET, POST } = await import('@/app/api/auth/[...all]/route');

    const getRes = await GET(new Request('https://utopia.test/api/auth/get-session'));
    expect(getRes.status).toBe(418);
    await expect(getRes.text()).resolves.toBe('delegated-to-better-auth');

    const postRes = await POST(
      new Request('https://utopia.test/api/auth/sign-in/email', { method: 'POST' }),
    );
    expect(postRes.status).toBe(418);

    // El gate real vio ambas peticiones: nada se resolvió con la respuesta
    // anónima de fase 1.
    expect(seen).toEqual(['GET /api/auth/get-session', 'POST /api/auth/sign-in/email']);
  });
});

// ---------------------------------------------------------------------------

describe('causa raíz — BetterAuth sin secret en producción', () => {
  it('rechaza al despachar la primera petición (motivo del guard)', async () => {
    clearSecrets();
    // BetterAuth solo lanza fuera de test: `validateSecret()` hace
    // `if (isTest()) return`, e `isTest()` mira NODE_ENV y la env `TEST` (que
    // Vitest deja puesta). Emulamos el runtime de Vercel apagando ambas.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TEST', 'false');
    vi.resetModules();

    const { betterAuth } = await import('better-auth');
    const auth = betterAuth({
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: 'https://utopia.test',
      emailAndPassword: { enabled: true },
    });

    await expect(
      auth.handler(new Request('https://utopia.test/api/auth/get-session')),
    ).rejects.toThrow(/default secret/i);
  });
});
