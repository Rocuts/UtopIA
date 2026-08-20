// ---------------------------------------------------------------------------
// handler.ts — pipeline withApiV1: auth → scope → cuota → body → idempotencia.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

import { generateApiKeyToken, hashApiKeyToken } from '../keys';
import type { AuthDeps, AuthenticatedKey } from '../auth';
import type {
  IdempotencyBegin,
  IdempotencyScope,
  IdempotencyStore,
} from '../idempotency';
import { apiJson, withApiV1, API_VERSION } from '../handler';
import { enforceKeyRateLimit } from '../rate-limit';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeAuth(keysByHash: Map<string, AuthenticatedKey>) {
  const findActiveKeyByHash = vi.fn(async (hash: string) => keysByHash.get(hash) ?? null);
  const touchLastUsed = vi.fn();
  const deps: AuthDeps = { findActiveKeyByHash, touchLastUsed };
  return { deps, findActiveKeyByHash, touchLastUsed };
}

function fakeIdemStore(): IdempotencyStore {
  const rows = new Map<
    string,
    { fingerprint: string; status: 'processing' | 'completed'; s?: number; b?: unknown }
  >();
  const k = (s: IdempotencyScope) => `${s.workspaceId}|${s.endpoint}|${s.key}`;
  return {
    async begin(s): Promise<IdempotencyBegin> {
      const e = rows.get(k(s));
      if (!e) {
        rows.set(k(s), { fingerprint: s.fingerprint, status: 'processing' });
        return { kind: 'new' };
      }
      if (e.fingerprint !== s.fingerprint) return { kind: 'mismatch' };
      if (e.status === 'processing') return { kind: 'processing' };
      return { kind: 'completed', status: e.s!, body: e.b };
    },
    async complete(s, status, body) {
      rows.set(k(s), { fingerprint: s.fingerprint, status: 'completed', s: status, b: body });
    },
    async abandon(s) {
      rows.delete(k(s));
    },
  };
}

interface Setup {
  token: string;
  key: AuthenticatedKey;
  auth: ReturnType<typeof fakeAuth>;
  idem: IdempotencyStore;
}

function setup(scopes: string[] = ['trial_balances:write']): Setup {
  process.env.UTOPIA_API_KEY_PEPPER = randomBytes(32).toString('base64');
  const { token } = generateApiKeyToken('test');
  const key: AuthenticatedKey = {
    id: `key-${Math.random()}`,
    workspaceId: 'ws-1',
    name: 'ERP Piloto',
    scopes,
    rpmRead: 1000,
    rpmWrite: 1000,
  };
  const auth = fakeAuth(new Map([[hashApiKeyToken(token), key]]));
  return { token, key, auth, idem: fakeIdemStore() };
}

function makeReq(opts: { token?: string; body?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return new Request('https://utopia.test/api/v1/trial-balances', {
    method: 'POST',
    headers,
    body: opts.body,
  });
}

const okHandler = vi.fn(async (ctx: { requestId: string }) =>
  apiJson(201, { id: 'tb_1', object: 'trial_balance' }, ctx.requestId, {
    Location: '/api/v1/trial-balances/tb_1',
  }),
);

function route(s: Setup, overrides: Record<string, unknown> = {}) {
  return withApiV1(
    {
      scopes: ['trial_balances:write'],
      kind: 'write',
      readBody: true,
      idempotencyEndpoint: 'trial-balances.create',
      deps: { auth: s.auth.deps, idempotencyStore: s.idem, rateLimit: enforceKeyRateLimit },
      ...overrides,
    },
    okHandler as never,
  );
}

beforeEach(() => {
  okHandler.mockClear();
});

// ---------------------------------------------------------------------------

describe('withApiV1 — autenticación', () => {
  it('503 api_disabled sin pepper configurado', async () => {
    const s = setup();
    delete process.env.UTOPIA_API_KEY_PEPPER;
    const res = await route(s)(makeReq({ body: '{}' }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('api_disabled');
  });

  it('401 missing_api_key sin Authorization', async () => {
    const s = setup();
    const res = await route(s)(makeReq({ body: '{}' }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('missing_api_key');
  });

  it('401 invalid_api_key con checksum roto SIN tocar la DB', async () => {
    const s = setup();
    const bad = s.token.slice(0, -1) + (s.token.endsWith('A') ? 'B' : 'A');
    const res = await route(s)(makeReq({ token: bad, body: '{}' }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('invalid_api_key');
    expect(s.auth.findActiveKeyByHash).not.toHaveBeenCalled();
  });

  it('401 invalid_api_key con token bien formado pero desconocido', async () => {
    const s = setup();
    const other = generateApiKeyToken('test').token;
    const res = await route(s)(makeReq({ token: other, body: '{}' }));
    expect(res.status).toBe(401);
    expect(s.auth.findActiveKeyByHash).toHaveBeenCalledTimes(1);
  });

  it('403 insufficient_scope cuando falta el scope', async () => {
    const s = setup(['trial_balances:read']);
    const res = await route(s)(makeReq({ token: s.token, body: '{}' }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('insufficient_scope');
  });
});

describe('withApiV1 — cuota, body e idempotencia', () => {
  it('propaga el 429 del rate limiter', async () => {
    const s = setup();
    const denyingLimiter: typeof enforceKeyRateLimit = async (_k, _kind, _l, requestId) => ({
      ok: false,
      response: new Response(JSON.stringify({ code: 'rate_limited', request_id: requestId }), {
        status: 429,
        headers: { 'Retry-After': '7' },
      }),
    });
    const res = await route(s, {
      deps: { auth: s.auth.deps, idempotencyStore: s.idem, rateLimit: denyingLimiter },
    })(makeReq({ token: s.token, body: '{}' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('7');
  });

  it('413 payload_too_large sobre el máximo', async () => {
    const s = setup();
    const res = await route(s, { maxBodyBytes: 10 })(
      makeReq({ token: s.token, body: '{"x":"12345678901234567890"}' }),
    );
    expect(res.status).toBe(413);
  });

  it('400 malformed_json con body roto', async () => {
    const s = setup();
    const res = await route(s)(makeReq({ token: s.token, body: '{no-json' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('malformed_json');
  });

  it('camino feliz: headers estándar + Location + touchLastUsed', async () => {
    const s = setup();
    const res = await route(s)(makeReq({ token: s.token, body: '{"csv":"x"}' }));
    expect(res.status).toBe(201);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(res.headers.get('utopia-api-version')).toBe(API_VERSION);
    expect(res.headers.get('ratelimit')).toContain('"write"');
    expect(res.headers.get('location')).toBe('/api/v1/trial-balances/tb_1');
    expect(s.auth.touchLastUsed).toHaveBeenCalled();
  });

  it('replay idempotente: el handler corre una vez y la 2ª respuesta lo marca', async () => {
    const s = setup();
    const r = route(s);
    const mk = () =>
      makeReq({ token: s.token, body: '{"csv":"x"}', headers: { 'idempotency-key': 'idem-1' } });
    const first = await r(mk());
    expect(first.status).toBe(201);
    expect(first.headers.get('idempotent-replayed')).toBeNull();

    const second = await r(mk());
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(second.headers.get('location')).toBe('/api/v1/trial-balances/tb_1');
    expect(await second.json()).toEqual({ id: 'tb_1', object: 'trial_balance' });
    expect(okHandler).toHaveBeenCalledTimes(1);
  });

  it('mismo Idempotency-Key con body distinto → 422', async () => {
    const s = setup();
    const r = route(s);
    await r(makeReq({ token: s.token, body: '{"csv":"x"}', headers: { 'idempotency-key': 'k2' } }));
    const res = await r(
      makeReq({ token: s.token, body: '{"csv":"OTRO"}', headers: { 'idempotency-key': 'k2' } }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('idempotency_payload_mismatch');
  });
});
