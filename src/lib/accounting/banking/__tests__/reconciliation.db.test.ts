// Integración contra Postgres real (ver src/lib/accounting/__tests__/db-harness.ts).
// Se omite sin UTOPIA_TEST_DATABASE_URL.
//
// contab-nomina-09: libros acumulados al corte vs extracto del MISMO período;
//                   sin extracto del período → no conciliable (no 0).
// contab-nomina-10: el matcher concilia 1:1 (una línea contable, un movimiento).

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { HAS_TEST_DB, makeLedger, rows, type TestLedger } from '@/lib/accounting/__tests__/db-harness';

vi.mock('@/lib/kpis/cache', () => ({ invalidatePillarKpis: async () => undefined }));

process.env.UTOPIA_ENABLE_BANK_RECON = 'true';

describe.skipIf(!HAS_TEST_DB)('conciliación bancaria — Postgres', () => {
  let L: TestLedger;
  let bankAccountId = '';

  beforeAll(async () => {
    L = await makeLedger('recon');
    const { getDb } = await import('@/lib/db/client');
    const { bankAccounts } = await import('@/lib/db/schema');
    const [ba] = await getDb()
      .insert(bankAccounts)
      .values({ workspaceId: L.workspaceId, accountId: L.acc['111005'], bankName: 'Banco', accountNumber: '123' })
      .returning();
    bankAccountId = ba.id;
  }, 60_000);

  async function deposit(periodId: string, date: string, amount: string) {
    const { createEntry } = await import('@/lib/accounting/double-entry/service');
    return createEntry({
      workspaceId: L.workspaceId,
      periodId,
      entryDate: new Date(date),
      description: 'Consignación cliente',
      status: 'posted',
      lines: [
        { accountId: L.acc['111005'], thirdPartyId: L.thirdPartyId, debit: amount, credit: '0' },
        { accountId: L.acc['421005'], debit: '0', credit: amount },
      ],
    });
  }

  it('contab-nomina-09: saldo en libros acumulado vs extracto del período; sin extracto → N/D', async () => {
    const { getDb } = await import('@/lib/db/client');
    const { bankStatementImports } = await import('@/lib/db/schema');
    const { bankReconciliationPort } = await import('@/lib/accounting/banking/services/status');
    const jan = await L.period(2026, 1);
    const feb = await L.period(2026, 2);
    await deposit(jan.id, '2026-01-05T00:00:00Z', '6000000.00');
    await deposit(feb.id, '2026-02-10T00:00:00Z', '500000.00');

    // Sin extracto de febrero (sólo uno de enero): no conciliable, bloquea.
    await getDb().insert(bankStatementImports).values({
      workspaceId: L.workspaceId, bankAccountId, filename: 'ene.csv', status: 'completed',
      periodStart: new Date('2026-01-01T00:00:00Z'), periodEnd: new Date('2026-01-31T00:00:00Z'), endingBalance: '6000000.00',
    });
    const [noStmt] = await bankReconciliationPort.getReconciliationStatus({ workspaceId: L.workspaceId, periodId: feb.id });
    expect(noStmt.ledgerBalanceCop).toBe('6500000.00');
    expect(noStmt.bankBalanceCop).toBeNull();
    expect(noStmt.reconcilable).toBe(false);
    expect(noStmt.blocking).toBe(true);

    // Enero concilia contra su propio extracto.
    const [janStatus] = await bankReconciliationPort.getReconciliationStatus({ workspaceId: L.workspaceId, periodId: jan.id });
    expect(janStatus.ledgerBalanceCop).toBe('6000000.00');
    expect(janStatus.differenceCop).toBe('0.00');
    expect(janStatus.blocking).toBe(false);

    // Con el extracto de febrero (saldo final 6.500.000): diferencia 0.
    await getDb().insert(bankStatementImports).values({
      workspaceId: L.workspaceId, bankAccountId, filename: 'feb.csv', status: 'completed',
      periodStart: new Date('2026-02-01T00:00:00Z'), periodEnd: new Date('2026-02-28T00:00:00Z'), endingBalance: '6500000.00',
    });
    const [withStmt] = await bankReconciliationPort.getReconciliationStatus({ workspaceId: L.workspaceId, periodId: feb.id });
    expect(withStmt.ledgerBalanceCop).toBe('6500000.00');
    expect(withStmt.bankBalanceCop).toBe('6500000.00');
    expect(withStmt.differenceCop).toBe('0.00');
    expect(withStmt.blocking).toBe(false);
  });

  it('contab-nomina-10: dos movimientos idénticos contra una sola línea → sólo uno se concilia', async () => {
    const { getDb } = await import('@/lib/db/client');
    const { bankTransactions } = await import('@/lib/db/schema');
    const { runReconciliation } = await import('@/lib/accounting/banking/services/reconciliation');
    const mar = await L.period(2026, 3);
    const { lines } = await deposit(mar.id, '2026-03-25T00:00:00Z', '777000.00');
    await getDb().insert(bankTransactions).values([
      { workspaceId: L.workspaceId, bankAccountId, postedAt: new Date('2026-03-25T00:00:00Z'), description: 'Consignación cliente', amount: '777000.00', fingerprint: 'fp-a' },
      { workspaceId: L.workspaceId, bankAccountId, postedAt: new Date('2026-03-25T00:00:00Z'), description: 'Consignación cliente', amount: '777000.00', fingerprint: 'fp-b' },
    ]);
    const res = await runReconciliation({ workspaceId: L.workspaceId, bankAccountId, periodId: mar.id });
    expect(res.autoMatched).toBe(1);
    expect(res.unmatchedCount).toBe(1);
    // Sin extracto de marzo: no conciliable (no se compara contra 0).
    expect(res.bankBalance).toBeNull();
    expect(res.difference).toBeNull();
    expect(res.status).toBe('open');
    const n = await rows<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n FROM bank_transactions WHERE matched_journal_line_id = ${lines[0].id}`);
    expect(n[0].n).toBe('1');
  });
});
