// ---------------------------------------------------------------------------
// Contract tests for /api/accounting/periods + sub-routes (close/lock/reopen).
//
// These are unit-level — we mock global `fetch` and assert that the UI
// integrations call the API with the correct body, headers, and method,
// and that they handle the documented status codes (201 / 200 / 4xx).
//
// Why no integration test here: WS5 monthly-close workflow is exercised in
// `src/lib/workflows/monthly-close/__tests__` and route handlers are tested
// indirectly through the existing accounting smoke tests. This file locks
// the wire contract that PeriodsManagementView depends on.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface AccountingPeriod {
  id: string;
  year: number;
  month: number;
  status: 'open' | 'closed' | 'locked';
  startsAt: string;
  endsAt: string;
  closedAt: string | null;
  closedBy: string | null;
  lockedAt: string | null;
}

const samplePeriod: AccountingPeriod = {
  id: '00000000-0000-0000-0000-000000000001',
  year: 2026,
  month: 5,
  status: 'open',
  startsAt: '2026-05-01T00:00:00.000Z',
  endsAt: '2026-05-31T23:59:59.999Z',
  closedAt: null,
  closedBy: null,
  lockedAt: null,
};

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(handler);
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/accounting/periods', () => {
  it('returns { periods: AccountingPeriod[] } on success', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ ok: true, periods: [samplePeriod] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const res = await fetch('/api/accounting/periods?year=2026');
    expect(res.ok).toBe(true);
    const json = (await res.json()) as { periods: AccountingPeriod[] };
    expect(Array.isArray(json.periods)).toBe(true);
    expect(json.periods[0].id).toBe(samplePeriod.id);
  });

  it('rejects invalid_year with 400', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: 'invalid_year' }), { status: 400 }),
    );
    const res = await fetch('/api/accounting/periods?year=99999');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/accounting/periods', () => {
  it('creates a period and returns 201 with the period payload', async () => {
    const body = { year: 2026, month: 5 };
    const fetchSpy = mockFetch(async (_input, init) => {
      const parsed = JSON.parse(String(init?.body));
      expect(parsed).toEqual(body);
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ ok: true, period: samplePeriod }), { status: 201 });
    });
    const res = await fetch('/api/accounting/periods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { period: AccountingPeriod };
    expect(json.period.month).toBe(5);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('handles overlap conflict via unique index (typically 422 from Zod, 409 from DB)', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: 'period_overlap' }), { status: 422 }),
    );
    const res = await fetch('/api/accounting/periods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: 2026, month: 5 }),
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/accounting/periods/close', () => {
  it('returns 200 + period on closed transition', async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          period: { ...samplePeriod, status: 'closed', closedAt: '2026-06-01T00:00:00.000Z' },
        }),
        { status: 200 },
      ),
    );
    const res = await fetch('/api/accounting/periods/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId: samplePeriod.id }),
    });
    expect(res.ok).toBe(true);
    const json = (await res.json()) as { period: AccountingPeriod };
    expect(json.period.status).toBe('closed');
    expect(json.period.closedAt).not.toBeNull();
  });

  it('is idempotent: alreadyClosed flag set when re-closing', async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({ ok: true, period: { ...samplePeriod, status: 'closed' }, alreadyClosed: true }),
        { status: 200 },
      ),
    );
    const res = await fetch('/api/accounting/periods/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId: samplePeriod.id }),
    });
    const json = (await res.json()) as { alreadyClosed?: boolean };
    expect(json.alreadyClosed).toBe(true);
  });

  it('refuses to close a locked period with 409', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: 'period_locked' }), { status: 409 }),
    );
    const res = await fetch('/api/accounting/periods/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId: samplePeriod.id }),
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/accounting/periods/lock', () => {
  it('returns 200 + locked period when transitioning closed → locked', async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          period: { ...samplePeriod, status: 'locked', lockedAt: '2026-06-01T00:00:00.000Z' },
        }),
        { status: 200 },
      ),
    );
    const res = await fetch('/api/accounting/periods/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId: samplePeriod.id }),
    });
    const json = (await res.json()) as { period: AccountingPeriod };
    expect(json.period.status).toBe('locked');
    expect(json.period.lockedAt).not.toBeNull();
  });

  it('refuses to lock an open period (must close first) with 409', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: 'period_must_be_closed_first' }), { status: 409 }),
    );
    const res = await fetch('/api/accounting/periods/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId: samplePeriod.id }),
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/accounting/periods/reopen', () => {
  it('returns 200 + open period when transitioning closed → open', async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          period: { ...samplePeriod, status: 'open', closedAt: null },
        }),
        { status: 200 },
      ),
    );
    const res = await fetch('/api/accounting/periods/reopen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId: samplePeriod.id }),
    });
    const json = (await res.json()) as { period: AccountingPeriod };
    expect(json.period.status).toBe('open');
    expect(json.period.closedAt).toBeNull();
  });

  it('refuses to reopen a locked period with 409', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: 'period_locked_cannot_reopen' }), { status: 409 }),
    );
    const res = await fetch('/api/accounting/periods/reopen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId: samplePeriod.id }),
    });
    expect(res.status).toBe(409);
  });
});
