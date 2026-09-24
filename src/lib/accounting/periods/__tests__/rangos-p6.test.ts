// contab-nomina-26 — el período 13 comparte con diciembre el instante de fin
// de año y los rangos explícitos no se validaban: la búsqueda del período de
// una fecha no era determinista y se podían crear períodos solapados.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  findOverlappingPeriod,
  pickPeriodForDate,
  yearEndAdjustmentsInstant,
  type PeriodRange,
} from '../ranges';

const existing = vi.hoisted(() => ({ rows: [] as unknown[] }));
const inserted = vi.hoisted(() => ({ calls: 0 }));

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/db/workspace', () => ({ getOrCreateWorkspace: async () => ({ id: 'ws-1' }) }));
vi.mock('@/lib/accounting/actions/_auth-gate', () => ({ denyIfNoSession: async () => null }));
vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: async () => existing.rows }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          inserted.calls++;
          return [{ id: 'new', status: 'open', ...v }];
        },
      }),
    }),
  }),
}));

import { createPeriodAction } from '@/lib/accounting/actions/period-actions';

function month(year: number, m: number, id = `${year}-${m}`): PeriodRange {
  return {
    id,
    year,
    month: m,
    startsAt: new Date(Date.UTC(year, m - 1, 1)),
    endsAt: new Date(Date.UTC(year, m, 0, 23, 59, 59, 999)),
  };
}
function p13(year: number): PeriodRange {
  const t = yearEndAdjustmentsInstant(year);
  return { id: `${year}-13`, year, month: 13, startsAt: t, endsAt: t };
}

beforeEach(() => {
  existing.rows = [];
  inserted.calls = 0;
});

describe('pickPeriodForDate — elección determinista', () => {
  it('el instante de fin de año se ubica en diciembre, no en el período 13, en cualquier orden', () => {
    const t = yearEndAdjustmentsInstant(2026);
    expect(pickPeriodForDate([p13(2026), month(2026, 12)], t)?.month).toBe(12);
    expect(pickPeriodForDate([month(2026, 12), p13(2026)], t)?.month).toBe(12);
  });

  it('sólo el período 13 contiene la fecha → se usa el 13', () => {
    expect(pickPeriodForDate([p13(2026)], yearEndAdjustmentsInstant(2026))?.month).toBe(13);
  });

  it('sin período que la contenga → null', () => {
    expect(pickPeriodForDate([month(2026, 1)], new Date('2026-02-10T12:00:00Z'))).toBeNull();
  });
});

describe('findOverlappingPeriod', () => {
  it('un rango explícito que invade el mes vecino se detecta', () => {
    const cand: PeriodRange = {
      year: 2026, month: 2,
      startsAt: new Date('2026-01-25T00:00:00Z'), endsAt: new Date('2026-02-28T23:59:59.999Z'),
    };
    expect(findOverlappingPeriod(cand, [month(2026, 1)])?.month).toBe(1);
  });

  it('meses contiguos y el período 13 frente a diciembre no son solapamiento', () => {
    expect(findOverlappingPeriod(month(2026, 2), [month(2026, 1), month(2026, 3)])).toBeNull();
    expect(findOverlappingPeriod(month(2026, 12), [p13(2026)])).toBeNull();
    expect(findOverlappingPeriod(p13(2026), [month(2026, 12)])).toBeNull();
  });
});

describe('createPeriodAction — rangos disjuntos', () => {
  it('rechaza con PERIOD_OVERLAP un rango explícito que se solapa y no inserta', async () => {
    existing.rows = [month(2026, 1)];
    const r = await createPeriodAction({
      year: 2026, month: 2, startsAt: '2026-01-20T00:00:00Z', endsAt: '2026-02-28T23:59:59.999Z',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PERIOD_OVERLAP');
    expect(inserted.calls).toBe(0);
  });

  it('rechaza fechas explícitas para el período 13', async () => {
    const r = await createPeriodAction({
      year: 2026, month: 13, startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-12-31T23:59:59.999Z',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT');
    expect(inserted.calls).toBe(0);
  });

  it('un mes sin solapamiento se crea', async () => {
    existing.rows = [month(2026, 1), month(2026, 3), p13(2025)];
    const r = await createPeriodAction({ year: 2026, month: 2 });
    expect(r.ok).toBe(true);
    expect(inserted.calls).toBe(1);
  });
});
