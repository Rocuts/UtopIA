// repeated-amounts.test.ts — Montos repetidos.

import { describe, it, expect } from 'vitest';
import { detectRepeatedAmounts } from '../rules/repeated-amounts';

type Occurrence = {
  entryId: string;
  amount: number;
  date: Date;
  thirdPartyId: string | null;
};

function makeOccurrences(
  amount: number,
  count: number,
  startDate: Date = new Date('2026-01-05T00:00:00Z'),
  daySpacing = 1,
): Occurrence[] {
  return Array.from({ length: count }, (_, i) => ({
    entryId: `entry-${amount}-${i}`,
    amount,
    date: new Date(startDate.getTime() + i * daySpacing * 24 * 60 * 60 * 1000),
    thirdPartyId: `tp-${i % 2}`,
  }));
}

describe('detectRepeatedAmounts', () => {
  it('montos variados (sin repetición excesiva) → sin anomalías', () => {
    const occs: Occurrence[] = [
      { entryId: 'e1', amount: 150_000, date: new Date('2026-01-05'), thirdPartyId: 'tp1' },
      { entryId: 'e2', amount: 280_000, date: new Date('2026-01-06'), thirdPartyId: 'tp2' },
      { entryId: 'e3', amount: 430_000, date: new Date('2026-01-07'), thirdPartyId: 'tp3' },
      { entryId: 'e4', amount: 750_000, date: new Date('2026-01-08'), thirdPartyId: 'tp4' },
      { entryId: 'e5', amount: 990_000, date: new Date('2026-01-09'), thirdPartyId: 'tp5' },
    ];
    const result = detectRepeatedAmounts(occs, {
      commonRoundAmounts: new Set([750_000]),
    });
    expect(result).toHaveLength(0);
  });

  it('monto $170.000 repetido 5 veces en 7 días → anomalía medium', () => {
    const occs = makeOccurrences(170_000, 5, new Date('2026-01-05T00:00:00Z'), 1);
    const result = detectRepeatedAmounts(occs, {
      minWeeklyRepeats: 5,
      minPeriodRepeats: 8,
      commonRoundAmounts: new Set(),
    });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('repeated_amount');
    expect(result[0].severity).toBe('medium');
    expect(result[0].evidence.amount).toBe(170_000);
    expect(result[0].evidence.count).toBe(5);
  });

  it('monto $500.000 (común, en lista de excepción) → sin anomalía', () => {
    const occs = makeOccurrences(500_000, 10, new Date('2026-01-05T00:00:00Z'), 1);
    const result = detectRepeatedAmounts(occs, {
      minWeeklyRepeats: 5,
      minPeriodRepeats: 8,
      commonRoundAmounts: new Set([500_000]),
    });
    expect(result).toHaveLength(0);
  });

  it('monto repetido 8+ veces en el período (no necesariamente semanal) → anomalía', () => {
    // 8 ocurrencias en 30 días (no semanal)
    const occs = makeOccurrences(230_000, 8, new Date('2026-01-01T00:00:00Z'), 4);
    const result = detectRepeatedAmounts(occs, {
      minWeeklyRepeats: 5,
      minPeriodRepeats: 8,
      commonRoundAmounts: new Set(),
    });
    expect(result).toHaveLength(1);
    expect(result[0].evidence.count).toBe(8);
  });

  it('montos menores que el umbral mínimo se ignoran', () => {
    // $50.000 < $100.000 threshold
    const occs = makeOccurrences(50_000, 10, new Date('2026-01-05T00:00:00Z'), 1);
    const result = detectRepeatedAmounts(occs, {
      minAmountCop: 100_000,
      commonRoundAmounts: new Set(),
    });
    expect(result).toHaveLength(0);
  });
});
