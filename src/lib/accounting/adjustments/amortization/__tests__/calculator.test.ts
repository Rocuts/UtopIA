// contab-nomina-15: amortización por acumulado esperado — el residuo de
// redondeo y los meses no corridos se recuperan; el saldo termina en cero.
import { describe, it, expect } from 'vitest';
import { calculateAmortization } from '../calculator';
import type { AccountingPeriodRow, DeferredAssetRow } from '@/lib/db/schema';

type Asset = DeferredAssetRow & { lastAmortizedPeriod?: { year: number; month: number } | null };

function period(year: number, month: number): AccountingPeriodRow {
  return {
    id: `p-${year}-${month}`,
    workspaceId: 'ws',
    year,
    month,
    status: 'open',
    startsAt: new Date(Date.UTC(year, month - 1, 1)),
    endsAt: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
    closedAt: null,
    closedBy: null,
    lockedAt: null,
  } as AccountingPeriodRow;
}

function asset(over: Partial<Asset>): Asset {
  return {
    id: 'd1',
    workspaceId: 'ws',
    description: 'Seguro',
    category: 'insurance',
    assetAccountId: 'acc-170520',
    expenseAccountId: 'acc-513025',
    totalAmount: '1000000.00',
    amortizationStart: new Date('2026-01-15T00:00:00Z'),
    amortizationEnd: new Date('2026-04-14T00:00:00Z'),
    amortizedAmount: '0',
    lastAmortizedPeriodId: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAmortizedPeriod: null,
    ...over,
  } as Asset;
}

function cents(s: string): bigint {
  const [i, f = ''] = s.split('.');
  return BigInt(i) * BigInt(100) + BigInt((f + '00').slice(0, 2));
}

function fromCents(c: bigint): string {
  return `${c / BigInt(100)}.${(c % BigInt(100)).toString().padStart(2, '0')}`;
}

/** Corre la amortización mes a mes sobre `months`, aplicando el estado. */
function run(start: Asset, months: Array<[number, number]>) {
  let amortized = '0';
  let last: { year: number; month: number } | null = null;
  const posted: Record<string, string> = {};
  for (const [y, m] of months) {
    const r = calculateAmortization({
      workspaceId: 'ws',
      period: period(y, m),
      entryDate: period(y, m).endsAt,
      deferredAssets: [{ ...start, amortizedAmount: amortized, lastAmortizedPeriod: last }],
    });
    if (r.lines.length > 0) {
      posted[`${y}-${m}`] = r.lines[0].monthlyAmountCop;
      amortized = r.lines[0].newAmortizedCop;
      last = { year: y, month: m };
    }
  }
  return { amortized, posted };
}

describe('calculateAmortization — acumulado esperado (contab-nomina-15)', () => {
  it('$1.000.000 del 15-ene al 14-abr: amortiza exactamente el total (antes quedaban 2 centavos)', () => {
    const { amortized } = run(asset({}), [
      [2026, 1],
      [2026, 2],
      [2026, 3],
      [2026, 4],
      [2026, 5],
    ]);
    expect(amortized).toBe('1000000.00');
  });

  it('un mes no corrido se recupera en el siguiente y el año cierra en cero', () => {
    const a = asset({
      totalAmount: '1200000.00',
      amortizationStart: new Date('2026-01-01T00:00:00Z'),
      amortizationEnd: new Date('2026-12-31T00:00:00Z'),
    });
    const months: Array<[number, number]> = [];
    for (let m = 1; m <= 12; m++) if (m !== 3) months.push([2026, m]);
    const { amortized, posted } = run(a, months);
    expect(amortized).toBe('1200000.00');
    // Abril carga marzo + abril (61 días de 365).
    const expectedAprCum = (cents('1200000.00') * BigInt(120)) / BigInt(365);
    const expectedFebCum = (cents('1200000.00') * BigInt(59)) / BigInt(365);
    expect(posted['2026-4']).toBe(fromCents(expectedAprCum - expectedFebCum));
  });

  it('si el cierre se corre después de amortization_end, amortiza todo el pendiente (antes period_out_of_range)', () => {
    const r = calculateAmortization({
      workspaceId: 'ws',
      period: period(2026, 6),
      entryDate: period(2026, 6).endsAt,
      deferredAssets: [asset({ amortizedAmount: '600000.00', lastAmortizedPeriod: { year: 2026, month: 2 } })],
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].monthlyAmountCop).toBe('400000.00');
    expect(r.lines[0].remainingCop).toBe('0.00');
  });

  it('antes del inicio: period_out_of_range; período 13: closing_period', () => {
    const before = calculateAmortization({
      workspaceId: 'ws',
      period: period(2025, 12),
      entryDate: period(2025, 12).endsAt,
      deferredAssets: [asset({})],
    });
    expect(before.skipped[0].reason).toBe('period_out_of_range');
    const p13 = { ...period(2026, 12), month: 13 } as AccountingPeriodRow;
    const closing = calculateAmortization({
      workspaceId: 'ws',
      period: p13,
      entryDate: p13.endsAt,
      deferredAssets: [asset({})],
    });
    expect(closing.skipped[0].reason).toBe('closing_period');
  });

  it('la llave de idempotencia distingue la amortización del período', () => {
    const r = calculateAmortization({
      workspaceId: 'ws',
      period: period(2026, 2),
      entryDate: period(2026, 2).endsAt,
      deferredAssets: [asset({})],
    });
    expect(r.proposedEntry?.sourceRef).toBe('period:p-2026-2:amortization');
  });
});
