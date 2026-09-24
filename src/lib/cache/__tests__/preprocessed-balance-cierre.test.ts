// contab-nomina-04 (W3-C) — El compositor del balance desde el libro mayor
// sumaba el asiento de cierre anual (source_type 'closing', período 13), que
// lleva las clases 4-6 a cero contra 3605: el P&G del ejercicio cerrado (y el
// comparativo "cierre del año anterior") salía en $0. Debe excluir el cierre y
// sus reversos del ejercicio reportado, igual que pillar_kpis_view (migración
// 0022) y src/lib/kpis/pillar-view.ts, y conservarlos para años anteriores.
import { describe, expect, it, vi } from 'vitest';

const periods = vi.hoisted(() => [
  { id: 'p-dic25', workspaceId: 'ws', year: 2025, month: 12, status: 'closed' },
  { id: 'p-c25', workspaceId: 'ws', year: 2025, month: 13, status: 'closed' },
  { id: 'p-ago', workspaceId: 'ws', year: 2026, month: 8, status: 'open' },
]);

const ledger = vi.hoisted(() => ({
  extra: [] as Array<{
    periodId: string;
    accountId: string;
    debit: string;
    credit: string;
    closing: boolean;
  }>,
}));

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: async () => periods }) }),
  }),
}));

const acc = (id: string, code: string, type: string) => ({
  id, code, name: code, type, active: true, isPostable: true,
});
const tot = (
  periodId: string,
  accountId: string,
  debit: string,
  credit: string,
  closing = false,
) => ({ periodId, accountId, debit, credit, closing });

vi.mock('@/lib/cache/ledger-queries', () => ({
  getCachedAccountsFlat: async () => [
    acc('caja', '110505', 'ACTIVO'),
    acc('capital', '310505', 'PATRIMONIO'),
    acc('util', '360505', 'PATRIMONIO'),
    acc('ventas', '413550', 'INGRESO'),
    acc('gasto', '519595', 'GASTO'),
  ],
  getLedgerTotalsByPeriods: async (_ws: string, ids: string[]) =>
    [
      // Ejercicio 2025: capital 1.000, ventas 400, gasto 100 ⇒ utilidad 300.
      tot('p-dic25', 'capital', '0', '1000'),
      tot('p-dic25', 'caja', '1300', '0'),
      tot('p-dic25', 'ventas', '0', '400'),
      tot('p-dic25', 'gasto', '100', '0'),
      // Cierre anual 2025 (período 13): clases 4-5 a cero contra 360505.
      tot('p-c25', 'ventas', '400', '0', true),
      tot('p-c25', 'gasto', '0', '100', true),
      tot('p-c25', 'util', '0', '300', true),
      // Agosto 2026: ventas 900, gasto 50.
      tot('p-ago', 'caja', '900', '50'),
      tot('p-ago', 'ventas', '0', '900'),
      tot('p-ago', 'gasto', '50', '0'),
      ...ledger.extra,
    ].filter((t) => ids.includes(t.periodId)),
}));

import {
  getCachedPreprocessedBalance,
  loadTrialBalanceRows,
} from '@/lib/cache/preprocessed-balance';

const bal = (rows: Array<{ code: string; balancesByPeriod: Record<string, number> }>, code: string) =>
  rows.find((r) => r.code === code)?.balancesByPeriod;

describe('balance desde el libro mayor — asiento de cierre (contab-nomina-04)', () => {
  it('el período 13 conserva el P&G del ejercicio: el cierre no lo anula', async () => {
    ledger.extra = [];
    const { rows, primaryLabel } = await loadTrialBalanceRows({
      workspaceId: 'ws',
      periodId: 'p-c25',
    });
    expect(primaryLabel).toBe('2025');
    expect(bal(rows, '413550')).toEqual({ '2025': 400 });
    expect(bal(rows, '519595')).toEqual({ '2025': 100 });
    // La contrapartida del cierre tampoco cuenta: el resultado no se duplica.
    expect(bal(rows, '360505')).toEqual({ '2025': 0 });

    const { balance } = await getCachedPreprocessedBalance('ws', 'p-c25');
    const ct = balance!.primary.controlTotals;
    expect(ct.utilidadNeta).toBe(300);
    expect(Math.abs(ct.activo - (ct.pasivo + ct.patrimonio))).toBeLessThan(0.01);
  });

  it('el comparativo (cierre del año anterior) conserva su P&G; los años anteriores sí usan el cierre', async () => {
    ledger.extra = [];
    const { rows } = await loadTrialBalanceRows({
      workspaceId: 'ws',
      periodId: 'p-ago',
      comparativePeriodId: 'p-c25',
    });
    // 2026: sólo el año en curso; el resultado 2025 ya está en 360505 por el cierre.
    expect(bal(rows, '413550')).toEqual({ '2026-08': 900, '2025': 400 });
    expect(bal(rows, '519595')).toEqual({ '2026-08': 50, '2025': 100 });
    expect(bal(rows, '360505')).toEqual({ '2026-08': 300, '2025': 0 });
    // Con el cierre contabilizado no se inventa un traslado adicional a 3705.
    expect(rows.find((r) => r.code.startsWith('3705'))).toBeUndefined();

    const { balance } = await getCachedPreprocessedBalance('ws', 'p-ago', 'p-c25');
    // El cierre 2025 (período 13) es el comparativo, no el principal.
    expect(balance!.primary.period).toBe('2026-08');
    expect(balance!.comparative?.period).toBe('2025');
    const cur = balance!.primary.controlTotals;
    const comp = balance!.comparative!.controlTotals;
    expect(cur.utilidadNeta).toBe(850);
    expect(comp.utilidadNeta).toBe(300);
    expect(Math.abs(cur.activo - (cur.pasivo + cur.patrimonio))).toBeLessThan(0.01);
    expect(Math.abs(comp.activo - (comp.pasivo + comp.patrimonio))).toBeLessThan(0.01);
  });

  it('un reverso del cierre posteado en el año de T no mete el resultado anterior en el P&G de T', async () => {
    // Reverso (closing = true) del cierre 2025, posteado en agosto 2026.
    ledger.extra = [
      tot('p-ago', 'ventas', '0', '400', true),
      tot('p-ago', 'gasto', '100', '0', true),
      tot('p-ago', 'util', '300', '0', true),
    ];
    const { rows } = await loadTrialBalanceRows({ workspaceId: 'ws', periodId: 'p-ago' });
    expect(bal(rows, '413550')).toEqual({ '2026-08': 900 });
    expect(bal(rows, '519595')).toEqual({ '2026-08': 50 });
    expect(bal(rows, '360505')).toEqual({ '2026-08': 300 });
    ledger.extra = [];
  });

  it('período 13 como principal: diciembre del mismo año no es comparativo (mismo corte)', async () => {
    ledger.extra = [];
    const { primaryLabel, comparativeLabel } = await loadTrialBalanceRows({
      workspaceId: 'ws',
      periodId: 'p-c25',
      comparativePeriodId: 'p-dic25',
    });
    expect(primaryLabel).toBe('2025');
    expect(comparativeLabel).toBeNull();
  });
});
