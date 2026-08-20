// ---------------------------------------------------------------------------
// idempotency.ts — semántica Stripe + códigos del draft IETF (-07, expirado).
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import {
  fingerprintBody,
  runIdempotent,
  type IdempotencyBegin,
  type IdempotencyScope,
  type IdempotencyStore,
} from '../idempotency';

function scope(overrides: Partial<IdempotencyScope> = {}): IdempotencyScope {
  return {
    workspaceId: 'ws-1',
    endpoint: 'trial-balances.create',
    key: 'idem-abc',
    fingerprint: fingerprintBody('{"csv":"x"}'),
    ...overrides,
  };
}

/** Fake en memoria con la misma semántica que el store de Postgres. */
function memStore() {
  const rows = new Map<
    string,
    { fingerprint: string; status: 'processing' | 'completed'; responseStatus?: number; responseBody?: unknown }
  >();
  const keyOf = (s: IdempotencyScope) => `${s.workspaceId}|${s.endpoint}|${s.key}`;
  const store: IdempotencyStore = {
    async begin(s): Promise<IdempotencyBegin> {
      const existing = rows.get(keyOf(s));
      if (!existing) {
        rows.set(keyOf(s), { fingerprint: s.fingerprint, status: 'processing' });
        return { kind: 'new' };
      }
      if (existing.fingerprint !== s.fingerprint) return { kind: 'mismatch' };
      if (existing.status === 'processing') return { kind: 'processing' };
      return {
        kind: 'completed',
        status: existing.responseStatus!,
        body: existing.responseBody,
      };
    },
    async complete(s, status, body) {
      rows.set(keyOf(s), {
        fingerprint: s.fingerprint,
        status: 'completed',
        responseStatus: status,
        responseBody: body,
      });
    },
    async abandon(s) {
      rows.delete(keyOf(s));
    },
  };
  return { store, rows };
}

describe('fingerprintBody', () => {
  it('sha256 hex determinista', () => {
    expect(fingerprintBody('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintBody('abc')).toBe(fingerprintBody('abc'));
    expect(fingerprintBody('abc')).not.toBe(fingerprintBody('abd'));
  });
});

describe('runIdempotent', () => {
  it('sin scope ejecuta directo sin tocar el store', async () => {
    const { store } = memStore();
    const beginSpy = vi.spyOn(store, 'begin');
    const r = await runIdempotent(store, null, async () => ({ status: 201, body: { ok: 1 } }));
    expect(r).toEqual({ status: 201, body: { ok: 1 }, replayed: false });
    expect(beginSpy).not.toHaveBeenCalled();
  });

  it('primera corrida ejecuta y persiste; replay NO re-ejecuta', async () => {
    const { store } = memStore();
    const exec = vi.fn(async () => ({ status: 201, body: { id: 'tb_1' } }));
    const s = scope();

    const first = await runIdempotent(store, s, exec);
    expect(first).toEqual({ status: 201, body: { id: 'tb_1' }, replayed: false });

    const second = await runIdempotent(store, s, exec);
    expect(second).toEqual({ status: 201, body: { id: 'tb_1' }, replayed: true });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('mismo key con payload distinto → mismatch (422)', async () => {
    const { store } = memStore();
    await runIdempotent(store, scope(), async () => ({ status: 201, body: {} }));
    const r = await runIdempotent(
      store,
      scope({ fingerprint: fingerprintBody('otro-body') }),
      async () => ({ status: 201, body: {} }),
    );
    expect(r).toEqual({ conflict: 'mismatch' });
  });

  it('solicitud en vuelo → in_use (409)', async () => {
    const { store } = memStore();
    const s = scope();
    await store.begin(s); // simula otra request procesando
    const r = await runIdempotent(store, s, async () => ({ status: 201, body: {} }));
    expect(r).toEqual({ conflict: 'in_use' });
  });

  it('exec lanza → abandona la fila (retry posible) y propaga', async () => {
    const { store, rows } = memStore();
    const s = scope();
    await expect(
      runIdempotent(store, s, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(rows.size).toBe(0);
    // retry tras el fallo vuelve a ejecutar
    const retry = await runIdempotent(store, s, async () => ({ status: 201, body: { ok: 2 } }));
    expect(retry).toEqual({ status: 201, body: { ok: 2 }, replayed: false });
  });

  it('status 5xx NO se persiste (el retry re-ejecuta)', async () => {
    const { store, rows } = memStore();
    const s = scope();
    const r = await runIdempotent(store, s, async () => ({ status: 500, body: { err: 1 } }));
    expect(r).toEqual({ status: 500, body: { err: 1 }, replayed: false });
    expect(rows.size).toBe(0);
  });
});
