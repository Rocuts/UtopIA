// Regresión valoracion-14 / 15 / 16 — síntesis sólo con metodologías válidas,
// validada en código, y citas normativas corregidas.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { agentName: string; userContent: string; system: string };
const calls: Call[] = [];
const responses: Record<string, unknown[]> = {};
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (o: Call) => {
    calls.push({ agentName: o.agentName, userContent: o.userContent, system: o.system });
    const next = responses[o.agentName]?.shift();
    if (next === undefined || next instanceof Error) throw next ?? new Error(`${o.agentName} timeout`);
    return { json: next, meta: {} };
  }),
}));

import { orchestrateValuation } from '@/lib/agents/financial/valuation/orchestrator';
import { validateSynthesis } from '@/lib/agents/financial/valuation/validators/synthesis-validator';
import { buildMarketComparablesPrompt } from '@/lib/agents/financial/valuation/prompts/market-comparables.prompt';
import { buildValuationSynthesizerPrompt } from '@/lib/agents/financial/valuation/prompts/valuation-synthesizer.prompt';
import { ValuationSynthesisReportSchema, type ValuationSynthesisReportJson } from '@/lib/agents/financial/contracts/valuation';

const coJson = { name: 'ACME', nit: '900', fiscalPeriod: '2025', entityType: null, sector: null, niifGroup: null, comparativePeriod: null, city: null, signatories: null };
const company = { name: 'ACME', nit: '900', fiscalPeriod: '2025' } as never;
const pesos = (n: number) => String(Math.round(n * 100));

function synthJson(over: Partial<ValuationSynthesisReportJson> = {}): ValuationSynthesisReportJson {
  return {
    company: coJson as never,
    purpose: 'M&A',
    methodologyWeights: [
      { method: 'dcf', weightPercent: 50, rationale: 'x' },
      { method: 'market_comparables', weightPercent: 50, rationale: 'x' },
    ],
    consolidatedRange: { conservativeCop: pesos(1_000), baseCop: pesos(1_500), optimisticCop: pesos(2_000), confidenceLevel: 'bajo', rationale: 'x' },
    methodologyReconciliation: { dcfMidpointCop: pesos(1_400), comparablesMidpointCop: pesos(1_600), divergencePercent: 13.3, divergenceIsRedFlag: false, rationale: 'x' },
    keyAssumptions: [],
    regulatoryImplications: { art90Et: 'x', nic36OrNiif3: null, superSociedades: null },
    limitations: [],
    valueOpinion: { executiveSummary: 'resumen' },
    citations: [],
    ...over,
  };
}

/** DCF coherente (WACC 10%, g 2%) — ver dcf-validator.test.ts. */
function dcfJson() {
  const rows = [2026, 2027, 2028].map((year) => ({
    year, revenueCop: pesos(5_000_000_000), ebitdaCop: pesos(1_100_000_000), ebitCop: pesos(1_000_000_000),
    taxCop: pesos(350_000_000), depAmortCop: pesos(100_000_000), capexCop: pesos(150_000_000),
    workingCapitalChangeCop: pesos(50_000_000), fcfCop: pesos(550_000_000),
  }));
  return {
    company: coJson, projection: { rows, keyAssumptions: [] },
    wacc: {
      riskFreeBasis: 'TES_COP_ex_default', sovereignYieldPercent: 6.5, defaultSpreadPercent: 1.5, riskFreeRatePercent: 5,
      countryRiskPremiumPercent: 2, equityRiskPremiumPercent: 3, beta: 1, sizePremiumPercent: 0,
      copInflationPercent: null, usdInflationPercent: null, costOfEquityPercent: 10, costOfDebtPercent: 12,
      taxRatePercent: 35, equityWeightPercent: 100, debtWeightPercent: 0, waccPercent: 10,
      marketDataProvenance: 'supuesto', rationale: 'x',
    },
    terminalValue: { nextYearFcfCop: pesos(561_000_000), perpetualGrowthPercent: 2, waccPercent: 10, terminalValueCop: pesos(7_012_500_000), terminalValuePercentOfTotal: 79.4, rationale: 'x' },
    valuation: {
      enterpriseValueCop: '663636363637', financialDebtCop: pesos(700_000_000), cashAndEquivalentsCop: pesos(200_000_000),
      netDebtCop: pesos(500_000_000), otherBridgeAdjustmentsCop: null, equityValueCop: '613636363637',
      sharesOutstanding: null, pricePerShareCop: null,
    },
    limitations: [], citations: [],
  };
}

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(responses)) delete responses[k];
});

describe('valoracion-14 — sin metodologías válidas no hay opinión de valor', () => {
  it('si fallan DCF y Múltiplos el Sintetizador no se ejecuta y el informe declara N/D', async () => {
    const events: string[] = [];
    const rep = await orchestrateValuation(
      { financialData: 'x', company, language: 'es' },
      { onProgress: (e) => events.push(e.type) },
    );
    expect(calls.map((c) => c.agentName)).not.toContain('valuation-synthesizer');
    expect(rep.synthesis).toBeNull();
    expect(rep.valueOpinion.status).toBe('not_issued');
    expect(events).toContain('value_opinion_not_issued');
    expect(rep.consolidatedReport).toContain('Sin opinión de valor (N/D)');
    expect(rep.consolidatedReport).not.toContain('Multi-Metodologia');
    expect(rep.consolidatedReport).not.toMatch(/En nuestra opinión, el valor razonable/);
  });

  it('si sólo falla el DCF: el Sintetizador recibe JSON con DCF null, peso 0 y el informe es de metodología única', async () => {
    responses['market-comparables'] = [{
      company: coJson,
      comparableSelection: { criteria: ['CIIU'], comparables: [5, 6, 7, 9].map((m, i) => ({ name: `C${i}`, country: 'CO', source: 'BVC', sourceAsOf: '2026-06', revenueCop: null, ebitdaCop: null, evEbitda: m, pe: null, pBv: null, evRevenue: null, rationale: 'x' })), geographicNote: 'x' },
      multipleStatistics: [],
      impliedValuation: {
        targetRevenueCop: null, targetEbitdaCop: pesos(1_000_000_000), targetNetIncomeCop: null, targetBookValueCop: null, targetNetDebtCop: pesos(500_000_000),
        enterpriseValueMinCop: '0', enterpriseValueMedianCop: '0', enterpriseValueMaxCop: '0', equityValueMinCop: '0', equityValueMedianCop: '0', equityValueMaxCop: '0',
        primaryMultiple: 'ev_ebitda', primaryMultipleRationale: 'x',
      },
      adjustments: [],
      adjustedValueRange: { conservativeCop: '0', baseCop: '0', optimisticCop: '0' },
      limitations: [], citations: [],
    }];
    // El LLM insiste en 50/50 e inventa un punto medio DCF
    responses['valuation-synthesizer'] = [synthJson()];
    const rep = await orchestrateValuation({ financialData: 'x', company, language: 'es' });
    const synthCall = calls.find((c) => c.agentName === 'valuation-synthesizer')!;
    const payload = JSON.parse(synthCall.userContent.slice(synthCall.userContent.indexOf('{')));
    expect(payload.dcf.estado).toBe('no_disponible');
    expect(payload.multiplos.estado).toBe('disponible');
    expect(synthCall.userContent).not.toContain('[ERROR');
    expect(rep.valueOpinion).toMatchObject({ status: 'issued', methodologies: ['market_comparables'] });
    const c = rep.synthesis!.computed!;
    expect(c.weights).toEqual({ dcf: 0, market_comparables: 100 });
    expect(c.dcfMidpointCop).toBeNull();
    // EV/EBITDA mediana 6,5 × 1.000M − 500M = 6.000M
    expect(c.baseCop).toBe(pesos(6_000_000_000));
    expect(rep.synthesis!.valueRange).toContain('Punto medio DCF: N/D');
    expect(rep.consolidatedReport).toContain('Valoracion por Metodologia Unica');
    expect(rep.synthesis!.executiveSummary).toContain('(metodología única: Múltiplos de Mercado)');
  });

  it('los puntos medios del contrato admiten null', () => {
    const shape = ValuationSynthesisReportSchema.shape.methodologyReconciliation.shape;
    expect(shape.dcfMidpointCop.safeParse(null).success).toBe(true);
    expect(shape.comparablesMidpointCop.safeParse(null).success).toBe(true);
    expect(ValuationSynthesisReportSchema.shape.methodologyWeights.safeParse([{ method: 'dcf', weightPercent: 100, rationale: 'x' }]).success).toBe(true);
  });
});

describe('valoracion-15 — síntesis recalculada en código', () => {
  const inputs = {
    dcf: { midpointCop: pesos(10_000_000_000), lowCop: pesos(8_000_000_000), highCop: pesos(12_000_000_000) },
    comparables: { midpointCop: pesos(2_000_000_000), lowCop: pesos(1_500_000_000), highCop: pesos(2_500_000_000) },
  };

  it('pesos duplicados o que no suman 100 bloquean la opinión de valor', () => {
    const v = validateSynthesis(synthJson({
      methodologyWeights: [
        { method: 'dcf', weightPercent: 80, rationale: 'x' },
        { method: 'dcf', weightPercent: 50, rationale: 'x' },
      ],
    }), inputs);
    expect(v.status).toBe('blocked');
    if (v.status === 'blocked') expect(v.blockingErrors[0].code).toBe('invalid_weights');
  });

  it('divergencia y bandera roja recalculadas; rango invertido fuera de las metodologías se ordena y acota', () => {
    const v = validateSynthesis(synthJson({
      methodologyWeights: [
        { method: 'dcf', weightPercent: 60, rationale: 'x' },
        { method: 'market_comparables', weightPercent: 40, rationale: 'x' },
      ],
      consolidatedRange: { conservativeCop: pesos(50_000_000_000), baseCop: pesos(40_000_000_000), optimisticCop: pesos(30_000_000_000), confidenceLevel: 'alto', rationale: 'x' },
      methodologyReconciliation: { dcfMidpointCop: pesos(10_000_000_000), comparablesMidpointCop: pesos(2_000_000_000), divergencePercent: 10, divergenceIsRedFlag: false, rationale: 'x' },
    }), inputs);
    if (v.status !== 'ok') throw new Error('esperaba ok');
    const c = v.computed;
    // |10 − 2| / 6 = 133,3%
    expect(c.divergencePercent).toBe(133.3);
    expect(c.divergenceIsRedFlag).toBe(true);
    // base = 0,6 × 10.000M + 0,4 × 2.000M = 6.800M
    expect(c.baseCop).toBe(pesos(6_800_000_000));
    // LLM: 50.000M / 30.000M ⇒ ordenado 30.000M–50.000M ⇒ acotado a [base, máx 12.000M]
    expect(c.conservativeCop).toBe(pesos(6_800_000_000));
    expect(c.optimisticCop).toBe(pesos(12_000_000_000));
    const [lo, mid, hi] = [c.conservativeCop, c.baseCop, c.optimisticCop].map(BigInt);
    expect(lo <= mid && mid <= hi).toBe(true);
    expect(BigInt(c.boundsLowCop) <= lo && hi <= BigInt(c.boundsHighCop)).toBe(true);
    expect(v.discrepancies.map((d) => d.field)).toEqual(expect.arrayContaining(['Divergencia', 'Bandera roja (divergencia > 50%)', 'Conservador (piso)', 'Optimista (techo)']));
  });

  it('con sólo el DCF válido el informe usa las cifras recalculadas y redacta la opinión en código', async () => {
    responses['dcf-modeler'] = [dcfJson()];
    responses['market-comparables'] = [new Error('timeout')];
    responses['valuation-synthesizer'] = [synthJson({ methodologyWeights: [{ method: 'dcf', weightPercent: 100, rationale: 'x' }] })];
    const rep = await orchestrateValuation({ financialData: 'x', company, language: 'es' });
    expect(rep.valueOpinion.methodologies).toEqual(['dcf']);
    expect(rep.synthesis!.computed!.baseCop).toBe('613636363637');
    expect(rep.synthesis!.executiveSummary).toContain('con punto medio $6.136.363.636,37');
  });
});

describe('valoracion-16 — citas normativas', () => {
  it('se retira la Circular 115-000011/2008 y el Art. 90 E.T. se describe por tipo de activo', () => {
    const mc = buildMarketComparablesPrompt(company, 'es', 'venta de acciones');
    const sy = buildValuationSynthesizerPrompt(company, 'es', 'venta de acciones');
    for (const p of [mc, sy]) {
      expect(p).not.toContain('115-000011');
      expect(p).not.toContain('al menos dos metodologías');
      expect(p).not.toContain('valor catastral/patrimonial ajustado');
      expect(p).toContain('valor intrínseco incrementado en un 30%');
      expect(p).toContain('avalúo catastral');
    }
    expect(sy).toContain('valor intrínseco × 1,3');
    const desc = ValuationSynthesisReportSchema.shape.regulatoryImplications.shape.superSociedades.description ?? '';
    expect(desc).not.toContain('115-000011');
  });
});
