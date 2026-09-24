// ---------------------------------------------------------------------------
// Flujo partido completo con las fases reales (revisión I1)
// ---------------------------------------------------------------------------
// Las pruebas de integración de I1 cruzan /consolidate, /export y /html con
// Partes II/III de fixture. Aquí las Partes II y III salen de las rutas
// /strategy y /governance REALES (LLM mockeado en `callFinancialAgent`, el
// resto —re-derivación del preprocesado con el ledger, anclas, validador de
// prosa, sellos, consolidado, persistencia y gates— corre en real) y el
// informe recorre todas las salidas: /export por referencia (en el idioma del
// informe y en el otro), /export sin referencia (rawData + preprocessed y sólo
// preprocessed) y /html por referencia y sin ella.
//
//   - Informe honesto (traza de pérdida con comparativo) → 200 en todas.
//   - Ajuste confirmado del Doctor anclado al comparativo 2024 (`period`) →
//     /strategy y /governance re-derivan con el MISMO ledger → 200 en todas.
//   - Acta con una utilidad neta falsa y el flag del cliente "limpio" → la
//     versión persistida la sella y todas las salidas responden 422.
//
// Alcance: `getDb()` es el fake de `provenance-fixture` y la sesión se fija
// con un mock (no acredita aislamiento real de tenants).
// ---------------------------------------------------------------------------
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { makeReportsTableFake } from '@/lib/reports/__tests__/provenance-fixture';

const W1 = '11111111-1111-4111-8111-111111111111';
const COMPANY: CompanyInfo = { name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 };
const pp = preprocesarPerdidaComparativo();
const A = pp.primary.controlTotals.cents!;
const T = { activo: A.activo as bigint, utilidadNeta: A.utilidadNeta as bigint, efectivo: A.efectivoCuenta11 as bigint };
const cop = (c: bigint | string) => formatCopFromCents(BigInt(c), false);

// 2024 con la caja $1.000.000 de menos; ajuste confirmado +1.000.000 a 110505 en 2024.
const CSV_2024_CORTO = CSV_PERDIDA_COMPARATIVO.replace(
  '110505,Caja general,Auxiliar,1,30000000,5000000',
  '110505,Caja general,Auxiliar,1,29000000,5000000',
);
const LEDGER = {
  adjustments: [
    {
      id: 'adj-2024-caja', accountCode: '110505', accountName: 'Caja general', amount: 1_000_000,
      rationale: 'Arqueo 2024', status: 'applied' as const, proposedAt: '2026-09-24T00:00:00Z',
      appliedAt: '2026-09-24T00:01:00Z', period: '2024',
    },
  ],
};

function estrategia(executive?: string): StrategyReportJson {
  const ct = pp.primary.controlTotals;
  const cents = (pesos: number) => String(Math.round(pesos * 100));
  return {
    company: { name: COMPANY.name, nit: COMPANY.nit, entityType: 'SAS', sector: null, niifGroup: 2, fiscalPeriod: '2025', comparativePeriod: '2024', city: null, signatories: null },
    reportMode: 'COMPARATIVO_COMPLETO',
    confidence: null,
    executiveDashboard: {
      rows: [
        { label: 'Total Activo', primary: T.activo.toString(), comparative: null, variation: null, variationPct: null, commentary: 'Cierre.' },
        { label: 'Utilidad Neta', primary: T.utilidadNeta.toString(), comparative: null, variation: null, variationPct: null, commentary: 'Pérdida.' },
        { label: 'Efectivo', primary: T.efectivo.toString(), comparative: null, variation: null, variationPct: null, commentary: 'Caja.' },
      ],
      executiveCommentary:
        executive ??
        `El total de activos cerró en ${cop(T.activo)}, la pérdida neta del ejercicio fue de ${cop(-T.utilidadNeta)} ` +
          `y el efectivo al cierre fue de ${cop(T.efectivo)}. En 2024 el efectivo al cierre fue de $30.000.000,00.`,
    },
    technicalAlerts: [
      { severity: 'amber', title: 'TTD', description: 'TTD (parágrafo 6 del art. 240 E.T.): N/D sin ID/UD verificados; la utilidad contable no es base fiscal.', normReference: null },
    ],
    kpis: [],
    dupontAnalysis: null,
    trends: null,
    breakEven: { fixedCostsCop: '1', variableCostsCop: '1', revenueCop: '1', breakEvenPointCop: '1', marginOfSafetyPct: '1', classificationNote: 'nota' },
    projectedCashFlow: {
      liquidityGate: {
        triggered: false,
        currentAssetsCop: cents(ct.activoCorriente),
        currentLiabilitiesCop: cents(ct.pasivoCorriente),
        gapCop: String(BigInt(cents(ct.activoCorriente)) - BigInt(cents(ct.pasivoCorriente))),
        message: null,
      },
      initialCashBalanceCop: T.efectivo.toString(), dsoDays: '30', inflationIndexPct: '5,0',
      scenarios: [], solvencyNarrative: 'ok', controlKpis: [], assumptionsNote: 'supuestos',
    },
    recommendations: [1, 2, 3].map((i) => ({
      title: `Acción ${i}`, diagnosis: 'Cartera.', action: 'Cobrar.', expectedImpact: 'Caja.',
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
        body: `El efectivo al cierre fue de ${cop(T.efectivo)} y el efectivo al cierre de 2024 fue de $30.000.000,00. El total de activos asciende a ${cop(T.activo)}.`,
        normReference: null, materiality: 'material' as const, confidence: null,
      },
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
    complianceChecklist: [],
    disclaimers: [],
    preparerNotes: [],
  } as unknown as GovernanceReportJson;
}

const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  expect(res.status, text.slice(0, 2000)).toBe(200);
  return JSON.parse(text) as T;
}

interface Corrida {
  rawData: string;
  phase: { niif: FinancialReport['niifAnalysis']; context: { preprocessed: PreprocessedBalance; bindingTotals: string; company: CompanyInfo } };
  strategy: FinancialReport['strategicAnalysis'];
  governance: FinancialReport['governance'];
  consolidated: { report: FinancialReport; reportRef?: { reportId: string; reportHash: string } };
}

async function correr(opts: { rawData: string; ledger?: typeof LEDGER; governance?: GovernanceReportJson; strategy?: StrategyReportJson; language?: 'es' | 'en' }): Promise<Corrida> {
  const language = opts.language ?? 'es';
  const ledgerField = opts.ledger ? { adjustmentLedger: opts.ledger } : {};
  const phase = await json<Corrida['phase']>(
    await niif(req('/api/financial-report/niif', { rawData: opts.rawData, company: COMPANY, language, ...ledgerField })),
  );
  const handoff = {
    niifResult: phase.niif, bindingTotals: phase.context.bindingTotals, preprocessed: phase.context.preprocessed,
    company: phase.context.company, language, ...ledgerField,
  };
  state.queue.push(opts.strategy ?? estrategia());
  const { strategy } = await json<{ strategy: Corrida['strategy'] }>(await strategyRoute(req('/api/financial-report/strategy', handoff)));
  // V10 (TTD) lo exige el gate de emitibilidad sobre el texto; el Director real
  // lo redacta, el mock no.
  strategy.fullContent += '\n\nTTD (parágrafo 6 del art. 240 E.T.): N/D sin ID/UD verificados.';
  state.queue.push(opts.governance ?? gobierno());
  const { governance } = await json<{ governance: Corrida['governance'] }>(
    await governanceRoute(req('/api/financial-report/governance', { ...handoff, strategyResult: strategy })),
  );
  const consolidated = await json<Corrida['consolidated']>(
    await consolidate(
      req('/api/financial-report/consolidate', {
        rawData: opts.rawData, company: phase.context.company, language, ...ledgerField,
        reportParts: { niifAnalysis: phase.niif, strategicAnalysis: strategy, governance },
      }),
    ),
  );
  return { rawData: opts.rawData, phase, strategy, governance, consolidated };
}

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
  vi.mocked(runHtmlEditor).mockResolvedValue({
    html: '<html><head></head><body><main>Informe</main></body></html>', metadata: {}, checklistFailures: [], emittable: true,
  } as never);
});

async function exportsAll(c: Corrida, ledger?: typeof LEDGER, language: 'es' | 'en' = 'es') {
  const ledgerField = ledger ? { adjustmentLedger: ledger } : {};
  const r = c.consolidated.report;
  const out: Record<string, { status: number; body: string }> = {};
  const call = async (k: string, res: Promise<Response>) => {
    const x = await res;
    out[k] = { status: x.status, body: x.status === 200 ? '' : (await x.text()).slice(0, 1500) };
  };
  await call('export-ref', exportReport(req('/api/financial-report/export', { reportRef: c.consolidated.reportRef, format: 'excel', language })));
  await call('export-ref-en', exportReport(req('/api/financial-report/export', { reportRef: c.consolidated.reportRef, format: 'excel', language: language === 'es' ? 'en' : 'es' })));
  await call('export-raw', exportReport(req('/api/financial-report/export', { report: r, rawData: c.rawData, preprocessed: c.phase.context.preprocessed, format: 'excel', language, ...ledgerField })));
  await call('export-pp', exportReport(req('/api/financial-report/export', { report: r, preprocessed: c.phase.context.preprocessed, format: 'excel', language, ...ledgerField })));
  await call('html-ref', html(req('/api/financial-report/html', { reportRef: c.consolidated.reportRef, language })));
  await call(
    'html-noref',
    html(
      req('/api/financial-report/html', {
        niifReport: r.niifAnalysis.json, strategyReport: r.strategicAnalysis.json, governanceReport: r.governance.json,
        company: { ...r.company, sector: null, city: null, signatories: null },
        metadata: { entityNit: r.company.nit, periodEnd: '2025-12-31' }, language,
        preprocessed: c.phase.context.preprocessed, ...ledgerField,
        actaQualifications: r.governance.actaQualifications ?? null,
        strategyQualifications: r.strategicAnalysis.strategyQualifications ?? null,
      }),
    ),
  );
  return out;
}

describe('revisor I1 — corrida honesta por TODAS las rutas con fases reales', () => {
  it('traza en pesos: sin salvedades y todas las salidas 200', async () => {
    const c = await correr({ rawData: CSV_PERDIDA_COMPARATIVO });
    expect(c.strategy.strategyQualifications?.clean).toBe(true);
    expect(c.governance.actaQualifications?.clean ?? true).toBe(true);
    expect(c.consolidated.report.governance.actaQualifications?.clean).toBe(true);
    expect(c.consolidated.report.niifAnalysis.reconciliation?.clean).toBe(true);
    const out = await exportsAll(c);
    for (const [k, v] of Object.entries(out)) expect(v.status, `${k}: ${v.body}`).toBe(200);
  });

  it('ajuste del Doctor en el comparativo 2024: fases, consolidado y salidas 200', async () => {
    const c = await correr({ rawData: CSV_2024_CORTO, ledger: LEDGER });
    expect(c.consolidated.report.governance.actaQualifications?.clean).toBe(true);
    const out = await exportsAll(c, LEDGER);
    for (const [k, v] of Object.entries(out)) expect(v.status, `${k}: ${v.body}`).toBe(200);
  });

  it('prosa falsa en el acta con el flag limpio: bloqueada en todas las salidas', async () => {
    const lie = gobierno('La utilidad neta del ejercicio fue de $9.000.000,00.');
    const c = await correr({ rawData: CSV_PERDIDA_COMPARATIVO, governance: lie });
    // La fase ya lo sella; el cliente lo "limpia" y reenvía.
    const cleaned = { ...c.governance, actaQualifications: { clean: true, motivos: [] } };
    const consolidated = await json<Corrida['consolidated']>(
      await consolidate(
        req('/api/financial-report/consolidate', {
          rawData: c.rawData, company: c.phase.context.company, language: 'es',
          reportParts: { niifAnalysis: c.phase.niif, strategicAnalysis: c.strategy, governance: cleaned },
        }),
      ),
    );
    expect(consolidated.report.governance.actaQualifications?.clean).toBe(false);
    const forged = { ...consolidated.report, governance: { ...consolidated.report.governance, actaQualifications: { clean: true, motivos: [] } }, niifAnalysis: { ...consolidated.report.niifAnalysis, reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false } } };
    const out = await exportsAll({ ...c, consolidated: { ...consolidated, report: forged } });
    for (const [k, v] of Object.entries(out)) expect(v.status, `${k}`).toBe(422);
  });

});
