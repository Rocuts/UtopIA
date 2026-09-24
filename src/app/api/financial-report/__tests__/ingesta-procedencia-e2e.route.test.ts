// ---------------------------------------------------------------------------
// Ingesta (P4) × procedencia (P1) — punta a punta sin 422 falsos
// ---------------------------------------------------------------------------
// P4 hizo que la lectura del balance dependa de confirmaciones del usuario
// (unidad "en miles" reexpresada a pesos, excepciones de vencimiento) y P1 hizo
// que /consolidate, /export y /html RE-DERIVEN el balance en el servidor y
// respondan 422 si los totales de control del preprocesado enviado no casan.
// Si alguna re-derivación perdiera una confirmación, un informe honesto en
// miles de pesos recibiría un 422 "Fuentes incoherentes" (cifras 1.000 veces
// menores) o un gate de liquidez distinto al de /niif.
//
// Recorrido: balance que declara "miles de pesos" + unidad confirmada +
// vencimiento declarado → /niif (analista mockeado con el informe coherente
// reexpresado; Stage 0 real) → /consolidate persiste → /export por referencia
// y sin referencia (rawData + preprocessed, y sólo preprocessed) → /html.
// Dos vehículos de la confirmación: las directivas que el intake escribe en
// `rawData` y los campos `unitMultiplier` / `maturityOverrides` del cuerpo.
//
// Alcance: el LLM está mockeado; `getDb()` es el fake de `provenance-fixture`
// y la sesión se fija con un mock (no acredita aislamiento real de tenants).
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: null as unknown, workspace: null as string | null }));

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('@/lib/db/workspace', () => ({ getCurrentWorkspaceId: vi.fn(async () => state.workspace) }));
vi.mock('@/lib/db/activity-log', () => ({ logActivity: async () => {} }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: async () => '' }));
vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: vi.fn(async () => null) }));
vi.mock('@/lib/db/telemetry', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/telemetry')>();
  return { ...actual, resolveOwnedReportId: async () => null };
});
vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({ runNiifAnalyst: vi.fn() }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
vi.mock('@/lib/agents/financial/agents/html-editor', () => ({ runHtmlEditor: vi.fn() }));
vi.mock('@/lib/agents/financial/contracts/html-editor', () => ({
  HtmlEditorInputSchema: { safeParse: (body: unknown) => ({ success: true, data: body }) },
}));

import { POST as niif } from '../niif/route';
import { POST as consolidate } from '../consolidate/route';
import { POST as exportReport } from '../export/route';
import { POST as html } from '../html/route';
import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import { runHtmlEditor } from '@/lib/agents/financial/agents/html-editor';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { toNiifAnalysisResult } from '@/lib/agents/financial/agents/renderer';
import {
  CSV_PERDIDA_COMPARATIVO,
  informeHonesto,
  preprocesarPerdidaComparativo,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import { escribirDirectivasIngesta } from '@/lib/upload/ingest-directives';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { makeProvenanceParts, makeReportsTableFake } from '@/lib/reports/__tests__/provenance-fixture';

const W1 = '11111111-1111-4111-8111-111111111111';
const COMPANY = { name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS', niifGroup: 2, fiscalPeriod: '2025' };

/**
 * La pérdida con comparativo de la traza (pipeline-flujo-23), declarada en
 * MILES de pesos: cada saldo ÷ 1.000 y un título con la unidad. Reexpresada,
 * es exactamente el balance en pesos del fixture.
 */
const CSV_MILES = CSV_PERDIDA_COMPARATIVO.split('\n')
  .map((line, i) => {
    if (i === 1) return `${line}\nCifras expresadas en miles de pesos`;
    if (!/^\d/.test(line)) return line;
    const cells = line.split(',');
    return [...cells.slice(0, 4), ...cells.slice(4).map((v) => String(Number(v) / 1000))].join(',');
  })
  .join('\n');
/** Bancos nacionales (21) declarados no corrientes: cambia el pasivo corriente frente al grupo PUC. */
const MATURITY = { '210505': 'no_corriente' as const };
/** El informe NIIF que un analista honesto emitiría sobre el balance en pesos. */
const NIIF_JSON: NiifReportJson = informeHonesto(preprocesarPerdidaComparativo());

let fake: ReturnType<typeof makeReportsTableFake>;
const previousDbUrl = process.env.DATABASE_URL;

const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

interface NiifOut {
  niif: FinancialReport['niifAnalysis'];
  context: { preprocessed: PreprocessedBalance & Record<string, unknown>; bindingTotals: string };
}

/** Recorrido completo con el vehículo de confirmación dado. */
async function run(vehicle: 'directives' | 'fields') {
  const rawData =
    vehicle === 'directives'
      ? escribirDirectivasIngesta(CSV_MILES, { unidadConfirmada: 'miles', vencimientos: MATURITY })
      : CSV_MILES;
  const confirmations = vehicle === 'fields' ? { unitMultiplier: 1000, maturityOverrides: MATURITY } : {};

  const niifRes = await niif(req('/api/financial-report/niif', { rawData, company: COMPANY, language: 'es', ...confirmations }));
  const niifBody = await niifRes.text();
  expect(niifRes.status, niifBody).toBe(200);
  const phase = JSON.parse(niifBody) as NiifOut;

  const p = makeProvenanceParts();
  const consolidateRes = await consolidate(
    req('/api/financial-report/consolidate', {
      rawData,
      company: COMPANY,
      language: 'es',
      ...confirmations,
      reportParts: { niifAnalysis: phase.niif, strategicAnalysis: p.strategicAnalysis, governance: p.governance },
    }),
  );
  const consolidateBody = await consolidateRes.text();
  expect(consolidateRes.status, consolidateBody).toBe(200);
  const consolidated = JSON.parse(consolidateBody) as {
    report: FinancialReport;
    reportRef?: { reportId: string; reportHash: string };
  };
  return { rawData, confirmations, phase, consolidated };
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
  vi.mocked(runNiifAnalyst).mockResolvedValue({
    ...toNiifAnalysisResult(structuredClone(NIIF_JSON)),
    reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false },
  });
  vi.mocked(runHtmlEditor).mockResolvedValue({
    html: '<html><head></head><body><main>Informe</main></body></html>',
    metadata: {},
    checklistFailures: [],
    emittable: true,
  } as never);
});

describe.each(['directives', 'fields'] as const)('balance en miles + vencimiento declarado (%s)', (vehicle) => {
  it('/niif reexpresa a pesos y aplica el vencimiento declarado', async () => {
    const { phase } = await run(vehicle);
    const ct = phase.context.preprocessed.primary.controlTotals;
    expect(ct.activo).toBe(100_000_000);
    // Bancos (45.000 miles) declarados no corrientes: sólo Proveedores queda corriente.
    expect(ct.pasivoCorriente).toBe(25_000_000);
    expect(phase.niif.reconciliation?.clean).toBe(true);
    const notes = phase.context.preprocessed.primary.validation.adjustments.join('\n');
    expect(notes).toMatch(/cifras reexpresadas de miles de pesos a pesos/);
  });

  it('/consolidate persiste la versión con el balance en pesos y sin salvedades', async () => {
    const { consolidated } = await run(vehicle);
    expect(consolidated.reportRef).toBeDefined();
    const stored = fake.rows[0].data as { report: FinancialReport; preprocessed: { primary: { controlTotals: { activo: number; pasivoCorriente: number } } } };
    expect(stored.preprocessed.primary.controlTotals.activo).toBe(100_000_000);
    expect(stored.preprocessed.primary.controlTotals.pasivoCorriente).toBe(25_000_000);
    expect(stored.report.niifAnalysis.reconciliation?.clean).toBe(true);
    expect(stored.report.emittability?.kind).toBe('emittable');
  });

  it('/export por referencia (Excel) y /html por referencia: 200 verificado', async () => {
    const { consolidated } = await run(vehicle);
    const excel = await exportReport(req('/api/financial-report/export', { reportRef: consolidated.reportRef, format: 'excel' }));
    expect(excel.status, await excel.clone().text()).toBe(200);
    expect(excel.headers.get('X-Report-Provenance')).toBe('verified');
    const out = await html(req('/api/financial-report/html', { reportRef: consolidated.reportRef, language: 'es' }));
    expect(out.status, await out.clone().text()).toBe(200);
    expect(runHtmlEditor).toHaveBeenCalledTimes(1);
  });

  it('/export sin referencia con rawData + preprocessed, sólo preprocessed y /html sin referencia: 200', async () => {
    const { rawData, confirmations, phase, consolidated } = await run(vehicle);
    const withRaw = await exportReport(
      req('/api/financial-report/export', {
        report: consolidated.report,
        rawData,
        ...confirmations,
        preprocessed: phase.context.preprocessed,
        format: 'excel',
      }),
    );
    expect(withRaw.status, await withRaw.clone().text()).toBe(200);
    expect(withRaw.headers.get('X-Report-Provenance')).toBe('unverified');

    const onlyPreprocessed = await exportReport(
      req('/api/financial-report/export', {
        report: consolidated.report,
        preprocessed: phase.context.preprocessed,
        format: 'excel',
      }),
    );
    expect(onlyPreprocessed.status, await onlyPreprocessed.clone().text()).toBe(200);
    // El Excel se compone con el balance en pesos (re-derivado), no en miles.
    const pp = vi.mocked(generateFinancialExcel).mock.calls.at(-1)![0].preprocessed as PreprocessedBalance;
    expect(pp.primary.controlTotals.activo).toBe(100_000_000);
    expect(pp.primary.controlTotals.pasivoCorriente).toBe(25_000_000);

    const r = consolidated.report;
    const out = await html(
      req('/api/financial-report/html', {
        niifReport: r.niifAnalysis.json,
        strategyReport: r.strategicAnalysis.json ?? {},
        governanceReport: r.governance.json ?? {},
        company: { ...r.company, sector: null, city: null, signatories: null },
        metadata: { entityNit: r.company.nit, periodEnd: '2025-12-31' },
        language: 'es',
        preprocessed: phase.context.preprocessed,
      }),
    );
    expect(out.status, await out.clone().text()).toBe(200);
  });
});

describe('confirmaciones como campos en /consolidate y /export: mismo contrato que /niif', () => {
  it('un campo que contradice la directiva del texto es 422 y un campo inválido 400, sin elegir en silencio', async () => {
    const rawData = escribirDirectivasIngesta(CSV_MILES, { unidadConfirmada: 'miles' });
    const p = makeProvenanceParts();
    const contradicts = await consolidate(
      req('/api/financial-report/consolidate', {
        rawData,
        company: COMPANY,
        language: 'es',
        unitMultiplier: 1000000,
        reportParts: { niifAnalysis: p.niifAnalysis, strategicAnalysis: p.strategicAnalysis, governance: p.governance },
      }),
    );
    expect(contradicts.status).toBe(422);
    expect(fake.rows).toHaveLength(0);

    const invalid = await exportReport(
      req('/api/financial-report/export', {
        report: { ...p, company: COMPANY, consolidatedReport: 'x', generatedAt: '2026-09-24T00:00:00Z' },
        rawData,
        unitMultiplier: 7,
        format: 'excel',
      }),
    );
    expect(invalid.status).toBe(400);
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });
});
