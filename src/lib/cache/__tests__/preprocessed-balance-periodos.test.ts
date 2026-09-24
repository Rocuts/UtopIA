// ratios-kpis-03 — El libro mayor mensual se etiquetaba con String(year): para
// cualquier mes ≠ enero, T (2026-08) y T-1 (2026-07) compartían la clave '2026'
// y el comparativo SOBRESCRIBÍA al actual. Además las clases 1-3 sólo tenían
// los movimientos del mes (sin arrastre de saldos).
import { describe, expect, it, vi } from 'vitest';

const periods = vi.hoisted(() => [
  { id: 'p-dic25', workspaceId: 'ws', year: 2025, month: 12, status: 'closed' },
  { id: 'p-jul', workspaceId: 'ws', year: 2026, month: 7, status: 'closed' },
  { id: 'p-ago', workspaceId: 'ws', year: 2026, month: 8, status: 'open' },
]);

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: async () => periods }) }),
  }),
}));

const acc = (id: string, code: string, type: string) => ({
  id, code, name: code, type, active: true, isPostable: true,
});
const tot = (periodId: string, accountId: string, debit: string, credit: string) => ({
  periodId, accountId, debit, credit,
});

vi.mock('@/lib/cache/ledger-queries', () => ({
  getCachedAccountsFlat: async () => [
    acc('caja', '110505', 'ACTIVO'),
    acc('ventas', '413550', 'INGRESO'),
    acc('capital', '310505', 'PATRIMONIO'),
    acc('gasto', '519595', 'GASTO'),
  ],
  getLedgerTotalsByPeriods: async (_ws: string, ids: string[]) =>
    [
      // Diciembre 2025: aporte de capital + ventas del año 2025 (sin asiento de cierre)
      tot('p-dic25', 'capital', '0', '1000'),
      tot('p-dic25', 'caja', '1300', '0'),
      tot('p-dic25', 'ventas', '0', '300'),
      // Julio 2026: ventas 100
      tot('p-jul', 'caja', '100', '0'),
      tot('p-jul', 'ventas', '0', '100'),
      // Agosto 2026: ventas 900, gasto 50
      tot('p-ago', 'caja', '900', '50'),
      tot('p-ago', 'ventas', '0', '900'),
      tot('p-ago', 'gasto', '50', '0'),
    ].filter((t) => ids.includes(t.periodId)),
}));

import {
  findComparativePeriod,
  getCachedPreprocessedBalance,
  loadTrialBalanceRows,
} from '@/lib/cache/preprocessed-balance';

const bal = (rows: Array<{ code: string; balancesByPeriod: Record<string, number> }>, code: string) =>
  rows.find((r) => r.code === code)?.balancesByPeriod;

describe('libro mayor mensual → balance por periodo', () => {
  it('la clave distingue el mes (YYYY-MM) y el comparativo no pisa al actual', async () => {
    const { rows, primaryLabel, comparativeLabel } = await loadTrialBalanceRows({
      workspaceId: 'ws',
      periodId: 'p-ago',
      comparativePeriodId: 'p-jul',
    });
    expect(primaryLabel).toBe('2026-08');
    expect(comparativeLabel).toBe('2026-07');
    // Resultados: acumulado del año (enero..mes), no sólo el mes.
    expect(bal(rows, '413550')).toEqual({ '2026-08': 1000, '2026-07': 100 });
    expect(bal(rows, '519595')).toEqual({ '2026-08': 50, '2026-07': 0 });
  });

  it('las clases 1-3 son saldos ACUMULADOS al cierre (apertura + movimientos)', async () => {
    const { rows } = await loadTrialBalanceRows({
      workspaceId: 'ws',
      periodId: 'p-ago',
      comparativePeriodId: 'p-jul',
    });
    expect(bal(rows, '110505')).toEqual({ '2026-08': 2250, '2026-07': 1400 });
    expect(bal(rows, '310505')).toEqual({ '2026-08': 1000, '2026-07': 1000 });
  });

  it('el resultado de años anteriores sin asiento de cierre se traslada al patrimonio (ecuación cuadra)', async () => {
    const { rows } = await loadTrialBalanceRows({
      workspaceId: 'ws',
      periodId: 'p-ago',
      comparativePeriodId: 'p-jul',
    });
    const prior = rows.find((r) => r.code.startsWith('3705'));
    expect(prior?.balancesByPeriod).toEqual({ '2026-08': 300, '2026-07': 300 });

    const { balance } = await getCachedPreprocessedBalance('ws', 'p-ago', 'p-jul');
    expect(balance?.primary.period).toBe('2026-08');
    expect(balance?.comparative?.period).toBe('2026-07');
    const ct = balance!.primary.controlTotals;
    expect(ct.efectivoCuenta11).toBe(2250);
    expect(ct.utilidadNeta).toBe(950);
    expect(Math.abs(ct.activo - (ct.pasivo + ct.patrimonio))).toBeLessThan(0.01);
  });

  it('el comparativo es el cierre del año anterior (base consistente con resultados acumulados)', async () => {
    const current = periods.find((p) => p.id === 'p-ago')!;
    const comp = await findComparativePeriod('ws', current as never);
    expect(comp?.id).toBe('p-dic25');
  });
});
