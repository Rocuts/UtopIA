// ---------------------------------------------------------------------------
// POST /api/accounting/periods — rangos disjuntos (contab-nomina-26).
// ---------------------------------------------------------------------------
// P6 hizo que createPeriodAction rechazara rangos que se solapan y fechas
// explícitas para el período 13, pero la ruta HTTP seguía insertando lo que
// llegara: un cliente podía crear marzo con startsAt en febrero, o mover el
// período 13 fuera del 31-dic 23:59:59.999, y reverseEntry / el cierre
// quedaban con dos períodos para la misma fecha. La ruta reutiliza ahora
// findOverlappingPeriod e isCanonicalYearEndRange (periods/ranges.ts).
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state } = vi.hoisted(() => ({
  state: {
    existing: [] as Array<{ id: string; year: number; month: number; startsAt: Date; endsAt: Date }>,
    inserted: [] as unknown[],
  },
}));

vi.mock('@/lib/auth/require-session', () => ({
  requireAuthSession: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/db/workspace', () => ({
  getOrCreateWorkspace: vi.fn(async () => ({ id: 'ws-1' })),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: () => {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(state.existing).then(resolve, reject),
      };
      return chain;
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          state.inserted.push(v);
          return [{ id: 'nuevo', ...v }];
        },
      }),
    }),
  }),
}));
/* eslint-enable @typescript-eslint/no-explicit-any */

import { POST } from '../route';

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/accounting/periods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

function month(year: number, m: number, id = `p-${year}-${m}`) {
  return {
    id,
    year,
    month: m,
    startsAt: new Date(Date.UTC(year, m - 1, 1)),
    endsAt: new Date(Date.UTC(year, m, 0, 23, 59, 59, 999)),
  };
}

beforeEach(() => {
  state.existing = [];
  state.inserted = [];
});

describe('POST /api/accounting/periods — rangos', () => {
  it('crea un mes sin fechas explícitas (rango calculado)', async () => {
    state.existing = [month(2026, 1), month(2026, 2)];
    const res = await post({ year: 2026, month: 3 });
    expect(res.status).toBe(201);
    expect(state.inserted).toHaveLength(1);
  });

  it('rechaza con 409 un rango explícito que se solapa con otro mes', async () => {
    state.existing = [month(2026, 2)];
    const res = await post({
      year: 2026,
      month: 3,
      startsAt: '2026-02-15T00:00:00.000Z',
      endsAt: '2026-03-31T23:59:59.999Z',
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('period_overlap');
    expect(body.message).toContain('2026-02');
    expect(state.inserted).toHaveLength(0);
  });

  it('el período 13 no admite fechas explícitas distintas del cierre canónico', async () => {
    const res = await post({
      year: 2026,
      month: 13,
      startsAt: '2026-12-01T00:00:00.000Z',
      endsAt: '2026-12-31T23:59:59.999Z',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_period_range');
    expect(state.inserted).toHaveLength(0);
  });

  it('el período 13 con su instante canónico (explícito o calculado) se crea aunque exista diciembre', async () => {
    state.existing = [month(2026, 12)];
    const canon = '2026-12-31T23:59:59.999Z';
    const r1 = await post({ year: 2026, month: 13, startsAt: canon, endsAt: canon });
    expect(r1.status).toBe(201);
    const r2 = await post({ year: 2027, month: 13 });
    expect(r2.status).toBe(201);
    expect(state.inserted).toHaveLength(2);
  });

  it('un rango con startsAt posterior a endsAt tras completar con el calculado es 400', async () => {
    // Sólo startsAt explícito: el fin sale del mes calculado y queda antes.
    const res = await post({ year: 2026, month: 3, startsAt: '2026-04-10T00:00:00.000Z' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_period_range');
    expect(state.inserted).toHaveLength(0);
  });
});
