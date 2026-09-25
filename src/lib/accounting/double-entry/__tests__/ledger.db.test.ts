// Integración contra Postgres real (ver src/lib/accounting/__tests__/db-harness.ts).
// Se omite sin UTOPIA_TEST_DATABASE_URL.
//
// W3-C — listLedgerLines (GET /api/accounting/journal?view=ledger): líneas del
// mayor con saldo acumulado por cuenta desde el saldo anterior al período.

import { describe, it, expect, beforeAll, vi } from 'vitest';

import { HAS_TEST_DB, makeLedger, type TestLedger, type TestPeriod } from '@/lib/accounting/__tests__/db-harness';

vi.mock('@/lib/kpis/cache', () => ({ invalidatePillarKpis: async () => undefined }));

describe.skipIf(!HAS_TEST_DB)('listLedgerLines — Postgres', () => {
  let L: TestLedger;
  let jan: TestPeriod;
  let feb: TestPeriod;
  let saleId: string;

  beforeAll(async () => {
    L = await makeLedger('ledger-view');
    const { createEntry } = await import('@/lib/accounting/double-entry/service');
    jan = await L.period(2026, 1);
    feb = await L.period(2026, 2);
    const mk = (periodId: string, date: string, lines: Array<Record<string, unknown>>, status: 'posted' | 'draft' = 'posted') =>
      createEntry({
        workspaceId: L.workspaceId,
        periodId,
        entryDate: new Date(date),
        description: 'mov',
        status,
        lines: lines as never,
      });
    await mk(jan.id, '2026-01-05T00:00:00Z', [
      { accountId: L.acc['111005'], thirdPartyId: L.thirdPartyId, debit: '1000000.00', credit: '0' },
      { accountId: L.acc['311505'], debit: '0', credit: '1000000.00' },
    ]);
    const sale = await mk(feb.id, '2026-02-03T00:00:00Z', [
      { accountId: L.acc['111005'], thirdPartyId: L.thirdPartyId, debit: '500000.10', credit: '0' },
      { accountId: L.acc['413505'], costCenterId: L.costCenterId, debit: '0', credit: '500000.10' },
    ]);
    saleId = sale.entry.id;
    await mk(feb.id, '2026-02-04T00:00:00Z', [
      { accountId: L.acc['510506'], costCenterId: L.costCenterId, debit: '200000.00', credit: '0' },
      { accountId: L.acc['111005'], thirdPartyId: L.thirdPartyId, debit: '0', credit: '200000.00' },
    ]);
    // Borrador: no es libro.
    await mk(
      feb.id,
      '2026-02-05T00:00:00Z',
      [
        { accountId: L.acc['111005'], thirdPartyId: L.thirdPartyId, debit: '999.00', credit: '0' },
        { accountId: L.acc['311505'], debit: '0', credit: '999.00' },
      ],
      'draft',
    );
  }, 60_000);

  it('cuenta + período: saldo anterior y saldo acumulado exacto por línea; sin borradores', async () => {
    const { listLedgerLines } = await import('@/lib/accounting/double-entry/ledger');
    const r = await listLedgerLines({ workspaceId: L.workspaceId, periodId: feb.id, accountId: L.acc['111005'] });
    expect(r.openingBalances).toEqual([{ accountId: L.acc['111005'], balance: '1000000.00' }]);
    expect(r.lines.map((l) => [l.debit, l.credit, l.balance])).toEqual([
      ['500000.10', '0.00', '1500000.10'],
      ['0.00', '200000.00', '1300000.10'],
    ]);
    expect(r.lines[0].thirdParty?.identification).toBe('800197268');
    expect(r.truncated).toBe(false);
  });

  it('sin cuenta: el saldo de cada línea es el de SU cuenta, no una suma de cuentas', async () => {
    const { listLedgerLines } = await import('@/lib/accounting/double-entry/ledger');
    const r = await listLedgerLines({ workspaceId: L.workspaceId, periodId: feb.id });
    expect(r.lines.map((l) => [l.account.code, l.balance])).toEqual([
      ['111005', '1500000.10'],
      ['413505', '-500000.10'],
      ['510506', '200000.00'],
      ['111005', '1300000.10'],
    ]);
  });

  it('filtros de tercero (NIT) y centro de costo (código)', async () => {
    const { listLedgerLines } = await import('@/lib/accounting/double-entry/ledger');
    const tp = await listLedgerLines({ workspaceId: L.workspaceId, periodId: feb.id, thirdParty: '800197' });
    expect(tp.lines.map((l) => l.account.code)).toEqual(['111005', '111005']);
    const cc = await listLedgerLines({ workspaceId: L.workspaceId, periodId: feb.id, costCenter: 'AD' });
    expect(cc.lines.map((l) => l.account.code)).toEqual(['413505', '510506']);
    const none = await listLedgerLines({ workspaceId: L.workspaceId, periodId: feb.id, costCenter: '%' });
    expect(none.lines).toEqual([]);
  });

  it('límite: marca truncated; período de otro workspace ⇒ error', async () => {
    const { listLedgerLines } = await import('@/lib/accounting/double-entry/ledger');
    const r = await listLedgerLines({ workspaceId: L.workspaceId, periodId: feb.id, limit: 1 });
    expect(r.lines).toHaveLength(1);
    expect(r.truncated).toBe(true);
    const other = await makeLedger('ledger-other');
    await expect(listLedgerLines({ workspaceId: other.workspaceId, periodId: feb.id })).rejects.toThrow(
      /Período no encontrado/,
    );
  });

  it('un reverso aparece junto al original y el saldo vuelve', async () => {
    const { reverseEntry } = await import('@/lib/accounting/double-entry/service');
    const { listLedgerLines } = await import('@/lib/accounting/double-entry/ledger');
    await reverseEntry({
      workspaceId: L.workspaceId,
      originalEntryId: saleId,
      reason: 'prueba',
      entryDate: new Date('2026-02-06T00:00:00Z'),
    });
    const r = await listLedgerLines({ workspaceId: L.workspaceId, periodId: feb.id, accountId: L.acc['413505'] });
    expect(r.lines.map((l) => l.balance)).toEqual(['-500000.10', '0.00']);
    expect(r.lines[0].reversedByEntryId).not.toBeNull();
  });
});
