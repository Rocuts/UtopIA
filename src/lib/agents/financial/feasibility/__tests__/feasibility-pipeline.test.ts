// Regresión valoracion-09 / 10 — datos del usuario llegan a los tres agentes,
// métricas y matriz de riesgo en código, sin Monte Carlo afirmado.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ agentName: string; userContent: string; system: string }> = [];
const agentQueue: unknown[] = [];
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (opts: { agentName: string; userContent: string; system: string }) => {
    calls.push({ agentName: opts.agentName, userContent: opts.userContent, system: opts.system });
    return { json: agentQueue.shift(), meta: {} };
  }),
}));

import { orchestrateFeasibilityStudy } from '@/lib/agents/financial/feasibility/orchestrator';
import { buildRiskAssessorPrompt } from '@/lib/agents/financial/feasibility/prompts/risk-assessor.prompt';
import { RiskAssessmentReportSchema, FinancialModelReportSchema } from '@/lib/agents/financial/contracts/feasibility';

const pesos = (n: number) => String(Math.round(n * 100));
const SECRET = 'PRECIO_UNITARIO_COTIZADO=$18.500; COSTO_VARIABLE=$11.200; CAPACIDAD=40.000 u/año';
const INSTR = 'USAR TASA DE DESCUENTO 16%';

const market = { marketSize: 'm', targetSegment: 't', competitiveLandscape: 'c', demandProjections: 'd', entryBarriers: 'e' };

function modelJson(over: Record<string, unknown> = {}) {
  return {
    proFormaStatements: 'p',
    capitalStructure: 'c',
    wacc: {
      riskFreeBasis: 'TES_COP_ex_default', sovereignYieldPercent: 13, defaultSpreadPercent: 2, riskFreeRatePercent: 11,
      countryRiskPremiumPercent: 2, equityRiskPremiumPercent: 5, beta: 1, sizePremiumPercent: 0,
      copInflationPercent: null, usdInflationPercent: null, costOfEquityPercent: 18, costOfDebtPercent: 14,
      taxRatePercent: 35, equityWeightPercent: 60, debtWeightPercent: 40, waccPercent: 14.44,
      marketDataProvenance: 'supuesto', rationale: 'x',
    },
    discountRateSource: 'tasa_indicada_por_usuario',
    discountRatePercent: 16,
    initialInvestmentCop: pesos(1_000_000_000),
    cashFlows: [1, 2, 3, 4, 5].map((year) => ({ year, freeCashFlowCop: pesos(350_000_000) })),
    breakEvenInputs: { fixedCostsCop: pesos(400_000_000), unitPriceCop: pesos(18_500), unitVariableCostCop: pesos(11_200) },
    // el LLM escribe un VPN inventado en prosa
    projectEvaluation: 'VPN 9.999 millones',
    sensitivityAnalysis: 's',
    breakEvenAnalysis: 'b',
    ...over,
  };
}

function riskJson(over: Record<string, unknown> = {}) {
  return {
    riskMatrix: [
      { category: 'mercado', description: 'x', probability: 1, impact: 1, mitigation: '', normReference: null },
      { category: 'financiero', description: 'y', probability: 4, impact: 4, mitigation: '', normReference: null },
    ],
    riskAdjustedNpv: 'Monte Carlo 10.000 iteraciones: P(VPN<0)=12%',
    riskAdjustedDiscountRatePercent: 20,
    mitigationStrategies: 'x', insuranceRecommendations: 'x',
    goNoGoDecision: 'go', goNoGoRationale: 'x', executiveSummary: 'x',
    ...over,
  };
}

const project = { projectName: 'Planta', description: 'd', sector: 'Manufactura', estimatedInvestment: 1_000_000_000 };

beforeEach(() => { calls.length = 0; agentQueue.length = 0; });

describe('valoracion-09 — datos del usuario y métricas en código', () => {
  it('projectData e instrucciones llegan al Modelador Financiero y al Evaluador de Riesgos', async () => {
    agentQueue.push(market, modelJson(), riskJson());
    await orchestrateFeasibilityStudy({ projectData: SECRET, project, language: 'es', instructions: INSTR });
    const byAgent = Object.fromEntries(calls.map((x) => [x.agentName, x]));
    expect(byAgent['financial-modeler'].userContent).toContain(SECRET);
    expect(byAgent['financial-modeler'].userContent).toContain(INSTR);
    expect(byAgent['risk-assessor'].userContent).toContain(SECRET);
    expect(byAgent['risk-assessor'].userContent).toContain(INSTR);
    expect(byAgent['risk-assessor'].userContent).toContain('METRICAS CALCULADAS EN CODIGO');
  });

  it('VPN/TIR/payback/IR y punto de equilibrio se calculan en código con la tasa indicada por el usuario', async () => {
    agentQueue.push(market, modelJson(), riskJson());
    const rep = await orchestrateFeasibilityStudy({ projectData: SECRET, project, language: 'es', instructions: INSTR });
    const fm = rep.financialModel;
    expect(fm.discountRate).toEqual({ percent: 16, source: 'tasa_usuario' });
    // 350M × anualidad(16%, 5) = 350M × 3,274294 ≈ 1.146,0M ⇒ VPN ≈ 146,0M
    const npv = Number(BigInt(fm.metrics!.npvCop)) / 100;
    expect(npv).toBeGreaterThan(146_000_000);
    expect(npv).toBeLessThan(146_010_000);
    expect(fm.metrics!.irrPercent).toBeCloseTo(22.11, 1);
    expect(fm.projectEvaluation).toContain('Métricas calculadas en código');
    expect(fm.breakEven.status).toBe('ok');
    expect(fm.breakEvenAnalysis).toContain('calculado en código');
    expect(FinancialModelReportSchema.shape.cashFlows).toBeDefined();
    // La ruta API serializa el informe con NextResponse.json: sin BigInt.
    expect(() => JSON.stringify(rep)).not.toThrow();
  });

  it('una tasa "del usuario" que no aparece en sus datos se reemplaza por el WACC recalculado', async () => {
    agentQueue.push(market, modelJson({ discountRatePercent: 9 }), riskJson());
    const rep = await orchestrateFeasibilityStudy({ projectData: SECRET, project, language: 'es', instructions: INSTR });
    // Ke = 11 + 5 + 2 = 18; WACC = 0,6 × 18 + 0,4 × 14 × 0,65 = 14,44
    expect(rep.financialModel.discountRate).toEqual({ percent: 14.44, source: 'wacc_recalculado' });
  });

  it('WACC con doble conteo del riesgo país ⇒ métricas N/D y decisión no determinable', async () => {
    agentQueue.push(
      market,
      modelJson({
        discountRateSource: 'wacc_calculado',
        wacc: { ...modelJson().wacc as object, sovereignYieldPercent: null, defaultSpreadPercent: null, riskFreeRatePercent: 13 },
      }),
      riskJson(),
    );
    const rep = await orchestrateFeasibilityStudy({ projectData: SECRET, project, language: 'es' });
    expect(rep.financialModel.metrics).toBeNull();
    expect(rep.financialModel.projectEvaluation).toContain('VPN / TIR / TIRM / payback / IR: N/D');
    expect(rep.riskAssessment.decision).toBe('no_determinable');
  });
});

describe('valoracion-10 — matriz de riesgo y decisión deterministas, sin Monte Carlo', () => {
  it('score = P × I y clasificación derivados en código; crítico sin mitigación ⇒ NO-GO', async () => {
    agentQueue.push(market, modelJson(), riskJson());
    const rep = await orchestrateFeasibilityStudy({ projectData: SECRET, project, language: 'es', instructions: INSTR });
    expect(rep.riskAssessment.riskMatrix).toContain('| 1 | mercado | x | 1 | 1 | 1 | bajo |');
    expect(rep.riskAssessment.riskMatrix).toContain('| 2 | financiero | y | 4 | 4 | 16 | critico |');
    expect(rep.riskAssessment.decision).toBe('no_go');
    expect(rep.riskAssessment.goNoGoRecommendation).toContain('**Decision:** NO-GO');
    expect(rep.riskAssessment.decisionOverrides.join(' ')).toContain('sin mitigación');
  });

  it('"go" con riesgo alto mitigado ⇒ GO CON CONDICIONES; VPN < 0 ⇒ NO-GO', async () => {
    agentQueue.push(market, modelJson(), riskJson({
      riskMatrix: [{ category: 'financiero', description: 'y', probability: 3, impact: 4, mitigation: 'cobertura', normReference: null }],
    }));
    const rep = await orchestrateFeasibilityStudy({ projectData: SECRET, project, language: 'es', instructions: INSTR });
    expect(rep.riskAssessment.decision).toBe('go_con_condiciones');

    agentQueue.push(market, modelJson({ cashFlows: [1, 2, 3, 4, 5].map((year) => ({ year, freeCashFlowCop: pesos(100_000_000) })) }), riskJson({ riskMatrix: [] }));
    const neg = await orchestrateFeasibilityStudy({ projectData: SECRET, project, language: 'es', instructions: INSTR });
    expect(neg.riskAssessment.decision).toBe('no_go');
  });

  it('VPN ajustado por riesgo recalculado en código; referencias a Monte Carlo rotuladas como no ejecutadas', async () => {
    agentQueue.push(market, modelJson(), riskJson());
    const rep = await orchestrateFeasibilityStudy({ projectData: SECRET, project, language: 'es', instructions: INSTR });
    expect(rep.riskAssessment.riskAdjustedNpv).toContain('VPN ajustado por riesgo (calculado en código)');
    expect(rep.riskAssessment.riskAdjustedNpv).toContain('@ 20.00%');
    expect(rep.riskAssessment.riskAdjustedNpv).toContain('no se ejecutó ninguna simulación Monte Carlo');
  });

  it('el prompt ya no pide iteraciones ≥ 10.000 ni P(VPN<0); el schema no acepta score del LLM', () => {
    const p = buildRiskAssessorPrompt({ projectName: 'P', description: 'd', sector: 's' }, 'es');
    expect(p).not.toContain('iteraciones >=10.000');
    expect(p).not.toContain('probabilidad VPN<0');
    expect(p).toContain('NEVER afirmes simulaciones');
    expect('score' in RiskAssessmentReportSchema.shape.riskMatrix.element.shape).toBe(false);
  });
});
