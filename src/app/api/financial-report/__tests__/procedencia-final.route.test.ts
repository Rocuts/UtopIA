// ---------------------------------------------------------------------------
// Procedencia — ronda final de la fase 2 (re-auditoría 2 del 2026-09-24)
// ---------------------------------------------------------------------------
// Reproducciones de la re-auditoría final portadas a la suite real, con el
// mismo arnés que procedencia-servidor.route.test.ts (almacenamiento fake que
// evalúa las condiciones SQL reales; workspace fijado por prueba) y el
// composer REAL del PDF (sólo se sustituye el render a bytes):
//   - e2e-niif2-02: una desviación que /niif ya corrigió en el JSON
//     (`overwritten: true`, informe limpio) no sella la versión persistida.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const state = vi.hoisted(() => ({ db: null as unknown, workspace: null as string | null }));

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('@/lib/db/workspace', () => ({ getCurrentWorkspaceId: vi.fn(async () => state.workspace) }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
vi.mock('@/lib/export/pdf-elite-react', async (orig) => {
  const actual = await orig<typeof import('@/lib/export/pdf-elite-react')>();
  return {
    ...actual,
    composeEditorialReport: vi.fn(actual.composeEditorialReport),
    renderEditorialReportToStream: vi.fn(async () => Readable.from(['%PDF-test'])),
  };
});
vi.mock('@/lib/agents/financial/agents/html-editor', () => ({ runHtmlEditor: vi.fn() }));
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
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { runHtmlEditor } from '@/lib/agents/financial/agents/html-editor';
import type { FinancialReport } from '@/lib/agents/financial/types';
import {
  consolidateBody,
  makeProvenanceParts,
  makeReportsTableFake,
} from '@/lib/reports/__tests__/provenance-fixture';

const W1 = '11111111-1111-4111-8111-111111111111';

let fake: ReturnType<typeof makeReportsTableFake>;
const previousDbUrl = process.env.DATABASE_URL;

const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

type Ref = { reportId: string; reportHash: string };
type ConsolidateJson = { report: FinancialReport; reportRef?: Ref; provenance: Record<string, unknown> };

async function consolidateWith(
  parts: ReturnType<typeof makeProvenanceParts>,
  extra: Record<string, unknown> = {},
): Promise<ConsolidateJson> {
  const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody({ reportParts: parts, ...extra })));
  const json = (await res.json()) as ConsolidateJson;
  if (res.status !== 200) throw new Error(`consolidate ${res.status}: ${JSON.stringify(json).slice(0, 1500)}`);
  return json;
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
  vi.mocked(runHtmlEditor).mockResolvedValue({
    html: '<html><head></head><body><main>Informe</main></body></html>',
    metadata: {},
    checklistFailures: [],
    emittable: true,
  } as never);
});

// ---------------------------------------------------------------------------
// e2e-niif2-02
// ---------------------------------------------------------------------------

describe('e2e-niif2-02 — total del ESF corregido por /niif (overwritten) en un informe limpio', () => {
  function partsWithDeviation(overwritten: boolean) {
    const parts = makeProvenanceParts();
    // Lo que persiste `runNiifAnalyst` cuando el Pass-1 emitió el Total Activo
    // +1 centavo y `reconcileAnchors` lo sobrescribió: el JSON final es el
    // honesto (Activo $10.000,00) y la desviación queda como traza.
    parts.niifAnalysis.reconciliation = {
      deviations: [
        {
          period: 'primary',
          field: 'balanceSheet.totalAssetsPrimary',
          label: 'Total Activo',
          key: 'totalAssets',
          emitted: '1000001',
          expected: '1000000',
          gapCents: '1',
          overwritten,
        },
      ],
      lineGaps: [],
      repairAttempted: false,
      clean: true,
    } as never;
    return parts;
  }

  it('la versión persistida queda limpia y Excel, PDF y HTML por referencia salen 200 sin sello', async () => {
    const out = await consolidateWith(partsWithDeviation(true));
    expect(out.report.niifAnalysis.reconciliation?.clean).toBe(true);
    expect(out.report.consolidatedReport).not.toMatch(/REPORTE CON SALVEDADES|NO es firmable/);

    const xlsx = await exportReport(req('/api/financial-report/export', { reportRef: out.reportRef, format: 'excel' }));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get('X-Report-Provenance')).toBe('verified');
    const excel = vi.mocked(generateFinancialExcel).mock.calls[0][0];
    expect(excel.report.consolidatedReport).not.toMatch(/REPORTE CON SALVEDADES/);

    const pdf = await exportReport(
      req('/api/financial-report/export', { reportRef: out.reportRef, format: 'pdf-elite', language: 'es' }),
    );
    expect(pdf.status).toBe(200);
    const h = await html(req('/api/financial-report/html', { reportRef: out.reportRef, language: 'es' }));
    expect(h.status).toBe(200);
  });

  it('control: una desviación NO corregida sella la versión y bloquea la exportación', async () => {
    const out = await consolidateWith(partsWithDeviation(false));
    expect(out.report.niifAnalysis.reconciliation?.clean).toBe(false);
    const xlsx = await exportReport(req('/api/financial-report/export', { reportRef: out.reportRef, format: 'excel' }));
    expect(xlsx.status).toBe(422);
  });
});
