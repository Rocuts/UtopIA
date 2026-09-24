// ---------------------------------------------------------------------------
// Procedencia servidor de informes (fase 2, P1) — rutas con almacenamiento
// controlado
// ---------------------------------------------------------------------------
// Antes, /export y /html validaban el informe y el balance que llegaban en el
// cuerpo, pero nada demostraba que correspondieran a una versión autorizada de
// la empresa, y /api/escudo/fiscal-anchor persistía el snapshot fiscal que
// enviaba el navegador (tributario-modulos-24). Ahora /consolidate persiste la
// versión ensamblada por el servidor en `reports` (kind 'financial_report') del
// workspace de la sesión y devuelve `{reportId, reportHash}`; las salidas la
// cargan por esa referencia dentro del MISMO workspace y usan ESA versión.
//
// Alcance de esta prueba: `getDb()` es un fake que evalúa las condiciones SQL
// reales del store (workspace, kind, id) y simula jsonb con un viaje JSON; el
// workspace de la sesión se fija en cada caso con un mock de
// `getCurrentWorkspaceId`. No prueba la resolución real de sesión/cookie ni
// Postgres (ver financial-report-store.db.test.ts): un mock de auth aislado no
// acredita aislamiento real de tenants.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const state = vi.hoisted(() => ({ db: null as unknown, workspace: null as string | null }));

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('@/lib/db/workspace', () => ({ getCurrentWorkspaceId: vi.fn(async () => state.workspace) }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
vi.mock('@/lib/export/pdf-elite-react', () => ({
  composeEditorialReport: vi.fn(() => ({ appendix: { validationWarnings: [] } })),
  renderEditorialReportToStream: vi.fn(),
}));
vi.mock('@/lib/agents/financial/agents/html-editor', () => ({ runHtmlEditor: vi.fn() }));
// El contrato de los tres JSON se prueba aparte; aquí interesa qué JSON llega.
vi.mock('@/lib/agents/financial/contracts/html-editor', () => ({
  HtmlEditorInputSchema: { safeParse: (body: unknown) => ({ success: true, data: body }) },
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
import { POST as html } from '../html/route';
import { POST as fiscalAnchor } from '../../escudo/fiscal-anchor/route';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { composeEditorialReport, renderEditorialReportToStream } from '@/lib/export/pdf-elite-react';
import { runHtmlEditor } from '@/lib/agents/financial/agents/html-editor';
import { upsertAlert } from '@/lib/workflows/sentinel/repository';
import type { FinancialReport } from '@/lib/agents/financial/types';
import {
  PROVENANCE_COMPANY,
  PROVENANCE_CSV,
  consolidateBody,
  makeProvenanceParts,
  makeReportsTableFake,
} from '@/lib/reports/__tests__/provenance-fixture';

const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const MISSING_ID = '33333333-3333-4333-8333-333333333333';

let fake: ReturnType<typeof makeReportsTableFake>;
const previousDbUrl = process.env.DATABASE_URL;

const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

type Ref = { reportId: string; reportHash: string };
type ConsolidateJson = {
  report: FinancialReport;
  reportRef?: Ref;
  provenance: { status: string; reason?: string; reportHash: string; sourceHash: string | null; contractVersion: string };
};

/** Partes con JSON de Estrategia y Gobierno (el HTML los exige). */
function partsWithJson() {
  const parts = makeProvenanceParts();
  (parts.strategicAnalysis as { json?: unknown }).json = {
    technicalAlerts: [{ severity: 'red' }, { severity: 'amber' }],
  };
  (parts.governance as { json?: unknown }).json = { shareholderMinutes: null };
  return parts;
}

async function consolidateIn(workspace: string | null, extra: Record<string, unknown> = {}) {
  state.workspace = workspace;
  const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody({ reportParts: partsWithJson(), ...extra })));
  expect(res.status).toBe(200);
  return (await res.json()) as ConsolidateJson;
}

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
  vi.mocked(runHtmlEditor).mockResolvedValue({
    html: '<html><head></head><body><main>Informe</main></body></html>',
    metadata: {},
    checklistFailures: [],
    emittable: true,
  } as never);
});

describe('/consolidate persiste la versión del informe en el workspace de la sesión', () => {
  it('devuelve {reportId, reportHash} y guarda informe, balance, huellas y contrato', async () => {
    const out = await consolidateIn(W1);
    expect(out.provenance.status).toBe('persisted');
    expect(out.reportRef?.reportId).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.reportRef?.reportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fake.rows).toHaveLength(1);
    const row = fake.rows[0];
    expect(row.workspaceId).toBe(W1);
    expect(row.kind).toBe('financial_report');
    const data = row.data as Record<string, unknown>;
    expect(data.reportHash).toBe(out.reportRef?.reportHash);
    expect(data.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.contractVersion).toBe(out.provenance.contractVersion);
    expect((row.controlTotals as { activo: number }).activo).toBe(10000);
    // La UI conserva exactamente lo persistido.
    expect(out.report).toEqual(data.report);
    // Snapshot fiscal y Âncora calculados en el servidor desde el balance re-derivado.
    expect(out.report.fiscalSnapshot?.period).toBeTruthy();
  });

  it('sin workspace o sin base de datos no hay referencia: procedencia no persistida con motivo', async () => {
    const anon = await consolidateIn(null);
    expect(anon.provenance).toMatchObject({ status: 'not_persisted', reason: 'no_workspace' });
    expect(anon.reportRef).toBeUndefined();
    delete process.env.DATABASE_URL;
    try {
      const noDb = await consolidateIn(W1);
      expect(noDb.provenance).toMatchObject({ status: 'not_persisted', reason: 'no_database' });
    } finally {
      process.env.DATABASE_URL = 'postgres://fake-for-tests';
    }
    expect(fake.rows).toHaveLength(0);
  });

  it('el texto de cada parte debe coincidir con su fullContent', async () => {
    const res = await consolidate(
      req('/api/financial-report/consolidate', consolidateBody({ niifContent: 'Otro texto de la Parte I' })),
    );
    expect(res.status).toBe(400);
    expect(fake.rows).toHaveLength(0);
  });
});

describe('/export usa la versión persistida referenciada', () => {
  it('mismo workspace: exporta ESA versión, sellada como verificada', async () => {
    const { reportRef, report } = await consolidateIn(W1);
    const res = await exportReport(req('/api/financial-report/export', { reportRef, format: 'excel' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Report-Provenance')).toBe('verified');
    expect(res.headers.get('X-Report-Id')).toBe(reportRef!.reportId);
    const args = vi.mocked(generateFinancialExcel).mock.calls[0][0];
    expect(args.report.niifAnalysis.json).toEqual(report.niifAnalysis.json);
    expect(args.report.consolidatedReport.startsWith('# PROCEDENCIA VERIFICADA')).toBe(true);
    expect(args.report.consolidatedReport).toContain(reportRef!.reportHash);
    expect(args.preprocessed?.primary.controlTotals.activo).toBe(10000);
  });

  it('un cuerpo alterado (informe, balance, preprocesado, ledger) no sustituye al persistido', async () => {
    const { reportRef, report } = await consolidateIn(W1);
    const forged = structuredClone(report);
    forged.niifAnalysis.json!.balanceSheet.totalAssetsPrimary = '99999900';
    forged.consolidatedReport = 'Informe alterado';
    const res = await exportReport(
      req('/api/financial-report/export', {
        reportRef,
        format: 'excel',
        report: forged,
        rawData: PROVENANCE_CSV.replace('130505,Clientes,Auxiliar,1,8300', '130505,Clientes,Auxiliar,1,999999'),
        preprocessed: { periods: [] },
        adjustmentLedger: { adjustments: 'x' },
      }),
    );
    expect(res.status).toBe(200);
    const args = vi.mocked(generateFinancialExcel).mock.calls[0][0];
    expect(args.report.niifAnalysis.json?.balanceSheet.totalAssetsPrimary).toBe('1000000');
    expect(args.report.consolidatedReport).not.toContain('Informe alterado');
    expect(args.preprocessed?.primary.controlTotals.activo).toBe(10000);
  });

  it('PDF: compone desde la versión persistida y el Anexo lleva la procedencia', async () => {
    const { reportRef, report } = await consolidateIn(W1);
    const res = await exportReport(
      req('/api/financial-report/export', { reportRef, format: 'pdf-elite', report: { alterado: true }, language: 'es' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Report-Provenance')).toBe('verified');
    const input = vi.mocked(composeEditorialReport).mock.calls[0][0];
    expect(input.report).toEqual(report);
    const doc = vi.mocked(composeEditorialReport).mock.results[0].value as {
      appendix: { validationWarnings: string[] };
    };
    expect(doc.appendix.validationWarnings.join('\n')).toMatch(/^PROCEDENCIA VERIFICADA — /m);
  });

  it('versión de OTRO workspace e id inexistente → el mismo 404 (no revela existencia)', async () => {
    const { reportRef } = await consolidateIn(W1);
    state.workspace = W2;
    const foreign = await exportReport(req('/api/financial-report/export', { reportRef, format: 'excel' }));
    state.workspace = W1;
    const missing = await exportReport(
      req('/api/financial-report/export', { reportRef: { ...reportRef, reportId: MISSING_ID }, format: 'excel' }),
    );
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });

  it('sin workspace de sesión una referencia no se resuelve (404)', async () => {
    const { reportRef } = await consolidateIn(W1);
    state.workspace = null;
    const res = await exportReport(req('/api/financial-report/export', { reportRef, format: 'excel' }));
    expect(res.status).toBe(404);
  });

  it('referencia mal formada → 400 sin consultar el almacenamiento', async () => {
    await consolidateIn(W1);
    const before = fake.queries.length;
    const res = await exportReport(
      req('/api/financial-report/export', { reportRef: { reportId: "x' OR 1=1", reportHash: 'x' }, format: 'excel' }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('REPORT_REF_INVALID');
    expect(fake.queries.length).toBe(before);
  });

  it('misma versión con otra huella → 409', async () => {
    const { reportRef } = await consolidateIn(W1);
    const res = await exportReport(
      req('/api/financial-report/export', { reportRef: { ...reportRef, reportHash: 'f'.repeat(64) }, format: 'excel' }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('REPORT_VERSION_MISMATCH');
  });

  it('una fila alterada en el almacenamiento no se exporta (409 de integridad)', async () => {
    const { reportRef } = await consolidateIn(W1);
    const data = fake.rows[0].data as { report: FinancialReport };
    data.report.niifAnalysis.json!.balanceSheet.totalAssetsPrimary = '1';
    const res = await exportReport(req('/api/financial-report/export', { reportRef, format: 'excel' }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('REPORT_VERSION_INTEGRITY');
  });

  it('niif-contrato-21: con referencia el gate cruza contra las anclas del balance persistido', async () => {
    // Informe cuyo JSON no corresponde al balance (Activo $10.000 frente a uno de $20.000).
    const otherCsv = PROVENANCE_CSV.replace('130505,Clientes,Auxiliar,1,8300', '130505,Clientes,Auxiliar,1,18300')
      .replace('311505,Capital,Auxiliar,1,3000', '311505,Capital,Auxiliar,1,13000');
    const { reportRef, report } = await consolidateIn(W1, { rawData: otherCsv });
    // Sin referencia ni balance, el mismo informe sólo prueba coherencia interna.
    const bodyOnly = await exportReport(req('/api/financial-report/export', { report, format: 'excel' }));
    expect(bodyOnly.status).toBe(200);
    expect(bodyOnly.headers.get('X-Report-Provenance')).toBe('unverified');
    vi.mocked(generateFinancialExcel).mockClear();
    const byRef = await exportReport(req('/api/financial-report/export', { reportRef, format: 'excel' }));
    expect(byRef.status).toBe(422);
    expect(((await byRef.json()) as { details: string[] }).details.join('\n')).toMatch(/Fuentes incoherentes/);
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });

  it('sin referencia (histórico / sin base de datos) se conserva el camino anterior, rotulado "no verificada"', async () => {
    const { report } = await consolidateIn(null);
    const res = await exportReport(req('/api/financial-report/export', { report, rawData: PROVENANCE_CSV, format: 'excel' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Report-Provenance')).toBe('unverified');
    const args = vi.mocked(generateFinancialExcel).mock.calls[0][0];
    expect(args.report.consolidatedReport.startsWith('# PROCEDENCIA NO VERIFICADA')).toBe(true);
  });
});

describe('/html usa la versión persistida referenciada', () => {
  it('los JSON, el balance y las cifras de la metadata salen de la versión; el HTML sale sellado', async () => {
    const { reportRef, report } = await consolidateIn(W1);
    const forgedNiif = structuredClone(report.niifAnalysis.json!);
    forgedNiif.balanceSheet.totalAssetsPrimary = '99999900';
    const res = await html(
      req('/api/financial-report/html', {
        reportRef,
        niifReport: forgedNiif,
        strategyReport: {},
        governanceReport: {},
        company: { ...PROVENANCE_COMPANY, name: 'Otra SAS' },
        metadata: { entityCity: 'Cali', auxiliariesProcessed: 999, alertsCounts: { high: 0, medium: 0, low: 0 } },
        preprocessed: null,
        language: 'es',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Report-Provenance')).toBe('verified');
    const input = vi.mocked(runHtmlEditor).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(input.niifReport).toEqual(report.niifAnalysis.json);
    expect((input.company as { name: string }).name).toBe(PROVENANCE_COMPANY.name);
    const meta = input.metadata as Record<string, unknown>;
    expect(meta.entityCity).toBe('Cali');
    expect(meta.reportHashSha256).toBe(reportRef!.reportHash);
    expect(meta.alertsCounts).toEqual({ high: 1, medium: 1, low: 0 });
    expect(meta.auxiliariesProcessed).not.toBe(999);
    expect((input.preprocessed as { primary: { controlTotals: { activo: number } } }).primary.controlTotals.activo).toBe(10000);
    const out = (await res.json()) as { html: string };
    expect(out.html).toContain('data-provenance="verified"');
    expect(out.html).toContain(reportRef!.reportHash);
  });

  it('mismo gate que /export: una versión persistida no emitible no sale en HTML "verificado"', async () => {
    // Texto de la Parte I sin la declaración de impracticabilidad de los
    // comparativos: /consolidate la persiste con emittability 'no-emitible'.
    const parts = partsWithJson();
    parts.niifAnalysis.fullContent = 'Estado de Situación Financiera.';
    state.workspace = W1;
    const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody({ reportParts: parts })));
    const { reportRef, report } = (await res.json()) as ConsolidateJson;
    expect(report.emittability?.kind).toBe('no-emitible');
    const byExport = await exportReport(req('/api/financial-report/export', { reportRef, format: 'excel' }));
    expect(byExport.status).toBe(422);
    const byHtml = await html(req('/api/financial-report/html', { reportRef, language: 'es' }));
    expect(byHtml.status).toBe(422);
    expect(((await byHtml.json()) as { details: string[] }).details).toContain(
      'El informe contiene salvedades o validaciones bloqueantes.',
    );
    expect(runHtmlEditor).not.toHaveBeenCalled();
  });

  it('referencia de otro workspace → 404 sin pagar el Editor Jefe', async () => {
    const { reportRef } = await consolidateIn(W1);
    state.workspace = W2;
    const res = await html(req('/api/financial-report/html', { reportRef, language: 'es' }));
    expect(res.status).toBe(404);
    expect(runHtmlEditor).not.toHaveBeenCalled();
  });
});

describe('/api/escudo/fiscal-anchor persiste el snapshot de la versión (tributario-modulos-24)', () => {
  it('guarda el snapshot y el Âncora calculados por el servidor, no los del cuerpo', async () => {
    const { reportRef, report } = await consolidateIn(W1);
    const forged = { ...report.fiscalSnapshot, period: '1999', anchor: { alertas: [] } };
    const res = await fiscalAnchor(req('/api/escudo/fiscal-anchor', { reportRef, fiscalSnapshot: forged }));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { sourceReportId: string };
    expect(payload.sourceReportId).toBe(reportRef!.reportId);
    const row = fake.rows.find((r) => r.kind === 'escudo_fiscal');
    expect(row?.workspaceId).toBe(W1);
    expect(row?.data).toEqual(JSON.parse(JSON.stringify(report.fiscalSnapshot)));
    expect(vi.mocked(upsertAlert).mock.calls.length).toBe(report.fiscalSnapshot?.anchor.alertas?.length ?? 0);
  });

  it('sin referencia no persiste cifras del navegador (422); ajena → 404', async () => {
    const { reportRef, report } = await consolidateIn(W1);
    const noRef = await fiscalAnchor(req('/api/escudo/fiscal-anchor', { fiscalSnapshot: report.fiscalSnapshot }));
    expect(noRef.status).toBe(422);
    state.workspace = W2;
    const foreign = await fiscalAnchor(req('/api/escudo/fiscal-anchor', { reportRef }));
    expect(foreign.status).toBe(404);
    expect(fake.rows.filter((r) => r.kind === 'escudo_fiscal')).toHaveLength(0);
    expect(upsertAlert).not.toHaveBeenCalled();
  });
});
