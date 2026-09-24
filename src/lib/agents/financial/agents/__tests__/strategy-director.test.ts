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
import { callFinancialAgent } from '@/lib/agents/financial/agents/runtime';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

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
    // Pendiente #2 (auditoría integral 2026-09-24): sin preprocesado el KPI no
    // tiene base determinista y se publica N/D, no la cifra del modelo.
    expect(res.kpiDashboard).toContain('| liquidity | Capital de trabajo | Capital de trabajo: sin fórmula determinista | ND |');
    expect(res.kpiDashboard).not.toContain('($250.000.000,00)');

    // Con preprocesado el capital de trabajo se recalcula (AC − PC) y conserva el signo.
    queue.push(strategyJson());
    const pre = {
      primary: {
        period: '2025',
        controlTotals: { activoCorriente: 50 * M, pasivoCorriente: 300 * M, capitalTrabajo: -250 * M, efectivoCuenta11: 50 * M },
      },
    } as unknown as PreprocessedBalance;
    const withPre = await run(pre);
    expect(withPre.kpiDashboard).toContain(
      '| liquidity | Capital de trabajo | Activo corriente − Pasivo corriente — calculado por el sistema | ($250.000.000,00) |',
    );
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
    // El JSON tampoco conserva la cifra del LLM: "el PE no existe" es null.
    expect(res.json?.breakEven.breakEvenPointCop).toBeNull();
  });

  it('sin ingresos el PE es null en el JSON (no la cifra que emitió el LLM)', async () => {
    const json = strategyJson();
    json.breakEven = { ...json.breakEven, revenueCop: c(0), breakEvenPointCop: c(123 * M) };
    queue.push(json);
    const res = await run();
    expect(res.json?.breakEven.breakEvenPointCop).toBeNull();
    expect(res.breakEvenAnalysis).toContain('**Punto de Equilibrio**: N/D (sin ingresos del periodo');
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

describe('pipeline-flujo-15 — degradación visible del Director de Estrategia', () => {
  it('onDegraded se registra: aviso en el cuerpo, campo degraded y progreso visible', async () => {
    const json = strategyJson();
    vi.mocked(callFinancialAgent).mockImplementationOnce((async (opts: {
      agentName: string;
      onDegraded?: (i: { agentName: string; requestedEffort: string; message: string }) => void;
    }) => {
      opts.onDegraded?.({ agentName: opts.agentName, requestedEffort: 'medium', message: 'Estrategia regenerada con esfuerzo bajo.' });
      return { json, meta: { degraded: true } };
    }) as never);
    const events: unknown[] = [];
    const res = await runStrategyDirector(
      { fullContent: 'niif' } as never, { name: 'ACME', nit: '900', fiscalPeriod: '2025' } as never,
      'es', undefined, 'TOTALES', undefined, (e) => events.push(e),
    );
    expect(res.degraded).toBe(true);
    expect(res.fullContent.startsWith('> **SECCIÓN GENERADA CON RAZONAMIENTO REDUCIDO**')).toBe(true);
    expect(res.kpiDashboard).toContain('RAZONAMIENTO REDUCIDO');
    expect(events).toContainEqual({ type: 'stage_progress', stage: 2, detail: 'Estrategia regenerada con esfuerzo bajo.' });
  });

  it('sin degradación no hay aviso ni campo degraded', async () => {
    queue.push(strategyJson());
    const res = await run();
    expect(res.degraded).toBeUndefined();
    expect(res.fullContent).not.toContain('RAZONAMIENTO REDUCIDO');
  });
});

// ---------------------------------------------------------------------------
// e2e-niif-17 / e2e-niif-14 — tendencias deterministas en la Parte II
// ---------------------------------------------------------------------------
// Con trends=null el adaptador imprimía "Sin periodo comparativo disponible"
// en un informe "2025 vs 2024"; con trends del modelo, una tendencia "+33,3 %"
// de una pérdida que pasó de −$30M a −$40M salía como cifra.

/** Pérdida: UN −30M (2024) → −40M (2025); ingresos 100M → 80M; patrimonio 70M → 30M. */
const LOSS_TWO = [
  'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
  '110505,Caja general,Auxiliar,1,30000000,5000000',
  '130505,Clientes nacionales,Auxiliar,1,20000000,15000000',
  '152410,Maquinaria,Auxiliar,1,50000000,50000000',
  '152405,Equipo de oficina,Auxiliar,1,50000000,50000000',
  '159205,Depreciacion acumulada equipo,Auxiliar,1,-10000000,-20000000',
  '210505,Bancos nacionales,Auxiliar,1,40000000,45000000',
  '220505,Proveedores nacionales,Auxiliar,1,30000000,25000000',
  '311505,Capital suscrito y pagado,Auxiliar,1,100000000,100000000',
  '360505,Perdida del ejercicio,Auxiliar,1,-30000000,-40000000',
  '370505,Perdidas acumuladas,Auxiliar,1,0,-30000000',
  '410505,Ventas,Auxiliar,1,100000000,80000000',
  '510506,Sueldos,Auxiliar,1,40000000,30000000',
  '516015,Depreciacion equipo,Auxiliar,1,0,10000000',
  '530505,Intereses bancarios,Auxiliar,1,10000000,10000000',
  '613505,Costo de ventas,Auxiliar,1,80000000,70000000',
].join('\n');

describe('e2e-niif-17 — tendencias con comparativo', () => {
  it('trends=null con comparativo: variaciones deterministas, no "Sin periodo comparativo"', async () => {
    queue.push(strategyJson({ trends: null }));
    const res = await run(preprocessTrialBalance(parseTrialBalanceCSV(LOSS_TWO)));
    expect(res.breakEvenAnalysis).not.toContain('Sin periodo comparativo disponible');
    expect(res.breakEvenAnalysis).toContain('- Ingresos YoY: -20,0%');
    expect(res.breakEvenAnalysis).toContain('- Utilidad Neta YoY: -33,3%');
    // EBITDA −20M en ambos años (2025: EBIT −30M + D&A 10M).
    expect(res.breakEvenAnalysis).toContain('- EBITDA YoY: 0,0%');
    expect(res.breakEvenAnalysis).toContain('- Patrimonio YoY: -57,1%');
    expect(res.breakEvenAnalysis).toMatch(/calculadas por el sistema/);
    expect(res.json?.trends?.yoyNetIncome).toBe('-33,3%');
  });

  it('una tendencia del modelo se sustituye por la determinista y el Δ de margen no se imprime como cifra', async () => {
    queue.push(strategyJson({
      trends: {
        yoyRevenue: '+20,0%', yoyEbitda: '+15,0%', yoyNetIncome: '+33,3%', yoyEquity: '+10,0%',
        marginDeltaPp: '+5,0', qualitativeCommentary: 'Comentario del modelo.',
      },
    }));
    const res = await run(preprocessTrialBalance(parseTrialBalanceCSV(LOSS_TWO)));
    expect(res.breakEvenAnalysis).not.toContain('+33,3%');
    expect(res.breakEvenAnalysis).toContain('- Utilidad Neta YoY: -33,3%');
    expect(res.breakEvenAnalysis).toContain('- Δ Margen (pp): N/D');
    expect(res.breakEvenAnalysis).toContain('Comentario del modelo.');
  });

  it('comparativo de saldos de apertura: tendencias del P&G N/D con su motivo; patrimonio sí', async () => {
    queue.push(strategyJson({ trends: null }));
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(LOSS_TWO), { openingPeriods: ['2024'] });
    const res = await run(pp);
    expect(res.breakEvenAnalysis).toContain('- Utilidad Neta YoY: N/D');
    expect(res.breakEvenAnalysis).toContain('- Patrimonio YoY: -57,1%');
    expect(res.breakEvenAnalysis).toMatch(/N\/D: .*saldos de apertura/);
  });

  it('sin comparativo no hay tendencias aunque el modelo las escriba', async () => {
    queue.push(strategyJson({
      trends: {
        yoyRevenue: '+20,0%', yoyEbitda: null, yoyNetIncome: null, yoyEquity: null,
        marginDeltaPp: null, qualitativeCommentary: 'x',
      },
    }));
    const single = LOSS_TWO.split('\n').map((l) => l.split(',').filter((_, i) => i !== 4).join(',')).join('\n');
    const res = await run(preprocessTrialBalance(parseTrialBalanceCSV(single)));
    expect(res.json?.trends).toBeNull();
    expect(res.breakEvenAnalysis).toContain('_Sin periodo comparativo disponible._');
    expect(res.breakEvenAnalysis).not.toContain('+20,0%');
  });
});
