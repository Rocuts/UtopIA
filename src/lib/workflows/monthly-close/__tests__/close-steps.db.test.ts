// Integración contra Postgres real (ver src/lib/accounting/__tests__/db-harness.ts).
// Se omite sin UTOPIA_TEST_DATABASE_URL.
//
// contab-nomina-04: el cierre mensual no anula el P&G del período.
// contab-nomina-03: el cierre anual (período 13) cierra contra 360505/361005
//                   conservando centro de costo/tercero, e idempotente.
// contab-nomina-05: ajustes del cierre idempotentes y con estado del activo.
// contab-nomina-06/-07/-08/-16: provisiones coherentes con el PUC sembrado.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { sql, eq } from 'drizzle-orm';

import { HAS_TEST_DB, makeLedger, rows, type TestLedger } from '@/lib/accounting/__tests__/db-harness';

vi.mock('@/lib/kpis/cache', () => ({ invalidatePillarKpis: async () => undefined }));

process.env.UTOPIA_ENABLE_AUTO_ADJUSTMENTS = 'true';

describe.skipIf(!HAS_TEST_DB)('cierre mensual/anual — Postgres', () => {
  let L: TestLedger;

  beforeAll(async () => {
    L = await makeLedger('close');
  }, 60_000);

  async function post(periodId: string, date: string, lines: Array<Record<string, unknown>>, status: 'posted' | 'draft' = 'posted') {
    const { createEntry } = await import('@/lib/accounting/double-entry/service');
    return createEntry({
      workspaceId: L.workspaceId,
      periodId,
      entryDate: new Date(date),
      description: 'mov',
      status,
      lines: lines as never,
    });
  }

  async function pillarValor(periodId: string): Promise<string | null> {
    const r = await rows<{ v: string }>(sql`
      SELECT valor_ebitda_cop::text AS v FROM pillar_kpis_view
      WHERE workspace_id = ${L.workspaceId} AND period_id = ${periodId}`);
    return r[0]?.v ?? null;
  }

  it('contab-nomina-04: el cierre mensual no traslada resultados ni deja el P&G del mes en cero', async () => {
    const { generateClosingEntry } = await import('@/lib/workflows/monthly-close/steps/closing-entry');
    const feb = await L.period(2026, 2);
    await post(feb.id, '2026-02-10T00:00:00Z', [
      { accountId: L.acc['110505'], debit: '1000000.00', credit: '0' },
      { accountId: L.acc['421005'], debit: '0', credit: '1000000.00' },
    ]);
    await post(feb.id, '2026-02-11T00:00:00Z', [
      { accountId: L.acc['530505'], debit: '200000.00', credit: '0' },
      { accountId: L.acc['110505'], debit: '0', credit: '200000.00' },
    ]);
    const res = await generateClosingEntry({ workspaceId: L.workspaceId, periodId: feb.id, runId: 'r-feb' });
    expect(res.closingEntryId).toBe('no-op');
    expect(res.netResultCop).toBe('800000.00');
    expect(res.retainedEarningsAccountCode).toBeNull();
    expect(await pillarValor(feb.id)).toBe('800000.00');
  });

  it('contab-nomina-03: cierre anual en período 13 contra 360505 con centro de costo/tercero; idempotente', async () => {
    const { generateClosingEntry } = await import('@/lib/workflows/monthly-close/steps/closing-entry');
    const L2 = await makeLedger('annual');
    const mar = await L2.period(2027, 3);
    const dec = await L2.period(2027, 12);
    const p13 = await L2.period(2027, 13);
    const { createEntry } = await import('@/lib/accounting/double-entry/service');
    const mk = (periodId: string, date: string, lines: Array<Record<string, unknown>>) =>
      createEntry({ workspaceId: L2.workspaceId, periodId, entryDate: new Date(date), description: 'mov', status: 'posted', lines: lines as never });
    await mk(mar.id, '2027-03-15T00:00:00Z', [
      { accountId: L2.acc['111005'], thirdPartyId: L2.thirdPartyId, debit: '10000000.00', credit: '0' },
      { accountId: L2.acc['413505'], costCenterId: L2.costCenterId, debit: '0', credit: '10000000.00' },
    ]);
    await mk(dec.id, '2027-12-20T00:00:00Z', [
      { accountId: L2.acc['510506'], costCenterId: L2.costCenterId, debit: '4000000.00', credit: '0' },
      { accountId: L2.acc['111005'], thirdPartyId: L2.thirdPartyId, debit: '0', credit: '4000000.00' },
    ]);
    const decBefore = await rows<{ v: string }>(sql`
      SELECT valor_ebitda_cop::text AS v FROM pillar_kpis_view WHERE workspace_id = ${L2.workspaceId} AND period_id = ${dec.id}`);

    const res = await generateClosingEntry({ workspaceId: L2.workspaceId, periodId: p13.id, runId: 'r-13' });
    expect(res.netResultCop).toBe('6000000.00');
    expect(res.retainedEarningsAccountCode).toBe('360505');
    expect(res.closingEntryId).not.toBe('no-op');

    // Cuentas de resultado del ejercicio en cero; utilidad en 360505.
    const bal = await rows<{ code: string; b: string }>(sql`
      SELECT coa.code, SUM(jl.debit - jl.credit)::numeric(20,2)::text AS b
      FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
      JOIN chart_of_accounts coa ON coa.id = jl.account_id
      WHERE je.workspace_id = ${L2.workspaceId} AND je.status = 'posted'
        AND coa.code IN ('413505', '510506', '360505')
      GROUP BY coa.code ORDER BY coa.code`);
    expect(bal).toEqual([
      { code: '360505', b: '-6000000.00' },
      { code: '413505', b: '0.00' },
      { code: '510506', b: '0.00' },
    ]);
    // El P&G de diciembre no se toca.
    const decAfter = await rows<{ v: string }>(sql`
      SELECT valor_ebitda_cop::text AS v FROM pillar_kpis_view WHERE workspace_id = ${L2.workspaceId} AND period_id = ${dec.id}`);
    expect(decAfter).toEqual(decBefore);

    const again = await generateClosingEntry({ workspaceId: L2.workspaceId, periodId: p13.id, runId: 'r-13b' });
    expect(again.closingEntryId).toBe(res.closingEntryId);
    const n = await rows<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n FROM journal_entries WHERE workspace_id = ${L2.workspaceId} AND source_type = 'closing'`);
    expect(n[0].n).toBe('1');
  });

  it('contab-nomina-05: dos corridas de ajustes no duplican y actualizan el activo', async () => {
    const { runAdjustments } = await import('@/lib/workflows/monthly-close/steps/run-adjustments');
    const { seedProvisionsForWorkspace } = await import('@/lib/db/seeds/provisions-config-co-2026');
    const { getDb } = await import('@/lib/db/client');
    const { fixedAssets } = await import('@/lib/db/schema');
    const L3 = await makeLedger('adj');
    const jan = await L3.period(2026, 1);
    const seed = await seedProvisionsForWorkspace(L3.workspaceId);
    expect(seed.errors).toEqual([]);
    expect(seed.provisionsInserted).toBe(11);

    const db = getDb();
    const [asset] = await db
      .insert(fixedAssets)
      .values({
        workspaceId: L3.workspaceId,
        code: 'PC-1',
        name: 'Computador',
        category: 'computo',
        assetAccountId: L3.acc['152805'],
        depreciationAccountId: L3.acc['159220'],
        expenseAccountId: L3.acc['516020'],
        acquisitionDate: new Date('2025-12-01T00:00:00Z'),
        acquisitionCost: '3600000.00',
        usefulLifeMonths: 36,
      })
      .returning();

    const { createEntry } = await import('@/lib/accounting/double-entry/service');
    const mk = (lines: Array<Record<string, unknown>>, status: 'posted' | 'draft' = 'posted') =>
      createEntry({ workspaceId: L3.workspaceId, periodId: jan.id, entryDate: new Date('2026-01-30T00:00:00Z'), description: 'nómina', status, lines: lines as never });
    await mk([
      { accountId: L3.acc['510506'], costCenterId: L3.costCenterId, debit: '4000000.00', credit: '0' },
      { accountId: L3.acc['111005'], thirdPartyId: L3.thirdPartyId, debit: '0', credit: '4000000.00' },
    ]);
    // Borrador que NO debe entrar en la base (contab-nomina-16).
    await mk(
      [
        { accountId: L3.acc['510506'], costCenterId: L3.costCenterId, debit: '9000000.00', credit: '0' },
        { accountId: L3.acc['111005'], thirdPartyId: L3.thirdPartyId, debit: '0', credit: '9000000.00' },
      ],
      'draft',
    );

    const r1 = await runAdjustments({ workspaceId: L3.workspaceId, periodId: jan.id, runId: 'a1' });
    const r2 = await runAdjustments({ workspaceId: L3.workspaceId, periodId: jan.id, runId: 'a2' });
    expect(r1.depreciationEntryId).toBeTruthy();
    // Segunda corrida: el activo ya está depreciado en el período → nada nuevo.
    expect(r2.depreciationEntryId).toBeNull();
    expect(r2.provisionEntryIds).toEqual([]);
    // Sin condición 114-1 declarada: salud/SENA/ICBF N/D, no se asume exoneración.
    const skipped = Object.fromEntries(r1.provisionsSkipped.map((s) => [s.provisionType, s.reason]));
    expect(skipped).toMatchObject({ salud: 'employer_114_1_unknown', sena: 'employer_114_1_unknown', icbf: 'employer_114_1_unknown' });

    const [a] = await db.select().from(fixedAssets).where(eq(fixedAssets.id, asset.id));
    expect(a.accumulatedDepreciation).toBe('100000.00');
    expect(a.lastDepreciatedPeriodId).toBe(jan.id);

    const counts = await rows<{ src: string; ref: string; n: string; amt: string }>(sql`
      SELECT source_type::text AS src, source_ref AS ref, COUNT(*)::text AS n, MAX(total_debit)::text AS amt
      FROM journal_entries WHERE workspace_id = ${L3.workspaceId} AND status = 'posted'
        AND source_type IN ('depreciation', 'adjustment')
      GROUP BY source_type, source_ref ORDER BY source_ref`);
    for (const c of counts) expect(c.n, c.ref).toBe('1');
    const amt = Object.fromEntries(counts.map((c) => [c.ref.split(':').pop(), c.amt]));
    // Base = 4.000.000 posteados (el borrador de 9.000.000 no cuenta).
    expect(amt.prima).toBe('333332.00');
    expect(amt.cesantias).toBe('333332.00');
    expect(amt.intereses_cesantias).toBe('40000.00');
    expect(amt.vacaciones).toBe('166668.00');
    expect(amt.pension).toBe('480000.00');
    expect(amt.caja).toBe('160000.00');

    // Declarando empleador beneficiario 114-1 con trabajador identificado
    // < 10 SMMLV, salud/SENA/ICBF quedan exonerados (sin provisión).
    const { workspaces } = await import('@/lib/db/schema');
    await db.update(workspaces).set({ empleadorBeneficiario114_1: true }).where(eq(workspaces.id, L3.workspaceId));
    const feb = await L3.period(2026, 2);
    await createEntry({
      workspaceId: L3.workspaceId, periodId: feb.id, entryDate: new Date('2026-02-27T00:00:00Z'), description: 'nómina', status: 'posted',
      lines: [
        { accountId: L3.acc['510506'], costCenterId: L3.costCenterId, thirdPartyId: L3.thirdPartyId, debit: '4000000.00', credit: '0' },
        { accountId: L3.acc['111005'], thirdPartyId: L3.thirdPartyId, debit: '0', credit: '4000000.00' },
      ],
    });
    const { adjustmentsPort } = await import('@/lib/accounting/adjustments');
    const prev = await adjustmentsPort.previewProvisions({ workspaceId: L3.workspaceId, periodId: feb.id, entryDate: feb.endsAt });
    const sk = Object.fromEntries(prev.skipped.map((s) => [s.provisionType, s.reason]));
    expect(sk).toMatchObject({ salud: 'exonerated_114_1', sena: 'exonerated_114_1', icbf: 'exonerated_114_1' });
    expect(prev.lines.find((l) => l.provisionType === 'caja')?.provisionAmountCop).toBe('160000.00');
  });
});
