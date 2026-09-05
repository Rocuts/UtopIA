import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Readable } from 'node:stream';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';

// Real PostgreSQL engine and real Drizzle predicates. Only session provider,
// LLM, facts/telemetry and binary renderers are controlled at external boundaries.
const state = vi.hoisted(() => ({ userId: 'user-a' as string | null, cookie: '', sessionFailure: false }));
let pg: PGlite;
let db: ReturnType<typeof drizzle>;
vi.mock('@/lib/db/client', () => ({ getDb: () => db }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => ({ value: state.cookie }), set: vi.fn() }),
}));
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: async () => {
  if (state.sessionFailure) throw new Error('session service unavailable');
  return state.userId ? { user: { id: state.userId } } : null;
} } } }));
vi.mock('@/lib/db/activity-log', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: async () => '' }));
vi.mock('@/lib/db/telemetry', () => ({
  asTelemetryUuid: (id: string) => id,
  resolveOwnedReportId: async () => null,
  runWithTelemetryContext: (_: unknown, run: () => unknown) => run(),
}));
vi.mock('@/lib/agents/financial/orchestrator', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/agents/financial/orchestrator')>();
  return { ...actual, runNiifPhase: vi.fn(), runStrategyPhase: vi.fn(), runGovernancePhase: vi.fn() };
});
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
vi.mock('@/lib/export/pdf-elite-react', () => ({
  composeEditorialReport: vi.fn(() => ({})),
  renderEditorialReportToStream: vi.fn(async () => Readable.from([Buffer.from('%PDF-test')])),
}));
import { POST as niif } from '../niif/route';
import { POST as strategy } from '../strategy/route';
import { POST as governance } from '../governance/route';
import { POST as exportReport } from '../export/route';
import { runNiifPhase, runStrategyPhase, runGovernancePhase } from '@/lib/agents/financial/orchestrator';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { composeEditorialReport } from '@/lib/export/pdf-elite-react';
import { loadFinancialVersion, requireReportWorkspace, saveFinancialVersion } from '@/lib/db/financial-report-versions';
import { requireWorkspace, getCurrentWorkspaceId, getOrCreateWorkspace } from '@/lib/db/workspace';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const report = makeExportableReport();
const rawData = 'Codigo,Nombre,Saldo\n110505,Caja,10000\n';
const req = (body: unknown, stream = false) => new Request('http://localhost/api/financial-report', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(stream ? { 'X-Stream': 'true' } : {}) }, body: JSON.stringify(body),
});
async function payload(response: Response, event: string, stream: boolean) {
  expect(response.status).toBe(200);
  if (!stream) return response.json();
  const text = await response.text();
  const block = text.split('\n\n').find(b => b.startsWith(`event: ${event}\n`));
  expect(block, text).toBeDefined();
  return JSON.parse(block!.split('\ndata: ')[1]);
}
async function complete(stream = false) {
  const first = await payload(await niif(req({ rawData, company: report.company, persist: true }, stream)), 'niif_phase', stream);
  const second = await payload(await strategy(req({ reportVersionId: first.reportVersionId }, stream)), 'strategy_phase', stream);
  const third = await payload(await governance(req({ reportVersionId: second.reportVersionId }, stream)), 'governance_phase', stream);
  return { first, second, third };
}

beforeAll(async () => {
  pg = new PGlite(); db = drizzle(pg);
  await pg.exec(`CREATE TABLE workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nit text, name text, user_id text,
    representante_legal_nombre text, revisor_fiscal_nombre text, revisor_fiscal_tp text,
    contador_publico_nombre text, contador_publico_tp text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
    kind text NOT NULL, title text, data jsonb NOT NULL, control_totals jsonb, created_at timestamptz NOT NULL DEFAULT now());`);
});
afterAll(async () => { vi.unstubAllEnvs(); await pg.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-only'); vi.stubEnv('AUTH_SECRET', ''); vi.stubEnv('BETTER_AUTH_SECRETS', '');
  state.userId = 'user-a'; state.cookie = B; state.sessionFailure = false;
  await pg.exec('TRUNCATE reports, workspaces CASCADE');
  await pg.query('INSERT INTO workspaces(id,nit,name,user_id) VALUES ($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,NULL)',
    [A, report.company.nit, 'Empresa A', 'user-a', B, '800123456', 'Empresa B', 'user-b', C, '700123456', 'Anon']);
  vi.mocked(runNiifPhase).mockResolvedValue({ niif: report.niifAnalysis, context: {
    effectiveCompany: report.company, bindingTotalsBlock: 'TOTALES VINCULANTES', ppForAgents: undefined,
  } } as never);
  vi.mocked(runStrategyPhase).mockResolvedValue(report.strategicAnalysis);
  vi.mocked(runGovernancePhase).mockResolvedValue(report.governance);
});

describe('authorized persisted report lifecycle with PostgreSQL', () => {
  for (const stream of [false, true]) it(`persists every phase before success; export uses the saved version (SSE=${stream})`, async () => {
    const { first, second, third } = await complete(stream);
    const ws = await requireReportWorkspace();
    expect((await loadFinancialVersion(ws, first.reportVersionId)).stage).toBe('niif');
    expect((await loadFinancialVersion(ws, second.reportVersionId)).parentId).toBe(first.reportVersionId);
    expect((await loadFinancialVersion(ws, third.reportVersionId)).parentId).toBe(second.reportVersionId);
    expect(third.report.reportVersionId).toBe(third.reportVersionId);
    for (const format of ['excel', 'pdf-elite']) {
      const res = await exportReport(req({ reportVersionId: third.reportVersionId, format }));
      expect(res.status).toBe(200); expect(res.headers.get('X-Report-Version-Id')).toBe(third.reportVersionId);
      await res.arrayBuffer();
    }
    expect(vi.mocked(generateFinancialExcel).mock.calls[0][0].report.consolidatedReport).toBe(third.report.consolidatedReport);
    expect(vi.mocked(composeEditorialReport).mock.calls[0][0].report.company).toEqual(report.company);
  });
  it('does not accept another company at generation', async () => {
    expect((await niif(req({ rawData, persist: true, company: { ...report.company, nit: '800123456' } }))).status).toBe(403);
    expect(runNiifPhase).not.toHaveBeenCalled();
  });
  it('derives source totals on the server instead of trusting uploaded preprocessing', async () => {
    const res = await niif(req({ rawData, company: report.company, persist: true, preprocessed: { forged: true } }));
    expect(res.status).toBe(200);
    const options = vi.mocked(runNiifPhase).mock.calls[0][1];
    expect(options?.preprocessed).toBeDefined();
    expect(options?.preprocessed).not.toHaveProperty('forged');
  });
  it('blocks export of provisional versions without converting them into completed reports', async () => {
    const { third } = await complete(); const ws = await requireReportWorkspace();
    const id = await saveFinancialVersion(ws, { ...await loadFinancialVersion(ws, third.reportVersionId), provisional: { active: true, reason: 'unresolved data' } });
    expect((await exportReport(req({ reportVersionId: id }))).status).toBe(422);
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });
  it('exports original complete versions after a newer one exists', async () => {
    const { third } = await complete(); const ws = await requireReportWorkspace();
    const saved = await loadFinancialVersion(ws, third.reportVersionId);
    const newer = await saveFinancialVersion(ws, { ...saved, report: { ...saved.report!, consolidatedReport: 'Second version' } });
    expect((await exportReport(req({ reportVersionId: newer }))).status).toBe(200);
    expect((await exportReport(req({ reportVersionId: third.reportVersionId }))).status).toBe(200);
    const calls = vi.mocked(generateFinancialExcel).mock.calls;
    expect(calls[0][0].report.consolidatedReport).toBe('Second version');
    expect(calls[1][0].report.consolidatedReport).toBe(third.report.consolidatedReport);
  });
  it('keeps the same version exportable after a transient renderer error', async () => {
    const { third } = await complete();
    vi.mocked(generateFinancialExcel).mockRejectedValueOnce(new Error('temporary renderer failure'));
    expect((await exportReport(req({ reportVersionId: third.reportVersionId }))).status).toBe(503);
    expect((await exportReport(req({ reportVersionId: third.reportVersionId }))).status).toBe(200);
    expect(runNiifPhase).toHaveBeenCalledTimes(1);
    expect(runStrategyPhase).toHaveBeenCalledTimes(1);
    expect(runGovernancePhase).toHaveBeenCalledTimes(1);
  });
  it('cannot select another tenant using the cookie or request fields', async () => {
    const { first, third } = await complete();
    state.userId = 'user-b'; state.cookie = A;
    expect((await strategy(req({ reportVersionId: first.reportVersionId, workspaceId: A }))).status).toBe(404);
    for (const format of ['excel', 'pdf-elite']) {
      expect((await exportReport(req({ reportVersionId: third.reportVersionId, format }))).status).toBe(404);
    }
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });
  it('uses persisted phase inputs even if the client replaces totals, company, NIIF and instructions', async () => {
    const first = await payload(await niif(req({ rawData, persist: true, company: report.company })), 'niif_phase', false);
    const res = await strategy(req({ reportVersionId: first.reportVersionId, niifResult: { fullContent: 'forged' },
      bindingTotals: 'forged', company: { nit: '800123456' }, instructions: 'forged', preprocessed: { fake: true } }));
    expect(res.status).toBe(200);
    expect(vi.mocked(runStrategyPhase).mock.calls[0][0]).toMatchObject({
      niifResult: { fullContent: report.niifAnalysis.fullContent }, bindingTotals: 'TOTALES VINCULANTES', company: report.company,
    });
  });
  it('rejects client changes to report, source, company, audits or quality at export', async () => {
    const { third } = await complete();
    for (const key of ['report', 'rawData', 'company', 'auditReport', 'qualityReport', 'workspaceId']) {
      expect((await exportReport(req({ reportVersionId: third.reportVersionId, [key]: 'forged' }))).status).toBe(400);
    }
    // Audits enter the download by reference only; a reference is a stored id.
    for (const key of ['auditVersionId', 'qualityVersionId']) {
      expect((await exportReport(req({ reportVersionId: third.reportVersionId, [key]: 'forged' }))).status).toBe(400);
      expect((await exportReport(req({ reportVersionId: third.reportVersionId, [key]: B }))).status).toBe(404);
    }
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });
  it('rejects malformed, absent, foreign-kind and incomplete references', async () => {
    expect((await exportReport(req({ reportVersionId: 'bad' }))).status).toBe(400);
    expect((await exportReport(req({ reportVersionId: B }))).status).toBe(404);
    await pg.query('INSERT INTO reports(id, workspace_id, kind, data) VALUES($1,$2,$3,$4)', [B, A, 'escudo_fiscal', '{}']);
    expect((await exportReport(req({ reportVersionId: B }))).status).toBe(404);
    const first = await payload(await niif(req({ rawData, persist: true, company: report.company })), 'niif_phase', false);
    expect((await exportReport(req({ reportVersionId: first.reportVersionId }))).status).toBe(409);
    expect((await governance(req({ reportVersionId: first.reportVersionId }))).status).toBe(409);
  });
  it('detects persisted data corruption after JSONB round-trip', async () => {
    const { third } = await complete();
    await pg.query("UPDATE reports SET data=jsonb_set(data, '{payload,report,consolidatedReport}', '\"altered\"') WHERE id=$1", [third.reportVersionId]);
    expect((await exportReport(req({ reportVersionId: third.reportVersionId }))).status).toBe(409);
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });
  it('detects changes to provenance metadata as well as report content', async () => {
    const { third } = await complete();
    await pg.query("UPDATE reports SET data=jsonb_set(data, '{rules}', '\"altered-rules\"') WHERE id=$1", [third.reportVersionId]);
    expect((await exportReport(req({ reportVersionId: third.reportVersionId }))).status).toBe(409);
  });
  it('keeps distinct concurrent versions and never overwrites a previously exported report', async () => {
    const { third } = await complete();
    const ws = await requireReportWorkspace(); const initial = await loadFinancialVersion(ws, third.reportVersionId);
    const ids = await Promise.all(Array.from({ length: 8 }, (_, i) => saveFinancialVersion(ws, {
      ...initial, parentId: third.reportVersionId, instructions: `run-${i}`,
    })));
    expect(new Set(ids).size).toBe(8);
    expect(await loadFinancialVersion(ws, third.reportVersionId)).toEqual(initial);
  });
  it('does not truncate long source data', async () => {
    const { third } = await complete(); const ws = await requireReportWorkspace();
    const source = 'source,'.repeat(40000);
    const id = await saveFinancialVersion(ws, { ...await loadFinancialVersion(ws, third.reportVersionId), rawData: source });
    expect((await loadFinancialVersion(ws, id)).rawData).toBe(source);
  });
  for (const alias of ['BETTER_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRETS']) {
    it(`resolves the user workspace using ${alias} and ignores another tenant's cookie`, async () => {
      vi.stubEnv('BETTER_AUTH_SECRET', ''); vi.stubEnv(alias, 'test-secret');
      expect((await requireWorkspace())?.id).toBe(A);
      expect(await getCurrentWorkspaceId()).toBe(A);
    });
  }
  it('fails closed when configured auth has no session or session lookup fails', async () => {
    state.userId = null; state.cookie = C;
    expect(await requireWorkspace()).toBeNull(); expect(await getCurrentWorkspaceId()).toBeNull();
    await expect(getOrCreateWorkspace()).rejects.toThrow('Authentication required');
    expect((await niif(req({ rawData, company: report.company, persist: true }))).status).toBe(401);
    state.sessionFailure = true;
    expect(await requireWorkspace()).toBeNull();
    expect((await exportReport(req({ reportVersionId: A }))).status).toBe(401);
  });
  it('does not silently approve anonymous financial exports', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', ''); state.userId = null; state.cookie = C;
    expect((await exportReport(req({ reportVersionId: A }))).status).toBe(503);
  });
  it('does not acknowledge successful generation if persistence fails', async () => {
    await pg.exec("ALTER TABLE reports ADD CONSTRAINT reject_test_insert CHECK (kind <> 'financial_server_version_v1')");
    try {
      expect((await niif(req({ rawData, company: report.company, persist: true }))).status).toBe(503);
      const response = await niif(req({ rawData, company: report.company, persist: true }, true));
      const text = await response.text();
      expect(text).toContain('event: error'); expect(text).not.toContain('event: niif_phase'); expect(text).not.toContain('event: done');
    } finally { await pg.exec('ALTER TABLE reports DROP CONSTRAINT reject_test_insert'); }
  });
});
