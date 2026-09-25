// Integración contra Postgres real (ver src/lib/accounting/__tests__/db-harness.ts).
// Se omite sin UTOPIA_TEST_DATABASE_URL.
//
// contab-nomina-04 (W3-C): el balance compuesto desde el libro mayor excluye
// del ejercicio reportado el asiento de cierre anual (período 13) y los
// reversos de un cierre, igual que pillar_kpis_view (migración 0022).

import { describe, it, expect, beforeAll, vi } from 'vitest';

import { HAS_TEST_DB, makeLedger, type TestLedger, type TestPeriod } from '@/lib/accounting/__tests__/db-harness';

vi.mock('@/lib/kpis/cache', () => ({ invalidatePillarKpis: async () => undefined }));

describe.skipIf(!HAS_TEST_DB)('balance desde el libro mayor con cierre anual — Postgres', () => {
  let L: TestLedger;
  let p13: TestPeriod;
  let feb: TestPeriod;
  let closingEntryId: string;

  const bal = (rows: Array<{ code: string; balancesByPeriod: Record<string, number> }>, code: string) =>
    rows.find((r) => r.code === code)?.balancesByPeriod;

  beforeAll(async () => {
    L = await makeLedger('cache-cierre');
    const { createEntry } = await import('@/lib/accounting/double-entry/service');
    const { generateClosingEntry } = await import('@/lib/workflows/monthly-close/steps/closing-entry');
    const mar = await L.period(2027, 3);
    const dec = await L.period(2027, 12);
    p13 = await L.period(2027, 13);
    feb = await L.period(2028, 2);
    const mk = (periodId: string, date: string, lines: Array<Record<string, unknown>>) =>
      createEntry({
        workspaceId: L.workspaceId,
        periodId,
        entryDate: new Date(date),
        description: 'mov',
        status: 'posted',
        lines: lines as never,
      });
    // 2027: aporte 10M, ventas 10M, sueldos 4M ⇒ utilidad 6M.
    await mk(mar.id, '2027-03-15T00:00:00Z', [
      { accountId: L.acc['111005'], thirdPartyId: L.thirdPartyId, debit: '20000000.00', credit: '0' },
      { accountId: L.acc['311505'], debit: '0', credit: '10000000.00' },
      { accountId: L.acc['413505'], costCenterId: L.costCenterId, debit: '0', credit: '10000000.00' },
    ]);
    await mk(dec.id, '2027-12-20T00:00:00Z', [
      { accountId: L.acc['510506'], costCenterId: L.costCenterId, debit: '4000000.00', credit: '0' },
      { accountId: L.acc['111005'], thirdPartyId: L.thirdPartyId, debit: '0', credit: '4000000.00' },
    ]);
    const res = await generateClosingEntry({ workspaceId: L.workspaceId, periodId: p13.id, runId: 'r-13' });
    expect(res.retainedEarningsAccountCode).toBe('360505');
    closingEntryId = res.closingEntryId;
    // 2028: ventas 3M, sueldos 1M ⇒ utilidad 2M.
    await mk(feb.id, '2028-02-10T00:00:00Z', [
      { accountId: L.acc['111005'], thirdPartyId: L.thirdPartyId, debit: '3000000.00', credit: '0' },
      { accountId: L.acc['413505'], costCenterId: L.costCenterId, debit: '0', credit: '3000000.00' },
    ]);
    await mk(feb.id, '2028-02-11T00:00:00Z', [
      { accountId: L.acc['510506'], costCenterId: L.costCenterId, debit: '1000000.00', credit: '0' },
      { accountId: L.acc['111005'], thirdPartyId: L.thirdPartyId, debit: '0', credit: '1000000.00' },
    ]);
  }, 60_000);

  it('el período 13 conserva el P&G del ejercicio y no duplica el resultado en 360505', async () => {
    const { loadTrialBalanceRows } = await import('@/lib/cache/preprocessed-balance');
    const { rows, primaryLabel } = await loadTrialBalanceRows({ workspaceId: L.workspaceId, periodId: p13.id });
    expect(primaryLabel).toBe('2027');
    expect(bal(rows, '413505')).toEqual({ '2027': 10_000_000 });
    expect(bal(rows, '510506')).toEqual({ '2027': 4_000_000 });
    expect(bal(rows, '360505')).toEqual({ '2027': 0 });
  });

  it('con el comparativo automático (el 13 del año anterior) el principal es el periodo en curso', async () => {
    const { findComparativePeriod, getCachedPreprocessedBalance } = await import('@/lib/cache/preprocessed-balance');
    const comp = await findComparativePeriod(L.workspaceId, { ...feb, workspaceId: L.workspaceId } as never);
    expect(comp?.id).toBe(p13.id);
    const { balance } = await getCachedPreprocessedBalance(L.workspaceId, feb.id, comp!.id);
    expect(balance!.primary.period).toBe('2028-02');
    expect(balance!.comparative?.period).toBe('2027');
    const cur = balance!.primary.controlTotals;
    const prev = balance!.comparative!.controlTotals;
    expect(cur.utilidadNeta).toBe(2_000_000);
    expect(prev.utilidadNeta).toBe(6_000_000);
    expect(Math.abs(cur.activo - (cur.pasivo + cur.patrimonio))).toBeLessThan(0.01);
    expect(Math.abs(prev.activo - (prev.pasivo + prev.patrimonio))).toBeLessThan(0.01);
  });

  it('el reverso del cierre posteado en 2028 no mete el resultado 2027 en el P&G de 2028', async () => {
    const { reverseEntry } = await import('@/lib/accounting/double-entry/service');
    await reverseEntry({
      workspaceId: L.workspaceId,
      originalEntryId: closingEntryId,
      reason: 'prueba: reverso del cierre',
      entryDate: new Date('2028-02-15T00:00:00Z'),
    });
    const { loadTrialBalanceRows, getCachedPreprocessedBalance } = await import('@/lib/cache/preprocessed-balance');
    const { rows } = await loadTrialBalanceRows({ workspaceId: L.workspaceId, periodId: feb.id });
    expect(bal(rows, '413505')).toEqual({ '2028-02': 3_000_000 });
    expect(bal(rows, '510506')).toEqual({ '2028-02': 1_000_000 });
    const { balance } = await getCachedPreprocessedBalance(L.workspaceId, feb.id);
    const ct = balance!.primary.controlTotals;
    expect(ct.utilidadNeta).toBe(2_000_000);
    expect(Math.abs(ct.activo - (ct.pasivo + ct.patrimonio))).toBeLessThan(0.01);
  });
});
