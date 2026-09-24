// ratios-kpis-05 — EBITDA con UNA sola definición para tarjeta, barras y PDF.
import { describe, it, expect } from 'vitest';

import { computeEbitda } from '../ebitda';
import { computeValorExecutiveCards } from '../valor-cards';
import { buildValorBarSeries } from '../valor-bars';
import { makeClass, makeControlTotals, makePnlSnapshot, makeSnapshot } from './_fixtures';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

function balanceOf(...periods: ReturnType<typeof makePnlSnapshot>[]): PreprocessedBalance {
  return {
    periods,
    primary: periods[periods.length - 1],
    comparative: periods.length > 1 ? periods[periods.length - 2] : null,
    rawRows: [],
    auxiliaryCount: 0,
    cleanData: '',
    validationReport: '',
    comparativos_impracticables: periods.length < 2,
    reclasificacionesNoCompensacion: [],
  };
}

describe('computeEbitda — definición canónica', () => {
  it('EBIT operacional (41 − 4175 − 6 − 7 − 51 − 52) + D&A (5160/5165/5260/5265/7360)', () => {
    const r = computeEbitda(makePnlSnapshot());
    expect(r.ingresosOperacionalesNetos).toBe(1_920_000_000);
    expect(r.utilidadOperacional).toBe(270_000_000);
    expect(r.depreciaciones).toBe(60_000_000); // 5160 20M + 5260 30M + 7360 10M
    expect(r.amortizaciones).toBe(10_000_000); // 5265
    expect(r.ebitda).toBe(340_000_000);
  });

  it('no suma de vuelta impuesto (54) ni financieros (53) ni ingresos 42', () => {
    const snap = makePnlSnapshot();
    const r = computeEbitda(snap);
    // Si se partiera de la utilidad neta (345M) el resultado incluiría el 42.
    expect(r.ebitda).not.toBe(snap.controlTotals.utilidadNeta + 95_000_000 + 30_000_000 + 70_000_000);
  });

  it('sin grupo 41 → null con motivo (nunca una aproximación desde la utilidad neta)', () => {
    const snap = makeSnapshot(
      makeControlTotals({ ingresos: 1_000_000_000, utilidadNeta: 100_000_000 }),
      [makeClass(5, [{ code: '519595', balance: 900_000_000 }])],
    );
    const r = computeEbitda(snap);
    expect(r.ebitda).toBeNull();
    expect(r.reason).toMatch(/grupo 41/);
  });
});

describe('Superficies consumen la misma cifra', () => {
  it('tarjeta EBITDA = barras = computeEbitda', () => {
    const snap = makePnlSnapshot();
    const expected = computeEbitda(snap).ebitda;
    const cards = computeValorExecutiveCards({ snapshot: snap });
    expect(cards.ebitda.value).toBe(expected);

    const prev = makePnlSnapshot('2025');
    const bars = buildValorBarSeries(balanceOf(prev, snap));
    expect(bars[bars.length - 1].ebitda).toBe(expected);
  });

  it('margen EBITDA sobre ingresos operacionales netos (340 / 1.920)', () => {
    const cards = computeValorExecutiveCards({ snapshot: makePnlSnapshot() });
    expect(cards.waoo.value).toBeCloseTo(340 / 1920, 10);
    expect(cards.waoo.status).toBe('healthy'); // 17,7 %
  });
});
