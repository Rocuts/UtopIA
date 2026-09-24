// ---------------------------------------------------------------------------
// Pyme — margen porcentual del resumen mensual (integración fase 2, P6).
//
// `monthlySummary` fijaba `margenPct = 0` cuando el mes no tenía ingresos:
// un mes con $500.000 de egresos y $0 de ingresos salía con "margen 0 %"
// (ni pérdida ni N/D). Sin ingresos el margen porcentual no existe: la API
// entrega `null` y cada consumidor lo muestra N/D.
//
// Todo el I/O está mockeado: cada SELECT consume la siguiente fila de la cola
// en el orden de `monthlySummary` (totales → top ingresos → top egresos →
// mes anterior).
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

let queue: unknown[][] = [];

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeSelectChain() {
  const rows = queue.shift() ?? [];
  const chain: any = {
    from: () => chain,
    where: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({ select: () => makeSelectChain() }),
}));
/* eslint-enable @typescript-eslint/no-explicit-any */

import { monthlySummary } from '../pyme';

function enqueue(totals: { ingresos: string; egresos: string; entryCount: number }) {
  queue = [[totals], [], [], [{ ingresos: '0', egresos: '0', count: 0 }]];
}

beforeEach(() => {
  queue = [];
});

describe('monthlySummary — margenPct', () => {
  it('con ingresos es la fracción margen / ingresos', async () => {
    enqueue({ ingresos: '8000000', egresos: '7000000', entryCount: 4 });
    const s = await monthlySummary('b-1', 2026, 3);
    expect(s.totals.margen).toBe(1_000_000);
    expect(s.totals.margenPct).toBeCloseTo(0.125, 12);
  });

  it('sin ingresos y con egresos es null (N/D), no 0', async () => {
    enqueue({ ingresos: '0', egresos: '500000', entryCount: 2 });
    const s = await monthlySummary('b-1', 2026, 3);
    expect(s.totals.margen).toBe(-500_000);
    expect(s.totals.margenPct).toBeNull();
  });

  it('mes vacío: margenPct null', async () => {
    enqueue({ ingresos: '0', egresos: '0', entryCount: 0 });
    const s = await monthlySummary('b-1', 2026, 3);
    expect(s.totals.margenPct).toBeNull();
    expect(s.previous).toBeNull();
  });
});
