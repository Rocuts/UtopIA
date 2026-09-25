// Integración contra Postgres real (ver src/lib/accounting/__tests__/db-harness.ts).
// Se omite sin UTOPIA_TEST_DATABASE_URL.
//
// Procedencia servidor (fase 2, P1): la versión del informe se guarda en
// `reports` (jsonb) y se lee por {reportId, reportHash} DENTRO del workspace.
// Aquí se comprueba con Postgres lo que el fake de las pruebas de rutas sólo
// simula: que el viaje por jsonb reproduce las huellas (orden de claves,
// números, BigInt como decimal) y que el filtro por workspace/kind es real.
// El workspace de la sesión se fija con un mock de `getCurrentWorkspaceId`: la
// resolución de sesión/cookie tiene sus propias pruebas.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { HAS_TEST_DB } from '@/lib/accounting/__tests__/db-harness';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { buildFinancialReportVersion } from '../financial-report-version';
import { PROVENANCE_CSV } from './provenance-fixture';

const session = vi.hoisted(() => ({ workspace: null as string | null }));
vi.mock('@/lib/db/workspace', () => ({ getCurrentWorkspaceId: async () => session.workspace }));

describe.skipIf(!HAS_TEST_DB)('versión persistida del informe — Postgres', () => {
  let W1: string;
  let W2: string;

  beforeAll(async () => {
    const { getDb } = await import('@/lib/db/client');
    const { workspaces } = await import('@/lib/db/schema');
    const [a] = await getDb().insert(workspaces).values({ name: `p1-a-${Date.now()}` }).returning();
    const [b] = await getDb().insert(workspaces).values({ name: `p1-b-${Date.now()}` }).returning();
    W1 = a.id;
    W2 = b.id;
  }, 60_000);

  function version() {
    return buildFinancialReportVersion({
      report: makeExportableReport(),
      preprocessed: preprocessTrialBalance(parseTrialBalanceCSV(PROVENANCE_CSV)),
      rawData: PROVENANCE_CSV,
    });
  }

  it('persiste y relee la versión por referencia: jsonb reproduce las huellas', async () => {
    const { persistFinancialReportVersion, loadFinancialReportVersion } = await import(
      '../financial-report-store'
    );
    const v = version();
    const saved = await persistFinancialReportVersion({ workspaceId: W1, version: v, controlTotals: { activo: 10000 } });
    expect(saved.status).toBe('persisted');
    if (saved.status !== 'persisted') return;
    const loaded = await loadFinancialReportVersion(W1, {
      reportId: saved.provenance.reportId,
      reportHash: saved.provenance.reportHash,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.provenance.reportHash).toBe(v.reportHash);
    expect(loaded.provenance.sourceHash).toBe(v.sourceHash);
    expect(loaded.preprocessed?.primary.controlTotals.cents?.activo).toBe(BigInt(1_000_000));
    expect(loaded.report.niifAnalysis.json?.balanceSheet.totalAssetsPrimary).toBe('1000000');
  });

  it('otro workspace o id inexistente → 404; otra huella → 409; fila alterada → 409 de integridad', async () => {
    const { persistFinancialReportVersion, loadFinancialReportVersion } = await import(
      '../financial-report-store'
    );
    const { getDb } = await import('@/lib/db/client');
    const { reports } = await import('@/lib/db/schema');
    const saved = await persistFinancialReportVersion({ workspaceId: W1, version: version(), controlTotals: null });
    if (saved.status !== 'persisted') throw new Error('no persistió');
    const ref = { reportId: saved.provenance.reportId, reportHash: saved.provenance.reportHash };

    const foreign = await loadFinancialReportVersion(W2, ref);
    const missing = await loadFinancialReportVersion(W1, { ...ref, reportId: '33333333-3333-4333-8333-333333333333' });
    expect(foreign).toEqual(missing);
    expect(foreign).toMatchObject({ ok: false, status: 404 });

    const otherHash = await loadFinancialReportVersion(W1, { ...ref, reportHash: 'f'.repeat(64) });
    expect(otherHash).toMatchObject({ ok: false, status: 409, code: 'REPORT_VERSION_MISMATCH' });

    const [row] = await getDb().select({ data: reports.data }).from(reports).where(eq(reports.id, ref.reportId));
    const data = row.data as { report: { consolidatedReport: string } };
    data.report.consolidatedReport = 'alterado en la base';
    await getDb().update(reports).set({ data }).where(eq(reports.id, ref.reportId));
    const tampered = await loadFinancialReportVersion(W1, ref);
    expect(tampered).toMatchObject({ ok: false, status: 409, code: 'REPORT_VERSION_INTEGRITY' });
  });

  it('la frontera de las rutas resuelve el workspace de la sesión, nunca el del cuerpo', async () => {
    const { persistFinancialReportVersion } = await import('../financial-report-store');
    const { resolvePersistedReport } = await import('../persisted-report-request');
    const saved = await persistFinancialReportVersion({ workspaceId: W1, version: version(), controlTotals: null });
    if (saved.status !== 'persisted') throw new Error('no persistió');
    const body = {
      reportRef: { reportId: saved.provenance.reportId, reportHash: saved.provenance.reportHash },
      workspaceId: W1,
    };
    session.workspace = W1;
    expect((await resolvePersistedReport(body)).kind).toBe('ok');
    session.workspace = W2;
    const other = await resolvePersistedReport(body);
    expect(other.kind).toBe('error');
    if (other.kind === 'error') expect(other.response.status).toBe(404);
  });
});
