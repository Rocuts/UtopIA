import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Readable } from 'node:stream';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';

// Same boundaries as persisted-versions: real PostgreSQL and real Drizzle
// predicates; only the session provider, the agents and the binary renderers
// are controlled.
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
vi.mock('@/lib/agents/financial/audit/orchestrator', () => ({ orchestrateAudit: vi.fn() }));
vi.mock('@/lib/agents/financial/quality/agent', () => ({ runQualityAudit: vi.fn() }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
vi.mock('@/lib/export/pdf-elite-react', () => ({
  composeEditorialReport: vi.fn(() => ({})),
  renderEditorialReportToStream: vi.fn(async () => Readable.from([Buffer.from('%PDF-test')])),
}));
import { POST as niif } from '../niif/route';
import { POST as strategy } from '../strategy/route';
import { POST as governance } from '../governance/route';
import { POST as exportReport } from '../export/route';
import { POST as auditRoute } from '../../financial-audit/route';
import { POST as qualityRoute } from '../../financial-quality/route';
import { runNiifPhase, runStrategyPhase, runGovernancePhase } from '@/lib/agents/financial/orchestrator';
import { orchestrateAudit } from '@/lib/agents/financial/audit/orchestrator';
import { runQualityAudit } from '@/lib/agents/financial/quality/agent';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { composeEditorialReport } from '@/lib/export/pdf-elite-react';
import { requireReportWorkspace, loadFinancialVersion, saveFinancialVersion } from '@/lib/db/financial-report-versions';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const report = makeExportableReport();
const rawData = 'Codigo,Nombre,Saldo\n110505,Caja,10000\n';

function makeAudit(overrides: Partial<AuditReport> = {}): AuditReport {
  const domains = ['niif', 'tributario', 'legal', 'revisoria'] as const;
  return {
    company: report.company,
    auditorResults: domains.map(domain => ({
      domain, auditorName: `Auditor ${domain}`, complianceScore: 90,
      findings: [], summary: `Resumen ${domain}`, fullContent: `# ${domain}`, failed: false,
    })),
    overallScore: 90,
    opinionType: 'favorable',
    opinionText: 'Sin salvedades.',
    consolidatedFindings: [{
      code: 'NIIF-001', severity: 'medio', domain: 'niif', title: 'Revelación pendiente',
      description: 'Falta la nota de partes relacionadas.', normReference: 'NIC 24',
      recommendation: 'Incorporar la nota.', impact: 'Revelación incompleta.',
    }],
    findingCounts: { critico: 0, alto: 0, medio: 1, bajo: 0, informativo: 0 },
    executiveSummary: 'Auditoría sin salvedades.',
    consolidatedReport: '# Auditoría consolidada',
    generatedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

function makeQuality(overrides: Partial<QualityAssessment> = {}): QualityAssessment {
  return {
    overallScore: 88,
    grade: 'B',
    dimensions: [{
      name: 'Trazabilidad', score: 88, framework: 'ISO 42001',
      findings: ['Origen documentado'], recommendations: ['Mantener el registro'],
    }],
    ifrs18Readiness: { ready: false, score: 70, gaps: ['Categorías de resultado'] },
    dataQuality: { completeness: 90, accuracy: 92, consistency: 88, timeliness: 80, validity: 91 },
    aiGovernance: { traceability: 90, explainability: 85, antiHallucination: 95, humanOversight: 80 },
    executiveSummary: 'Calidad aceptable.',
    fullReport: '# Meta-auditoría',
    generatedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

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
async function complete() {
  const first = await payload(await niif(req({ rawData, company: report.company, persist: true })), 'niif_phase', false);
  const second = await payload(await strategy(req({ reportVersionId: first.reportVersionId })), 'strategy_phase', false);
  const third = await payload(await governance(req({ reportVersionId: second.reportVersionId })), 'governance_phase', false);
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
  vi.mocked(orchestrateAudit).mockResolvedValue(makeAudit());
  vi.mocked(runQualityAudit).mockResolvedValue(makeQuality());
});

describe('audit and meta-audit provenance with PostgreSQL', () => {
  for (const stream of [false, true]) it(`stores the audit before announcing it and exports it with its version (SSE=${stream})`, async () => {
    const { first, third } = await complete();
    const audit = await payload(await auditRoute(req({ reportVersionId: first.reportVersionId }, stream)), 'result', stream);
    expect(audit.auditVersionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(audit.auditComplete).toBe(true);
    // The audit ran while strategy and governance were still generating.
    expect(audit.examinedStage).toBe('niif');

    const quality = await qualityRoute(req({
      reportVersionId: third.reportVersionId, auditVersionId: audit.auditVersionId,
    })).then(r => r.json());
    expect(quality.qualityVersionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(quality.qualityComplete).toBe(true);

    const res = await exportReport(req({
      reportVersionId: third.reportVersionId, format: 'excel',
      auditVersionId: audit.auditVersionId, qualityVersionId: quality.qualityVersionId,
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Audit-Version-Id')).toBe(audit.auditVersionId);
    expect(res.headers.get('X-Quality-Version-Id')).toBe(quality.qualityVersionId);
    await res.arrayBuffer();
    // The exporter must receive the stored results, not an empty placeholder.
    const excelArgs = vi.mocked(generateFinancialExcel).mock.calls[0][0];
    expect(excelArgs.auditReport?.consolidatedReport).toBe('# Auditoría consolidada');
    expect(excelArgs.qualityReport?.fullReport).toBe('# Meta-auditoría');
    expect(excelArgs.auditExaminedStage).toBe('niif');

    const pdf = await exportReport(req({
      reportVersionId: third.reportVersionId, format: 'pdf-elite',
      auditVersionId: audit.auditVersionId, qualityVersionId: quality.qualityVersionId,
    }));
    expect(pdf.status).toBe(200);
    await pdf.arrayBuffer();
    expect(vi.mocked(composeEditorialReport).mock.calls[0][0].auditReport?.overallScore).toBe(90);
    expect(vi.mocked(composeEditorialReport).mock.calls[0][0].qualityReport?.grade).toBe('B');
  });

  it('audits the stored version instead of content sent by the browser', async () => {
    const { first } = await complete();
    for (const key of ['report', 'company', 'consolidatedReport', 'rawData', 'workspaceId']) {
      expect((await auditRoute(req({ reportVersionId: first.reportVersionId, [key]: 'forged' }))).status).toBe(400);
    }
    expect((await auditRoute(req({ report: { company: report.company, consolidatedReport: 'forged' } }))).status).toBe(400);
    expect(orchestrateAudit).not.toHaveBeenCalled();

    await auditRoute(req({ reportVersionId: first.reportVersionId }));
    expect(vi.mocked(orchestrateAudit).mock.calls[0][0].report.niifAnalysis.fullContent)
      .toBe(report.niifAnalysis.fullContent);
    expect(vi.mocked(orchestrateAudit).mock.calls[0][0].report.company).toEqual(report.company);
  });

  it('meta-audits the stored version and refuses client-supplied audit content', async () => {
    const { third } = await complete();
    for (const key of ['report', 'auditReport', 'preprocessed']) {
      expect((await qualityRoute(req({ reportVersionId: third.reportVersionId, [key]: 'forged' }))).status).toBe(400);
    }
    expect(runQualityAudit).not.toHaveBeenCalled();
    await qualityRoute(req({ reportVersionId: third.reportVersionId }));
    const stored = await loadFinancialVersion(await requireReportWorkspace(), third.reportVersionId);
    expect(vi.mocked(runQualityAudit).mock.calls[0][0].report.consolidatedReport)
      .toBe(stored.report!.consolidatedReport);
    expect(vi.mocked(runQualityAudit).mock.calls[0][0].auditReport).toBeUndefined();
  });

  it('does not let another company reach or export a stored audit', async () => {
    const { first, third } = await complete();
    const audit = await auditRoute(req({ reportVersionId: first.reportVersionId })).then(r => r.json());
    state.userId = 'user-b'; state.cookie = A;
    expect((await auditRoute(req({ reportVersionId: first.reportVersionId }))).status).toBe(404);
    expect((await qualityRoute(req({ reportVersionId: third.reportVersionId }))).status).toBe(404);
    expect((await exportReport(req({
      reportVersionId: third.reportVersionId, auditVersionId: audit.auditVersionId,
    }))).status).toBe(404);
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });

  it('rejects malformed, absent and wrong-kind audit references at export', async () => {
    const { third } = await complete();
    expect((await exportReport(req({ reportVersionId: third.reportVersionId, auditVersionId: 'forged' }))).status).toBe(400);
    expect((await exportReport(req({ reportVersionId: third.reportVersionId, auditVersionId: B }))).status).toBe(404);
    // A financial version id is not an audit result.
    expect((await exportReport(req({
      reportVersionId: third.reportVersionId, auditVersionId: third.reportVersionId,
    }))).status).toBe(404);
    // A stored audit is not a stored meta-audit.
    const audit = await auditRoute(req({ reportVersionId: third.reportVersionId })).then(r => r.json());
    expect((await exportReport(req({
      reportVersionId: third.reportVersionId, qualityVersionId: audit.auditVersionId,
    }))).status).toBe(409);
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });

  it('never joins a report with an audit of a different report', async () => {
    const runA = await complete();
    const runB = await complete();
    const auditOfB = await auditRoute(req({ reportVersionId: runB.first.reportVersionId })).then(r => r.json());
    expect((await exportReport(req({
      reportVersionId: runA.third.reportVersionId, auditVersionId: auditOfB.auditVersionId,
    }))).status).toBe(409);
    expect((await qualityRoute(req({
      reportVersionId: runA.third.reportVersionId, auditVersionId: auditOfB.auditVersionId,
    }))).status).toBe(409);
    // Its own chain still resolves: the NIIF version it examined is an ancestor.
    expect((await exportReport(req({
      reportVersionId: runB.third.reportVersionId, auditVersionId: auditOfB.auditVersionId,
    }))).status).toBe(200);
  });

  it('never joins a meta-audit with an audit it did not read', async () => {
    const { first, third } = await complete();
    const firstAudit = await auditRoute(req({ reportVersionId: first.reportVersionId })).then(r => r.json());
    const secondAudit = await auditRoute(req({ reportVersionId: first.reportVersionId })).then(r => r.json());
    const quality = await qualityRoute(req({
      reportVersionId: third.reportVersionId, auditVersionId: firstAudit.auditVersionId,
    })).then(r => r.json());
    expect((await exportReport(req({
      reportVersionId: third.reportVersionId, auditVersionId: secondAudit.auditVersionId,
      qualityVersionId: quality.qualityVersionId,
    }))).status).toBe(409);
    // Omitting the audit does not hide the pairing either.
    expect((await exportReport(req({
      reportVersionId: third.reportVersionId, qualityVersionId: quality.qualityVersionId,
    }))).status).toBe(409);
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });

  it('detects an altered audit row and an altered examined report version', async () => {
    const { first, third } = await complete();
    const audit = await auditRoute(req({ reportVersionId: first.reportVersionId })).then(r => r.json());
    await pg.query("UPDATE reports SET data=jsonb_set(data, '{payload,audit,overallScore}', '100') WHERE id=$1",
      [audit.auditVersionId]);
    expect((await exportReport(req({
      reportVersionId: third.reportVersionId, auditVersionId: audit.auditVersionId,
    }))).status).toBe(409);

    // A version that is internally consistent but no longer the one examined.
    const clean = await auditRoute(req({ reportVersionId: first.reportVersionId })).then(r => r.json());
    const ws = await requireReportWorkspace();
    const stored = await loadFinancialVersion(ws, first.reportVersionId);
    const replacement = await saveFinancialVersion(ws, { ...stored, instructions: 'rewritten' });
    const [{ data: rewritten }] = (await pg.query<{ data: unknown }>(
      'SELECT data FROM reports WHERE id=$1', [replacement])).rows;
    await pg.query('UPDATE reports SET data=$1 WHERE id=$2', [rewritten, first.reportVersionId]);
    expect((await exportReport(req({
      reportVersionId: third.reportVersionId, auditVersionId: clean.auditVersionId,
    }))).status).toBe(409);
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });

  it('keeps an incomplete audit on screen and out of the download', async () => {
    const { first, third } = await complete();
    const partial = makeAudit();
    partial.auditorResults[2] = { ...partial.auditorResults[2], failed: true, complianceScore: 0, findings: [] };
    vi.mocked(orchestrateAudit).mockResolvedValue(partial);
    const audit = await auditRoute(req({ reportVersionId: first.reportVersionId })).then(r => r.json());
    expect(audit.auditVersionId).toBeDefined();
    expect(audit.auditComplete).toBe(false);
    expect((await exportReport(req({
      reportVersionId: third.reportVersionId, auditVersionId: audit.auditVersionId,
    }))).status).toBe(409);

    // The meta-audit may read it, but never becomes exportable on its own.
    const quality = await qualityRoute(req({
      reportVersionId: third.reportVersionId, auditVersionId: audit.auditVersionId,
    })).then(r => r.json());
    expect(quality.qualityComplete).toBe(false);
    expect((await exportReport(req({
      reportVersionId: third.reportVersionId, qualityVersionId: quality.qualityVersionId,
    }))).status).toBe(409);
    expect(generateFinancialExcel).not.toHaveBeenCalled();

    // The base report is still downloadable without the audits.
    expect((await exportReport(req({ reportVersionId: third.reportVersionId }))).status).toBe(200);
  });

  it('refuses to meta-audit a report version that is still in progress', async () => {
    const { first, second } = await complete();
    expect((await qualityRoute(req({ reportVersionId: first.reportVersionId }))).status).toBe(409);
    expect((await qualityRoute(req({ reportVersionId: second.reportVersionId }))).status).toBe(409);
    expect(runQualityAudit).not.toHaveBeenCalled();
  });

  it('does not acknowledge an audit or meta-audit it could not store', async () => {
    const { first, third } = await complete();
    await pg.exec("ALTER TABLE reports ADD CONSTRAINT reject_audit_insert CHECK (kind <> 'financial_audit_version_v1')");
    try {
      expect((await auditRoute(req({ reportVersionId: first.reportVersionId }))).status).toBe(503);
      expect((await qualityRoute(req({ reportVersionId: third.reportVersionId }))).status).toBe(503);
      const streamed = await auditRoute(req({ reportVersionId: first.reportVersionId }, true));
      const text = await streamed.text();
      expect(text).toContain('event: error');
      expect(text).not.toContain('event: result');
    } finally { await pg.exec('ALTER TABLE reports DROP CONSTRAINT reject_audit_insert'); }
  });

  it('reuses the stored result when a download is retried and never re-runs the agents', async () => {
    const { first, third } = await complete();
    const audit = await auditRoute(req({ reportVersionId: first.reportVersionId })).then(r => r.json());
    vi.mocked(generateFinancialExcel).mockRejectedValueOnce(new Error('temporary renderer failure'));
    const body = { reportVersionId: third.reportVersionId, auditVersionId: audit.auditVersionId };
    expect((await exportReport(req(body))).status).toBe(503);
    expect((await exportReport(req(body))).status).toBe(200);
    expect(orchestrateAudit).toHaveBeenCalledTimes(1);
  });

  it('fails closed for audits when authentication is configured without a session', async () => {
    const { first, third } = await complete();
    state.userId = null; state.cookie = C;
    expect((await auditRoute(req({ reportVersionId: first.reportVersionId }))).status).toBe(401);
    expect((await qualityRoute(req({ reportVersionId: third.reportVersionId }))).status).toBe(401);
    expect(orchestrateAudit).not.toHaveBeenCalled();
    expect(runQualityAudit).not.toHaveBeenCalled();
  });
});
