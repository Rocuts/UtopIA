// Integración contra Postgres real (ver db-harness.ts). Se omite sin
// UTOPIA_TEST_DATABASE_URL.
//
// contab-nomina-01: original + reverso netean a cero en todas las superficies.
// contab-nomina-12: se persiste exactamente el monto validado.
// contab-nomina-13: inmutabilidad de asientos/líneas posteados en la BD.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { sql, eq } from 'drizzle-orm';

import { HAS_TEST_DB, makeLedger, rows, type TestLedger } from './db-harness';

vi.mock('@/lib/kpis/cache', () => ({ invalidatePillarKpis: async () => undefined }));

describe.skipIf(!HAS_TEST_DB)('libro mayor — integridad en Postgres', () => {
  let L: TestLedger;

  beforeAll(async () => {
    L = await makeLedger('ledger');
  }, 60_000);

  async function sale(periodId: string, date: string, amount: string) {
    const { createEntry } = await import('@/lib/accounting/double-entry/service');
    return createEntry({
      workspaceId: L.workspaceId,
      periodId,
      entryDate: new Date(date),
      description: 'Intereses ganados',
      status: 'posted',
      lines: [
        { accountId: L.acc['110505'], debit: amount, credit: '0' },
        { accountId: L.acc['421005'], debit: '0', credit: amount },
      ],
    });
  }

  async function balance421005(): Promise<string> {
    const r = await rows<{ b: string }>(sql`
      SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::numeric(20,2)::text AS b
      FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.workspace_id = ${L.workspaceId} AND je.status = 'posted'
        AND jl.account_id = ${L.acc['421005']}`);
    return r[0].b;
  }

  async function pillarValor(periodId: string): Promise<string | null> {
    const r = await rows<{ v: string }>(sql`
      SELECT valor_ebitda_cop::text AS v FROM pillar_kpis_view
      WHERE workspace_id = ${L.workspaceId} AND period_id = ${periodId}`);
    return r[0]?.v ?? null;
  }

  it('contab-nomina-01: original + reverso netean a cero (mismo período) y el original sigue posted', async () => {
    const { reverseEntry } = await import('@/lib/accounting/double-entry/service');
    const { getPostedEntriesForPeriod } = await import('@/lib/workflows/monthly-close/repository');
    const mar = await L.period(2026, 3);
    const { entry } = await sale(mar.id, '2026-03-05T12:00:00Z', '300000.00');
    const rev = await reverseEntry({
      workspaceId: L.workspaceId,
      originalEntryId: entry.id,
      reason: 'error de digitación',
      entryDate: new Date('2026-03-20T12:00:00Z'),
    });

    expect(await pillarValor(mar.id)).toBe('0.00');
    expect(await balance421005()).toBe('0.00');

    const { getDb } = await import('@/lib/db/client');
    const { journalEntries } = await import('@/lib/db/schema');
    const [orig] = await getDb().select().from(journalEntries).where(eq(journalEntries.id, entry.id));
    expect(orig.status).toBe('posted');
    expect(orig.reversedByEntryId).toBe(rev.entry.id);

    // El cierre/hash del período ve ambos asientos.
    const posted = await getPostedEntriesForPeriod(L.workspaceId, mar.id);
    const ids = posted.map((e) => e.id);
    expect(ids).toContain(entry.id);
    expect(ids).toContain(rev.entry.id);

    // Listado: 'reversed' es estado de presentación derivado del enlace.
    const { listEntries } = await import('@/lib/accounting/double-entry/service');
    const listed = await listEntries({ workspaceId: L.workspaceId, periodId: mar.id, status: 'reversed' });
    expect(listed.entries.map((e) => e.id)).toEqual([entry.id]);
  });

  it('contab-nomina-01: original en período bloqueado conserva sus cifras; el reverso va al período abierto', async () => {
    const { reverseEntry } = await import('@/lib/accounting/double-entry/service');
    const { getDb } = await import('@/lib/db/client');
    const { accountingPeriods } = await import('@/lib/db/schema');
    const apr = await L.period(2026, 4);
    const may = await L.period(2026, 5);
    const { entry } = await sale(apr.id, '2026-04-10T12:00:00Z', '50000.00');
    const beforeApr = await pillarValor(apr.id);
    await getDb().update(accountingPeriods).set({ status: 'locked' }).where(eq(accountingPeriods.id, apr.id));

    await reverseEntry({
      workspaceId: L.workspaceId,
      originalEntryId: entry.id,
      reason: 'anulación',
      entryDate: new Date('2026-05-02T12:00:00Z'),
    });
    expect(beforeApr).toBe('50000.00');
    expect(await pillarValor(apr.id)).toBe('50000.00');
    expect(await pillarValor(may.id)).toBe('-50000.00');
    // Suma de todas las superficies del mayor: la venta anulada neta a cero.
    const r = await rows<{ b: string }>(sql`
      SELECT COALESCE(SUM(valor_ebitda_cop), 0)::numeric(20,2)::text AS b
      FROM pillar_kpis_view WHERE workspace_id = ${L.workspaceId}
        AND period_id IN (${apr.id}, ${may.id})`);
    expect(r[0].b).toBe('0.00');
  });

  it('contab-nomina-12: un 3.er decimal se rechaza y el monto persistido es el validado', async () => {
    const { createEntry } = await import('@/lib/accounting/double-entry/service');
    const jun = await L.period(2026, 6);
    await expect(
      createEntry({
        workspaceId: L.workspaceId,
        periodId: jun.id,
        entryDate: new Date('2026-06-10T00:00:00Z'),
        description: 'redondeo',
        status: 'posted',
        lines: [
          { accountId: L.acc['110505'], debit: '100.005', credit: '0' },
          { accountId: L.acc['311505'], debit: '0', credit: '100.00' },
        ],
      }),
    ).rejects.toThrow(/more than 2 decimals/);

    const ok = await createEntry({
      workspaceId: L.workspaceId,
      periodId: jun.id,
      entryDate: new Date('2026-06-10T00:00:00Z'),
      description: 'normalizado',
      status: 'posted',
      lines: [
        { accountId: L.acc['110505'], debit: '1000.5', credit: '0' },
        { accountId: L.acc['311505'], debit: '0', credit: '1000.500' },
      ],
    });
    const r = await rows<{ d: string; c: string }>(sql`
      SELECT SUM(debit)::text AS d, SUM(credit)::text AS c FROM journal_lines WHERE entry_id = ${ok.entry.id}`);
    expect(r[0]).toEqual({ d: '1000.50', c: '1000.50' });
    expect(ok.entry.totalDebit).toBe('1000.50');

    // El health check del cierre detecta líneas que no suman la cabecera
    // (antes sólo comparaba total_debit vs total_credit de la cabecera).
    const { getUnbalancedPostedEntriesCount } = await import('@/lib/workflows/monthly-close/repository');
    expect(await getUnbalancedPostedEntriesCount(L.workspaceId, jun.id)).toBe(0);
    const [bad] = await rows<{ id: string }>(sql`
      INSERT INTO journal_entries (workspace_id, period_id, entry_number, entry_date, status, description, total_debit, total_credit)
      VALUES (${L.workspaceId}, ${jun.id}, 999, '2026-06-11', 'posted', 'legado descuadrado', 100.00, 100.00)
      RETURNING id`);
    await rows(sql`
      INSERT INTO journal_lines (workspace_id, entry_id, line_number, account_id, debit, credit, functional_debit, functional_credit)
      VALUES (${L.workspaceId}, ${bad.id}, 1, ${L.acc['110505']}, 100.01, 0, 100.01, 0),
             (${L.workspaceId}, ${bad.id}, 2, ${L.acc['311505']}, 0, 100.00, 0, 100.00)`);
    expect(await getUnbalancedPostedEntriesCount(L.workspaceId, jun.id)).toBe(1);
  });

  it('contab-nomina-13: la BD rechaza mutar/borrar asientos y líneas posteados', async () => {
    const jul = await L.period(2026, 7);
    const { entry, lines } = await sale(jul.id, '2026-07-03T00:00:00Z', '1000.00');
    const expectDbError = async (q: import('drizzle-orm').SQL) => {
      await expect(rows(q)).rejects.toThrow();
    };
    await expectDbError(sql`UPDATE journal_lines SET debit = debit + 1000000 WHERE id = ${lines[0].id}`);
    await expectDbError(sql`DELETE FROM journal_lines WHERE entry_id = ${entry.id}`);
    await expectDbError(sql`UPDATE journal_entries SET status = 'draft' WHERE id = ${entry.id}`);
    await expectDbError(sql`UPDATE journal_entries SET description = 'otra' WHERE id = ${entry.id}`);
    await expectDbError(sql`UPDATE journal_entries SET status = 'reversed' WHERE id = ${entry.id}`);
    await expectDbError(sql`DELETE FROM journal_entries WHERE id = ${entry.id}`);

    // Borradores siguen siendo editables/borrables (voidDraft).
    const { createEntry, voidDraft } = await import('@/lib/accounting/double-entry/service');
    const draft = await createEntry({
      workspaceId: L.workspaceId,
      periodId: jul.id,
      entryDate: new Date('2026-07-04T00:00:00Z'),
      description: 'borrador',
      status: 'draft',
      lines: [
        { accountId: L.acc['110505'], debit: '10.00', credit: '0' },
        { accountId: L.acc['421005'], debit: '0', credit: '10.00' },
      ],
    });
    await expect(voidDraft({ workspaceId: L.workspaceId, entryId: draft.entry.id })).resolves.toEqual({ ok: true });
  });
});
