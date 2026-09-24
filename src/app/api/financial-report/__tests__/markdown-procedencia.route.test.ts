// ---------------------------------------------------------------------------
// I3 — el Markdown de las Partes I–III no puede introducir cifras que el JSON
// validado no respalda
// ---------------------------------------------------------------------------
// Reproducción (revisor de I1): con JSON honesto y una cifra falsa SÓLO en el
// Markdown de la Parte III ("La utilidad neta del ejercicio fue de
// $9.000.000,00"), /consolidate persistía la versión con
// `actaQualifications.clean: true` y /export por referencia devolvía 200
// "procedencia verificada": el PDF (acta, notas, recomendaciones, punto de
// equilibrio, proyecciones) y el Excel (Parte II, pestaña Resumen) imprimen ese
// Markdown, y los veredictos del servidor sólo miraban el JSON.
//
// Diseño: el Markdown de cada Parte es una función determinista de su JSON
// (renderer.ts, strategy-director.ts, governance-specialist.ts). El servidor lo
// RE-RENDERIZA desde el JSON —con los sellos de SUS veredictos— en
// /consolidate (antes de consolidar y persistir) y en /export (por referencia
// y sin ella); el texto del navegador se descarta. /html no consume Markdown
// (sólo los tres JSON). Una Parte II/III sin JSON válido y con texto se sella.
//
// Las Partes salen de las rutas /niif, /strategy y /governance REALES (LLM
// mockeado en `callFinancialAgent`), así que la paridad fase ↔ servidor se
// prueba sobre el Markdown que produce el pipeline, no sobre fixtures a mano.
//
// Alcance: `getDb()` es el fake de `provenance-fixture` y la sesión se fija
// con un mock (no acredita aislamiento real de tenants).
// ---------------------------------------------------------------------------
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const state = vi.hoisted(() => ({ db: null as unknown, workspace: null as string | null, queue: [] as unknown[] }));

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
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async () => ({ json: structuredClone(state.queue.shift()), meta: {} })),
}));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
vi.mock('@/lib/export/pdf-elite-react', () => ({
  composeEditorialReport: vi.fn(() => ({ appendix: { validationWarnings: [] } })),
  renderEditorialReportToStream: vi.fn(),
}));
vi.mock('@/lib/agents/financial/agents/html-editor', () => ({ runHtmlEditor: vi.fn() }));
vi.mock('@/lib/agents/financial/contracts/html-editor', () => ({
  HtmlEditorInputSchema: { safeParse: (body: unknown) => ({ success: true, data: body }) },
}));

import { POST as niif } from '../niif/route';
import { POST as strategyRoute } from '../strategy/route';
import { POST as governanceRoute } from '../governance/route';
import { POST as consolidate } from '../consolidate/route';
import { POST as exportReport } from '../export/route';
import { POST as html } from '../html/route';
import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import { runHtmlEditor } from '@/lib/agents/financial/agents/html-editor';
import { toNiifAnalysisResult } from '@/lib/agents/financial/agents/renderer';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { composeEditorialReport, renderEditorialReportToStream } from '@/lib/export/pdf-elite-react';
import { buildActaExpectedArithmetic } from '@/lib/agents/financial/prompts/governance-specialist.prompt';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import {
  CSV_PERDIDA_COMPARATIVO,
  informeHonesto,
  preprocesarPerdidaComparativo,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import type { GovernanceReportJson } from '@/lib/agents/financial/contracts/governance-report';
import type { StrategyReportJson } from '@/lib/agents/financial/contracts/strategy-report';
import type { CompanyInfo, FinancialReport } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { buildFinancialReportVersion } from '@/lib/reports/financial-report-version';
import { persistFinancialReportVersion } from '@/lib/reports/financial-report-store';
import { makeReportsTableFake } from '@/lib/reports/__tests__/provenance-fixture';
import { COMPLIANCE_CHECKLIST, TTD_NOTE_BODY } from '@/lib/reports/__tests__/coherent-parts';

const W1 = '11111111-1111-4111-8111-111111111111';
const COMPANY: CompanyInfo = { name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 };
const pp = preprocesarPerdidaComparativo();
const A = pp.primary.controlTotals.cents!;
const T = { activo: A.activo as bigint, utilidadNeta: A.utilidadNeta as bigint, efectivo: A.efectivoCuenta11 as bigint };
const cop = (c: bigint | string) => formatCopFromCents(BigInt(c), false);

/** La cifra que sólo existe en el Markdown alterado. */
const FAKE_AMOUNT = '$987.654.321,00';
const FAKE = `La utilidad neta del ejercicio fue de ${FAKE_AMOUNT}.`;

function estrategia(dashboardActivo: bigint = T.activo): StrategyReportJson {
  const ct = pp.primary.controlTotals;
  const cents = (pesos: number) => String(Math.round(pesos * 100));
  return {
    company: { name: COMPANY.name, nit: COMPANY.nit, entityType: 'SAS', sector: null, niifGroup: 2, fiscalPeriod: '2025', comparativePeriod: '2024', city: null, signatories: null },
    reportMode: 'COMPARATIVO_COMPLETO',
    confidence: null,
    executiveDashboard: {
      rows: [
        { label: 'Total Activo', primary: dashboardActivo.toString(), comparative: null, variation: null, variationPct: null, commentary: 'Cierre.' },
        { label: 'Efectivo', primary: T.efectivo.toString(), comparative: null, variation: null, variationPct: null, commentary: 'Caja.' },
      ],
      executiveCommentary: `El total de activos cerró en ${cop(T.activo)} y el efectivo al cierre fue de ${cop(T.efectivo)}.`,
    },
    technicalAlerts: [],
    kpis: [
      {
        category: 'efficiency', name: 'Rotación de inventarios', formula: 'Costo de ventas / inventario promedio',
        resultPrimary: '45', resultComparative: null, unit: 'days',
        benchmarkBand: { description: 'Sector', lowerBound: null, upperBound: null },
        diagnosis: 'Rotación estable.', yoyVariation: null, confidence: null, anomalyFlag: null,
        presentationMode: null, baselineLabel: null, sparklinePoints: null,
      },
    ],
    dupontAnalysis: null,
    trends: {
      yoyRevenue: '+1,0%', yoyEbitda: null, yoyNetIncome: null, yoyEquity: null, marginDeltaPp: null,
      qualitativeCommentary: 'Los ingresos se mantuvieron estables.',
    },
    breakEven: { fixedCostsCop: '100000000', variableCostsCop: '50000000', revenueCop: '200000000', breakEvenPointCop: '1', marginOfSafetyPct: '1', classificationNote: 'Costos fijos: nómina y arriendos.' },
    projectedCashFlow: {
      liquidityGate: {
        triggered: false,
        currentAssetsCop: cents(ct.activoCorriente),
        currentLiabilitiesCop: cents(ct.pasivoCorriente),
        gapCop: String(BigInt(cents(ct.activoCorriente)) - BigInt(cents(ct.pasivoCorriente))),
        message: null,
      },
      initialCashBalanceCop: T.efectivo.toString(), dsoDays: '30', inflationIndexPct: '5,0',
      scenarios: [], solvencyNarrative: 'La entidad atiende sus obligaciones de corto plazo.', controlKpis: [], assumptionsNote: 'Supuestos conservadores.',
    },
    recommendations: [1, 2, 3].map((i) => ({
      title: `Acción ${i}`, diagnosis: 'Cartera concentrada.', action: 'Cobrar.', expectedImpact: 'Caja.',
      priority: 'medium' as const, horizon: 'short_term' as const, normReference: null,
    })),
    presumedCostWarning: null,
    preparerNotes: [],
  } as StrategyReportJson;
}

function gobierno(development?: string): GovernanceReportJson {
  const acta = buildActaExpectedArithmetic(COMPANY, pp)!;
  return {
    company: { name: COMPANY.name, nit: COMPANY.nit, entityType: 'SAS', sector: null, niifGroup: 2, fiscalPeriod: '2025', comparativePeriod: '2024', city: null, signatories: null },
    reportMode: 'COMPARATIVO_COMPLETO',
    signatories: null,
    financialNotes: [
      {
        number: 1, title: 'Efectivo',
        body: `El efectivo al cierre fue de ${cop(T.efectivo)}. El total de activos asciende a ${cop(T.activo)}.`,
        normReference: null, materiality: 'material' as const, confidence: null,
      },
      { number: 2, title: 'Impuestos', body: TTD_NOTE_BODY, normReference: 'Art. 240 E.T.', materiality: 'material' as const, confidence: null },
    ],
    shareholderMinutes: {
      assemblyType: 'Asamblea General de Accionistas', entityRegimeCitation: 'Ley 1258 de 2008', city: null, meetingDate: null,
      convocationStatement: 'Se convocó según los estatutos.', quorumStatement: 'Se verificó el quorum deliberatorio.',
      agenda: Array.from({ length: 8 }, (_, i) => ({ number: i + 1, topic: `Punto ${i + 1}` })),
      developments: [
        { itemNumber: 1, body: development ?? `La pérdida neta del ejercicio fue de ${cop(-T.utilidadNeta)}; no hay utilidades por distribuir.` },
      ],
      resultDistribution: {
        netIncomeCop: acta.netIncomeCop, applies: acta.distributionApplies,
        lines: acta.lines.map((l) => ({ label: l.label, amountCop: l.amountCop, normReference: l.normReference })),
        neutralProposalText: 'La asamblea decide sobre el tratamiento de la pérdida.',
      },
      capitalizationProposal: {
        applies: acta.capitalizationApplies, retainedEarningsBaseCop: acta.capitalizationBaseCop,
        capitalizationAmountCop: acta.capitalizationAmountCop, legalReference: 'Art. 30 E.T.', body: 'No se propone capitalización.',
      },
      signatures: [
        { role: 'presidente_asamblea', name: null, identification: null },
        { role: 'secretario_asamblea', name: null, identification: null },
        { role: 'representante_legal', name: null, identification: null },
      ],
      fiscalReviewerOpinion: { applies: false, reviewerName: null, reviewerTp: null, opinionType: null, opinionBody: null, exemptionReason: 'No obligada.' },
      closingStatement: 'Se levanta la sesión.',
    },
    complianceChecklist: COMPLIANCE_CHECKLIST,
    disclaimers: [],
    preparerNotes: [],
  } as unknown as GovernanceReportJson;
}

const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function ok<T>(res: Response): Promise<T> {
  const text = await res.text();
  expect(res.status, text.slice(0, 2000)).toBe(200);
  return JSON.parse(text) as T;
}

type Parts = Pick<FinancialReport, 'niifAnalysis' | 'strategicAnalysis' | 'governance'>;
interface Phases extends Parts {
  context: { preprocessed: PreprocessedBalance; company: CompanyInfo };
}
interface Consolidated {
  report: FinancialReport;
  consolidatedReport: string;
  reportRef?: { reportId: string; reportHash: string };
}

/** /niif → /strategy → /governance reales (LLM mockeado). */
async function fases(
  opts: { strategy?: StrategyReportJson; governance?: GovernanceReportJson; language?: 'es' | 'en' } = {},
): Promise<Phases> {
  const language = opts.language ?? 'es';
  const phase = await ok<{ niif: FinancialReport['niifAnalysis']; context: { preprocessed: PreprocessedBalance; bindingTotals: string; company: CompanyInfo } }>(
    await niif(req('/api/financial-report/niif', { rawData: CSV_PERDIDA_COMPARATIVO, company: COMPANY, language })),
  );
  const handoff = {
    niifResult: phase.niif, bindingTotals: phase.context.bindingTotals, preprocessed: phase.context.preprocessed,
    company: phase.context.company, language,
  };
  state.queue.push(opts.strategy ?? estrategia());
  const { strategy } = await ok<{ strategy: FinancialReport['strategicAnalysis'] }>(
    await strategyRoute(req('/api/financial-report/strategy', handoff)),
  );
  state.queue.push(opts.governance ?? gobierno());
  const { governance } = await ok<{ governance: FinancialReport['governance'] }>(
    await governanceRoute(req('/api/financial-report/governance', { ...handoff, strategyResult: strategy })),
  );
  return { niifAnalysis: phase.niif, strategicAnalysis: strategy, governance, context: phase.context };
}

async function consolidar(parts: Parts, company: CompanyInfo, language: 'es' | 'en' = 'es'): Promise<Consolidated> {
  return ok<Consolidated>(
    await consolidate(
      req('/api/financial-report/consolidate', { rawData: CSV_PERDIDA_COMPARATIVO, company, language, reportParts: parts }),
    ),
  );
}

/** El navegador altera SÓLO el texto: JSON y veredictos quedan honestos. */
function forjar(p: Parts): Parts {
  const add = (s: string) => `${s}\n\n${FAKE}`;
  return {
    niifAnalysis: { ...p.niifAnalysis, incomeStatement: add(p.niifAnalysis.incomeStatement), fullContent: add(p.niifAnalysis.fullContent) },
    strategicAnalysis: {
      ...p.strategicAnalysis,
      breakEvenAnalysis: add(p.strategicAnalysis.breakEvenAnalysis),
      projectedCashFlow: add(p.strategicAnalysis.projectedCashFlow),
      strategicRecommendations: add(p.strategicAnalysis.strategicRecommendations),
      fullContent: add(p.strategicAnalysis.fullContent),
    },
    governance: {
      ...p.governance,
      financialNotes: add(p.governance.financialNotes),
      shareholderMinutes: add(p.governance.shareholderMinutes),
      fullContent: add(p.governance.fullContent),
    },
  };
}

const MD_FIELDS = {
  niifAnalysis: ['balanceSheet', 'incomeStatement', 'cashFlowStatement', 'equityChangesStatement', 'technicalNotes', 'fullContent'],
  strategicAnalysis: ['kpiDashboard', 'breakEvenAnalysis', 'projectedCashFlow', 'strategicRecommendations', 'fullContent'],
  governance: ['financialNotes', 'shareholderMinutes', 'fullContent'],
} as const;

/** Markdown de las tres Partes (para comparar fase ↔ servidor). */
function markdownOf(p: Parts): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [part, fields] of Object.entries(MD_FIELDS)) {
    for (const f of fields) out[`${part}.${f}`] = (p as unknown as Record<string, Record<string, string>>)[part][f];
  }
  return out;
}

const containsFake = (x: unknown) => JSON.stringify(x).includes('987.654.321');

let fake: ReturnType<typeof makeReportsTableFake>;
const previousDbUrl = process.env.DATABASE_URL;
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
  state.queue.length = 0;
  fake = makeReportsTableFake();
  state.db = fake.db;
  state.workspace = W1;
  vi.mocked(runNiifAnalyst).mockResolvedValue({
    ...toNiifAnalysisResult(structuredClone(informeHonesto(pp))),
    reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false },
  });
  vi.mocked(renderEditorialReportToStream).mockImplementation(async () => Readable.from(['%PDF-test']));
  vi.mocked(runHtmlEditor).mockResolvedValue({
    html: '<html><head></head><body><main>Informe</main></body></html>', metadata: {}, checklistFailures: [], emittable: true,
  } as never);
});

describe('I3 — paridad: el render del servidor es el Markdown que producen las fases', () => {
  it('corrida honesta: la versión persistida lleva EXACTAMENTE el texto de /niif, /strategy y /governance', async () => {
    const f = await fases();
    const c = await consolidar(f, f.context.company);
    expect(c.report.strategicAnalysis.strategyQualifications?.clean).toBe(true);
    expect(c.report.governance.actaQualifications?.clean).toBe(true);
    expect(c.report.niifAnalysis.reconciliation?.clean).toBe(true);
    expect(markdownOf(c.report)).toEqual(markdownOf(f));
    // El consolidado se arma con ese mismo texto.
    expect(c.consolidatedReport).toContain(f.governance.fullContent);
    expect(c.consolidatedReport).toContain(f.strategicAnalysis.fullContent);
    expect(c.report.emittability?.kind).toBe('emittable');
  });

  it('con salvedades (prosa falsa del acta y Total Activo falso en el dashboard, en el JSON): los sellos del servidor son los de las fases', async () => {
    const f = await fases({
      strategy: estrategia(T.activo + BigInt(100_000_000)),
      governance: gobierno(FAKE),
    });
    expect(f.governance.actaQualifications?.clean).toBe(false);
    expect(f.strategicAnalysis.strategyQualifications?.clean).toBe(false);
    const c = await consolidar(f, f.context.company);
    expect(c.report.governance.actaQualifications?.clean).toBe(false);
    expect(c.report.strategicAnalysis.strategyQualifications?.clean).toBe(false);
    expect(markdownOf(c.report)).toEqual(markdownOf(f));
    expect(c.report.governance.shareholderMinutes).toMatch(/PARTE III CON SALVEDADES — CIFRAS EN PROSA SIN RESPALDO/);
    expect(c.report.strategicAnalysis.kpiDashboard).toMatch(/ANÁLISIS ESTRATÉGICO CON SALVEDADES/);
  });

  it('en inglés: mismos sellos y notas que las fases', async () => {
    const f = await fases({ strategy: estrategia(T.activo + BigInt(100_000_000)), governance: gobierno(FAKE), language: 'en' });
    const c = await consolidar(f, f.context.company, 'en');
    expect(markdownOf(c.report)).toEqual(markdownOf(f));
    expect(c.report.governance.shareholderMinutes).toMatch(/PART III WITH QUALIFICATIONS — NARRATIVE FIGURES WITHOUT SUPPORT/);
    expect(c.report.strategicAnalysis.fullContent).toMatch(/### Deterministic verification of Part II/);
  });
});

describe('I3 — paridad de la Parte I sellada por los invariantes de /niif', () => {
  it('ECP que no cierra con el patrimonio del ESF: el sello de integridad de la fase se reproduce en el servidor', async () => {
    const json = structuredClone(informeHonesto(pp));
    const closing = json.equityChanges.rows[json.equityChanges.rows.length - 1];
    closing.capitalSocial = String(BigInt(closing.capitalSocial) + BigInt(100));
    closing.total = String(BigInt(closing.total) + BigInt(100));
    vi.mocked(runNiifAnalyst).mockResolvedValue({
      ...toNiifAnalysisResult(json),
      reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false },
    });
    const f = await fases();
    expect(f.niifAnalysis.reconciliation?.clean).toBe(false);
    expect(f.niifAnalysis.fullContent).toMatch(/REPORTE CON SALVEDADES — INTEGRIDAD ARITMÉTICA/);
    // El cliente "limpia" la reconciliación y reenvía: el servidor la recalcula.
    const c = await consolidar(
      { ...f, niifAnalysis: { ...f.niifAnalysis, reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false } } },
      f.context.company,
    );
    expect(c.report.niifAnalysis.reconciliation?.clean).toBe(false);
    expect(markdownOf(c.report)).toEqual(markdownOf(f));
  });
});

describe('I3 — cifra falsa SÓLO en el Markdown (JSON honesto, flags limpios)', () => {
  it('/consolidate descarta el texto del navegador: versión persistida y consolidado sin la cifra', async () => {
    const f = await fases();
    const forged = forjar(f);
    const c = await consolidar(forged, f.context.company);
    const stored = (fake.rows[0].data as { report: FinancialReport }).report;
    expect(containsFake(stored)).toBe(false);
    expect(containsFake(c.consolidatedReport)).toBe(false);
    expect(markdownOf(stored)).toEqual(markdownOf(f));
    expect(stored.governance.actaQualifications?.clean).toBe(true);
  });

  it('por referencia: Excel, PDF y HTML reciben el render del JSON y salen "verificados"', async () => {
    const f = await fases();
    const c = await consolidar(forjar(f), f.context.company);
    const excel = await exportReport(req('/api/financial-report/export', { reportRef: c.reportRef, format: 'excel' }));
    expect(excel.status).toBe(200);
    expect(excel.headers.get('X-Report-Provenance')).toBe('verified');
    expect(containsFake(vi.mocked(generateFinancialExcel).mock.calls[0][0].report)).toBe(false);

    const pdf = await exportReport(req('/api/financial-report/export', { reportRef: c.reportRef, format: 'pdf-elite' }));
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('X-Report-Provenance')).toBe('verified');
    const composed = vi.mocked(composeEditorialReport).mock.calls[0][0].report;
    expect(containsFake(composed)).toBe(false);
    expect(composed.governance.shareholderMinutes).toBe(f.governance.shareholderMinutes);

    // /html no consume Markdown: el Editor Jefe recibe los tres JSON.
    const page = await html(req('/api/financial-report/html', { reportRef: c.reportRef, language: 'es' }));
    expect(page.status).toBe(200);
    expect(containsFake(vi.mocked(runHtmlEditor).mock.calls[0][0])).toBe(false);
  });

  it('sin referencia: Excel y PDF re-renderizan las Partes y reconstruyen el consolidado desde ellas', async () => {
    const f = await fases();
    const c = await consolidar(f, f.context.company);
    // El navegador altera el informe que ya recibió del servidor (texto de las
    // Partes y del consolidado) y lo reenvía sin referencia.
    const forgedParts = forjar(c.report);
    const forged: FinancialReport = {
      ...c.report,
      ...forgedParts,
      consolidatedReport: c.report.consolidatedReport.replace('# PARTE III:', `${FAKE}\n\n# PARTE III:`),
    };
    for (const format of ['excel', 'pdf-elite'] as const) {
      vi.clearAllMocks();
      vi.mocked(renderEditorialReportToStream).mockImplementation(async () => Readable.from(['%PDF-test']));
      const res = await exportReport(
        req('/api/financial-report/export', {
          report: forged, rawData: CSV_PERDIDA_COMPARATIVO, preprocessed: f.context.preprocessed, format, language: 'es',
        }),
      );
      expect(res.status, format).toBe(200);
      expect(res.headers.get('X-Report-Provenance')).toBe('unverified');
      const used =
        format === 'excel'
          ? vi.mocked(generateFinancialExcel).mock.calls[0][0].report
          : vi.mocked(composeEditorialReport).mock.calls[0][0].report;
      expect(containsFake(used), format).toBe(false);
      expect(markdownOf(used)).toEqual(markdownOf(f));
      expect(used.consolidatedReport).toContain('# PARTE III: GOBIERNO CORPORATIVO');
      expect(used.consolidatedReport).toContain(f.governance.fullContent);
    }
    // /html sin referencia: sólo JSON (el cuerpo no trae Markdown que imprimir).
    const page = await html(
      req('/api/financial-report/html', {
        niifReport: c.report.niifAnalysis.json, strategyReport: c.report.strategicAnalysis.json,
        governanceReport: c.report.governance.json,
        company: { ...c.report.company, sector: null, city: null, signatories: null },
        metadata: { entityNit: c.report.company.nit, periodEnd: '2025-12-31' }, language: 'es',
        preprocessed: f.context.preprocessed,
      }),
    );
    expect(page.status).toBe(200);
    expect(containsFake(vi.mocked(runHtmlEditor).mock.calls[0][0])).toBe(false);
  });

  it('versión persistida antes de I3 con el texto del navegador: /export por referencia imprime el render del JSON persistido', async () => {
    const f = await fases();
    const c = await consolidar(f, f.context.company);
    // Una versión que un /consolidate anterior persistió con el Markdown
    // alterado (huella íntegra: así se guardó).
    const legacy: FinancialReport = {
      ...c.report,
      ...forjar(c.report),
      consolidatedReport: c.report.consolidatedReport.replace(
        c.report.governance.fullContent,
        `${c.report.governance.fullContent}\n\n${FAKE}`,
      ),
    };
    const version = buildFinancialReportVersion({ report: legacy, preprocessed: pp, rawData: CSV_PERDIDA_COMPARATIVO });
    const persisted = await persistFinancialReportVersion({ workspaceId: W1, version, controlTotals: null });
    if (persisted.status !== 'persisted') throw new Error('no persistió');
    const reportRef = { reportId: persisted.provenance.reportId, reportHash: persisted.provenance.reportHash };
    expect(containsFake(legacy)).toBe(true);

    vi.clearAllMocks();
    const excel = await exportReport(req('/api/financial-report/export', { reportRef, format: 'excel' }));
    expect(excel.status).toBe(200);
    expect(excel.headers.get('X-Report-Provenance')).toBe('verified');
    const used = vi.mocked(generateFinancialExcel).mock.calls[0][0].report;
    expect(containsFake(used)).toBe(false);
    expect(markdownOf(used)).toEqual(markdownOf(f));
    // El encabezado del consolidado persistido se conserva (detrás del sello de
    // procedencia del Excel); sólo cambia el segmento de las Partes.
    expect(used.consolidatedReport).toContain(c.report.consolidatedReport.split('# PARTE I:')[0]);
    expect(used.consolidatedReport).toContain(f.governance.fullContent);
  });
});

describe('I3 — Parte II/III sin JSON válido y con texto: se sella', () => {
  it('JSON de Gobierno o de Estrategia ausente (o inválido) → versión persistida sellada y 422 por referencia y sin ella', async () => {
    const f = await fases();
    const cases: Array<[string, Parts]> = [
      ['gobierno ausente', { ...f, governance: { ...f.governance, json: undefined } }],
      ['gobierno inválido', { ...f, governance: { ...f.governance, json: { shareholderMinutes: null } as unknown as GovernanceReportJson } }],
      ['estrategia ausente', { ...f, strategicAnalysis: { ...f.strategicAnalysis, json: undefined } }],
    ];
    for (const [label, parts] of cases) {
      const c = await consolidar(parts, f.context.company);
      const r = c.report;
      const sealed =
        label.startsWith('gobierno')
          ? r.governance.actaQualifications?.clean === false && /Parte III no trae cifras estructuradas/.test(r.governance.fullContent)
          : r.strategicAnalysis.strategyQualifications?.clean === false && /Parte II no trae cifras estructuradas/.test(r.strategicAnalysis.fullContent);
      expect(sealed, label).toBe(true);
      expect(r.niifAnalysis.reconciliation?.clean, label).toBe(false);
      const byRef = await exportReport(req('/api/financial-report/export', { reportRef: c.reportRef, format: 'excel' }));
      expect(byRef.status, label).toBe(422);
      // El cliente "limpia" los flags y reenvía sin referencia: sigue sellada.
      const forged: FinancialReport = {
        ...r,
        niifAnalysis: { ...r.niifAnalysis, reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false } },
        governance: { ...r.governance, actaQualifications: { clean: true, motivos: [] } },
        strategicAnalysis: { ...r.strategicAnalysis, strategyQualifications: { clean: true, motivos: [], noVerificables: [] } },
      };
      const loose = await exportReport(
        req('/api/financial-report/export', { report: forged, rawData: CSV_PERDIDA_COMPARATIVO, format: 'pdf-elite', language: 'es' }),
      );
      expect(loose.status, label).toBe(422);
    }
    expect(generateFinancialExcel).not.toHaveBeenCalled();
    expect(composeEditorialReport).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Revisión I3 — cifras DERIVADAS de la Parte II alteradas en el JSON
// ---------------------------------------------------------------------------
// El render del servidor imprimía el JSON recibido tal cual: el punto de
// equilibrio, el margen de seguridad, el mensaje de la puerta de liquidez y los
// KPIs sin ancla —que la fase fija de forma determinista y que ningún cruce
// verifica— podían llegar alterados al PDF y al Excel con "procedencia
// verificada" (el render declaraba N/D un KPI cuya cifra imprimía la tabla).
// Ahora el JSON pasa otra vez por el post-procesador de la fase
// (`postProcessStrategyJson`), idempotente sobre el que ella publicó.
// ---------------------------------------------------------------------------
describe('revisión I3 — cifras derivadas de la Parte II alteradas en el JSON', () => {
  it('punto de equilibrio, KPI sin ancla y mensaje de liquidez: ni el consolidado ni el PDF/Excel por referencia los imprimen', async () => {
    const f = await fases();
    const sj = structuredClone(f.strategicAnalysis.json!) as StrategyReportJson;
    sj.breakEven.breakEvenPointCop = '98765432100';
    sj.breakEven.marginOfSafetyPct = '98.76';
    sj.kpis[0] = { ...sj.kpis[0], resultPrimary: '987654321', formula: 'x', diagnosis: 'Cifra del cliente.' };
    sj.projectedCashFlow.liquidityGate.message = FAKE;
    const c = await consolidar({ ...f, strategicAnalysis: { ...f.strategicAnalysis, json: sj } }, f.context.company);
    const stored = (fake.rows[0].data as { report: FinancialReport }).report;
    for (const x of [c.consolidatedReport, stored]) {
      expect(containsFake(x)).toBe(false);
      expect(JSON.stringify(x)).not.toContain('987654321');
      expect(JSON.stringify(x)).not.toContain('98,76%');
    }
    // El JSON que acompaña a la versión es el derivado: el de la fase. El
    // texto también, salvo la nota de verificación, que declara "no
    // verificable" el KPI que el JSON recibido traía con cifra (el cruce se
    // hace sobre lo recibido: sólo endurece).
    expect(stored.strategicAnalysis.json).toEqual(f.strategicAnalysis.json);
    const withoutNote = (p: Parts) => {
      const md = markdownOf(p);
      md['strategicAnalysis.fullContent'] = md['strategicAnalysis.fullContent'].replace(/\n- No verificables[^\n]*$/, '');
      return md;
    };
    expect(withoutNote(stored)).toEqual(withoutNote(f));
    expect(stored.strategicAnalysis.fullContent).toMatch(/No verificables[^\n]*KPI Rotación de inventarios/);

    const pdf = await exportReport(req('/api/financial-report/export', { reportRef: c.reportRef, format: 'pdf-elite' }));
    expect(pdf.status).toBe(200);
    expect(containsFake(vi.mocked(composeEditorialReport).mock.calls[0][0].report)).toBe(false);
    const excel = await exportReport(req('/api/financial-report/export', { reportRef: c.reportRef, format: 'excel' }));
    expect(excel.status).toBe(200);
    expect(JSON.stringify(vi.mocked(generateFinancialExcel).mock.calls[0][0].report)).not.toContain('987654321');
  });

  it('sin referencia: el JSON alterado de la Parte II tampoco imprime sus cifras derivadas', async () => {
    const f = await fases();
    const c = await consolidar(f, f.context.company);
    const sj = structuredClone(c.report.strategicAnalysis.json!) as StrategyReportJson;
    sj.breakEven.breakEvenPointCop = '98765432100';
    const forged: FinancialReport = { ...c.report, strategicAnalysis: { ...c.report.strategicAnalysis, json: sj } };
    const res = await exportReport(
      req('/api/financial-report/export', {
        report: forged, rawData: CSV_PERDIDA_COMPARATIVO, preprocessed: f.context.preprocessed, format: 'pdf-elite', language: 'es',
      }),
    );
    expect(res.status).toBe(200);
    const used = vi.mocked(composeEditorialReport).mock.calls[0][0].report;
    expect(containsFake(used)).toBe(false);
    expect(markdownOf(used)).toEqual(markdownOf(f));
  });

  it('paridad con punto de equilibrio no definido (costos variables ≥ ingresos): el aviso N/D no se duplica', async () => {
    const e = estrategia();
    e.breakEven = { ...e.breakEven, variableCostsCop: '300000000' };
    const f = await fases({ strategy: e });
    expect(f.strategicAnalysis.json!.breakEven.classificationNote.match(/Punto de equilibrio N\/D/g)).toHaveLength(1);
    const c = await consolidar(f, f.context.company);
    expect(markdownOf(c.report)).toEqual(markdownOf(f));
    expect(c.report.strategicAnalysis.json).toEqual(f.strategicAnalysis.json);
  });
});
