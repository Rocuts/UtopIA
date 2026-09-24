// ---------------------------------------------------------------------------
// Parte II por las rutas reales: dashboard de ingresos anclado y cifra de un
// KPI N/D fuera de la prosa (re-auditoría final fase 2: narrativa-14 N4,
// narrativa-15 N5)
// ---------------------------------------------------------------------------
// Harness de procedencia-narrativa.route.test.ts (fake de la tabla `reports`;
// Excel/PDF/HTML mockeados). Balance del fixture: Activo $10.000, Pasivo
// $4.000, Patrimonio $6.000, utilidad neta $2.000, ingresos $7.000.
//   N4: la fila "Ingresos operacionales" de $99.900.000 salía de /export por
//       referencia con 200 y procedencia verificada (sólo "no verificable").
//   N5: el KPI "Margen EBITDA ajustado" se publicaba N/D en la tabla, pero su
//       cifra del modelo seguía en el comentario ejecutivo y los diagnósticos.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: async () => '' }));
vi.mock('@/lib/db/telemetry', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/telemetry')>();
  return { ...actual, resolveOwnedReportId: async () => null };
});

import { POST as consolidate } from '@/app/api/financial-report/consolidate/route';
import { POST as exportReport } from '@/app/api/financial-report/export/route';
import { preprocessUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import type { StrategyReportJson } from '@/lib/agents/financial/contracts/strategy-report';
import type { FinancialReport } from '@/lib/agents/financial/types';
import {
  PROVENANCE_CSV,
  consolidateBody,
  makeProvenanceParts,
  makeReportsTableFake,
} from '@/lib/reports/__tests__/provenance-fixture';

const W1 = '11111111-1111-4111-8111-111111111111';
const read = preprocessUploadedTrialBalanceText(PROVENANCE_CSV);
if (read.kind !== 'ok') throw new Error('fixture sin balance');
const ct = read.preprocessed.primary.controlTotals;
const cents = (pesos: number) => String(Math.round(pesos * 100));
let fake: ReturnType<typeof makeReportsTableFake>;
const previousDbUrl = process.env.DATABASE_URL;

const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

type Row = StrategyReportJson['executiveDashboard']['rows'][number];
type Kpi = StrategyReportJson['kpis'][number];

function strategyJson(o: { executive?: string; extraRows?: Row[]; extraKpis?: Kpi[]; diagnosis?: string } = {}): StrategyReportJson {
  const base = makeProvenanceParts().strategicAnalysis.json as StrategyReportJson;
  return {
    ...base,
    executiveDashboard: {
      rows: [
        { label: 'Total Activo', primary: cents(ct.activo), comparative: null, variation: null, variationPct: null, commentary: 'Cierre.' },
        ...(o.extraRows ?? []),
      ],
      executiveCommentary: o.executive ?? 'El total de activos cerró en $10.000,00 y el patrimonio asciende a $6.000,00.',
    },
    kpis: [...base.kpis, ...(o.extraKpis ?? [])],
    recommendations: base.recommendations.map((r) => ({ ...r, diagnosis: o.diagnosis ?? r.diagnosis })),
  };
}

async function consolidateThenExport(strategy: StrategyReportJson) {
  const parts = makeProvenanceParts();
  (parts.strategicAnalysis as { json?: unknown }).json = strategy;
  const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody({ reportParts: parts })));
  expect(res.status).toBe(200);
  const out = (await res.json()) as { reportRef?: { reportId: string; reportHash: string } };
  const stored = (fake.rows[0].data as { report: FinancialReport }).report;
  const exp = await exportReport(req('/api/financial-report/export', { reportRef: out.reportRef, format: 'excel' }));
  return { stored, exp };
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
});

describe('Parte II por las rutas: control', () => {
  it('Parte II honesta con la fila "Ingresos operacionales" real → 200 verificado', async () => {
    const r = await consolidateThenExport(
      strategyJson({
        extraRows: [{ label: 'Ingresos operacionales', primary: cents(ct.ingresosOperacionalesNetos ?? 7_000), comparative: null, variation: null, variationPct: null, commentary: 'c' }],
      }),
    );
    expect(r.stored.strategicAnalysis.strategyQualifications?.clean).toBe(true);
    expect(r.exp.status).toBe(200);
    expect(r.exp.headers.get('X-Report-Provenance')).toBe('verified');
  });
});

describe('narrativa-14 (N4) — fila de ingresos del dashboard sin respaldo', () => {
  it('"Ingresos operacionales" $99.900.000 (real $7.000) sella la Parte II y /export no la emite verificada', async () => {
    const r = await consolidateThenExport(
      strategyJson({
        extraRows: [{ label: 'Ingresos operacionales', primary: cents(99_900_000), comparative: null, variation: null, variationPct: null, commentary: 'Crecimiento sostenido.' }],
      }),
    );
    expect(r.stored.strategicAnalysis.strategyQualifications?.clean).toBe(false);
    expect(r.stored.strategicAnalysis.strategyQualifications?.motivos.join('\n')).toMatch(/Dashboard — Ingresos operacionales/);
    expect(r.exp.status).toBe(422);
  });
});

describe('narrativa-15 (N5) — cifra de un KPI publicado N/D en la prosa', () => {
  it('el Markdown persistido no conserva "23,7" (N/D en la tabla y en la prosa)', async () => {
    const r = await consolidateThenExport(
      strategyJson({
        executive: 'El margen EBITDA ajustado de 23,7 % y un índice de solvencia de 4,8 veces muestran holgura.',
        diagnosis: 'El margen EBITDA ajustado es de 23,7 %.',
        extraKpis: [{
          category: 'profitability', name: 'Margen EBITDA ajustado', formula: '(1.659 / 7.000) = 23,7', resultPrimary: '23,7',
          resultComparative: null, unit: 'percent', benchmarkBand: { description: '> 10 %', lowerBound: '10', upperBound: null },
          diagnosis: 'Holgado.', yoyVariation: null, confidence: null, anomalyFlag: null, presentationMode: null, baselineLabel: null, sparklinePoints: null,
        }],
      }),
    );
    const md = r.stored.strategicAnalysis.fullContent;
    expect(md).toMatch(/\| Margen EBITDA ajustado \| [^|]*\| N\/D \|/);
    expect(md).not.toMatch(/23,7/);
    expect(md).toContain('El margen EBITDA ajustado de N/D y un índice de solvencia de 4,8 veces');
    expect(md).toContain('El margen EBITDA ajustado es de N/D.');
    // El JSON persistido (el que leen el Excel y el Editor Jefe) tampoco.
    expect(JSON.stringify(r.stored.strategicAnalysis.json)).not.toMatch(/23,7/);
    expect(r.exp.status).toBe(200);
  });
});
