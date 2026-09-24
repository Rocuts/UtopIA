// ---------------------------------------------------------------------------
// Ajustes del Doctor de Datos en un balance multiperiodo (cross-dep de P1)
// ---------------------------------------------------------------------------
// El Doctor de Datos propone ajustes anclados a un periodo
// (`propose_adjustment({ period })`, `Adjustment.period`) y `applyAdjustments`
// los aplica a ESE snapshot. Pero los `adjustmentSchema` de /niif, /consolidate
// y /export descartaban `period` (Zod quita las claves no declaradas) y
// `readAppliedAdjustments` (/html) replicaba ese contrato: un ajuste que corrige
// el comparativo 2024 se aplicaba al primario 2025. El 2024 seguía descuadrado,
// el 2025 quedaba descuadrado por el ajuste y la corrida terminaba en 422 (o,
// con un ajuste que no descuadra, con cifras movidas en el periodo equivocado).
//
// Escenario: la pérdida con comparativo de la traza con la caja de 2024
// registrada $1.000.000 de menos (2024 descuadrado) y el ajuste confirmado
// +$1.000.000 a 110505 en 2024. Con el periodo respetado el balance ajustado
// es exactamente el del fixture y el informe honesto se exporta.
//
// Alcance: el LLM está mockeado; `getDb()` es el fake de `provenance-fixture`
// y la sesión se fija con un mock.
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
import { toNiifAnalysisResult } from '@/lib/agents/financial/agents/renderer';
import {
  CSV_PERDIDA_COMPARATIVO,
  informeHonesto,
  preprocesarPerdidaComparativo,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import { readAppliedAdjustments } from '@/lib/reports/preprocessed-integrity';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { makeProvenanceParts, makeReportsTableFake } from '@/lib/reports/__tests__/provenance-fixture';

const W1 = '11111111-1111-4111-8111-111111111111';
const COMPANY = { name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS', niifGroup: 2, fiscalPeriod: '2025' };
/** Caja 2024 registrada $1.000.000 de menos: el comparativo no cuadra. */
const CSV_2024_DESCUADRADO = CSV_PERDIDA_COMPARATIVO.replace(
  '110505,Caja general,Auxiliar,1,30000000,5000000',
  '110505,Caja general,Auxiliar,1,29000000,5000000',
);
/** Ajuste confirmado por el usuario, anclado al comparativo. */
const LEDGER = {
  adjustments: [
    {
      id: 'adj-2024-caja',
      accountCode: '110505',
      accountName: 'Caja general',
      amount: 1_000_000,
      rationale: 'Arqueo de caja al cierre de 2024 no registrado',
      status: 'applied',
      proposedAt: '2026-09-24T00:00:00Z',
      appliedAt: '2026-09-24T00:05:00Z',
      period: '2024',
    },
  ],
};
const HONEST = preprocesarPerdidaComparativo();
const HONEST_JSON = toJsonSafe(HONEST);

let fake: ReturnType<typeof makeReportsTableFake>;
const previousDbUrl = process.env.DATABASE_URL;

const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const snapshot = (pp: PreprocessedBalance, period: string) => pp.periods.find((p) => p.period === period)!;

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
    ...toNiifAnalysisResult(structuredClone(informeHonesto(HONEST))),
    reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false },
  });
  vi.mocked(runHtmlEditor).mockResolvedValue({
    html: '<html><head></head><body><main>Informe</main></body></html>',
    metadata: {},
    checklistFailures: [],
    emittable: true,
  } as never);
});

describe('ajuste del Doctor de Datos anclado al comparativo', () => {
  it('readAppliedAdjustments conserva el periodo del ajuste', () => {
    expect(readAppliedAdjustments(LEDGER)?.[0].period).toBe('2024');
  });

  it('/niif → /consolidate → /export y /html: el ajuste corrige 2024, no mueve 2025, y el informe honesto se exporta', async () => {
    const niifRes = await niif(
      req('/api/financial-report/niif', { rawData: CSV_2024_DESCUADRADO, company: COMPANY, language: 'es', adjustmentLedger: LEDGER }),
    );
    const niifText = await niifRes.text();
    expect(niifRes.status, niifText).toBe(200);
    const phase = JSON.parse(niifText) as {
      niif: FinancialReport['niifAnalysis'];
      context: { preprocessed: PreprocessedBalance };
    };
    const pp = phase.context.preprocessed;
    expect(snapshot(pp, '2024').controlTotals.efectivoCuenta11).toBe(snapshot(HONEST, '2024').controlTotals.efectivoCuenta11);
    expect(snapshot(pp, '2025').controlTotals.efectivoCuenta11).toBe(snapshot(HONEST, '2025').controlTotals.efectivoCuenta11);

    const p = makeProvenanceParts();
    const consolidateRes = await consolidate(
      req('/api/financial-report/consolidate', {
        rawData: CSV_2024_DESCUADRADO,
        company: COMPANY,
        language: 'es',
        adjustmentLedger: LEDGER,
        reportParts: { niifAnalysis: phase.niif, strategicAnalysis: p.strategicAnalysis, governance: p.governance },
      }),
    );
    const consolidateText = await consolidateRes.text();
    expect(consolidateRes.status, consolidateText).toBe(200);
    const consolidated = JSON.parse(consolidateText) as {
      report: FinancialReport;
      reportRef: { reportId: string; reportHash: string };
    };

    const byRef = await exportReport(req('/api/financial-report/export', { reportRef: consolidated.reportRef, format: 'excel' }));
    expect(byRef.status, await byRef.clone().text()).toBe(200);

    const loose = await exportReport(
      req('/api/financial-report/export', {
        report: consolidated.report,
        rawData: CSV_2024_DESCUADRADO,
        preprocessed: pp,
        adjustmentLedger: LEDGER,
        format: 'excel',
      }),
    );
    expect(loose.status, await loose.clone().text()).toBe(200);

    const r = consolidated.report;
    const page = await html(
      req('/api/financial-report/html', {
        niifReport: r.niifAnalysis.json,
        strategyReport: {},
        governanceReport: {},
        company: { ...r.company, sector: null, city: null, signatories: null },
        metadata: { entityNit: r.company.nit, periodEnd: '2025-12-31' },
        language: 'es',
        preprocessed: pp,
        adjustmentLedger: LEDGER,
      }),
    );
    expect(page.status, await page.clone().text()).toBe(200);
  });

  it('un ajuste confirmado anclado a un periodo que no existe en el balance es 422 en todas las rutas (no se descarta en silencio)', async () => {
    // Revisión I1: con `period` respetado, `applyAdjustments` ignora con un
    // aviso en el log el ajuste cuyo periodo no está en el balance. El informe
    // salía 200 SIN el ajuste que el usuario confirmó.
    const ghost = { adjustments: [{ ...LEDGER.adjustments[0], id: 'adj-2023', period: '2023' }] };

    const niifRes = await niif(
      req('/api/financial-report/niif', { rawData: CSV_PERDIDA_COMPARATIVO, company: COMPANY, language: 'es', adjustmentLedger: ghost }),
    );
    const niifText = await niifRes.text();
    expect(niifRes.status, niifText).toBe(422);
    expect(niifText).toMatch(/2023/);
    expect(runNiifAnalyst).not.toHaveBeenCalled();

    const p = makeProvenanceParts();
    const consolidateRes = await consolidate(
      req('/api/financial-report/consolidate', {
        rawData: CSV_PERDIDA_COMPARATIVO,
        company: COMPANY,
        language: 'es',
        adjustmentLedger: ghost,
        reportParts: { niifAnalysis: p.niifAnalysis, strategicAnalysis: p.strategicAnalysis, governance: p.governance },
      }),
    );
    expect(consolidateRes.status, await consolidateRes.clone().text()).toBe(422);
    expect(fake.rows).toHaveLength(0);

    // Sin referencia: desde `rawData` y desde las filas del propio preprocesado.
    const report = { ...p, company: COMPANY, consolidatedReport: 'x', generatedAt: '2026-09-24T00:00:00Z' };
    const withRaw = await exportReport(
      req('/api/financial-report/export', {
        report, rawData: CSV_PERDIDA_COMPARATIVO, preprocessed: HONEST_JSON, adjustmentLedger: ghost, format: 'excel',
      }),
    );
    expect(withRaw.status, await withRaw.clone().text()).toBe(422);
    const ownRows = await exportReport(
      req('/api/financial-report/export', { report, preprocessed: HONEST_JSON, adjustmentLedger: ghost, format: 'excel' }),
    );
    expect(ownRows.status, await ownRows.clone().text()).toBe(422);
    expect(await ownRows.clone().text()).toMatch(/2023/);

    const page = await html(
      req('/api/financial-report/html', {
        niifReport: informeHonesto(HONEST),
        strategyReport: {},
        governanceReport: {},
        company: { ...COMPANY, sector: null, city: null, signatories: null },
        metadata: { entityNit: COMPANY.nit, periodEnd: '2025-12-31' },
        language: 'es',
        preprocessed: HONEST_JSON,
        adjustmentLedger: ghost,
      }),
    );
    expect(page.status, await page.clone().text()).toBe(422);
    expect(runHtmlEditor).not.toHaveBeenCalled();
  });
});
