// Regresión valoracion-06 / 07 / 08 — el DCF se recalcula en código tras el LLM.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const agentQueue: unknown[] = [];
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async () => ({ json: agentQueue.shift(), meta: {} })),
}));

import { runDcfModeler } from '@/lib/agents/financial/valuation/agents/dcf-modeler';
import { validateDcf } from '@/lib/agents/financial/valuation/validators/dcf-validator';
import { buildDcfModelerPrompt } from '@/lib/agents/financial/valuation/prompts/dcf-modeler.prompt';
import { DcfModelReportSchema, type DcfModelReportJson } from '@/lib/agents/financial/contracts/valuation';

const company = { name: 'ACME SAS', nit: '900123456-7', fiscalPeriod: '2025' } as never;
const pesos = (n: number) => String(Math.round(n * 100)); // → centavos MoneyCop

type Overrides = {
  wacc?: Partial<DcfModelReportJson['wacc']>;
  terminalValue?: Partial<DcfModelReportJson['terminalValue']>;
  valuation?: Partial<DcfModelReportJson['valuation']>;
  years?: number[];
};

/**
 * JSON "LLM": supuestos coherentes (Rf 5 = TES 6,5 − 1,5; β 1; ERP 3; CRP 2 ⇒
 * Ke 10%; E/V 100 ⇒ WACC 10%; g 2%), pero cifras derivadas erróneas.
 */
function llmDcf(o: Overrides = {}): DcfModelReportJson {
  const years = o.years ?? [2026, 2027, 2028];
  const rows = years.map((year) => ({
    year,
    revenueCop: pesos(5_000_000_000),
    ebitdaCop: pesos(1_100_000_000),
    ebitCop: pesos(1_000_000_000),
    taxCop: pesos(350_000_000),
    depAmortCop: pesos(100_000_000),
    capexCop: pesos(150_000_000),
    workingCapitalChangeCop: pesos(50_000_000),
    // correcto = 1.000M × 65% + 100M − 150M − 50M = 550M; el LLM reporta 700M
    fcfCop: pesos(700_000_000),
  }));
  return {
    company: { name: 'ACME SAS', nit: '900123456-7', fiscalPeriod: '2025', entityType: null, sector: null, city: null, comparativePeriod: null, niifGroup: null, signatories: null } as never,
    projection: { rows, keyAssumptions: ['Crecimiento 0%'] },
    wacc: {
      riskFreeBasis: 'TES_COP_ex_default',
      sovereignYieldPercent: 6.5,
      defaultSpreadPercent: 1.5,
      riskFreeRatePercent: 5,
      countryRiskPremiumPercent: 2,
      equityRiskPremiumPercent: 3,
      beta: 1,
      sizePremiumPercent: 0,
      copInflationPercent: null,
      usdInflationPercent: null,
      costOfEquityPercent: 18, // recalculado: 10
      costOfDebtPercent: 12,
      taxRatePercent: 35,
      equityWeightPercent: 100,
      debtWeightPercent: 0,
      waccPercent: 12, // recalculado: 10
      marketDataProvenance: 'supuesto de prueba',
      rationale: 'x',
      ...o.wacc,
    },
    terminalValue: {
      nextYearFcfCop: pesos(700_000_000),
      perpetualGrowthPercent: 2,
      waccPercent: 12,
      terminalValueCop: pesos(20_000_000_000),
      terminalValuePercentOfTotal: 60,
      rationale: 'x',
      ...o.terminalValue,
    },
    valuation: {
      enterpriseValueCop: pesos(25_000_000_000),
      financialDebtCop: pesos(700_000_000),
      cashAndEquivalentsCop: pesos(200_000_000),
      netDebtCop: pesos(500_000_000),
      otherBridgeAdjustmentsCop: null,
      // "EV − Deuda Neta + Caja" ⇒ 25.000 − 500 + 200 (caja sumada dos veces)
      equityValueCop: pesos(24_700_000_000),
      sharesOutstanding: null,
      pricePerShareCop: null,
      ...o.valuation,
    },
    limitations: [],
    citations: ['NIIF 13'],
  };
}

beforeEach(() => { agentQueue.length = 0; });

describe('valoracion-06 — validador determinista del DCF', () => {
  it('recalcula FCF, WACC, TV, EV y puente con BigInt exacto', () => {
    const json = llmDcf();
    expect(DcfModelReportSchema.safeParse(json).success).toBe(true);
    const v = validateDcf(json);
    expect(v.status).toBe('ok');
    if (v.status !== 'ok') return;
    const c = v.computed;
    expect(c.wacc.costOfEquityPercent).toBe(10);
    expect(c.wacc.waccPercent).toBe(10);
    expect(c.rows.map((r) => r.fcfCop)).toEqual([pesos(550_000_000), pesos(550_000_000), pesos(550_000_000)]);
    expect(c.rows.map((r) => r.taxCop)).toEqual([pesos(350_000_000), pesos(350_000_000), pesos(350_000_000)]);
    // VP: 550M/1,1 ; 550M/1,21 ; 550M/1,331 (centavos, half-up)
    expect(c.rows.map((r) => r.pvFcfCop)).toEqual(['50000000000', '45454545455', '41322314050']);
    // FCF(n+1) = 550M × 1,02 ; TV = 561M / 8% ; VP(TV) = TV / 1,331
    expect(c.nextYearFcfCop).toBe(pesos(561_000_000));
    expect(c.terminalValueCop).toBe(pesos(7_012_500_000));
    expect(c.pvTerminalValueCop).toBe('526859504132');
    // EV = Σ VP + VP(TV), identidad exacta en centavos
    expect(c.enterpriseValueCop).toBe(String(50000000000 + 45454545455 + 41322314050 + 526859504132));
    expect(BigInt(c.enterpriseValueCop)).toBe(BigInt(c.sumPvFcfCop) + BigInt(c.pvTerminalValueCop));
    // TV/EV real ≈ 79,4% ⇒ bandera de dependencia (el LLM declaró 60%)
    expect(c.terminalValuePercentOfEv).toBeGreaterThan(75);
    const fields = v.discrepancies.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['Ke', 'WACC', 'FCF 2026', 'FCF(n+1)', 'TV', 'Enterprise Value', 'Equity Value', 'VP(TV) / EV']));
  });

  it('g ≥ WACC recalculado bloquea el DCF (Gordon no definido) aunque el LLM declare otro WACC', async () => {
    const json = llmDcf({ terminalValue: { perpetualGrowthPercent: 11, waccPercent: 12 } });
    const v = validateDcf(json);
    expect(v.status).toBe('blocked');
    if (v.status === 'blocked') expect(v.blockingErrors.map((e) => e.code)).toContain('growth_not_below_wacc');

    agentQueue.push(json);
    const res = await runDcfModeler('datos', company, 'es');
    expect(res.status).toBe('blocked');
    expect(res.computed).toBeNull();
    expect(res.fullContent).toContain('DCF NO EMITIBLE');
    expect(res.fullContent).not.toContain('Equity Value');
    expect(res.blockingReasons.join(' ')).toMatch(/g \(11\.00%\) ≥ WACC recalculado \(10\.00%\)/);
  });

  it('años no consecutivos o E/V + D/V ≠ 100 bloquean', () => {
    const gap = validateDcf(llmDcf({ years: [2026, 2028, 2029] }));
    expect(gap.status).toBe('blocked');
    const weights = validateDcf(llmDcf({ wacc: { equityWeightPercent: 60, debtWeightPercent: 30 } }));
    expect(weights.status).toBe('blocked');
    if (weights.status === 'blocked') expect(weights.blockingErrors[0].code).toBe('capital_weights_invalid');
  });

  it('la sensibilidad WACC × g se calcula en código; celdas con g ≥ WACC quedan N/A', () => {
    const v = validateDcf(llmDcf());
    if (v.status !== 'ok') throw new Error('esperaba ok');
    const s = v.computed.sensitivity;
    expect(s.waccs).toEqual([8, 9, 10, 11, 12]);
    expect(s.growths).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(s.cells).toHaveLength(25);
    const base = s.cells.find((c) => c.waccPercent === 10 && c.growthPercent === 2);
    expect(base?.enterpriseValueCop).toBe(v.computed.enterpriseValueCop);
    // EV decrece con el WACC y crece con g
    const at = (w: number, g: number) => BigInt(s.cells.find((c) => c.waccPercent === w && c.growthPercent === g)!.enterpriseValueCop!);
    expect(at(8, 2) > at(12, 2)).toBe(true);
    expect(at(10, 3) > at(10, 1)).toBe(true);
    expect(BigInt(v.computed.equityRange.lowCop) <= BigInt(v.computed.equityValueCop)).toBe(true);
    expect(BigInt(v.computed.equityRange.highCop) >= BigInt(v.computed.equityValueCop)).toBe(true);
  });

  it('el renderer publica las cifras recalculadas y lista las discrepancias del LLM', async () => {
    agentQueue.push(llmDcf());
    const res = await runDcfModeler('datos', company, 'es');
    expect(res.status).toBe('ok');
    expect(res.cashFlowProjections).toContain('$550.000.000,00');
    expect(res.cashFlowProjections).not.toContain('$700.000.000,00');
    expect(res.waccCalculation).toContain('| **WACC** | **10.00%** |');
    expect(res.terminalValue).toContain('dependencia excesiva');
    expect(res.sensitivityAnalysis).toContain('calculado en código');
    expect(res.validationReport).toContain('| FCF 2026 | $700.000.000,00 | $550.000.000,00 |');
    expect(res.fullContent).toContain('## 6. VALIDACIÓN DETERMINISTA');
  });
});

describe('valoracion-07 — CAPM sin doble conteo del riesgo país', () => {
  it('base TES COP con CRP > 0 sin diferencial soberano se bloquea', () => {
    const v = validateDcf(llmDcf({ wacc: { sovereignYieldPercent: null, defaultSpreadPercent: null, riskFreeRatePercent: 12.5 } }));
    expect(v.status).toBe('blocked');
    if (v.status === 'blocked') expect(v.blockingErrors.map((e) => e.code)).toContain('country_risk_double_count');
  });

  it('Rf = TES − diferencial soberano se recalcula y reemplaza el Rf declarado', () => {
    const v = validateDcf(llmDcf({ wacc: { riskFreeRatePercent: 6.5 } }));
    if (v.status !== 'ok') throw new Error('esperaba ok');
    expect(v.computed.wacc.riskFreeRatePercent).toBe(5);
    expect(v.discrepancies.find((d) => d.field === 'Rf')).toEqual({ field: 'Rf', reported: '6.50%', recomputed: '5.00%' });
  });

  it('base UST USD convierte Ke a COP por Fisher y exige las inflaciones', () => {
    const usd = {
      riskFreeBasis: 'UST_USD_fisher' as const,
      sovereignYieldPercent: null,
      defaultSpreadPercent: null,
      riskFreeRatePercent: 4,
      countryRiskPremiumPercent: 2,
      equityRiskPremiumPercent: 5,
      beta: 1,
      sizePremiumPercent: 0,
    };
    const missing = validateDcf(llmDcf({ wacc: { ...usd, copInflationPercent: null, usdInflationPercent: null } }));
    expect(missing.status).toBe('blocked');
    const ok = validateDcf(llmDcf({ wacc: { ...usd, copInflationPercent: 5, usdInflationPercent: 2 } }));
    if (ok.status !== 'ok') throw new Error('esperaba ok');
    // Ke USD 11% ⇒ Ke COP = 1,11 × 1,05 / 1,02 − 1 = 14,2647%
    expect(ok.computed.wacc.costOfEquityUsdPercent).toBe(11);
    expect(ok.computed.wacc.costOfEquityPercent).toBeCloseTo(14.2647, 4);
  });

  it('el prompt ya no define Rf = TES completo + EMBI ni fija rangos de mercado', () => {
    const p = buildDcfModelerPrompt(company, 'es');
    expect(p).not.toContain('TES 10 años Colombia: ~12-13%');
    expect(p).not.toContain('Ke (CAPM) = Rf + Beta × (Rm − Rf) + CRP + SP');
    expect(p).toContain('Rf = TES 10Y COP − diferencial soberano');
    expect(p).toContain('UST_USD_fisher');
    expect(DcfModelReportSchema.shape.wacc.shape.riskFreeBasis.options).toEqual(['TES_COP_ex_default', 'UST_USD_fisher']);
  });
});

describe('valoracion-08 — puente EV → patrimonio sin doble suma de caja', () => {
  it('Equity = EV − (deuda − caja); la cifra del LLM "EV − DN + Caja" queda como discrepancia', () => {
    const v = validateDcf(llmDcf());
    if (v.status !== 'ok') throw new Error('esperaba ok');
    const ev = BigInt(v.computed.enterpriseValueCop);
    expect(v.computed.netDebtCop).toBe(pesos(500_000_000));
    expect(BigInt(v.computed.equityValueCop)).toBe(ev - BigInt(pesos(500_000_000)));
  });

  it('deuda neta declarada incoherente con deuda − caja se reemplaza', () => {
    const v = validateDcf(llmDcf({ valuation: { netDebtCop: pesos(300_000_000) } }));
    if (v.status !== 'ok') throw new Error('esperaba ok');
    expect(v.computed.netDebtCop).toBe(pesos(500_000_000));
    expect(v.discrepancies.map((d) => d.field)).toContain('Deuda neta');
  });

  it('precio por acción sólo con número de acciones', () => {
    const v = validateDcf(llmDcf({ valuation: { sharesOutstanding: 1000, pricePerShareCop: pesos(1) } }));
    if (v.status !== 'ok') throw new Error('esperaba ok');
    expect(BigInt(v.computed.pricePerShareCop!)).toBe((BigInt(v.computed.equityValueCop) * BigInt(2) + BigInt(1000)) / BigInt(2000));
    const noShares = validateDcf(llmDcf({ valuation: { pricePerShareCop: pesos(1) } }));
    if (noShares.status !== 'ok') throw new Error('esperaba ok');
    expect(noShares.computed.pricePerShareCop).toBeNull();
  });

  it('prompt y schema ya no dicen "EV − Deuda Neta + Caja"', () => {
    const p = buildDcfModelerPrompt(company, 'es');
    expect(p).not.toContain('Equity Value = EV − Deuda Neta + Caja');
    expect(p).toContain('Equity Value = EV − Deuda Neta');
    const desc = DcfModelReportSchema.shape.valuation.shape.equityValueCop.description ?? '';
    expect(desc).not.toContain('+ Caja');
    expect(desc).toContain('NO se suma otra vez');
  });
});
