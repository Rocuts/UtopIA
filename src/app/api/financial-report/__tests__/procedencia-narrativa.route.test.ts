// ---------------------------------------------------------------------------
// Procedencia × narrativa (integración P1 × P3) — la prosa se vuelve a cruzar
// en el servidor
// ---------------------------------------------------------------------------
// P3 añadió el validador de cifras en prosa (notas y acta: `checkGovernanceNarrative`;
// Parte II: `reconcileStrategyAnchors`) y P1 fijó en /consolidate el veredicto
// ARITMÉTICO del acta. Pero ni /consolidate ni /export ni /html corrían el
// validador de prosa: una Parte III cuyo acta decía "la utilidad neta del
// ejercicio fue de $9.000,00" (real $2.000) llegaba con `actaQualifications:
// {clean: true}` del navegador, se persistía así y /export la entregaba 200
// sellada "procedencia verificada"; sin referencia, /export y /html confiaban
// en el mismo flag. Ahora el servidor recalcula ambos veredictos (acta +
// prosa de la Parte III; anclas + prosa de la Parte II) desde el balance
// re-derivado. Sólo endurecen el del cliente, nunca lo levantan.
//
// Alcance: `getDb()` es el fake de `provenance-fixture` y el workspace de la
// sesión se fija con un mock; no acredita aislamiento real de tenants.
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
// El contrato de los tres JSON se prueba aparte; aquí interesa el gate del route.
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
import { composeEditorialReport } from '@/lib/export/pdf-elite-react';
import { runHtmlEditor } from '@/lib/agents/financial/agents/html-editor';
import { preprocessUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import type { StrategyReportJson } from '@/lib/agents/financial/contracts/strategy-report';
import type { GovernanceReportJson } from '@/lib/agents/financial/contracts/governance-report';
import type { FinancialReport } from '@/lib/agents/financial/types';
import {
  PROVENANCE_COMPANY,
  PROVENANCE_CSV,
  consolidateBody,
  makeProvenanceParts,
  makeReportsTableFake,
} from '@/lib/reports/__tests__/provenance-fixture';

const W1 = '11111111-1111-4111-8111-111111111111';
const COMPANY = PROVENANCE_COMPANY;
const read = preprocessUploadedTrialBalanceText(PROVENANCE_CSV);
if (read.kind !== 'ok') throw new Error('fixture sin balance');
const pp = read.preprocessed;
const ct = pp.primary.controlTotals;
const cents = (pesos: number) => String(Math.round(pesos * 100));
let fake: ReturnType<typeof makeReportsTableFake>;
const previousDbUrl = process.env.DATABASE_URL;

const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Prosa honesta del fixture (Activo $10.000, Pasivo $4.000, Patrimonio $6.000, utilidad $2.000). */
const HONEST_DEVELOPMENT =
  'Se aprobaron los estados financieros: el total de activos asciende a $10.000,00 y la utilidad neta del ejercicio fue de $2.000,00.';
const HONEST_NOTE = 'El total patrimonio es $6.000,00 y el efectivo al cierre fue de $1.700,00.';

/**
 * Parte III estructurada (JSON del contrato: desde I3 el servidor re-renderiza
 * el Markdown desde él y sella la Parte cuyo JSON no es válido): aritmética del
 * acta honesta; prosa configurable.
 */
function governanceJson(prose: { development?: string; note?: string } = {}): GovernanceReportJson {
  const base = makeProvenanceParts().governance.json!;
  return {
    ...base,
    financialNotes: [
      { number: 1, title: 'Situación financiera', body: prose.note ?? HONEST_NOTE, normReference: null, materiality: 'material', confidence: null },
      ...base.financialNotes.filter((n) => n.number !== 1),
    ],
    shareholderMinutes: {
      ...base.shareholderMinutes,
      developments: [{ itemNumber: 1, body: prose.development ?? HONEST_DEVELOPMENT }],
    },
  };
}

/** Parte II válida para `StrategyReportSchema` (≥1 KPI, ≥3 recomendaciones), con el comentario dado. */
function strategyJson(executive = 'El total de activos cerró en $10.000,00 y el patrimonio asciende a $6.000,00.'): StrategyReportJson {
  return {
    company: {
      name: COMPANY.name, nit: COMPANY.nit, entityType: 'SAS', sector: null, niifGroup: 2,
      fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
    },
    reportMode: 'LINEA_BASE',
    confidence: null,
    executiveDashboard: {
      rows: [
        { label: 'Total Activo', primary: cents(ct.activo), comparative: null, variation: null, variationPct: null, commentary: 'Cierre.' },
      ],
      executiveCommentary: executive,
    },
    technicalAlerts: [],
    kpis: [
      {
        category: 'liquidity', name: 'Capital de trabajo', formula: 'AC − PC',
        resultPrimary: String(BigInt(cents(ct.activoCorriente)) - BigInt(cents(ct.pasivoCorriente))),
        resultComparative: null, unit: 'cop',
        benchmarkBand: { description: '> 0', lowerBound: '0', upperBound: null },
        diagnosis: 'Holgura de corto plazo.', yoyVariation: null, confidence: null, anomalyFlag: null,
        presentationMode: null, baselineLabel: null, sparklinePoints: null,
      },
    ],
    dupontAnalysis: null,
    trends: null,
    breakEven: {
      fixedCostsCop: '1', variableCostsCop: '1', revenueCop: '1', breakEvenPointCop: '1',
      marginOfSafetyPct: '1', classificationNote: 'nota',
    },
    projectedCashFlow: {
      liquidityGate: {
        triggered: false,
        currentAssetsCop: cents(ct.activoCorriente),
        currentLiabilitiesCop: cents(ct.pasivoCorriente),
        gapCop: String(BigInt(cents(ct.activoCorriente)) - BigInt(cents(ct.pasivoCorriente))),
        message: null,
      },
      initialCashBalanceCop: cents(ct.efectivoCuenta11), dsoDays: '30', inflationIndexPct: '5,0',
      scenarios: [], solvencyNarrative: 'ok', controlKpis: [], assumptionsNote: 'supuestos',
    },
    recommendations: [1, 2, 3].map((i) => ({
      title: `Acción ${i}`, diagnosis: 'Cartera alta.', action: 'Cobrar.',
      expectedImpact: 'Mejor caja.', priority: 'high' as const, horizon: 'immediate' as const, normReference: null,
    })),
    presumedCostWarning: null,
    preparerNotes: [],
  } as StrategyReportJson;
}

interface PartsOptions {
  governance?: unknown;
  strategy?: unknown;
  actaQualifications?: unknown;
  strategyQualifications?: unknown;
}

function parts(o: PartsOptions = {}) {
  const r = makeProvenanceParts();
  (r.governance as { json?: unknown }).json = o.governance ?? governanceJson();
  (r.strategicAnalysis as { json?: unknown }).json = o.strategy ?? strategyJson();
  if (o.actaQualifications !== undefined) {
    (r.governance as { actaQualifications?: unknown }).actaQualifications = o.actaQualifications;
  }
  if (o.strategyQualifications !== undefined) {
    (r.strategicAnalysis as { strategyQualifications?: unknown }).strategyQualifications = o.strategyQualifications;
  }
  return r;
}

/** Informe completo sin referencia (lo que la UI tenía antes de P1 o sin DB). */
function reportWith(o: PartsOptions = {}): FinancialReport {
  const p = parts(o);
  return {
    company: { ...COMPANY },
    niifAnalysis: p.niifAnalysis,
    strategicAnalysis: p.strategicAnalysis,
    governance: p.governance,
    consolidatedReport: 'Informe consolidado',
    generatedAt: '2026-09-24T00:00:00Z',
  } as FinancialReport;
}

async function consolidateWith(o: PartsOptions) {
  const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody({ reportParts: parts(o) })));
  expect(res.status).toBe(200);
  const out = (await res.json()) as { report: FinancialReport; reportRef?: { reportId: string; reportHash: string } };
  const stored = (fake.rows[0].data as { report: FinancialReport }).report;
  return { out, stored };
}

const exportByRef = (reportRef: unknown, format = 'excel') =>
  exportReport(req('/api/financial-report/export', { reportRef, format }));

const CLEAN_ACTA = { clean: true, motivos: [] };
const CLEAN_STRATEGY = { clean: true, motivos: [], noVerificables: [] };

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

describe('/consolidate — la versión persistida lleva los veredictos de prosa calculados en el servidor', () => {
  it('utilidad neta falsa en el desarrollo del acta con `clean: true` del cliente → salvedad persistida y export 422', async () => {
    const { out, stored } = await consolidateWith({
      governance: governanceJson({ development: 'La utilidad neta del ejercicio fue de $9.000,00.' }),
      actaQualifications: CLEAN_ACTA,
    });
    expect(stored.governance.actaQualifications?.clean).toBe(false);
    expect(stored.governance.actaQualifications?.motivos.join('\n')).toMatch(/Acta — punto 1 · Utilidad neta/);
    expect(stored.niifAnalysis.reconciliation?.clean).toBe(false);

    const res = await exportByRef(out.reportRef);
    expect(res.status).toBe(422);
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });

  it('un total de activos falso en una nota también sella la Parte III', async () => {
    const { stored } = await consolidateWith({
      governance: governanceJson({ note: 'El total de activos asciende a $12.000,00.' }),
    });
    expect(stored.governance.actaQualifications?.clean).toBe(false);
    expect(stored.governance.actaQualifications?.motivos.join('\n')).toMatch(/Nota 1 — Situación financiera · Total Activo/);
  });

  it('prosa falsa de la Parte II con `clean: true` del cliente → strategyQualifications del servidor y export 422', async () => {
    const { out, stored } = await consolidateWith({
      strategy: strategyJson('El patrimonio total es de $9.000,00.'),
      strategyQualifications: CLEAN_STRATEGY,
    });
    expect(stored.strategicAnalysis.strategyQualifications?.clean).toBe(false);
    expect(stored.strategicAnalysis.strategyQualifications?.motivos.join('\n')).toMatch(/Total Patrimonio: la narrativa imprime \$9\.000,00/);
    expect(stored.niifAnalysis.reconciliation?.clean).toBe(false);
    expect((await exportByRef(out.reportRef)).status).toBe(422);
  });

  it('un `clean: false` del cliente en la Parte II se conserva aunque el servidor no encuentre desviaciones', async () => {
    const { stored } = await consolidateWith({
      strategyQualifications: { clean: false, motivos: ['Motivo del director'], noVerificables: [] },
    });
    expect(stored.strategicAnalysis.strategyQualifications?.clean).toBe(false);
    expect(stored.strategicAnalysis.strategyQualifications?.motivos).toContain('Motivo del director');
  });

  it('prosa honesta en notas, acta y Parte II: sin salvedades, export por referencia 200 verificado', async () => {
    const { out, stored } = await consolidateWith({});
    expect(stored.governance.actaQualifications).toEqual({ clean: true, motivos: [] });
    expect(stored.strategicAnalysis.strategyQualifications?.clean).toBe(true);
    expect(stored.niifAnalysis.reconciliation?.clean).toBe(true);
    const res = await exportByRef(out.reportRef);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Report-Provenance')).toBe('verified');
  });
});

describe('/export sin referencia — recalcula los veredictos desde el preprocesado re-derivado', () => {
  const exportLoose = (report: FinancialReport, format = 'excel') =>
    exportReport(req('/api/financial-report/export', { report, rawData: PROVENANCE_CSV, format, language: 'es' }));

  it('Excel: acta con cifra falsa en prosa y `clean: true` del cliente → 422', async () => {
    const res = await exportLoose(
      reportWith({
        governance: governanceJson({ development: 'La utilidad neta del ejercicio fue de $9.000,00.' }),
        actaQualifications: CLEAN_ACTA,
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { details: string[] }).details).toContain(
      'El informe contiene salvedades o validaciones bloqueantes.',
    );
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });

  it('Excel: acta cuya aritmética contradice el P&G, sin veredicto del cliente → 422', async () => {
    const gov = governanceJson();
    gov.shareholderMinutes.resultDistribution.netIncomeCop = '99999900';
    const res = await exportLoose(reportWith({ governance: gov }));
    expect(res.status).toBe(422);
  });

  it('PDF: la misma prosa falsa bloquea antes de componer el documento', async () => {
    const res = await exportLoose(
      reportWith({
        governance: governanceJson({ note: 'El total de activos asciende a $12.000,00.' }),
        actaQualifications: CLEAN_ACTA,
      }),
      'pdf-elite',
    );
    expect(res.status).toBe(422);
    expect(composeEditorialReport).not.toHaveBeenCalled();
  });

  it('prosa honesta: el Excel sin referencia sale 200 (sin falsos positivos)', async () => {
    const res = await exportLoose(reportWith({ actaQualifications: CLEAN_ACTA, strategyQualifications: CLEAN_STRATEGY }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Report-Provenance')).toBe('unverified');
  });
});

describe('/html sin referencia — la prosa de la Parte III se cruza antes de pagar el Editor Jefe', () => {
  const htmlBody = (governanceReport: unknown, extra: Record<string, unknown> = {}) => ({
    niifReport: makeProvenanceParts().niifAnalysis.json,
    strategyReport: strategyJson(),
    governanceReport,
    company: { ...COMPANY, sector: null, comparativePeriod: null, city: null, signatories: null },
    metadata: { entityNit: COMPANY.nit, periodEnd: '2025-12-31' },
    language: 'es',
    preprocessed: toJsonSafe(pp),
    actaQualifications: CLEAN_ACTA,
    strategyQualifications: CLEAN_STRATEGY,
    ...extra,
  });

  it('utilidad neta falsa en el acta con `clean: true` del cliente → 422 sin llamar al Editor Jefe', async () => {
    const res = await html(
      req('/api/financial-report/html', htmlBody(governanceJson({ development: 'La utilidad neta del ejercicio fue de $9.000,00.' }))),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { details: string[] }).details.join('\n')).toMatch(/Utilidad neta: la narrativa imprime \$9\.000,00/);
    expect(runHtmlEditor).not.toHaveBeenCalled();
  });

  it('prosa honesta → corre el Editor Jefe', async () => {
    const res = await html(req('/api/financial-report/html', htmlBody(governanceJson())));
    expect(res.status).toBe(200);
    expect(runHtmlEditor).toHaveBeenCalledTimes(1);
  });
});
