// Regresiones del Strategy Director (auditoría 2026-09):
//   valoracion-11 — el renderer perdía el signo del saldo final de caja del
//                   año +3, de los KPI en COP y del punto de equilibrio.
//   valoracion-12 — la puerta de liquidez (AC < PC), el punto de equilibrio y
//                   la aritmética de los escenarios quedaban al criterio del LLM.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queue: unknown[] = [];
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async () => ({ json: queue.shift(), meta: {} })),
}));

import { runStrategyDirector } from '../strategy-director';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

const c = (pesos: number) => String(Math.round(pesos * 100));
const M = 1_000_000;

function strategyJson(over: Record<string, unknown> = {}) {
  return {
    company: { name: 'ACME', nit: '900', fiscalPeriod: '2025', entityType: null, sector: null, niifGroup: null, comparativePeriod: null, city: null, signatories: null },
    reportMode: 'LINEA_BASE',
    executiveDashboard: { rows: [{ label: 'Total Activo', primary: c(1000), comparative: null, variation: null, variationPct: null, commentary: 'x' }], executiveCommentary: 'x' },
    technicalAlerts: [],
    kpis: [{ category: 'liquidity', name: 'Capital de trabajo', formula: 'AC − PC', resultPrimary: c(-250 * M), resultComparative: null, unit: 'cop', benchmarkBand: { description: '> 0', lowerBound: '0', upperBound: null }, diagnosis: 'x', yoyVariation: null, confidence: null, anomalyFlag: null, presentationMode: null, baselineLabel: null, sparklinePoints: null }],
    dupontAnalysis: null,
    trends: null,
    breakEven: {
      fixedCostsCop: c(400 * M), variableCostsCop: c(600 * M), revenueCop: c(1_000 * M),
      breakEvenPointCop: c(800 * M), marginOfSafetyPct: '20', classificationNote: 'CF: arriendos',
    },
    projectedCashFlow: {
      liquidityGate: { triggered: false, currentAssetsCop: c(500 * M), currentLiabilitiesCop: c(300 * M), gapCop: c(200 * M), message: null },
      initialCashBalanceCop: c(50 * M), dsoDays: '45', inflationIndexPct: '4',
      scenarios: [{
        scenario: 'conservative', assumptions: 'ingresos −15%',
        lines: [
          { concept: 'Flujo de Caja Neto del Periodo', currentYear: c(0), yearPlus1: c(-100 * M), yearPlus2: c(-100 * M), yearPlus3: c(-100 * M), isSubtotal: true },
          { concept: 'Saldo Final de Caja', currentYear: c(50 * M), yearPlus1: c(-50 * M), yearPlus2: c(-150 * M), yearPlus3: c(-250 * M), isSubtotal: true },
        ],
        finalCashBalanceYear3: c(-250 * M),
      }],
      solvencyNarrative: 'x', controlKpis: [], assumptionsNote: 'x',
    },
    recommendations: [],
    presumedCostWarning: null,
    preparerNotes: [],
    ...over,
  };
}

const run = (pre?: PreprocessedBalance) =>
  runStrategyDirector({ fullContent: 'niif' } as never, { name: 'ACME', nit: '900', fiscalPeriod: '2025' } as never, 'es', undefined, 'TOTALES', pre);

beforeEach(() => { queue.length = 0; });

describe('valoracion-11 — signos en el Markdown del Strategy Director', () => {
  it('saldo final negativo del año +3, KPI COP y tabla conservan el signo', async () => {
    queue.push(strategyJson());
    const res = await run();
    expect(res.projectedCashFlow).toContain('- Saldo Final Año +3: ($250.000.000,00)');
    expect(res.kpiDashboard).toContain('| liquidity | Capital de trabajo | AC − PC | ($250.000.000,00) |');
  });
});

describe('valoracion-12 — gate, punto de equilibrio y conciliación deterministas', () => {
  it('AC < PC con triggered=false del LLM: el gate se recalcula y la proyección se bloquea', async () => {
    const json = strategyJson();
    json.projectedCashFlow = {
      ...json.projectedCashFlow,
      liquidityGate: { triggered: false, currentAssetsCop: c(100 * M), currentLiabilitiesCop: c(300 * M), gapCop: c(-200 * M), message: null },
    };
    queue.push(json);
    const res = await run();
    expect(res.projectedCashFlow).not.toContain('AC ≥ PC: proyección habilitada.');
    expect(res.projectedCashFlow).toContain('ALERTA DE LIQUIDEZ: AC ($100.000.000,00) < PC ($300.000.000,00)');
    expect(res.json?.projectedCashFlow.liquidityGate.triggered).toBe(true);
    expect(res.json?.projectedCashFlow.scenarios).toEqual([]);
  });

  it('el gate usa AC/PC vinculantes del preprocesado, no los del LLM', async () => {
    queue.push(strategyJson()); // el LLM dice AC 500M ≥ PC 300M
    const pre = { primary: { period: '2025', controlTotals: { activoCorriente: 120 * M, pasivoCorriente: 300 * M, efectivoCuenta11: 50 * M } } } as unknown as PreprocessedBalance;
    const res = await run(pre);
    expect(res.json?.projectedCashFlow.liquidityGate).toMatchObject({
      triggered: true, currentAssetsCop: c(120 * M), currentLiabilitiesCop: c(300 * M), gapCop: c(-180 * M),
    });
  });

  it('margen de contribución ≤ 0: el punto de equilibrio no existe → N/D, sin margen de seguridad', async () => {
    const json = strategyJson();
    json.breakEven = { ...json.breakEven, variableCostsCop: c(1_200 * M), breakEvenPointCop: c(-2_000 * M), marginOfSafetyPct: '300' };
    queue.push(json);
    const res = await run();
    expect(res.breakEvenAnalysis).toContain('**Punto de Equilibrio**: N/D');
    expect(res.breakEvenAnalysis).toContain('**Margen de Seguridad**: N/D');
    expect(res.breakEvenAnalysis).not.toContain('300%');
    expect(res.json?.breakEven.marginOfSafetyPct).toBe('ND');
  });

  it('PE = CF / (1 − CV/I) se recalcula en código y sobrescribe la cifra del LLM', async () => {
    queue.push(strategyJson()); // CF 400M, CV 600M, I 1.000M → PE 1.000M; el LLM dijo 800M
    const res = await run();
    expect(res.json?.breakEven.breakEvenPointCop).toBe(c(1_000 * M));
    expect(res.breakEvenAnalysis).toContain('**Punto de Equilibrio**: $1.000.000.000,00');
    expect(res.breakEvenAnalysis).toContain('**Margen de Seguridad**: 0,00%');
  });

  it('el resumen del escenario sale de la tabla y una tabla que no concilia se rotula', async () => {
    const json = strategyJson();
    const sc = json.projectedCashFlow.scenarios[0];
    sc.finalCashBalanceYear3 = c(999 * M); // resumen distinto de la tabla
    sc.lines[1].yearPlus2 = c(-140 * M); // −50 − 100 ≠ −140
    queue.push(json);
    const res = await run();
    expect(res.json?.projectedCashFlow.scenarios[0].finalCashBalanceYear3).toBe(c(-250 * M));
    expect(res.projectedCashFlow).toContain('- Saldo Final Año +3: ($250.000.000,00)');
    expect(res.projectedCashFlow).toMatch(/⚠ .*no concilia.*Año \+2/);
  });
});
