// ---------------------------------------------------------------------------
// Cuota por llave + headers RateLimit (draft-ietf-httpapi-ratelimit-headers-11).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { checkRateLimit, checkRateLimitDynamic } from '@/lib/security/rate-limit';
import { enforceKeyRateLimit, rateLimitHeaders } from '../rate-limit';

describe('rateLimitHeaders (sintaxis Structured Fields del draft-11)', () => {
  it('emite RateLimit-Policy y RateLimit exactos', () => {
    const headers = rateLimitHeaders('write', {
      allowed: true,
      limit: 20,
      remaining: 3,
      resetSeconds: 41,
    });
    expect(headers['RateLimit-Policy']).toBe('"write";q=20;w=60');
    expect(headers['RateLimit']).toBe('"write";r=3;t=41');
  });
});

describe('checkRateLimitDynamic (backend memoria)', () => {
  it('respeta el límite explícito y reporta resetSeconds', async () => {
    const key = `test:${Date.now()}:${Math.random()}`;
    const first = await checkRateLimitDynamic(key, 2);
    const second = await checkRateLimitDynamic(key, 2);
    const third = await checkRateLimitDynamic(key, 2);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
    expect(third.resetSeconds).toBeGreaterThanOrEqual(1);
    expect(third.resetSeconds).toBeLessThanOrEqual(60);
  });

  it('mantiene compatible el checkRateLimit legado por endpoint', async () => {
    const r = await checkRateLimit(`ip-${Date.now()}`, 'chat');
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(30);
  });
});

describe('enforceKeyRateLimit', () => {
  it('permite bajo cuota (con headers) y corta con 429 + Retry-After', async () => {
    const keyId = `key-${Date.now()}-${Math.random()}`;
    const ok = await enforceKeyRateLimit(keyId, 'write', 1, 'req_t');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.headers['RateLimit']).toContain('"write"');
    }

    const blocked = await enforceKeyRateLimit(keyId, 'write', 1, 'req_t');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.response.status).toBe(429);
      expect(Number(blocked.response.headers.get('retry-after'))).toBeGreaterThan(0);
      const body = await blocked.response.json();
      expect(body.code).toBe('rate_limited');
    }
  });
});
