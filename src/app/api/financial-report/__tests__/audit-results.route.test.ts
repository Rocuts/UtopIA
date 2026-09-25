// ---------------------------------------------------------------------------
// Procedencia servidor de las Partes IV y V — rutas con almacenamiento
// controlado
// ---------------------------------------------------------------------------
// /export por referencia sellaba "procedencia verificada" pero imprimía los
// dictámenes y la meta-auditoría que enviaba el navegador. Ahora
// /financial-audit y /financial-quality, con `reportRef`, corren los agentes
// sobre la versión persistida y guardan el resultado atado a ella; /export
// sólo incluye resultados persistidos, por referencia, producidos sobre ESA
// versión y completos.
//
// Alcance: `getDb()` es el fake de provenance-fixture, que evalúa las
// condiciones SQL reales del store (workspace, kind, id); el workspace de la
// sesión se fija con un mock. Los agentes están controlados; el composer del
// PDF es el real y sólo su render binario está controlado. No prueba Postgres
// (ver audit-result-store.db.test.ts) ni la resolución real de sesión.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const state = vi.hoisted(() => ({ db: null as unknown, workspace: null as string | null }));

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('@/lib/db/workspace', () => ({ getCurrentWorkspaceId: vi.fn(async () => state.workspace) }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
// El composer es el REAL: sólo el render binario está controlado y captura el
// documento compuesto. Un mock del composer ocultó que las Partes IV/V
// persistidas se descartaban sin `assuranceProvenance` (reportes-export-11).
vi.mock('@/lib/export/pdf-elite-react', async (orig) => {
  const actual = await orig<typeof import('@/lib/export/pdf-elite-react')>();
  return {
    ...actual,
    composeEditorialReport: vi.fn(actual.composeEditorialReport),
    renderEditorialReportToStream: vi.fn(),
  };
});
vi.mock('@/lib/agents/financial/audit/orchestrator', () => ({ orchestrateAudit: vi.fn() }));
// Sólo el agente: el composer real usa `deriveQualityContext` del mismo módulo.
vi.mock('@/lib/agents/financial/quality/agent', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/financial/quality/agent')>()),
  runQualityAudit: vi.fn(),
}));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: async () => '' }));
vi.mock('@/lib/db/telemetry', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/telemetry')>();
  return { ...actual, resolveOwnedReportId: async () => null };
});
vi.mock('@/lib/workflows/sentinel/repository', () => ({
  upsertAlert: vi.fn(async () => undefined),
  findPendingAlertsForWorkspace: vi.fn(async () => []),
}));

import { POST as consolidate } from '../consolidate/route';
import { POST as exportReport } from '../export/route';
import { POST as auditRoute } from '../../financial-audit/route';
import { POST as qualityRoute } from '../../financial-quality/route';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { composeEditorialReport, renderEditorialReportToStream } from '@/lib/export/pdf-elite-react';
import { orchestrateAudit } from '@/lib/agents/financial/audit/orchestrator';
import { runQualityAudit } from '@/lib/agents/financial/quality/agent';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';
import { buildAuditResultVersion, FINANCIAL_AUDIT_RESULT_KIND } from '@/lib/reports/audit-result-version';
import {
  PROVENANCE_COMPANY,
  consolidateBody,
  makeProvenanceParts,
  makeReportsTableFake,
} from '@/lib/reports/__tests__/provenance-fixture';

const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const MISSING_ID = '33333333-3333-4333-8333-333333333333';

let fake: ReturnType<typeof makeReportsTableFake>;
const previousDbUrl = process.env.DATABASE_URL;

type Ref = { reportId: string; reportHash: string };
type ResultRef = { resultId: string; resultHash: string };

const req = (path: string, body: unknown, stream = false) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(stream ? { 'X-Stream': 'true' } : {}) },
    body: JSON.stringify(body),
  });

function makeAudit(overrides: Partial<AuditReport> = {}): AuditReport {
  const domains = ['niif', 'tributario', 'legal', 'revisoria'] as const;
  return {
    company: { ...PROVENANCE_COMPANY, niifGroup: 2 },
    auditorResults: domains.map((domain) => ({
      domain, auditorName: `Auditor ${domain}`, complianceScore: 90,
      findings: [], summary: `Resumen ${domain}`, fullContent: `# ${domain}`, failed: false,
    })),
    overallScore: 90,
    opinionType: 'favorable',
    opinionText: 'Sin salvedades.',
    consolidatedFindings: [],
    findingCounts: { critico: 0, alto: 0, medio: 0, bajo: 0, informativo: 0 },
    executiveSummary: 'Dictámenes sin salvedades.',
    consolidatedReport: '# Dictámenes persistidos',
    generatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

function makeQuality(overrides: Partial<QualityAssessment> = {}): QualityAssessment {
  return {
    overallScore: 84,
    grade: 'B',
    dimensions: [{ name: 'Trazabilidad', score: 88, framework: 'ISO 42001', findings: [], recommendations: [] }],
    ifrs18Readiness: { ready: false, score: 70, gaps: [] },
    dataQuality: { completeness: 90, accuracy: 92, consistency: 88, timeliness: 80, validity: 91 },
    aiGovernance: { traceability: 90, explainability: 85, antiHallucination: 95, humanOversight: 80 },
    executiveSummary: 'Calidad aceptable.',
    fullReport: '# Meta-auditoría persistida',
    generatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

/** Partes con JSON de Estrategia y Gobierno, como en procedencia-servidor. */
function partsWithJson() {
  const parts = makeProvenanceParts();
  const alert = (severity: 'red' | 'amber', title: string) => ({
    severity, title, description: 'Revisar la política de cobro de cartera.', normReference: null,
  });
  parts.strategicAnalysis.json = {
    ...parts.strategicAnalysis.json!,
    technicalAlerts: [alert('red', 'Cartera'), alert('amber', 'Liquidez')],
  };
  return parts;
}

async function consolidateIn(workspace: string | null) {
  state.workspace = workspace;
  const res = await consolidate(
    req('/api/financial-report/consolidate', consolidateBody({ reportParts: partsWithJson() })),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { report: FinancialReport; reportRef?: Ref };
}

async function sseEvent(res: Response, event: string) {
  expect(res.status).toBe(200);
  const text = await res.text();
  const block = text.split('\n\n').find((b) => b.startsWith(`event: ${event}\n`));
  return block ? JSON.parse(block.split('\ndata: ')[1]) : null;
}

async function auditOf(reportRef: Ref) {
  return (await (await auditRoute(req('/api/financial-audit', { reportRef }))).json()) as AuditReport;
}
async function qualityOf(reportRef: Ref, auditRef?: ResultRef) {
  return (await (await qualityRoute(req('/api/financial-quality', { reportRef, ...(auditRef ? { auditRef } : {}) }))).json()) as QualityAssessment;
}
const exportWith = (body: Record<string, unknown>) =>
  exportReport(req('/api/financial-report/export', { format: 'pdf-elite', ...body }));

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://fake-for-tests';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  if (previousDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDbUrl;
});

beforeEach(() => {
  vi.clearAllMocks();
  fake = makeReportsTableFake();
  state.db = fake.db;
  state.workspace = W1;
  vi.mocked(renderEditorialReportToStream).mockImplementation(async () => Readable.from(['%PDF-test']));
  vi.mocked(orchestrateAudit).mockResolvedValue(makeAudit());
  vi.mocked(runQualityAudit).mockResolvedValue(makeQuality());
});

describe('Partes IV y V por referencia: se guardan antes de responder', () => {
  it('audita la versión persistida y guarda el resultado atado a ella', async () => {
    const { reportRef } = await consolidateIn(W1);
    const audit = await auditOf(reportRef!);
    expect(audit.auditRef?.resultId).toMatch(/^[0-9a-f-]{36}$/);
    expect(audit.auditRef?.resultHash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit.auditComplete).toBe(true);
    expect(audit.persistence).toEqual({ status: 'persisted' });
    const row = fake.rows.find((r) => r.id === audit.auditRef!.resultId)!;
    expect(row.kind).toBe(FINANCIAL_AUDIT_RESULT_KIND);
    expect(row.workspaceId).toBe(W1);
    expect((row.data as { reportRef: Ref }).reportRef).toEqual(reportRef);
  });

  it('en SSE anuncia el resultado con su referencia sólo después de guardarlo', async () => {
    const { reportRef } = await consolidateIn(W1);
    const result = await sseEvent(await auditRoute(req('/api/financial-audit', { reportRef }, true)), 'result');
    expect(result.auditRef.resultId).toBe(fake.rows.find((r) => r.kind === FINANCIAL_AUDIT_RESULT_KIND)!.id);
  });

  it('los agentes leen la versión persistida, no el informe enviado en el cuerpo', async () => {
    const { reportRef, report } = await consolidateIn(W1);
    const forged = { ...report, company: { ...report.company, nit: '800123456-1' }, consolidatedReport: 'FORJADO' };
    await auditRoute(req('/api/financial-audit', { reportRef, report: forged, preprocessed: { forged: true } }));
    const audited = vi.mocked(orchestrateAudit).mock.calls[0][0].report;
    expect(audited.company.nit).toBe(report.company.nit);
    expect(audited.consolidatedReport).not.toContain('FORJADO');
    const opts = vi.mocked(orchestrateAudit).mock.calls[0][1];
    expect(opts?.preprocessed?.primary.controlTotals.activo).toBe(10000);

    const audit = await auditOf(reportRef!);
    await qualityRoute(req('/api/financial-quality', {
      reportRef, auditRef: audit.auditRef, report: forged, auditReport: makeAudit({ overallScore: 1 }),
    }));
    const input = vi.mocked(runQualityAudit).mock.calls[0][0];
    expect(input.report.company.nit).toBe(report.company.nit);
    expect(input.auditReport?.overallScore).toBe(90);
  });

  it('una referencia mal formada responde 400 sin correr los agentes', async () => {
    const { reportRef } = await consolidateIn(W1);
    expect((await auditRoute(req('/api/financial-audit', { reportRef: { reportId: 'x' } }))).status).toBe(400);
    expect((await qualityRoute(req('/api/financial-quality', { reportRef, auditRef: { resultId: 'x' } }))).status).toBe(400);
    expect(orchestrateAudit).not.toHaveBeenCalled();
    expect(runQualityAudit).not.toHaveBeenCalled();
  });
});

describe('/export incluye sólo Partes IV/V persistidas de ESA versión', () => {
  it('publica los resultados guardados en el PDF y en el Excel, y lo declara en el sello', async () => {
    const { reportRef } = await consolidateIn(W1);
    const audit = await auditOf(reportRef!);
    const quality = await qualityOf(reportRef!, audit.auditRef);
    expect(quality.qualityComplete).toBe(true);
    const refs = { auditRef: audit.auditRef, qualityRef: quality.qualityRef };

    const pdf = await exportWith({ reportRef, ...refs });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('X-Audit-Result-Id')).toBe(audit.auditRef!.resultId);
    expect(pdf.headers.get('X-Quality-Result-Id')).toBe(quality.qualityRef!.resultId);
    const composed = vi.mocked(composeEditorialReport).mock.calls[0][0];
    expect(composed.auditReport?.consolidatedReport).toBe('# Dictámenes persistidos');
    expect(composed.qualityReport?.fullReport).toBe('# Meta-auditoría persistida');
    expect(composed.assuranceProvenance).toBe('server-persisted');
    // Lo que de verdad se imprime: el documento compuesto trae ambas páginas.
    const doc = vi.mocked(renderEditorialReportToStream).mock.calls[0][0];
    expect(doc.auditFindings?.opinionType).toBe('favorable');
    expect(doc.qualityScores).toBeDefined();

    const xlsx = await exportReport(req('/api/financial-report/export', { reportRef, format: 'excel', ...refs }));
    expect(xlsx.status).toBe(200);
    const args = vi.mocked(generateFinancialExcel).mock.calls[0][0];
    expect(args.auditReport?.overallScore).toBe(90);
    expect(args.qualityReport?.grade).toBe('B');
    expect(args.report.consolidatedReport).toContain(`Parte IV (dictámenes generados por IA): resultado persistido ${audit.auditRef!.resultId}`);
    expect(args.report.consolidatedReport).toContain('El sello acredita su procedencia, no su contenido.');
  });

  it('los dictámenes enviados en el cuerpo no llegan al documento verificado', async () => {
    // Antes la ruta los pasaba al composer, que los descartaba por falta de
    // procedencia (reportes-export-11); ahora ni siquiera le llegan, y el sello
    // declara que se omitieron.
    const { reportRef } = await consolidateIn(W1);
    const pdf = await exportWith({
      reportRef, auditReport: makeAudit({ overallScore: 100, opinionText: 'FORJADO' }), qualityReport: makeQuality({ grade: 'A+' }),
    });
    expect(pdf.status).toBe(200);
    const composed = vi.mocked(composeEditorialReport).mock.calls[0][0];
    expect(composed.auditReport).toBeNull();
    expect(composed.qualityReport).toBeNull();
    expect(composed.assuranceProvenance).toBeNull();
    const doc = vi.mocked(renderEditorialReportToStream).mock.calls[0][0];
    expect(doc.auditFindings).toBeUndefined();
    expect(doc.qualityScores).toBeUndefined();
    expect(pdf.headers.get('X-Report-Audit-Content-Dropped')).toBe('true');
    expect(pdf.headers.get('X-Audit-Result-Id')).toBeNull();
  });

  it('otra empresa no alcanza un resultado aunque nombre esta misma versión', async () => {
    // La versión es de W1 y la cadena y la huella coinciden: lo único que separa
    // el contenido de W2 del documento es el filtro por workspace del store.
    const { reportRef } = await consolidateIn(W1);
    const planted = buildAuditResultVersion({
      part: 'iv', reportRef: reportRef!, auditRef: null, language: 'es',
      result: makeAudit({ opinionText: 'DE OTRA EMPRESA' }),
    });
    const resultId = '44444444-4444-4444-8444-444444444444';
    fake.rows.push({
      id: resultId, workspaceId: W2, kind: FINANCIAL_AUDIT_RESULT_KIND, title: null,
      data: JSON.parse(JSON.stringify(planted)), controlTotals: null,
    });
    const res = await exportWith({ reportRef, auditRef: { resultId, resultHash: planted.resultHash } });
    expect(res.status).toBe(404);
    expect(composeEditorialReport).not.toHaveBeenCalled();
    // Y desde W2 la versión del informe tampoco existe.
    state.workspace = W2;
    expect((await auditRoute(req('/api/financial-audit', { reportRef }))).status).toBe(404);
    expect(orchestrateAudit).not.toHaveBeenCalled();
  });

  it('nunca junta el informe con un resultado de otra versión', async () => {
    const first = await consolidateIn(W1);
    const second = await consolidateIn(W1);
    expect(second.reportRef!.reportId).not.toBe(first.reportRef!.reportId);
    const auditOfFirst = await auditOf(first.reportRef!);
    expect((await exportWith({ reportRef: second.reportRef, auditRef: auditOfFirst.auditRef })).status).toBe(409);
    expect((await qualityRoute(req('/api/financial-quality', {
      reportRef: second.reportRef, auditRef: auditOfFirst.auditRef,
    }))).status).toBe(409);
    expect(composeEditorialReport).not.toHaveBeenCalled();
    expect((await exportWith({ reportRef: first.reportRef, auditRef: auditOfFirst.auditRef })).status).toBe(200);
  });

  it('la meta-auditoría sólo se publica junto a la Parte IV que leyó, en ambos sentidos', async () => {
    const { reportRef } = await consolidateIn(W1);
    const a1 = await auditOf(reportRef!);
    const a2 = await auditOf(reportRef!);
    const readA1 = await qualityOf(reportRef!, a1.auditRef);
    const readNone = await qualityOf(reportRef!);
    expect((await exportWith({ reportRef, auditRef: a2.auditRef, qualityRef: readA1.qualityRef })).status).toBe(409);
    expect((await exportWith({ reportRef, qualityRef: readA1.qualityRef })).status).toBe(409);
    expect((await exportWith({ reportRef, auditRef: a1.auditRef, qualityRef: readNone.qualityRef })).status).toBe(409);
    expect(composeEditorialReport).not.toHaveBeenCalled();
    expect((await exportWith({ reportRef, auditRef: a1.auditRef, qualityRef: readA1.qualityRef })).status).toBe(200);
    expect((await exportWith({ reportRef, qualityRef: readNone.qualityRef })).status).toBe(200);
  });

  it('un resultado parcial se muestra pero no entra en la descarga, y la Parte V lo hereda', async () => {
    const { reportRef } = await consolidateIn(W1);
    const partial = makeAudit();
    partial.auditorResults[2] = { ...partial.auditorResults[2], failed: true, complianceScore: 0 };
    vi.mocked(orchestrateAudit).mockResolvedValueOnce(partial);
    const audit = await auditOf(reportRef!);
    expect(audit.auditRef).toBeDefined();
    expect(audit.auditComplete).toBe(false);
    expect((await exportWith({ reportRef, auditRef: audit.auditRef })).status).toBe(409);
    const quality = await qualityOf(reportRef!, audit.auditRef);
    expect(quality.qualityComplete).toBe(false);
    expect((await exportWith({ reportRef, qualityRef: quality.qualityRef })).status).toBe(409);
    expect(composeEditorialReport).not.toHaveBeenCalled();
    // El informe base sigue descargable sin ellas.
    expect((await exportWith({ reportRef })).status).toBe(200);
  });

  it('detecta una fila alterada, una huella ajena y una referencia de la otra Parte', async () => {
    const { reportRef } = await consolidateIn(W1);
    const audit = await auditOf(reportRef!);
    const quality = await qualityOf(reportRef!, audit.auditRef);
    // Una meta-auditoría nombrada como Parte IV (sola, sin pairing que la tape).
    expect((await exportWith({ reportRef, auditRef: quality.qualityRef })).status).toBe(409);
    expect((await exportWith({ reportRef, auditRef: quality.qualityRef, qualityRef: audit.auditRef })).status).toBe(409);
    expect((await exportWith({ reportRef, auditRef: { ...audit.auditRef!, resultHash: 'f'.repeat(64) } })).status).toBe(409);
    expect((await exportWith({ reportRef, auditRef: { resultId: MISSING_ID, resultHash: 'a'.repeat(64) } })).status).toBe(404);
    expect((await exportWith({ reportRef, auditRef: { resultId: 'no-uuid' } })).status).toBe(400);
    const row = fake.rows.find((r) => r.id === audit.auditRef!.resultId)!;
    (row.data as { result: AuditReport }).result.overallScore = 100;
    expect((await exportWith({ reportRef, auditRef: audit.auditRef })).status).toBe(409);
    expect(composeEditorialReport).not.toHaveBeenCalled();
  });

  it('si no se pudo guardar, el resultado se ve pero sin referencia exportable', async () => {
    const { reportRef } = await consolidateIn(W1);
    const insert = fake.db.insert;
    fake.db.insert = () => { throw new Error('almacenamiento caído'); };
    try {
      const audit = await auditOf(reportRef!);
      expect(audit.auditRef).toBeUndefined();
      expect(audit.persistence).toEqual({ status: 'not_persisted', reason: 'storage_error' });
      const streamed = await sseEvent(await auditRoute(req('/api/financial-audit', { reportRef }, true)), 'result');
      expect(streamed.auditRef).toBeUndefined();
      expect(streamed.persistence.status).toBe('not_persisted');
      const quality = await qualityOf(reportRef!);
      expect(quality.qualityRef).toBeUndefined();
    } finally {
      fake.db.insert = insert;
    }
    expect(fake.rows.some((r) => r.kind === FINANCIAL_AUDIT_RESULT_KIND)).toBe(false);
  });

  it('reintentar la descarga reutiliza el resultado guardado sin volver a correr los agentes', async () => {
    const { reportRef } = await consolidateIn(W1);
    const audit = await auditOf(reportRef!);
    vi.mocked(renderEditorialReportToStream).mockRejectedValueOnce(new Error('render caído'));
    expect((await exportWith({ reportRef, auditRef: audit.auditRef })).status).toBeGreaterThanOrEqual(500);
    expect((await exportWith({ reportRef, auditRef: audit.auditRef })).status).toBe(200);
    expect(orchestrateAudit).toHaveBeenCalledTimes(1);
  });
});
