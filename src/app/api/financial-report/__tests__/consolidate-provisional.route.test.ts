// ---------------------------------------------------------------------------
// pipeline-flujo-21 — el override "Continuar de todas formas" en el camino
// partido llega al consolidado, a la versión persistida y a las salidas
// ---------------------------------------------------------------------------
// P3 hizo que `consolidateSplitReport` antepusiera el encabezado BORRADOR con
// `provisional`, pero /consolidate no leía el flag ni la UI lo enviaba: el
// consolidado, la versión persistida y el PDF salían como definitivos aunque
// el usuario hubiera pedido un borrador, y el sello de procedencia decía
// "PROCEDENCIA VERIFICADA" sin más. Ahora /consolidate lee `provisional`
// (mismo esquema que /niif), la versión persistida lleva el encabezado y el
// sello de Excel/PDF/HTML aclara BORRADOR. El override no levanta ningún gate.
//
// Alcance: `getDb()` es el fake de `provenance-fixture` y la sesión se fija
// con un mock; no acredita aislamiento real de tenants.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const state = vi.hoisted(() => ({ db: null as unknown, workspace: null as string | null }));

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('@/lib/db/workspace', () => ({ getCurrentWorkspaceId: vi.fn(async () => state.workspace) }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
// El PDF se compone de verdad (marca de agua); sólo se sustituye el render.
vi.mock('@/lib/export/pdf-elite-react', async (orig) => {
  const actual = await orig<typeof import('@/lib/export/pdf-elite-react')>();
  return { ...actual, renderEditorialReportToStream: vi.fn() };
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

import { POST as consolidate } from '../consolidate/route';
import { POST as exportReport } from '../export/route';
import { POST as html } from '../html/route';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { renderEditorialReportToStream } from '@/lib/export/pdf-elite-react';
import { runHtmlEditor } from '@/lib/agents/financial/agents/html-editor';
import type { FinancialReport } from '@/lib/agents/financial/types';
import {
  consolidateBody,
  makeProvenanceParts,
  makeReportsTableFake,
} from '@/lib/reports/__tests__/provenance-fixture';

const W1 = '11111111-1111-4111-8111-111111111111';
const PROVISIONAL = { active: true, reason: 'El cliente pidió un borrador para revisión interna' };
let fake: ReturnType<typeof makeReportsTableFake>;
const previousDbUrl = process.env.DATABASE_URL;

const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

type Consolidated = {
  consolidatedReport: string;
  report: FinancialReport;
  reportRef?: { reportId: string; reportHash: string };
};

async function consolidateWith(extra: Record<string, unknown>) {
  const parts = makeProvenanceParts();
  (parts.strategicAnalysis as { json?: unknown }).json = { technicalAlerts: [] };
  (parts.governance as { json?: unknown }).json = { shareholderMinutes: null };
  return consolidate(req('/api/financial-report/consolidate', consolidateBody({ reportParts: parts, ...extra })));
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

describe('/consolidate con `provisional` (pipeline-flujo-21)', () => {
  it('el consolidado y la versión persistida llevan el encabezado BORRADOR con la razón', async () => {
    const res = await consolidateWith({ provisional: PROVISIONAL });
    expect(res.status).toBe(200);
    const out = (await res.json()) as Consolidated;
    expect(out.consolidatedReport.startsWith('> ⚠️ **BORRADOR — VALIDACION PENDIENTE**')).toBe(true);
    expect(out.consolidatedReport).toContain(PROVISIONAL.reason);
    const stored = (fake.rows[0].data as { report: FinancialReport }).report;
    expect(stored.consolidatedReport.startsWith('> ⚠️ **BORRADOR — VALIDACION PENDIENTE**')).toBe(true);
    // El override no levanta gates: la validación y la emitibilidad son las mismas.
    expect(stored.validation?.ok).toBe(true);
    expect(stored.emittability?.kind).toBe('emittable');
  });

  it('Excel, PDF y HTML por referencia: el sello de procedencia aclara BORRADOR y el PDF lleva la marca de agua', async () => {
    const out = (await (await consolidateWith({ provisional: PROVISIONAL })).json()) as Consolidated;

    const excel = await exportReport(req('/api/financial-report/export', { reportRef: out.reportRef, format: 'excel' }));
    expect(excel.status).toBe(200);
    expect(excel.headers.get('X-Report-Provenance')).toBe('verified');
    expect(excel.headers.get('X-Report-Draft')).toBe('true');
    const excelReport = vi.mocked(generateFinancialExcel).mock.calls[0][0].report;
    expect(excelReport.consolidatedReport.split('\n')[0]).toBe('# PROCEDENCIA VERIFICADA — BORRADOR (VALIDACIÓN PENDIENTE)');

    const pdf = await exportReport(req('/api/financial-report/export', { reportRef: out.reportRef, format: 'pdf-elite' }));
    expect(pdf.status).toBe(200);
    const doc = vi.mocked(renderEditorialReportToStream).mock.calls[0][0] as {
      meta: { watermark?: string };
      appendix: { validationWarnings: string[] };
    };
    expect(doc.meta.watermark).toBe('BORRADOR');
    expect(doc.appendix.validationWarnings.join('\n')).toMatch(/PROCEDENCIA VERIFICADA — BORRADOR/);

    const page = await html(req('/api/financial-report/html', { reportRef: out.reportRef, language: 'es' }));
    expect(page.status).toBe(200);
    const stamped = ((await page.json()) as { html: string }).html;
    expect(stamped).toContain('PROCEDENCIA VERIFICADA — BORRADOR');
    expect(stamped).toContain('draft=true');
  });

  it('sin override: sin encabezado ni aclaración BORRADOR', async () => {
    const out = (await (await consolidateWith({})).json()) as Consolidated;
    expect(out.consolidatedReport).not.toContain('BORRADOR — VALIDACION PENDIENTE');
    const excel = await exportReport(req('/api/financial-report/export', { reportRef: out.reportRef, format: 'excel' }));
    expect(excel.headers.get('X-Report-Draft')).toBeNull();
    const excelReport = vi.mocked(generateFinancialExcel).mock.calls[0][0].report;
    expect(excelReport.consolidatedReport.split('\n')[0]).toBe('# PROCEDENCIA VERIFICADA');
  });

  it('un `provisional` con forma inválida es 400 (mismo esquema que /niif) y no persiste nada', async () => {
    const res = await consolidateWith({ provisional: { active: true, reason: '' } });
    expect(res.status).toBe(400);
    expect(fake.rows).toHaveLength(0);
  });
});
