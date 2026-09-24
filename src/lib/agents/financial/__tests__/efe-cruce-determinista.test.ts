// ---------------------------------------------------------------------------
// El EFE emitido por el modelo se cruza contra el EFE determinista
// ---------------------------------------------------------------------------
// Hallazgo niif-contrato-02 (auditoría 2026-09): sobre el EFE sólo corrían
// invariantes internos. Una reclasificación entre actividades, un efectivo
// inicial inventado compensado en inversión o un dividendo fabricado
// compensado en operación salían con 0 bloqueos. El cruce es tolerancia $0.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PeriodSnapshot, PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import {
  buildDeterministicCashFlow,
  crossCheckCashFlowAgainstDeterministic,
} from '../contracts/deterministic-breakdown';
import { validateNiifReportJson } from '../validators/niif-json-validator';
import { makeCoherentNiifReport } from '../__fixtures__/coherent-niif-report';
import type { NiifReportJson } from '../contracts/niif-report';
import { buildNiifAnalystPass2Prompt, buildNiifAnalystPass3Prompt } from '../prompts/niif-analyst.prompt';

type Acc = [code: string, balancePesos: number];
function snap(period: string, accs: Acc[], utilidadNeta: number): PeriodSnapshot {
  const classes = [1, 2, 3].map((code) => ({
    code,
    name: `Clase ${code}`,
    auxiliaryTotal: 0,
    reportedTotal: null,
    discrepancy: 0,
    accounts: accs
      .filter(([c]) => c.startsWith(String(code)))
      .map(([c, b]) => ({ code: c, name: c, level: 'Auxiliar', balance: b, isLeaf: true })),
  }));
  const cash = accs.filter(([c]) => c.startsWith('11')).reduce((a, [, b]) => a + b, 0);
  return {
    period,
    classes,
    controlTotals: { utilidadNeta, efectivoCuenta11: cash },
    equityBreakdown: {},
  } as unknown as PeriodSnapshot;
}

// 2024: caja 1.000, deudores 500, capital 1.500. 2025: caja 1.900, deudores
// 300, obligación financiera 100, capital 1.500, utilidad 600.
// EFE: operación 600 + 200 = 800; financiación 100; Δ caja 900.
const OPENING: Acc[] = [['110505', 1000], ['130505', 500], ['310505', 1500]];
const CLOSING: Acc[] = [['110505', 1900], ['130505', 300], ['210505', 100], ['310505', 1500], ['360505', 600]];
const det = buildDeterministicCashFlow(snap('2025', CLOSING, 600), snap('2024', OPENING, 0))!;

type Line = NiifReportJson['cashFlow']['sections'][number]['lines'][number];
const L = (label: string, cents: string): Line => ({
  account: null,
  label,
  amountPrimary: cents,
  amountComparative: null,
  level: 2,
  isAbsolute: false,
  confidence: null,
  anomalyFlag: null,
});

/** EFE copiado del determinista: op 800, inv 0, fin 100, apertura 1.000, cierre 1.900. */
function efeCopiado(): NiifReportJson['cashFlow'] {
  return {
    sections: [
      { section: 'operating', lines: [L('Utilidad neta del ejercicio', '60000'), L('Variación de deudores', '20000')], netFlow: '80000' },
      { section: 'investing', lines: [], netFlow: '0' },
      { section: 'financing', lines: [L('Obligaciones financieras', '10000')], netFlow: '10000' },
    ],
    netChange: '90000',
    cashOpening: '100000',
    cashClosing: '190000',
    methodNote: 'indirect',
    degeneracyFlag: 'none',
  };
}

describe('crossCheckCashFlowAgainstDeterministic', () => {
  it('el EFE determinista de la prueba cierra', () => {
    expect(det.reconciled).toBe(true);
    expect(det.sections.map((s) => s.netFlowCents)).toEqual([BigInt(80000), BigInt(0), BigInt(10000)]);
    expect(det.netChangeCents).toBe(BigInt(90000));
  });

  it('un EFE que copia el determinista no tiene discrepancias', () => {
    expect(crossCheckCashFlowAgainstDeterministic(efeCopiado(), det)).toEqual([]);
  });

  it('una reclasificación entre actividades que cuadra consigo misma se detecta', () => {
    const cf = efeCopiado();
    cf.sections[0].netFlow = det.sections[0].netFlowCents.toString();
    cf.sections[2].netFlow = det.sections[2].netFlowCents.toString();
    cf.netChange = det.netChangeCents.toString();
    // Se mueven $30 de operación a financiación ("Préstamos de socios").
    cf.sections[0].netFlow = (det.sections[0].netFlowCents - BigInt(3000)).toString();
    cf.sections[2].netFlow = (det.sections[2].netFlowCents + BigInt(3000)).toString();
    const v = crossCheckCashFlowAgainstDeterministic(cf, det);
    expect(v.map((x) => x.kind)).toEqual(['section_net_flow', 'section_net_flow']);
  });

  it('un efectivo inicial inventado compensado en inversión se detecta', () => {
    const cf = efeCopiado();
    cf.sections[0].netFlow = det.sections[0].netFlowCents.toString();
    cf.sections[2].netFlow = det.sections[2].netFlowCents.toString();
    cf.cashOpening = '90000';
    cf.sections[1].netFlow = '10000';
    cf.netChange = (det.netChangeCents + BigInt(10000)).toString();
    const kinds = crossCheckCashFlowAgainstDeterministic(cf, det).map((x) => x.kind);
    expect(kinds).toContain('cash_opening');
    expect(kinds).toContain('section_net_flow');
  });

  it('un dividendo fabricado sin sustento en el balance se detecta aunque la sección cuadre', () => {
    const cf = efeCopiado();
    cf.sections[0].netFlow = det.sections[0].netFlowCents.toString();
    cf.netChange = det.netChangeCents.toString();
    cf.sections[2].lines = [
      L('Obligaciones financieras', '25720'),
      L('Dividendos pagados a los socios', '-15720'),
    ];
    cf.sections[2].netFlow = det.sections[2].netFlowCents.toString();
    const v = crossCheckCashFlowAgainstDeterministic(cf, det);
    expect(v.map((x) => x.kind)).toEqual(['distribution_without_support']);
  });
});

describe('Validador E18 (niif-contrato-02)', () => {
  const base = (): NiifReportJson => {
    const json = makeCoherentNiifReport();
    json.cashFlow = efeCopiado();
    json.cashFlow.sections[0].netFlow = det.sections[0].netFlowCents.toString();
    json.cashFlow.sections[2].netFlow = det.sections[2].netFlowCents.toString();
    json.cashFlow.netChange = det.netChangeCents.toString();
    return json;
  };

  it('sin discrepancias no hay E18', () => {
    const r = validateNiifReportJson(base(), { deterministicCashFlow: det });
    expect(r.errors.filter((e) => e.startsWith('E18'))).toEqual([]);
  });

  it('el EFE con actividades reclasificadas es error bloqueante E18', () => {
    const json = base();
    json.cashFlow.sections[0].netFlow = (det.sections[0].netFlowCents - BigInt(3000)).toString();
    json.cashFlow.sections[2].netFlow = (det.sections[2].netFlowCents + BigInt(3000)).toString();
    const r = validateNiifReportJson(json, { deterministicCashFlow: det });
    expect(r.ok).toBe(false);
    expect(r.errors.filter((e) => e.startsWith('E18')).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// runNiifAnalyst sella el informe cuando el EFE no es el determinista
// ---------------------------------------------------------------------------

const callFinancialAgentMock = vi.fn();
vi.mock('../agents/runtime', () => ({
  callFinancialAgent: (opts: unknown) => callFinancialAgentMock(opts),
}));
import { runNiifAnalyst } from '../agents/niif-analyst';

function preprocessedFixture(): PreprocessedBalance {
  const primary = snap('2025', CLOSING, 600);
  const comparative = snap('2024', OPENING, 0);
  return { primary, comparative, periods: [comparative, primary] } as unknown as PreprocessedBalance;
}

function pass1(): unknown {
  const j = makeCoherentNiifReport();
  return {
    company: { ...j.company, comparativePeriod: '2024' },
    balanceSheet: j.balanceSheet,
    // Utilidad neta alineada con el ancla del snapshot (600 pesos) para que la
    // reconciliación de Pass-1 no dispare el reintento de reparación.
    incomeStatement: { ...j.incomeStatement, netIncomePrimary: '60000' },
    curatorFlags: j.curatorFlags,
    reportMode: null,
  };
}

function pass2(cashFlow: NiifReportJson['cashFlow']): unknown {
  return { cashFlow, equityChanges: makeCoherentNiifReport().equityChanges };
}

describe('runNiifAnalyst — cruce del EFE (niif-contrato-02) y degradación (pipeline-flujo-15)', () => {
  beforeEach(() => callFinancialAgentMock.mockReset());

  it('un EFE con actividades reclasificadas deja el informe NO limpio y sellado', async () => {
    const cf = efeCopiado();
    cf.sections[0].netFlow = (det.sections[0].netFlowCents - BigInt(3000)).toString();
    cf.sections[2].netFlow = (det.sections[2].netFlowCents + BigInt(3000)).toString();
    cf.netChange = det.netChangeCents.toString();
    callFinancialAgentMock
      .mockResolvedValueOnce({ json: pass1(), meta: {} })
      .mockResolvedValueOnce({ json: pass2(cf), meta: {} })
      .mockResolvedValueOnce({ json: { technicalNotes: [] }, meta: {} });
    const result = await runNiifAnalyst(
      'raw',
      { name: 'X', nit: '1', fiscalPeriod: '2025', comparativePeriod: '2024' } as never,
      'es',
      undefined,
      '',
      preprocessedFixture(),
    );
    expect(result.reconciliation?.clean).toBe(false);
    expect(result.reconciliation?.cashFlowDiscrepancies?.length).toBe(2);
    expect(result.fullContent).toContain('REPORTE CON SALVEDADES');
  });

  it('un pase degradado viaja marcado en el cuerpo del informe', async () => {
    callFinancialAgentMock
      .mockResolvedValueOnce({ json: pass1(), meta: {} })
      .mockImplementationOnce(async (opts: { onDegraded?: (i: unknown) => void }) => {
        opts.onDegraded?.({ agentName: 'niif-analyst-pass2', requestedEffort: 'medium', message: 'degradado' });
        const cf = efeCopiado();
        cf.sections[0].netFlow = det.sections[0].netFlowCents.toString();
        cf.sections[2].netFlow = det.sections[2].netFlowCents.toString();
        cf.netChange = det.netChangeCents.toString();
        return { json: pass2(cf), meta: { degraded: true } };
      })
      .mockResolvedValueOnce({ json: { technicalNotes: [] }, meta: {} });
    const result = await runNiifAnalyst(
      'raw',
      { name: 'X', nit: '1', fiscalPeriod: '2025', comparativePeriod: '2024' } as never,
      'es',
      undefined,
      '',
      preprocessedFixture(),
    );
    expect(result.reconciliation?.degradedPasses).toEqual(['Flujo de Efectivo y Cambios en el Patrimonio']);
    expect(result.fullContent).toContain('RAZONAMIENTO REDUCIDO');
  });
});

describe('Prompt: el texto de dividendos no niega pagos sin evidencia (niif-contrato-04)', () => {
  const company = { name: 'X SAS', nit: '1', niifGroup: 2, fiscalPeriod: '2025', comparativePeriod: '2024' } as never;
  const anchors = {
    totalAssetsPrimary: '1', totalLiabilitiesPrimary: '0', totalEquityPrimary: '1', netIncomePrimary: '1', oriPrimary: '0',
    totalAssetsComparative: null, totalLiabilitiesComparative: null, totalEquityComparative: null,
    grossProfitComparative: null, operatingProfitComparative: null, netIncomeComparative: null, oriComparative: null,
    curatorFlags: { equityConvergenceApplied: false, cashFlowClosureForced: false, negativeAssetReclassified: false, presumedCostWarning: false, reclassifiedAmountCop: '0' },
  };

  it('dividendo pagado en el año: Pass-2 lo presenta en financiación pendiente de soporte', () => {
    const opening: Acc[] = [['110505', 1000], ['310505', 500], ['360505', 500]];
    const closing: Acc[] = [['110505', 1100], ['310505', 500], ['370505', 300], ['360505', 300]];
    const pp = {
      primary: snap('2025', closing, 300),
      comparative: snap('2024', opening, 500),
      periods: [],
    } as unknown as PreprocessedBalance;
    const p2 = buildNiifAnalystPass2Prompt(company, 'es', 'COMPARATIVO_COMPLETO', anchors, pp);
    const p3 = buildNiifAnalystPass3Prompt(company, 'es', 'COMPARATIVO_COMPLETO', anchors, {
      cashOpening: '1', cashClosing: '1', netChange: '0', ecpClosingTotal: '1',
    }, pp);
    for (const p of [p2, p3]) {
      expect(p).not.toMatch(/NO hubo distribución/);
      expect(p).toMatch(/pendiente de soporte/);
    }
  });

  it('sin movimiento patrimonial distinto del resultado: "no hay evidencia contable", no "no hubo distribución"', () => {
    const pp = {
      primary: snap('2025', CLOSING, 600),
      comparative: snap('2024', OPENING, 0),
      periods: [],
    } as unknown as PreprocessedBalance;
    const p3 = buildNiifAnalystPass3Prompt(company, 'es', 'COMPARATIVO_COMPLETO', anchors, {
      cashOpening: '1', cashClosing: '1', netChange: '0', ecpClosingTotal: '1',
    }, pp);
    expect(p3).not.toMatch(/NO hubo distribución/);
    expect(p3).toMatch(/No hay evidencia contable de distribución distinta de la variación de resultados acumulados/);
  });
});
